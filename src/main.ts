import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { defaultSelection, loadCombatMotions, motionStates, stateChoices, type CombatMotions, type MotionCatalog, type MotionSelection } from './combat-animations';
import { createEncounter, resetEncounter, attack, stepEncounter, type EncounterEvent, type ActorId, type Timings } from './encounter';
import './options.css';
import { defaultCameraZoom, readSettings, usesWebGPU } from './graphics-settings';
import type { GraphicsOptions } from './art-lab';
import type { WebGPURenderer } from 'three/webgpu';
const renderQuery = new URLSearchParams(location.search);
// Legacy lab URLs open the same clearing and Options UI.
if (['art', 'renderers'].includes(renderQuery.get('lab') ?? '')) {
  const url = new URL(location.href); for (const key of ['lab', 'space', 'look', 'surface', 'edges']) url.searchParams.delete(key); history.replaceState({}, '', url.href);
}
window.addEventListener('error', (event) => {
  const message = event.error instanceof Error ? event.error.stack ?? event.message : event.message;
  document.getElementById('scene')!.dataset.renderError = message;
});
const useWebGPU = usesWebGPU(readSettings().aa);
let artLab: GraphicsOptions | undefined;

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const mount = element<HTMLDivElement>('scene');
const status = element<HTMLParagraphElement>('asset-status');
const rockFocus = element<HTMLButtonElement>('rock-focus');
const phaseLabel = element<HTMLParagraphElement>('phase-label');
const playerHealth = element<HTMLDivElement>('player-health');
const enemyHealth = element<HTMLDivElement>('enemy-health');
const resultPanel = element<HTMLDivElement>('result-panel');
const resultTitle = element<HTMLHeadingElement>('result-title');
const resultCopy = element<HTMLParagraphElement>('result-copy');
const retry = element<HTMLButtonElement>('retry');
const playerMotions = element<HTMLSelectElement>('player-motions');
const enemyMotions = element<HTMLSelectElement>('enemy-motions');
const motionStatus = element<HTMLParagraphElement>('motion-status');
const moveSelectors = Object.fromEntries(motionStates.map((state) => [state, element<HTMLSelectElement>(`motion-${state}`)])) as Record<ClipName, HTMLSelectElement>;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#213839');
scene.fog = new THREE.Fog('#213839', 22, 45);
const camera = new THREE.OrthographicCamera(-9, 9, 6, -6, 0.1, 100);
const cameraOffset = new THREE.Vector3(12, 12.5, 12);
camera.position.copy(cameraOffset);
let renderer: THREE.WebGLRenderer | WebGPURenderer;
if (useWebGPU) {
  const { WebGPURenderer } = await import('three/webgpu');
  const gpu = new WebGPURenderer({ antialias: false });
  try {
    await gpu.init();
    if (!Reflect.get(gpu.backend, 'isWebGPUBackend')) throw new Error('Native WebGPU backend unavailable.');
    renderer = gpu;
  } catch (error) {
    gpu.dispose();
    document.body.dataset.rendererFallback = `WebGPU unavailable; using WebGL SMAA. ${String(error)}`;
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  }
} else renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
renderer.domElement.tabIndex = 0;
renderer.domElement.setAttribute('aria-label', 'Playable clearing. WASD or arrows to move, Space to attack.');
renderer.domElement.addEventListener('pointerdown', () => renderer.domElement.focus());
mount.append(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableRotate = false;
controls.enablePan = false;
controls.enableDamping = false;
controls.minZoom = 0.9;
controls.maxZoom = 2;
camera.zoom = defaultCameraZoom;
camera.updateProjectionMatrix();
controls.target.set(0, 0.9, 0);
camera.position.copy(controls.target).add(cameraOffset);
controls.update();
const ambient = new THREE.HemisphereLight('#dbe7dd', '#4b5846', 2.1);
scene.add(ambient);
const sun = new THREE.DirectionalLight('#ffe5b7', 3.1);
sun.position.set(-7, 13, 9);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -10;
sun.shadow.camera.right = 10;
sun.shadow.camera.top = 10;
sun.shadow.camera.bottom = -10;
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 40;
sun.shadow.normalBias = 0.025;
sun.shadow.bias = -0.00015;
sun.shadow.radius = 2;
scene.add(sun);
const material = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 1 });
const ground = new THREE.Mesh(new THREE.CylinderGeometry(8.1, 8.4, 0.55, 72), material('#485c48'));
ground.position.y = -0.32;
ground.receiveShadow = true;
scene.add(ground);
const rim = new THREE.Mesh(new THREE.CylinderGeometry(8.4, 8.3, 0.5, 72), material('#303b38'));
rim.position.y = -0.47;
rim.receiveShadow = true;
scene.add(rim);
const pebbleGeometry = new THREE.DodecahedronGeometry(0.16, 0);
const pebbleMaterial = material('#8b9680');
for (let i = 0; i < 52; i++) {
  const angle = i * 2.39996;
  const radius = 2.2 + Math.sqrt(i / 52) * 5.7;
  const pebble = new THREE.Mesh(pebbleGeometry, pebbleMaterial);
  pebble.position.set(Math.cos(angle) * radius, 0.04, Math.sin(angle) * radius);
  pebble.scale.setScalar(0.5 + (i % 5) * 0.16);
  pebble.castShadow = true;
  scene.add(pebble);
}

