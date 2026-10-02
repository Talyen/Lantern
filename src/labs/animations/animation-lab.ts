import { applyShadowQuality } from '../../rendering/quality-presets';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createRenderer } from '../../rendering/renderer';
import { WebGPUPipeline } from '../../rendering/webgpu-pipeline';
import { resolveLighting } from '../../levels/lighting';
import { AreaLightingResources } from '../../rendering/area-lighting';
import { readSettings } from '../../rendering/graphics-settings';
import { markOutline } from '../../rendering/outlines';
import { Equipment } from '../../rendering/equipment';
import { assetLibrary } from '../../assets/asset-library';
import { getMotionCatalog, loadEquipmentMotions, holdStaffArm, type MotionCatalog, type MotionClip, type MotionPack } from '../../animation/combat-animations';
import type { RigId } from '../../animation/combat-animations';
import type { Loadout } from '../../gameplay/equipment';
import './animation-lab.css';
import characters from '../../../assets/playable-characters.json';

type Clip = MotionClip & { mappedBones?: number; auditRole?: string };
type Pack = Omit<MotionPack, 'clips'> & { license?: string; url?: string; clips: Clip[] };
type Catalog = Omit<MotionCatalog, 'packs'> & { character: string; characterLabel: string; motion: string; packs: Pack[] };
type Favorite = { pack: string; clip: string };
type Lane = { group: THREE.Group; rig: RigId; rigLoading: boolean; catalog?: Catalog; source?: THREE.Group; equipment?: Equipment; loadout: Loadout; model?: THREE.Group; mixer?: THREE.AnimationMixer; action?: THREE.AnimationAction; clip?: Clip; pack?: Pack; generation: number; rigSelect: HTMLSelectElement; loadoutSelect: HTMLSelectElement; packSelect: HTMLSelectElement; clipSelect: HTMLSelectElement; search: HTMLInputElement; info: HTMLElement; favorite: HTMLButtonElement; timing: HTMLElement };
const loadouts: Record<string, Loadout> = { axe: { main: 'axe', off: null }, 'axe-shield': { main: 'axe', off: 'shield' }, sword: { main: 'sword', off: null }, 'sword-shield': { main: 'sword', off: 'shield' }, bow: { main: 'bow', off: null }, staff: { main: 'staff', off: null } };
const loadoutNames: Record<string, string> = { axe: 'Axe', 'axe-shield': 'Axe + Shield', sword: 'Sword', 'sword-shield': 'Sword + Shield', bow: 'Bow', staff: 'Staff' };
document.title = 'Lantern — Animation Comparison';
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <main class="animation-lab">
    <header class="lab-header"><div><a href="/">← Return to clearing</a><h1>Animations</h1><p id="lab-status" role="status">Loading local animation library…</p></div></header>
    <section class="lab-stage" aria-label="Side by side animation preview"><div id="lab-canvas"></div><div class="stage-label stage-label-a">A</div><div class="stage-label stage-label-b">B</div><div class="stage-tip">Drag to orbit · scroll to zoom</div></section>
    <section class="lab-toolbar" aria-label="Playback controls">
      <label>Show <select id="lab-category"><option value="all">All motions</option><option value="attack" selected>Attacks</option><option value="idle">Idles</option><option value="run">Running</option><option value="directional">Backward & strafe</option><option value="walk">Walking</option><option value="hit">Hit reactions</option><option value="death">Deaths</option><option value="block">Blocking</option><option value="chop">Chopping</option><option value="dodge">Dodges & rolls</option><option value="movement">Other movement</option><option value="other">Interactions & emotes</option><option value="favorites">Favorites</option></select></label>
      <button id="lab-pause" disabled>Pause</button><button id="lab-restart" disabled>Restart both</button><button id="lab-step" disabled>Step 1 frame</button>
      <label>Speed <select id="lab-speed"><option value="0.25">¼ speed</option><option value="0.5">½ speed</option><option value="1" selected>Normal</option><option value="1.5">1½ speed</option></select></label>
      <label class="lab-check"><input id="lab-loop" type="checkbox" checked> Loop</label>
      <label class="lab-check"><input id="lab-sync" type="checkbox"> Match cycle lengths</label>
      <label>View <select id="lab-view"><option value="iso">Isometric</option><option value="front">Front</option><option value="side">Side</option><option value="back">Back</option></select></label>
      <label class="lab-timeline">Scrub <input id="lab-scrub" type="range" min="0" max="1" step="0.001" value="0" disabled><output id="lab-time">0.00 s</output></label>
    </section>
    <section class="lab-lanes" aria-label="Animation selections">
      ${['a', 'b'].map((id) => `<article class="lane-card"><div class="lane-heading"><span>${id.toUpperCase()}</span><button id="${id}-favorite" disabled>☆ Save favorite</button></div><div class="lane-loadout"><label>Character<select id="${id}-rig"><option value="player">Player</option><option value="enemy">Goblin</option></select></label><label>Equipment<select id="${id}-loadout">${Object.keys(loadouts).map(key => `<option value="${key}">${loadoutNames[key]}</option>`).join('')}</select></label></div><label>Animation library<select id="${id}-pack" disabled></select></label><label>Find a motion<input id="${id}-search" type="search" placeholder="Sword, bow, magic, chop…" autocomplete="off"></label><label>Motion<select id="${id}-clip" disabled></select></label><div id="${id}-timing" class="lane-timing"></div><p id="${id}-info">Waiting for assets…</p></article>`).join('')}
    </section>
    <details class="lab-notes"><summary>How to compare</summary><p>Normal speed shows the prepared gameplay timing. Match cycle lengths aligns poses by progress. Pause, scrub, or jump to the amber contact/release marker to inspect feet, grip and recovery. Equipment previews do not change the character save. Each lane only plays motions prepared for its selected rig; equipment selections leave all compatible clips available.</p></details>
  </main>`;
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = el<HTMLElement>('lab-status');
const canvas = el<HTMLDivElement>('lab-canvas');
const category = el<HTMLSelectElement>('lab-category');
const pause = el<HTMLButtonElement>('lab-pause');
const restart = el<HTMLButtonElement>('lab-restart');
const step = el<HTMLButtonElement>('lab-step');
const speed = el<HTMLSelectElement>('lab-speed');
const loop = el<HTMLInputElement>('lab-loop');
const sync = el<HTMLInputElement>('lab-sync');
const scrub = el<HTMLInputElement>('lab-scrub');
const time = el<HTMLOutputElement>('lab-time');
let disposed = false;
let playing = true;
let seconds = 0;
let progress = 0;
let favorites: Favorite[] = [];
try { const value: unknown = JSON.parse(localStorage.getItem('lantern-animation-favorites') ?? '[]'); if (Array.isArray(value)) favorites = value.filter((f): f is Favorite => !!f && typeof f.pack === 'string' && typeof f.clip === 'string'); } catch { /* Storage can be unavailable. */ }
const retainedFavorites = favorites.filter((favorite) => favorite.pack === 'mixamo');
if (retainedFavorites.length !== favorites.length) {
  favorites = retainedFavorites;
  try { localStorage.setItem('lantern-animation-favorites', JSON.stringify(favorites)); } catch { /* Preview still works without storage. */ }
}
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(33, 1, 0.1, 50);
camera.position.set(2.8, 2.6, 5.2);
// Each comparison lane uses the shared graph, with independent render state/history.
const settings = readSettings();
const mounts = ['a', 'b'].map((id) => { const mount = document.createElement('div'); mount.dataset.lane = id; canvas.append(mount); return mount; });
const renderers: Awaited<ReturnType<typeof createRenderer>>[] = [];
for (const mount of mounts) renderers.push(await createRenderer(mount));
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.9, 0);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 3.5;
controls.maxDistance = 14;
controls.maxPolarAngle = Math.PI * 0.49;
controls.update();
const look = resolveLighting();
scene.background = new THREE.Color(look.background);
scene.fog = new THREE.Fog(look.background, look.fogNear, look.fogFar);
scene.add(new THREE.HemisphereLight(look.ambient.sky, look.ambient.ground, look.ambient.intensity));
const sun = new THREE.DirectionalLight(look.sun.color, look.sun.intensity);
sun.position.fromArray(look.sun.position);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshStandardMaterial({ color: '#213b3c', roughness: 1 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.065;
floor.receiveShadow = true;
scene.add(floor);
const lanes: Lane[] = ['a', 'b'].map((id) => {
  const group = new THREE.Group();
  const platform = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.18, 0.08, 64), new THREE.MeshStandardMaterial({ color: '#45605b', roughness: 1 }));
  platform.position.y = -0.025; platform.receiveShadow = true; group.add(platform);
  return { group, rig: 'player', rigLoading: false, loadout: { main: 'axe', off: null }, generation: 0, rigSelect: el<HTMLSelectElement>(`${id}-rig`), loadoutSelect: el<HTMLSelectElement>(`${id}-loadout`), packSelect: el<HTMLSelectElement>(`${id}-pack`), clipSelect: el<HTMLSelectElement>(`${id}-clip`), search: el<HTMLInputElement>(`${id}-search`), info: el<HTMLElement>(`${id}-info`), favorite: el<HTMLButtonElement>(`${id}-favorite`), timing: el<HTMLElement>(`${id}-timing`) };
});
const previews = lanes.map((lane, i) => {
  const laneScene = scene.clone(true); laneScene.add(lane.group);
  const laneCamera = camera.clone();
  const renderer = renderers[i];
  renderer.domElement.setAttribute('aria-label', `Animation comparison ${i === 0 ? 'A' : 'B'}`);
  renderer.setPixelRatio(1);
  renderer.setSize(canvas.clientWidth / 2, canvas.clientHeight);
  const lighting = new AreaLightingResources(renderer);
  laneScene.environment = lighting.environmentTexture(look); laneScene.environmentIntensity = look.environment!.intensity;
  const pipeline = new WebGPUPipeline(renderer, laneScene, laneCamera, controls.target);
  applyShadowQuality(laneScene, settings.shadowQuality);
  pipeline.configure(settings, look.saturation ?? 1, look);
  return { renderer, camera: laneCamera, pipeline, lighting };
});
await Promise.all(previews.map((preview) => preview.pipeline.ready()));
const resetHistories = () => previews.forEach((preview) => preview.pipeline.resetHistory());
window.addEventListener('pagehide', () => { disposed = true; controls.dispose(); lanes.forEach(clearLane); void assetLibrary.dispose(); previews.forEach(({ pipeline, renderer, lighting }) => { pipeline.dispose(); lighting.dispose(); renderer.dispose(); }); }, { once: true });
const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.AnimationClip>>();
const characterCache = new Map<string, Promise<THREE.Group>>();
function updatePlaybackControls(): void { const disabled = !lanes.some((lane) => lane.action); pause.disabled = restart.disabled = step.disabled = scrub.disabled = disabled; }
function saved(lane: Lane): boolean { return favorites.some((f) => f.pack === lane.pack?.id && f.clip === lane.clip?.id); }
function updateFavorite(lane: Lane): void { lane.favorite.textContent = saved(lane) ? '★ Saved favorite' : '☆ Save favorite'; lane.favorite.setAttribute('aria-pressed', String(saved(lane))); }
function fitModel(lane: Lane): THREE.Group {
  const model = clone(lane.source!) as THREE.Group;
  markOutline(model, 'actor');
  const wrapper = new THREE.Group(); wrapper.add(model); wrapper.updateMatrixWorld(true);
  const factor = characters[lane.rig].height / new THREE.Box3().setFromObject(wrapper).getSize(new THREE.Vector3()).y;
  wrapper.scale.setScalar(factor); wrapper.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(wrapper), center = bounds.getCenter(new THREE.Vector3());
  wrapper.position.set(-center.x, -bounds.min.y, -center.z);
  model.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
  return wrapper;
}
function clearLane(lane: Lane): void {
  lane.equipment?.dispose(); lane.equipment = undefined;
  lane.mixer?.stopAllAction();
  if (lane.model) {
    lane.mixer?.uncacheRoot(lane.model);
    lane.model.traverse(object => { if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose(); });
    lane.model.removeFromParent();
  }
  lane.model = undefined; lane.mixer = undefined; lane.action = undefined; lane.clip = undefined;
}
function updateTiming(lane: Lane): void {
  lane.timing.replaceChildren();
  if (!lane.clip || !lane.action) return;
  const track = document.createElement('div'); track.className = 'lane-track';
  const playhead = document.createElement('span'); playhead.className = 'lane-playhead'; track.append(playhead);
  const marker = lane.clip.contact;
  if (marker != null && marker > 0) {
    const button = document.createElement('button'); button.className = 'lane-contact'; button.type = 'button';
    const label = lane.clip.category === 'attack' && /bow|staff/.test(lane.clip.id) ? 'Release' : 'Contact';
    button.textContent = `${label} ${marker.toFixed(2)} s`; button.style.left = `${Math.min(1, marker / lane.action.getClip().duration) * 100}%`;
    button.onclick = () => {
      playing = false; pause.textContent = 'Play';
      progress = marker / lane.action!.getClip().duration;
      seconds = sync.checked ? progress * referenceDuration() : marker;
      applyPose(); resetHistories();
    };
    track.append(button);
  }
  const readout = document.createElement('output'); readout.className = 'lane-time';
  lane.timing.append(track, readout);
}
const referenceDuration = () => lanes[0].action?.getClip().duration ?? lanes[1].action?.getClip().duration ?? 1;
function applyPose(): void {
  const reference = referenceDuration();
  progress = sync.checked ? progress : Math.min(1, seconds / reference);
  for (const lane of lanes) {
    if (!lane.mixer || !lane.action || !lane.clip) continue;
    const duration = lane.action.getClip().duration;
    const t = sync.checked ? progress * duration : seconds;
    lane.action.time = loop.checked && t < duration ? t : loop.checked ? t % duration : Math.min(t, duration);
    lane.mixer.update(0);
    const playhead = lane.timing.querySelector<HTMLElement>('.lane-playhead');
    if (playhead) playhead.style.left = `${lane.action.time / duration * 100}%`;
    const readout = lane.timing.querySelector<HTMLOutputElement>('.lane-time');
    if (readout) readout.textContent = `${lane.action.time.toFixed(2)} / ${duration.toFixed(2)} s`;
  }
  scrub.value = String(loop.checked && !sync.checked ? (seconds % reference) / reference : progress);
  time.textContent = `${seconds.toFixed(2)} s`;
}
function resetPlayback(): void { resetHistories(); seconds = 0; progress = 0; applyPose(); }
async function selectClip(lane: Lane): Promise<void> {
  const generation = ++lane.generation;
  lane.favorite.disabled = true; updatePlaybackControls();
  const clip = lane.pack?.clips.find((c) => c.id === lane.clipSelect.value);
  if (!clip || !lane.source) { clearLane(lane); updateTiming(lane); lane.info.textContent = 'No compatible motions in this category.'; resetPlayback(); updatePlaybackControls(); return; }
  lane.info.textContent = 'Loading motion…';
  let equipment: Equipment | undefined;
  let model: THREE.Group | undefined;
  try {
    if (!cache.has(clip.url)) cache.set(clip.url, loader.loadAsync(clip.url).then((gltf) => {
      if (gltf.animations.length !== 1) throw new Error('Expected one baked animation');
      return gltf.animations[0];
    }).catch((error: unknown) => { cache.delete(clip.url); throw error; }));
    const motion=(await cache.get(clip.url)!).clone();
    if (lane.loadout.main==='staff' && !clip.audit && !['hit','death','dodge'].includes(clip.category)) {
      const preparedMotions=await loadEquipmentMotions(loader,lane.rig,lane.rig==='player' ? lane.loadout : {main:'axe',off:null});
      if (lane.rig==='player') holdStaffArm(motion,preparedMotions.clips.idle);
    }
    if (generation !== lane.generation || disposed) return;
    model = fitModel(lane); equipment = new Equipment(model, lane.rig);
    const prepared = await equipment.stage(lane.loadout);
    if (generation !== lane.generation || disposed) { equipment.dispose(); model.traverse(object => { if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose(); }); return; }
    equipment.commit(prepared);
    clearLane(lane);
    lane.model = model; lane.equipment = equipment; lane.group.add(lane.model);
    lane.mixer = new THREE.AnimationMixer(lane.model);
    lane.action = lane.mixer.clipAction(motion); lane.action.setLoop(THREE.LoopOnce, 1); lane.action.clampWhenFinished = true; lane.action.play(); lane.action.paused = true;
    lane.clip = clip;
    lane.info.textContent = `${motion.duration.toFixed(2)} s${clip.auditRole ? ' · Previous ' + clip.auditRole : ''}${clip.description ? ' · ' + clip.description : ''}`;
    lane.favorite.disabled = false; updateFavorite(lane); updateTiming(lane); resetPlayback();
    updatePlaybackControls();
  } catch (error) {
    equipment?.dispose();
    if (model && model !== lane.model) model.traverse(object => { if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose(); });
    if (generation === lane.generation) lane.info.textContent = `Preview unavailable: ${String(error)}`;
  }
}
async function fillClips(lane: Lane, preferred?: string): Promise<void> {
  if (lane.rigLoading) return;
  const previous = lane.clipSelect.value;
  lane.pack = lane.catalog?.packs.find((p) => p.id === lane.packSelect.value);
  const query = lane.search.value.trim().toLowerCase();
  const clips = (lane.pack?.clips ?? []).filter(c => !query || `${c.name} ${c.description ?? ''}`.toLowerCase().includes(query)).filter(c => category.value === 'all' || category.value === c.category || category.value === 'directional' && /backward|left|right/.test(c.id) || category.value === 'favorites' && favorites.some(f => f.pack === lane.pack!.id && f.clip === c.id));
  lane.clipSelect.replaceChildren(...clips.map((c) => new Option(c.description ? `${c.name} · ${c.description}` : c.name, c.id)));
  lane.clipSelect.disabled = clips.length === 0;
  if (preferred && clips.some(c => c.id === preferred)) lane.clipSelect.value = preferred;
  else if (clips.some((c) => c.id === previous)) lane.clipSelect.value = previous;
  else {
    const roles = lane.catalog?.profiles[lane.loadoutSelect.value] ?? lane.catalog?.defaults;
    const selected = clips.find(c => c.id === roles?.[category.value as keyof typeof roles]);
    if (selected) lane.clipSelect.value = selected.id;
  }
  await selectClip(lane);
}
async function selectRig(lane: Lane, rig: RigId): Promise<void> {
  const generation = ++lane.generation;
  lane.rigLoading = true; lane.info.textContent = 'Loading character…';
  lane.rigSelect.disabled = lane.loadoutSelect.disabled = lane.packSelect.disabled = lane.clipSelect.disabled = lane.search.disabled = true;
  try {
    const catalog = await getMotionCatalog(rig) as Catalog;
    if (!characterCache.has(catalog.character)) characterCache.set(catalog.character, loader.loadAsync(catalog.character).then(gltf => gltf.scene).catch(error => { characterCache.delete(catalog.character); throw error; }));
    const source = await characterCache.get(catalog.character)!;
    if (disposed || generation !== lane.generation) return;
    lane.rig = rig; lane.catalog = catalog; lane.source = source; lane.rigSelect.value = rig; lane.rigLoading = false;
    lane.packSelect.replaceChildren(...catalog.packs.filter(pack => pack.id === 'mixamo').map(pack => new Option(`${pack.label} (${pack.clips.length})`, pack.id)));
    lane.packSelect.value = 'mixamo'; lane.packSelect.disabled = false;
    await fillClips(lane, catalog.defaults.attack);
    status.textContent = lanes.map((current, index) => `${index === 0 ? 'A' : 'B'}: ${current.catalog?.characterLabel ?? 'Loading'} · ${current.catalog?.packs.reduce((count, pack) => count + pack.clips.length, 0) ?? 0} motions`).join(' / ');
  } catch (error) { if (generation === lane.generation) { lane.rigSelect.value = lane.rig; lane.info.textContent = String(error); } }
  finally { lane.rigLoading = false; lane.rigSelect.disabled = lane.loadoutSelect.disabled = lane.search.disabled = false; }
}
async function selectLoadout(lane: Lane, key: string): Promise<void> {
  if (!loadouts[key]) throw new Error('Unknown equipment selection');
  lane.loadout = { ...loadouts[key] }; lane.loadoutSelect.value = key;
  const roles = lane.catalog?.profiles[key];
  const preferred = roles?.[category.value as keyof typeof roles];
  await fillClips(lane, preferred);
}
for (const lane of lanes) {
  lane.rigSelect.addEventListener('change', () => { void selectRig(lane, lane.rigSelect.value as RigId); });
  lane.loadoutSelect.addEventListener('change', () => { void selectLoadout(lane, lane.loadoutSelect.value); });
  lane.packSelect.addEventListener('change', () => { void fillClips(lane); });
  lane.search.addEventListener('input', () => { void fillClips(lane); });
  lane.clipSelect.addEventListener('change', () => { void selectClip(lane); });
  lane.favorite.addEventListener('click', () => {
    if (!lane.pack || !lane.clip) return;
    if (saved(lane)) favorites = favorites.filter((f) => f.pack !== lane.pack!.id || f.clip !== lane.clip!.id);
    else favorites.push({ pack: lane.pack.id, clip: lane.clip.id });
    try { localStorage.setItem('lantern-animation-favorites', JSON.stringify(favorites)); } catch { status.textContent = 'Favorites could not be saved in this browser.'; }
    lanes.forEach(updateFavorite);
    if (category.value === 'favorites') lanes.forEach(l => { void fillClips(l); });
  });
}
category.addEventListener('change', () => lanes.forEach(lane => { void fillClips(lane); }));
pause.addEventListener('click', () => { playing = !playing; pause.textContent = playing ? 'Pause' : 'Play'; });
restart.addEventListener('click', resetPlayback);
step.addEventListener('click', () => { playing = false; pause.textContent = 'Play'; seconds += 1 / 30; progress += 1 / (30 * referenceDuration()); if (loop.checked) progress %= 1; else progress = Math.min(1, progress); applyPose(); });
scrub.addEventListener('input', () => { playing = false; pause.textContent = 'Play'; progress = Number(scrub.value); seconds = progress * referenceDuration(); applyPose(); resetHistories(); });
sync.addEventListener('change', resetPlayback);
loop.addEventListener('change', resetPlayback);
el<HTMLSelectElement>('lab-view').addEventListener('change', (e) => {
  const view = (e.target as HTMLSelectElement).value;
  camera.position.copy(new THREE.Vector3(...({ iso: [2.8, 2.6, 5.2], front: [0, 1.8, 5.8], side: [5.8, 1.8, 0], back: [0, 1.8, -5.8] }[view] as [number, number, number])));
  controls.target.set(0, 0.9, 0); controls.update(); resetHistories();
});
function resize(): void {
  const w = canvas.clientWidth / 2, h = canvas.clientHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  for (const preview of previews) {
    preview.camera.copy(camera); preview.renderer.setSize(w, h); preview.pipeline.resize();
  }
}
new ResizeObserver(resize).observe(canvas); resize();
const clock = new THREE.Timer();
function tick(): void {
  if (disposed) return;
  clock.update();
  const dt = Math.min(clock.getDelta(), 0.1) * Number(speed.value);
  if (playing && lanes.some((l) => l.action)) {
    seconds += dt;
    if (sync.checked) { progress += dt / referenceDuration(); progress = loop.checked ? progress % 1 : Math.min(1, progress); }
    applyPose();
  }
  controls.update();
  for (const preview of previews) {
    preview.camera.copy(camera);
    preview.pipeline.render();
    preview.renderer.domElement.dataset.graphics = JSON.stringify({ renderer: 'webgpu', settings, pipeline: preview.pipeline.diagnostics() });
  }
  requestAnimationFrame(tick);
}
tick();
await Promise.all(lanes.map(lane => selectRig(lane, 'player')));
const laneAt = (index: number | 'a' | 'b') => {
  const lane = lanes[typeof index === 'number' ? index : index === 'a' ? 0 : 1];
  if (!lane) throw new Error('Unknown comparison lane'); return lane;
};
const diagnostics = {
  setRig: (index: number | 'a' | 'b', rig: RigId) => selectRig(laneAt(index), rig),
  setLoadout: (index: number | 'a' | 'b', loadout: string) => selectLoadout(laneAt(index), loadout),
  async setClip(index: number | 'a' | 'b', clip: string) {
    const lane = laneAt(index);
    if (!lane.catalog?.packs.some(pack => pack.clips.some(candidate => candidate.id === clip))) throw new Error('Motion is not available on this rig');
    category.value = 'all'; lane.search.value = '';
    await Promise.all(lanes.map(current => fillClips(current, current === lane ? clip : current.clip?.id)));
  },
  setTime(value: number) { playing = false; pause.textContent = 'Play'; seconds = Math.max(0, value); progress = seconds / referenceDuration(); applyPose(); resetHistories(); },
  snapshot: () => ({ playing, seconds, progress, lanes: lanes.map(lane => ({ rig: lane.rig, loadout: lane.loadout, clip: lane.clip?.id, duration: lane.action?.getClip().duration, time: lane.action?.time, marker: lane.clip?.contact, clips: lane.catalog?.packs.flatMap(pack => pack.clips.map(clip => ({ id: clip.id, category: clip.category, contact: clip.contact, auditRole: clip.auditRole }))), equipment: lane.equipment?.diagnostics(), error: lane.info.textContent })) }),
};
(window as Window & { lanternAnimations?: typeof diagnostics }).lanternAnimations = diagnostics;
