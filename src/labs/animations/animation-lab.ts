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
import './animation-lab.css';
import characters from '../../../assets/playable-characters.json';

type Clip = { id: string; name: string; description?: string; category: string; url: string; duration: number; mappedBones: number };
type Pack = { id: string; label: string; license: string; url: string; clips: Clip[] };
type Catalog = { version: number; character: string; characterLabel: string; motion: string; packs: Pack[] };
type Favorite = { pack: string; clip: string };
type Lane = { group: THREE.Group; model?: THREE.Group; mixer?: THREE.AnimationMixer; action?: THREE.AnimationAction; clip?: Clip; pack?: Pack; generation: number; packSelect: HTMLSelectElement; clipSelect: HTMLSelectElement; search: HTMLInputElement; info: HTMLElement; favorite: HTMLButtonElement };
document.title = 'Lantern — Animation Comparison';
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <main class="animation-lab">
    <header class="lab-header"><div><a href="/">← Return to clearing</a><p class="lab-eyebrow">LANTERN / MOTION STUDY</p><h1>Find our fighting style.</h1><p id="lab-status" role="status">Loading local animation library…</p></div><span class="lab-badge">SAME CHARACTER · SAME LIGHTING</span></header>
    <section class="lab-stage" aria-label="Side by side animation preview"><div id="lab-canvas"></div><div class="stage-label stage-label-a">A</div><div class="stage-label stage-label-b">B</div><div class="stage-tip">Drag to orbit · scroll to zoom</div></section>
    <section class="lab-toolbar" aria-label="Playback controls">
      <label>Show <select id="lab-category"><option value="all">All motions</option><option value="attack" selected>Attacks</option><option value="idle">Idles</option><option value="run">Running</option><option value="walk">Walking</option><option value="hit">Hit reactions</option><option value="death">Deaths</option><option value="block">Blocking</option><option value="dodge">Dodges & rolls</option><option value="movement">Other movement</option><option value="other">Interactions & emotes</option><option value="favorites">Favorites</option></select></label>
      <button id="lab-pause" disabled>Pause</button><button id="lab-restart" disabled>Restart both</button><button id="lab-step" disabled>Step 1 frame</button>
      <label>Speed <select id="lab-speed"><option value="0.25">¼ speed</option><option value="0.5">½ speed</option><option value="1" selected>Normal</option><option value="1.5">1½ speed</option></select></label>
      <label class="lab-check"><input id="lab-loop" type="checkbox" checked> Loop</label>
      <label class="lab-check"><input id="lab-sync" type="checkbox"> Match cycle lengths</label>
      <label>View <select id="lab-view"><option value="iso">Isometric</option><option value="front">Front</option><option value="side">Side</option><option value="back">Back</option></select></label>
      <label class="lab-timeline">Scrub <input id="lab-scrub" type="range" min="0" max="1" step="0.001" value="0" disabled><output id="lab-time">0.00 s</output></label>
    </section>
    <section class="lab-lanes" aria-label="Animation selections">
      ${['a', 'b'].map((id) => `<article class="lane-card"><div class="lane-heading"><span>${id.toUpperCase()}</span><button id="${id}-favorite" disabled>☆ Save favorite</button></div><label>Animation library<select id="${id}-pack" disabled></select></label><label>Find a motion<input id="${id}-search" type="search" placeholder="Sword, bow, magic, climb…" autocomplete="off"></label><label>Motion<select id="${id}-clip" disabled></select></label><p id="${id}-info">Waiting for assets…</p></article>`).join('')}
    </section>
    <details class="lab-notes"><summary>How to compare</summary><p>Start with attacks, then compare idle, running, hit and death. Normal speed preserves each original clip’s timing; “Match cycle lengths” aligns both poses by progress. Pause and scrub to inspect contact, feet and recovery. Favorites stay in this browser. Missing categories remain unavailable instead of substituting a motion from another pack.</p><p id="lab-provenance"></p><div id="lab-sources"></div><p>These are automated retargeting previews. Some hands, shoulders and foot contacts may need cleanup before gameplay. Preview platforms remove horizontal root travel. Props and weapon-specific hand placement are not yet part of this comparison.</p></details>
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
let catalog: Catalog;
let character: THREE.Group;
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
scene.background = new THREE.Color('#182e30');
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
const studioLook = resolveLighting({ profile: 'studio' });
scene.add(new THREE.HemisphereLight(studioLook.ambient.sky, studioLook.ambient.ground, studioLook.ambient.intensity));
const sun = new THREE.DirectionalLight(studioLook.sun.color, studioLook.sun.intensity);
sun.position.fromArray(studioLook.sun.position);
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
  return { group, generation: 0, packSelect: el<HTMLSelectElement>(`${id}-pack`), clipSelect: el<HTMLSelectElement>(`${id}-clip`), search: el<HTMLInputElement>(`${id}-search`), info: el<HTMLElement>(`${id}-info`), favorite: el<HTMLButtonElement>(`${id}-favorite`) };
});
const previews = lanes.map((lane, i) => {
  const laneScene = scene.clone(true); laneScene.add(lane.group);
  const laneCamera = camera.clone();
  const renderer = renderers[i];
  renderer.domElement.setAttribute('aria-label', `Animation comparison ${i === 0 ? 'A' : 'B'}`);
  renderer.setPixelRatio(1);
  renderer.setSize(canvas.clientWidth / 2, canvas.clientHeight);
  const lighting = new AreaLightingResources(renderer);
  const studio = resolveLighting({ profile: 'studio' });
  laneScene.environment = lighting.environmentTexture(studio); laneScene.environmentIntensity = studio.environment!.intensity;
  const pipeline = new WebGPUPipeline(renderer, laneScene, laneCamera, controls.target);
  applyShadowQuality(laneScene, settings.shadowQuality);
  pipeline.configure(settings, studio.saturation ?? .85);
  return { renderer, camera: laneCamera, pipeline, lighting };
});
await Promise.all(previews.map((preview) => preview.pipeline.ready()));
const resetHistories = () => previews.forEach((preview) => preview.pipeline.resetHistory());
window.addEventListener('pagehide', () => { controls.dispose(); previews.forEach(({ pipeline, renderer, lighting }) => { pipeline.dispose(); lighting.dispose(); renderer.dispose(); }); }, { once: true });
const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.AnimationClip>>();
function updatePlaybackControls(): void { const disabled = !lanes.some((lane) => lane.action); pause.disabled = restart.disabled = step.disabled = scrub.disabled = disabled; }
function saved(lane: Lane): boolean { return favorites.some((f) => f.pack === lane.pack?.id && f.clip === lane.clip?.id); }
function updateFavorite(lane: Lane): void { lane.favorite.textContent = saved(lane) ? '★ Saved favorite' : '☆ Save favorite'; lane.favorite.setAttribute('aria-pressed', String(saved(lane))); }
function fitModel(): THREE.Group {
  const model = clone(character) as THREE.Group;
  const wrapper = new THREE.Group(); wrapper.add(model); wrapper.updateMatrixWorld(true);
  const factor = characters.player.height / new THREE.Box3().setFromObject(wrapper).getSize(new THREE.Vector3()).y;
  wrapper.scale.setScalar(factor); wrapper.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(wrapper), center = bounds.getCenter(new THREE.Vector3());
  wrapper.position.set(-center.x, -bounds.min.y, -center.z);
  model.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
  return wrapper;
}
function applyPose(): void {
  const reference = lanes[0].clip?.duration ?? lanes[1].clip?.duration ?? 1;
  progress = sync.checked ? progress : Math.min(1, seconds / reference);
  for (const lane of lanes) {
    if (!lane.mixer || !lane.action || !lane.clip) continue;
    const duration = lane.action.getClip().duration;
    const t = sync.checked ? progress * duration : seconds;
    lane.action.time = loop.checked && t < duration ? t : loop.checked ? t % duration : Math.min(t, duration);
    lane.mixer.update(0);
  }
  scrub.value = String(loop.checked && !sync.checked ? (seconds % reference) / reference : progress);
  time.textContent = `${seconds.toFixed(2)} s`;
}
function resetPlayback(): void { resetHistories(); seconds = 0; progress = 0; applyPose(); }
async function selectClip(lane: Lane): Promise<void> {
  const generation = ++lane.generation;
  lane.mixer?.stopAllAction();
  if (lane.model) lane.group.remove(lane.model);
  lane.model = undefined; lane.mixer = undefined; lane.action = undefined; lane.clip = undefined;
  lane.favorite.disabled = true; updatePlaybackControls();
  const clip = lane.pack?.clips.find((c) => c.id === lane.clipSelect.value);
  if (!clip) { lane.info.textContent = 'No motions in this category. Choose another category or library.'; resetPlayback(); return; }
  lane.info.textContent = 'Loading motion…';
  try {
    if (!cache.has(clip.url)) cache.set(clip.url, loader.loadAsync(clip.url).then((gltf) => {
      if (gltf.animations.length !== 1) throw new Error('Expected one baked animation');
      return gltf.animations[0];
    }).catch((error: unknown) => { cache.delete(clip.url); throw error; }));
    const motion = await cache.get(clip.url)!;
    if (generation !== lane.generation) return;
    lane.model = fitModel(); lane.group.add(lane.model);
    lane.mixer = new THREE.AnimationMixer(lane.model);
    lane.action = lane.mixer.clipAction(motion); lane.action.setLoop(THREE.LoopOnce, 1); lane.action.clampWhenFinished = true; lane.action.play(); lane.action.paused = true;
    lane.clip = clip;
    lane.info.textContent = `${motion.duration.toFixed(2)} s · ${clip.mappedBones} mapped bones · ${lane.pack!.license}${clip.description ? ' · ' + clip.description : ''}`;
    lane.favorite.disabled = false; updateFavorite(lane); resetPlayback();
    updatePlaybackControls();
  } catch (error) { if (generation === lane.generation) lane.info.textContent = `Motion unavailable: ${String(error)}`; }
}
function fillClips(lane: Lane): void {
  const previous = lane.clipSelect.value;
  lane.pack = catalog.packs.find((p) => p.id === lane.packSelect.value);
  const query = lane.search.value.trim().toLowerCase();
  const clips = (lane.pack?.clips ?? []).filter((c) => (!query || `${c.name} ${c.description ?? ''}`.toLowerCase().includes(query))).filter((c) => category.value === 'all' || category.value === c.category || category.value === 'favorites' && favorites.some((f) => f.pack === lane.pack!.id && f.clip === c.id));
  lane.clipSelect.replaceChildren(...clips.map((c) => new Option(c.description ? `${c.name} · ${c.description}` : c.name, c.id)));
  lane.clipSelect.disabled = clips.length === 0;
  if (clips.some((c) => c.id === previous)) lane.clipSelect.value = previous;
  else {
    const preferred = clips.find((c) => /HumanM@Attack1H01_R|Sword_Regular_A$|^Sword_Attack$|Melee_1H_Attack_Chop|^sword and shield slash$/.test(c.name));
    if (preferred) lane.clipSelect.value = preferred.id;
  }
  void selectClip(lane);
}
for (const lane of lanes) {
  lane.packSelect.addEventListener('change', () => fillClips(lane));
  lane.search.addEventListener('input', () => fillClips(lane));
  lane.clipSelect.addEventListener('change', () => { void selectClip(lane); });
  lane.favorite.addEventListener('click', () => {
    if (!lane.pack || !lane.clip) return;
    if (saved(lane)) favorites = favorites.filter((f) => f.pack !== lane.pack!.id || f.clip !== lane.clip!.id);
    else favorites.push({ pack: lane.pack.id, clip: lane.clip.id });
    try { localStorage.setItem('lantern-animation-favorites', JSON.stringify(favorites)); } catch { status.textContent = 'Favorites could not be saved in this browser.'; }
    lanes.forEach(updateFavorite);
    if (category.value === 'favorites') lanes.forEach(fillClips);
  });
}
category.addEventListener('change', () => lanes.forEach(fillClips));
pause.addEventListener('click', () => { playing = !playing; pause.textContent = playing ? 'Pause' : 'Play'; });
restart.addEventListener('click', resetPlayback);
step.addEventListener('click', () => { playing = false; pause.textContent = 'Play'; seconds += 1 / 30; progress += 1 / (30 * (lanes[0].clip?.duration ?? 1)); if (loop.checked) progress %= 1; else progress = Math.min(1, progress); applyPose(); });
scrub.addEventListener('input', () => { playing = false; pause.textContent = 'Play'; progress = Number(scrub.value); seconds = progress * (lanes[0].clip?.duration ?? lanes[1].clip?.duration ?? 1); applyPose(); resetHistories(); });
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
  clock.update();
  const dt = Math.min(clock.getDelta(), 0.1) * Number(speed.value);
  if (playing && lanes.some((l) => l.action)) {
    seconds += dt;
    if (sync.checked) { progress += dt / (lanes[0].clip?.duration ?? lanes[1].clip?.duration ?? 1); progress = loop.checked ? progress % 1 : Math.min(1, progress); }
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
try {
  const response = await fetch(characters.player.catalog);
  if (!response.ok) throw new Error('Animation lab has not been exported locally. Run npm run assets:export-animation-lab.');
  catalog = await response.json() as Catalog;
  catalog.packs = catalog.packs.filter((pack) => pack.id === 'mixamo');
  if (catalog.version !== 1 || !catalog.packs?.length) throw new Error('No exported animation libraries are available.');
  character = (await loader.loadAsync(catalog.character)).scene;
  const total = catalog.packs.reduce((n, p) => n + p.clips.length, 0);
  status.textContent = `${catalog.characterLabel} · ${total} motions from ${catalog.packs.length} libraries`;
  el<HTMLElement>('lab-provenance').textContent = catalog.motion;
  for (const pack of catalog.packs) {
    const p = document.createElement('p'); const link = document.createElement('a'); link.href = pack.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = pack.label; p.append(link, ` · ${pack.clips.length} preview clips · ${pack.license}`); el<HTMLElement>('lab-sources').append(p);
  }
  for (const lane of lanes) {
    lane.packSelect.replaceChildren(...catalog.packs.map((p) => new Option(`${p.label} (${p.clips.length})`, p.id)));
    lane.packSelect.value = 'mixamo';
    lane.packSelect.disabled = false; fillClips(lane);
  }
} catch (error) { status.textContent = String(error); lanes.forEach((l) => { l.info.textContent = 'Local assets are required for this preview.'; }); }