type Kind = 'pine' | 'rock' | 'chest';
type Placement = { x: number; z: number; rotation?: number; height: number };
const layouts: Record<Kind, Placement[]> = {
  pine: [{ x: -3.2, z: -1.3, height: 5.4 }, { x: 3.5, z: -2.2, height: 4.3, rotation: 0.8 }, { x: -4.6, z: 2.7, height: 3.4, rotation: 1.6 }],
  rock: [{ x: 3.1, z: 2.3, height: 1.35, rotation: 0.4 }, { x: -1.8, z: 3.6, height: 0.95, rotation: 1.8 }],
  chest: [{ x: 0.55, z: 0.25, height: 1.05, rotation: -0.65 }],
};
function placeModel(source: THREE.Group, placement: Placement): THREE.Group {
  const model = source.clone(true);
  model.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  if (size.y <= 0) throw new Error('Model has no visible height');
  model.scale.multiplyScalar(placement.height / size.y);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.set(placement.x - center.x, -box.min.y, placement.z - center.z);
  model.rotation.y += placement.rotation ?? 0;
  model.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  scene.add(model);
  return model;
}

type ClipName = 'idle' | 'run' | 'attack' | 'hit' | 'death';
type Actor = { root: THREE.Group; mixer: THREE.AnimationMixer | null; actions: Partial<Record<ClipName, THREE.AnimationAction>>; current: ClipName | null; moveSpeed: number; runSpeed: number; contacts: number[] };
const encounter = createEncounter();
function makeActor(id: ActorId): Actor {
  const root = new THREE.Group();
  const state = encounter[id];
  root.position.set(state.x, 0.04, state.z);
  scene.add(root);
  return { root, mixer: null, actions: {}, current: null, moveSpeed: state.speed, runSpeed: 3, contacts: [] };
}
const player = makeActor('player');
const enemy = makeActor('enemy');
let inspecting = false;
let motionLoading = false;
const keys = new Set<string>();
function play(actor: Actor, name: ClipName): void {
  if (actor.current === name && (name === 'idle' || name === 'run')) return;
  const next = actor.actions[name];
  if (!next) return;
  if (actor.current) actor.actions[actor.current]?.fadeOut(0.12);
  next.reset().setEffectiveTimeScale(name === 'run' ? actor.moveSpeed / actor.runSpeed : 1).fadeIn(0.12).play();
  actor.current = name;
}
function attachCharacter(actor: Actor, source: THREE.Group, clips: THREE.AnimationClip[], color: string): void {
  const model = cloneSkeleton(source);
  model.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
      const tinted = (object.material as THREE.MeshStandardMaterial).clone();
      tinted.color.set(color);
      object.material = tinted;
    }
  });
  model.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  model.scale.multiplyScalar(1.8 / size.y);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  model.position.y -= box.min.y;
  actor.root.add(model);
  actor.mixer = new THREE.AnimationMixer(model);
  installActions(actor, Object.fromEntries(motionStates.map((state) => {
    const clip = clips.find((item) => item.name === state);
    if (!clip) throw new Error(`Missing character animation: ${state}`);
    return [state, clip];
  })) as Record<ClipName, THREE.AnimationClip>);
  actor.contacts = [duration(actor, 'attack') * 0.42];
  play(actor, 'idle');
}
function duration(actor: Actor, state: ClipName): number { return actor.actions[state]?.getClip().duration ?? 0; }
function installActions(actor: Actor, clips: Record<ClipName, THREE.AnimationClip>): void {
  const mixer = actor.mixer!;
  mixer.stopAllAction();
  for (const action of Object.values(actor.actions)) if (action) mixer.uncacheClip(action.getClip());
  actor.actions = {};
  actor.current = null;
  for (const state of motionStates) {
    const action = mixer.clipAction(clips[state]);
    if (state !== 'idle' && state !== 'run') { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; }
    actor.actions[state] = action;
  }
}
function installMotions(actor: Actor, motions: CombatMotions): void {
  installActions(actor, motions.clips);
  actor.contacts = motions.contacts;
  actor.runSpeed = motions.runSpeed;
}
const hearts = (count: number, max: number) => Array.from({ length: max }, (_, i) => i < count ? '◆' : '◇').join(' ');
function updateHud(): void {
  playerHealth.textContent = hearts(encounter.player.hp, 5);
  enemyHealth.textContent = hearts(encounter.enemy.hp, 4);
}
function finish(won: boolean): void {
  resultTitle.textContent = won ? 'Victory' : 'Defeat';
  resultCopy.textContent = '';
  resultPanel.hidden = false;
  phaseLabel.textContent = won ? 'VICTORY' : 'DEFEAT';
}
function present(events: EncounterEvent[]): void {
  for (const id of ['player', 'enemy'] as ActorId[]) {
    const actor = id === 'player' ? player : enemy;
    actor.root.position.set(encounter[id].x, 0.04, encounter[id].z);
    actor.root.rotation.y = encounter[id].yaw;
  }
  for (const event of events) {
    if (event.type === 'label') phaseLabel.textContent = event.value === 'MOVE TO BEGIN' ? 'READY' : event.value === 'DEFEAT THE RAIDER' ? 'COMBAT' : event.value;
    else if (event.type === 'outcome') finish(event.won);
    else {
      const actor = event.actor === 'player' ? player : enemy;
      if (event.type === 'animation') play(actor, event.motion);
      else artLab?.effects.burst('hit', actor.root.position);
    }
  }
  updateHud();
}
function reset(): void {
  artLab?.effects.clear();
  resultPanel.hidden = true;
  for (const actor of [player, enemy]) {
    actor.mixer?.stopAllAction();
    actor.current = null;
  }
  present(resetEncounter(encounter));
  artLab?.resetHistory();
}
retry.addEventListener('click', () => { if (!motionLoading) { reset(); renderer.domElement.focus(); } });

