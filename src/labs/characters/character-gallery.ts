import { readPreference, savePreference } from '../../data/preferences';
import { unmatchedMotionNode } from '../../animation/rig-bindings';
import { disposeSceneResources, isMesh } from '../../assets/resource-ownership';
import { applyShadowQuality } from '../../rendering/quality-presets';
import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createRenderer } from '../../rendering/renderer';
import { AreaLightingResources } from '../../rendering/area-lighting';
import { resolveLighting } from '../../levels/lighting';
import { WebGPUPipeline } from '../../rendering/webgpu-pipeline';
import { defaults } from '../../rendering/graphics-settings';
import { markOutline } from '../../rendering/outlines';
import './character-gallery.css';

type Motion = 'idle' | 'run' | 'attack';
type Character = { id: string; name: string; family: string; url: string; thumbnail?: string; status: string; error?: string; motionError?: string; motions: Partial<Record<Motion, { url: string; duration: number }>> };
type Catalog = { version: number; complete: boolean; expectedCount: number; characters: Character[] };
const app = document.querySelector<HTMLDivElement>('#app')!;
document.title = 'Lantern — Characters';
app.innerHTML = `<main class="characters">
  <header><a href="/">← Clearing</a><h1>Characters</h1><a href="/?lab=animations">Animations</a></header>
  <div class="character-layout"><aside>
    <label>Search<input id="character-search" type="search" placeholder="Name…"></label>
    <label>Family<select id="character-family"><option value="all">All</option></select></label>
    <label class="favorite-filter"><input id="favorites-only" type="checkbox"> Favorites</label>
    <p id="roster-status" role="status">Loading…</p><div id="character-list"></div>
  </aside><section class="comparison">
    <div class="comparison-controls"><label>Choose for<select id="target-lane"><option value="0">A</option><option value="1">B</option></select></label>
      <label>View<select id="character-view"><option value="iso">Gameplay angle</option><option value="front">Front</option><option value="side">Side</option><option value="back">Back</option></select></label>
      <label>Motion<select id="character-motion"><option value="static">Rest pose</option><option value="idle">Idle</option><option value="run">Run</option><option value="attack">Attack</option></select></label>
      <button id="character-pause">Pause</button><button id="character-restart">Restart</button>
      <label>Speed<select id="character-speed"><option value="0.5">½</option><option value="1" selected>1×</option></select></label>
    </div><div class="character-stages">${[0, 1].map(i => `<article><div id="stage-${i}" class="character-stage"></div><div class="character-caption"><strong id="name-${i}">${i === 0 ? 'A' : 'B'}</strong><button id="favorite-${i}" disabled aria-label="Favorite ${i === 0 ? 'A' : 'B'}">☆</button></div><p id="info-${i}" role="status">Choose a character</p></article>`).join('')}</div>
  </section></div></main>`;
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const search = el<HTMLInputElement>('character-search');
const family = el<HTMLSelectElement>('character-family');
const favoritesOnly = el<HTMLInputElement>('favorites-only');
const list = el<HTMLDivElement>('character-list');
const rosterStatus = el<HTMLElement>('roster-status');
const target = el<HTMLSelectElement>('target-lane');
const motion = el<HTMLSelectElement>('character-motion');
const pause = el<HTMLButtonElement>('character-pause');
const speed = el<HTMLSelectElement>('character-speed');
const favoriteKey = 'lantern.character-favorites.v1';
const savedFavorites = readPreference(favoriteKey);
const favorites = new Set(Array.isArray(savedFavorites) ? savedFavorites.filter((id): id is string => typeof id === 'string') : []);
const response = await fetch('/vendor/character-gallery/catalog.json');
if (!response.ok) {
  rosterStatus.textContent = 'Character assets missing. Run npm run assets:export-characters, then reload.';
  throw new Error('Character assets missing. Run npm run assets:export-characters, then reload.');
}
const catalog = await response.json() as Catalog;
if (catalog.version !== 1 || !Array.isArray(catalog.characters)) throw new Error('Unsupported character catalog.');
for (const name of [...new Set(catalog.characters.map(row => row.family))].sort()) family.add(new Option(name, name));
const loader = new GLTFLoader();
const settings = defaults();
// Shared Golden lighting; focus blur is disabled for close asset inspection.
settings.dof = 'off'; settings.bloom = 0; settings.ao = 0.3;
const look = resolveLighting();
const camera = new THREE.PerspectiveCamera(33, 1, 0.05, 100);
const stages = await Promise.all([0, 1].map(async index => {
  const mount = el<HTMLDivElement>(`stage-${index}`);
  const renderer = await createRenderer(mount);
  renderer.setPixelRatio(1);
  renderer.setSize(mount.clientWidth, mount.clientHeight);
  const lighting = new AreaLightingResources(renderer);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(look.background); scene.fog = new THREE.Fog(look.background, look.fogNear, look.fogFar); scene.environment = lighting.environmentTexture(look); scene.environmentIntensity = look.environment!.intensity;
  scene.add(new THREE.HemisphereLight(look.ambient.sky, look.ambient.ground, look.ambient.intensity));
  const sun = new THREE.DirectionalLight(look.sun.color, look.sun.intensity); sun.position.fromArray(look.sun.position); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); scene.add(sun);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new MeshStandardNodeMaterial({ color: '#303b43', roughness: 1 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -0.015; floor.receiveShadow = true; scene.add(floor);
  const laneCamera = camera.clone(); laneCamera.aspect = mount.clientWidth / mount.clientHeight;
  const focus = new THREE.Vector3(0, 0.9, 0);
  applyShadowQuality(scene, settings.shadowQuality);
  const pipeline = new WebGPUPipeline(renderer, scene, laneCamera, focus); pipeline.configure(settings, look.saturation ?? 1, look); await pipeline.ready();
  return { index, mount, renderer, lighting, scene, camera: laneCamera, pipeline, focus, generation: 0, motionGeneration: 0, character: undefined as Character | undefined, model: undefined as THREE.Group | undefined, mixer: undefined as THREE.AnimationMixer | undefined, action: undefined as THREE.AnimationAction | undefined, error: '', clips: new Map<Motion, THREE.AnimationClip>(), release: () => {} };
}));
const controls = new OrbitControls(camera, document.querySelector<HTMLElement>('.character-stages'));
controls.target.set(0, 0.9, 0); controls.enablePan = false; controls.minDistance = 0.35; controls.maxDistance = 9; controls.maxPolarAngle = Math.PI * 0.9;
function setView(view: string, distance = 5.2, height = 0.9): void {
  controls.target.set(0, height, 0);
  const scale = distance / 5.2;
  const offset = view === 'front' ? new THREE.Vector3(0, 0.3 * scale, distance) : view === 'side' ? new THREE.Vector3(distance, 0.3 * scale, 0) : view === 'back' ? new THREE.Vector3(0, 0.3 * scale, -distance) : new THREE.Vector3(3.3, 4.7, 3.3).multiplyScalar(scale);
  camera.position.copy(controls.target).add(offset); controls.update(); stages.forEach(stage => stage.pipeline.resetHistory());
}
setView('iso');
let playing = true;
let capturing = false;
let disposed = false;
function refreshCaption(index: number): void {
  const stage = stages[index], row = stage.character;
  el(`name-${index}`).textContent = `${index === 0 ? 'A' : 'B'} · ${row?.name ?? 'Choose a character'}`;
  const favorite = el<HTMLButtonElement>(`favorite-${index}`); favorite.disabled = !row;
  favorite.textContent = row && favorites.has(row.id) ? '★' : '☆'; favorite.setAttribute('aria-pressed', String(!!row && favorites.has(row.id)));
  const selected = motion.value as Motion;
  el(`info-${index}`).textContent = stage.error || (!row ? 'Choose a character' : `${row.family} · ${motion.value === 'static' ? 'Rest pose' : stage.action ? selected[0].toUpperCase() + selected.slice(1) : 'Motion unavailable'}`);
}
function drawList(): void {
  const query = search.value.trim().toLowerCase();
  const rows = catalog.characters.filter(row => (family.value === 'all' || row.family === family.value) && (!favoritesOnly.checked || favorites.has(row.id)) && `${row.name} ${row.family}`.toLowerCase().includes(query));
  rosterStatus.textContent = `${rows.length} / ${catalog.characters.length}${catalog.complete ? '' : ' · Export incomplete'}`;
  list.replaceChildren(...rows.map(row => {
    const button = document.createElement('button'); button.className = 'character-card'; button.dataset.character = row.id;
    const image = document.createElement('img'); if (row.thumbnail) image.src = row.thumbnail; else image.hidden = true; image.alt = ''; image.loading = 'lazy'; image.onerror = () => { image.hidden = true; };
    const name = document.createElement('span'); name.textContent = `${favorites.has(row.id) ? '★ ' : ''}${row.name}`;
    const pack = document.createElement('small'); pack.textContent = row.family;
    button.append(image, name, pack); button.addEventListener('click', () => void select(Number(target.value), row.id).catch(previewFailed)); return button;
  }));
}
function previewFailed(error: unknown): void { console.error('Unable to update character preview.', error); }
async function applyMotion(index: number, generation: number): Promise<void> {
  const stage = stages[index], row = stage.character, model = stage.model;
  const motionGeneration = ++stage.motionGeneration;
  if (!row || !model) return;
  stage.mixer?.stopAllAction(); stage.action = undefined;
  // Restore authored rest transforms before changing or disabling animation.
  stage.mixer?.update(0);
  const role = motion.value as Motion;
  if (motion.value === 'static' || !row.motions[role]) { refreshCaption(index); stage.pipeline.resetHistory(); return; }
  try {
    let clip = stage.clips.get(role);
    if (!clip) {
      const gltf = await loader.loadAsync(row.motions[role].url);
      clip = gltf.animations[0];
      if (!clip) throw new Error('Motion has no animation');
      disposeSceneResources(gltf.scene);
      const missing = unmatchedMotionNode(model, [clip]);
      if (missing !== undefined) throw new Error(`Motion does not match skeleton: ${missing}`);
      if (stage.generation !== generation || stage.motionGeneration !== motionGeneration || disposed) return;
      stage.clips.set(role, clip);
    }
    if (stage.generation !== generation || stage.motionGeneration !== motionGeneration || disposed) return;
    stage.action = stage.mixer!.clipAction(clip); stage.action.reset().play(); stage.mixer!.update(0);
    stage.pipeline.resetHistory(); refreshCaption(index);
  } catch (error) { if (stage.generation === generation && stage.motionGeneration === motionGeneration) { stage.error = `Motion unavailable: ${String(error)}`; refreshCaption(index); } }
}
async function select(index: number, id: string): Promise<void> {
  const stage = stages[index], row = catalog.characters.find(character => character.id === id);
  if (!row) throw new Error(`Unknown character: ${id}`);
  const generation = ++stage.generation;
  stage.release(); stage.model = undefined; stage.mixer = undefined; stage.action = undefined; stage.clips.clear(); stage.character = row; stage.error = 'Loading…'; refreshCaption(index);
  try {
    if (row.status !== 'ready') throw new Error(row.error ?? 'Model not converted');
    const gltf = await loader.loadAsync(row.url);
    if (stage.generation !== generation || disposed) { disposeSceneResources(gltf.scene); return; }
    const model = gltf.scene;
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model), height = box.getSize(new THREE.Vector3()).y;
    if (!Number.isFinite(height) || height <= 0) { disposeSceneResources(model); throw new Error('Model has no visible body'); }
    // Parent normalization preserves skeletal root transforms and original proportions.
    const wrapper = new THREE.Group(); wrapper.add(model); wrapper.scale.setScalar(1.8 / height); wrapper.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(wrapper), center = bounds.getCenter(new THREE.Vector3()); wrapper.position.set(-center.x, -bounds.min.y, -center.z);
    model.traverse(object => { if (isMesh(object)) { object.castShadow = true; object.receiveShadow = true; } });
    markOutline(model, 'actor');
    stage.scene.add(wrapper); stage.model = model; stage.mixer = new THREE.AnimationMixer(model);
    stage.release = () => { stage.mixer?.stopAllAction(); stage.mixer?.uncacheRoot(model); wrapper.removeFromParent(); disposeSceneResources(model); stage.release = () => {}; };
    stage.error = ''; stage.pipeline.resetHistory(); await applyMotion(index, generation); refreshCaption(index);
  } catch (error) { if (stage.generation === generation) { stage.error = `Model unavailable: ${String(error)}`; refreshCaption(index); } }
}
function resize(): void { for (const stage of stages) {
  stage.renderer.setSize(stage.mount.clientWidth, stage.mount.clientHeight); stage.camera.aspect = stage.mount.clientWidth / stage.mount.clientHeight; stage.camera.updateProjectionMatrix(); stage.pipeline.resize();
} }
const observer = new ResizeObserver(resize); stages.forEach(stage => observer.observe(stage.mount));
search.addEventListener('input', drawList); family.addEventListener('change', drawList); favoritesOnly.addEventListener('change', drawList);
el<HTMLSelectElement>('character-view').addEventListener('change', event => setView((event.target as HTMLSelectElement).value));
motion.addEventListener('change', () => { for (const stage of stages) { stage.error = ''; void applyMotion(stage.index, stage.generation).catch(previewFailed); } });
pause.addEventListener('click', () => { playing = !playing; pause.textContent = playing ? 'Pause' : 'Play'; });
el('character-restart').addEventListener('click', () => { stages.forEach(stage => { stage.action?.reset(); stage.mixer?.update(0); stage.pipeline.resetHistory(); }); });
for (const stage of stages) el(`favorite-${stage.index}`).addEventListener('pointerdown', event => event.stopPropagation());
for (const stage of stages) el(`favorite-${stage.index}`).addEventListener('click', () => {
  const row = stage.character; if (!row) return;
  if (favorites.has(row.id)) favorites.delete(row.id); else favorites.add(row.id);
  savePreference(favoriteKey, [...favorites]);
  stages.forEach(stage => refreshCaption(stage.index)); drawList();
});
let last = performance.now();
function render(now: number): void {
  if (disposed) return;
  const dt = Math.min(0.05, (now - last) / 1000); last = now; controls.update();
  for (const stage of stages) {
    if (capturing && stage.index !== 0) continue;
    stage.camera.position.copy(camera.position); stage.camera.quaternion.copy(camera.quaternion); stage.focus.copy(controls.target);
    if (playing) stage.mixer?.update(dt * Number(speed.value));
    try { stage.pipeline.render(); } catch (error) { stage.error = `Graphics unavailable: ${String(error)}`; refreshCaption(stage.index); disposed = true; return; }
  }
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
drawList();
const first = catalog.characters.find(row => row.name === 'Paladin J Nordstrom') ?? catalog.characters[0];
const second = catalog.characters.find(row => row.name === 'Goblin D Shareyko') ?? catalog.characters[1];
await Promise.all([first && select(0, first.id), second && select(1, second.id)]);
// Local capture tooling uses the same rendered scene and rig checks as the gallery.
const bridge = {
  catalog: () => catalog,
  diagnostics: () => stages.map(stage => ({ id: stage.character?.id, error: stage.error, motion: motion.value, animated: !!stage.action, ...stage.pipeline.diagnostics() })),
  select,
  frame: setView,
  async capture(id: string, role = 'static', seconds = 0): Promise<string> {
    capturing = true; playing = false; pause.textContent = 'Play'; motion.value = role; setView('iso');
    await select(0, id);
    const stage = stages[0]; if (stage.error) throw new Error(stage.error);
    stage.mixer?.setTime(seconds); stage.pipeline.resetHistory();
    for (let frame = 0; frame < 20; frame++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    return stage.renderer.domElement.toDataURL('image/png');
  },
};
if (import.meta.env.DEV) Object.assign(window, { lanternCharacters: bridge });
window.addEventListener('pagehide', () => { disposed = true; observer.disconnect(); controls.dispose(); for (const stage of stages) { stage.generation++; stage.release(); stage.pipeline.dispose(); stage.lighting.dispose(); disposeSceneResources(stage.scene); void stage.renderer.dispose().catch((error: unknown) => console.error('Unable to release graphics.', error)); } }, { once: true });