const loader = new GLTFLoader();
const originalRocks: THREE.Group[] = [];
async function loadEnvironment(): Promise<void> {
  let loaded = 0;
  await Promise.all((['pine', 'rock', 'chest'] as const).map(async (kind) => {
    try {
      const gltf = await loader.loadAsync(`/vendor/synty/${kind}.glb`);
      for (const placement of layouts[kind]) {
        const model = placeModel(gltf.scene, placement);
        if (kind === 'rock') originalRocks.push(model);
        if (kind === 'pine') model.userData.foliage = true;
      }
      loaded++;
    } catch { /* Local private art may be absent. */ }
  }));
  status.textContent = loaded === 3 ? '' : 'Missing environment art.';
  rockFocus.disabled = originalRocks.length === 0;
}
rockFocus.addEventListener('click', () => {
  keys.clear();
  inspecting = !inspecting;
  rockFocus.hidden = !inspecting;
  rockFocus.textContent = 'Return';
  if (inspecting) {
    controls.target.set(layouts.rock[0].x, 0.7, layouts.rock[0].z);
    camera.position.copy(controls.target).add(cameraOffset);
    camera.zoom = 2;
  } else camera.zoom = defaultCameraZoom;
  camera.updateProjectionMatrix();
  controls.update();
  artLab?.resetHistory();
});
window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if (event.target instanceof HTMLElement && event.target.closest('select, input, button, summary, a')) return;
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowleft', 'arrowdown', 'arrowright', ' '].includes(key)) event.preventDefault();
  keys.add(key);
  if (key === ' ' && !event.repeat) startAttack();
});
window.addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());
function paused(): boolean { return Boolean(artLab?.paused || inspecting || motionLoading); }
function timings(): Timings {
  const timing = (actor: Actor) => ({ attack: duration(actor, 'attack'), hit: duration(actor, 'hit'), contacts: actor.contacts });
  return { player: timing(player), enemy: timing(enemy) };
}
function startAttack(): void { present(attack(encounter, timings().player, paused())); }
function updateGame(dt: number): void {
  const forward = Number(keys.has('w') || keys.has('arrowup')) - Number(keys.has('s') || keys.has('arrowdown'));
  const right = Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft'));
  present(stepEncounter(encounter, dt, { x: -forward + right, z: -forward - right, paused: paused() }, timings()));
}
function resize(): void {
  const width = mount.clientWidth;
  const height = mount.clientHeight;
  const aspect = width / height;
  const viewHeight = window.innerWidth < 720 ? 15 : 13.5;
  camera.left = -viewHeight * aspect / 2;
  camera.right = viewHeight * aspect / 2;
  camera.top = viewHeight / 2;
  camera.bottom = -viewHeight / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  artLab?.resize();
}
window.addEventListener('resize', resize);
resize();
let motionCatalog: MotionCatalog;
let activePlayerPack = 'mixamo';
let activeEnemyPack = 'mixamo';
let activePlayerSelection: MotionSelection;
function enableMotionControls(enabled: boolean): void {
  playerMotions.disabled = enemyMotions.disabled = !enabled;
  for (const select of Object.values(moveSelectors)) select.disabled = !enabled;
}
function renderMoveChoices(packId: string, selection: MotionSelection): void {
  for (const state of motionStates) {
    const select = moveSelectors[state];
    select.replaceChildren(...stateChoices(motionCatalog, packId, state).map((choice) => new Option(choice.clip.description ? `${choice.clip.name} · ${choice.clip.description}` : choice.clip.name, choice.value)));
    select.value = selection[state];
  }
}

async function changeMotions(who: 'player' | 'enemy', packId: string, selection: MotionSelection): Promise<void> {
  if (motionLoading) return;
  motionLoading = true;
  keys.clear();
  enableMotionControls(false);
  retry.disabled = true;
  motionStatus.textContent = 'Loading motion set…';
  try {
    const motions = await loadCombatMotions(loader, motionCatalog, packId, selection);
    installMotions(who === 'player' ? player : enemy, motions);
    if (who === 'player') { activePlayerPack = packId; activePlayerSelection = selection; renderMoveChoices(packId, selection); }
    else activeEnemyPack = packId;
    reset();
    motionStatus.textContent = '';
  } catch (error) {
    playerMotions.value = activePlayerPack;
    enemyMotions.value = activeEnemyPack;
    renderMoveChoices(activePlayerPack, activePlayerSelection);
    motionStatus.textContent = `Could not load those motions. ${String(error)}`;
  } finally { motionLoading = false; enableMotionControls(true); retry.disabled = false; }
}
async function initializeMotionSets(): Promise<void> {
  motionLoading = true;
  try {
    const response = await fetch('/vendor/animations/catalog.json');
    if (!response.ok) throw new Error('Export the animation lab to enable the other sets.');
    motionCatalog = await response.json() as MotionCatalog;
    if (motionCatalog.version !== 1 || !motionCatalog.packs?.length) throw new Error('Animation catalog unavailable.');
    // Only retained humanoid libraries are usable as encounter sets.
    motionCatalog.packs = motionCatalog.packs.filter((pack) => pack.id === 'mixamo');
    for (const select of [playerMotions, enemyMotions]) {
      select.replaceChildren(...motionCatalog.packs.map((pack) => new Option(pack.label, pack.id)));
      select.value = 'mixamo';
    }
    activePlayerSelection = defaultSelection(motionCatalog, activePlayerPack);
    const enemySelection = defaultSelection(motionCatalog, activeEnemyPack);
    const motions = await Promise.all([loadCombatMotions(loader, motionCatalog, activePlayerPack, activePlayerSelection), loadCombatMotions(loader, motionCatalog, activeEnemyPack, enemySelection)]);
    installMotions(player, motions[0]); installMotions(enemy, motions[1]);
    renderMoveChoices(activePlayerPack, activePlayerSelection);
    reset(); enableMotionControls(true);
    motionStatus.textContent = '';
    playerMotions.addEventListener('change', () => { void changeMotions('player', playerMotions.value, defaultSelection(motionCatalog, playerMotions.value)); });
    enemyMotions.addEventListener('change', () => { void changeMotions('enemy', enemyMotions.value, defaultSelection(motionCatalog, enemyMotions.value)); });
    for (const select of Object.values(moveSelectors)) select.addEventListener('change', () => {
      const selection = Object.fromEntries(motionStates.map((state) => [state, moveSelectors[state].value])) as MotionSelection;
      void changeMotions('player', activePlayerPack, selection);
    });
  } catch (error) {
    for (const select of [playerMotions, enemyMotions]) select.replaceChildren(new Option('Exported Mixamo set', 'compiled'));
    motionStatus.textContent = `Using the exported Mixamo set. ${String(error)}`;
  }
  finally { motionLoading = false; }
}
const clock = new THREE.Clock();
function tick(): void {
  const dt = Math.min(clock.getDelta(), 0.05);
  updateGame(dt);
  if (!inspecting && !artLab?.paused) {
    const target = player.root.position.clone().add(new THREE.Vector3(0, 0.9, 0));
    if (controls.target.distanceToSquared(target) < 1e-8) controls.target.copy(target);
    else controls.target.lerp(target, 1 - Math.exp(-dt * 5));
    // Ease the focus point only; a second camera lerp changes the isometric angle and distance.
    camera.position.copy(controls.target).add(cameraOffset);
  }
  for (const actor of [player, enemy]) actor.mixer?.update(inspecting || motionLoading || artLab?.paused ? 0 : dt);
  renderer.domElement.style.filter = encounter.invulnerability > 0 && Math.floor(encounter.invulnerability * 10) % 2 === 0 ? 'brightness(1.15)' : '';
  controls.update();
  if (artLab) artLab.render(dt);
  else renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();
await Promise.all([loadEnvironment(), (async () => {
  try {
    const gltf = await loader.loadAsync('/vendor/characters/prototype.glb');
    attachCharacter(player, gltf.scene, gltf.animations, '#d7c89c');
    attachCharacter(enemy, gltf.scene, gltf.animations, '#bc7558');
    reset();
    await initializeMotionSets();
  } catch (error) {
    phaseLabel.textContent = 'CHARACTER IMPORT NEEDED';
    status.textContent = `Character unavailable. Download Mixamo sources, export the animation lab, then export the character. ${String(error)}`;
  }
})()]);

{
  const { GraphicsOptions } = await import('./art-lab');
  artLab = new GraphicsOptions({ scene, camera, renderer, controls, sun, ambient, player: player.root, enemy: enemy.root, ground, rocks: originalRocks, resetEncounter: reset, clearInput: () => keys.clear() });
  resize();
  await artLab.load();
}
