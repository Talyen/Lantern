/* Development gallery: compare silhouettes and authored materials under shared Golden lighting. */
import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { assetLibrary, type AssetInstance } from '../../assets/asset-library';
import { createRenderer } from '../../rendering/renderer';
import { WebGPUPipeline } from '../../rendering/webgpu-pipeline';
import { AreaLightingResources } from '../../rendering/area-lighting';
import { applyShadowQuality } from '../../rendering/quality-presets';
import { readSettings } from '../../rendering/graphics-settings';
import { resolveLighting } from '../../levels/lighting';
import { itemDefinitions } from '../../gameplay/equipment';
import { asterfallLibrary, weaponNames, counterparts, type ArmoryWeapon } from './armory';
import './weapon-gallery.css';

document.title = 'Lantern — Weapons';
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `<main class="weapon-gallery"><header><a href="/">← Clearing</a><h1>Weapons</h1><a href="/?lab=animations&study=weapons">Held comparison</a></header>
  <nav aria-label="Weapon comparison"><label>Asterfall weapon<select id="weapon-kind"></select></label><label>Existing model<select id="weapon-current"></select></label><label>Size<select id="weapon-size"><option value="matched">Matched size</option><option value="authored">Authored size</option></select></label><button id="weapon-fit">Fit both</button><label>View<select id="weapon-view"><option value="front">Front</option><option value="side">Side</option><option value="back">Back</option></select></label></nav>
  <p id="weapon-status" role="status">Loading weapons…</p><section class="weapon-stages" aria-label="Side-by-side weapon preview">${['Current','Asterfall'].map((name, index) => `<article><h2>${name}</h2><div class="weapon-mount" id="weapon-stage-${index}"></div><p id="weapon-caption-${index}"></p></article>`).join('')}</section><footer>Drag to orbit · right-drag to pan · scroll to zoom. Both views share the same camera and lighting.</footer></main>`;
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const kind = element<HTMLSelectElement>('weapon-kind');
const current = element<HTMLSelectElement>('weapon-current');
const scale = element<HTMLSelectElement>('weapon-size');
const view = element<HTMLSelectElement>('weapon-view');
const status = element<HTMLElement>('weapon-status');
for (const [id, name] of Object.entries(weaponNames)) kind.add(new Option(name, id));
const catalog = await assetLibrary.getCatalog();
const existing = Object.values(catalog.assets).filter(asset => asset.status === 'converted' && asset.kind === 'model' && /(?:^|_)Wep_/i.test(asset.name)).sort((a, b) => a.pack.localeCompare(b.pack) || a.name.localeCompare(b.name));
current.add(new Option('No counterpart', ''));
for (const entry of existing) current.add(new Option(`${entry.pack} · ${entry.name.replaceAll('_', ' ')}`, entry.id));
const settings = readSettings();
settings.dof = 'off'; settings.bloom = 0;
const look = resolveLighting();
const camera = new THREE.PerspectiveCamera(33, 1, .05, 50);
camera.position.set(0, .8, 4);
const controls = new OrbitControls(camera, app.querySelector<HTMLElement>('.weapon-stages'));
controls.target.set(0, .8, 0); controls.enableDamping = true; controls.minDistance = .25; controls.maxDistance = 14;
let disposed = false, generation = 0;
type Lane = { scene: THREE.Scene; mount: HTMLDivElement; renderer: Awaited<ReturnType<typeof createRenderer>>; camera: THREE.PerspectiveCamera; lighting: AreaLightingResources; pipeline: WebGPUPipeline; floor: THREE.Mesh<THREE.PlaneGeometry, MeshStandardNodeMaterial>; instance?: AssetInstance };
const lanes: Lane[] = [];
for (const index of [0, 1]) {
  const mount = element<HTMLDivElement>(`weapon-stage-${index}`);
  const renderer = await createRenderer(mount);
  renderer.setSize(mount.clientWidth, mount.clientHeight);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(look.background);
  scene.fog = new THREE.Fog(look.background, look.fogNear, look.fogFar);
  const lighting = new AreaLightingResources(renderer);
  scene.environment = lighting.environmentTexture(look); scene.environmentIntensity = look.environment!.intensity;
  scene.add(new THREE.HemisphereLight(look.ambient.sky, look.ambient.ground, look.ambient.intensity));
  const sun = new THREE.DirectionalLight(look.sun.color, look.sun.intensity); sun.position.fromArray(look.sun.position); sun.castShadow = true; scene.add(sun);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new MeshStandardNodeMaterial({ color: '#303b43', roughness: 1 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -.015; floor.receiveShadow = true; scene.add(floor);
  const laneCamera = camera.clone(); laneCamera.aspect = mount.clientWidth / mount.clientHeight; laneCamera.updateProjectionMatrix();
  const pipeline = new WebGPUPipeline(renderer, scene, laneCamera, controls.target);
  applyShadowQuality(scene, settings.shadowQuality); pipeline.configure(settings, look.saturation ?? 1, look); await pipeline.ready();
  lanes.push({ scene, mount, renderer, camera: laneCamera, lighting, pipeline, floor, instance: undefined as AssetInstance | undefined });
}
function reset(): void { lanes.forEach(lane => lane.pipeline.resetHistory()); }
function resize(): void {
  for (const lane of lanes) { lane.renderer.setSize(lane.mount.clientWidth, lane.mount.clientHeight); lane.pipeline.resize(); }
  camera.aspect = lanes[0].mount.clientWidth / lanes[0].mount.clientHeight; camera.updateProjectionMatrix(); reset();
}
function bounds(): THREE.Box3 {
  const result = new THREE.Box3();
  lanes.forEach(lane => { if (lane.instance) result.union(new THREE.Box3().setFromObject(lane.instance.object)); });
  return result;
}
function fit(): void {
  const box = bounds(); if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3()), direction = camera.position.clone().sub(controls.target).normalize();
  const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const distance = Math.max(size.y / (2 * tangent), size.x / (2 * tangent * camera.aspect)) * 1.2 + size.z;
  controls.target.copy(box.getCenter(new THREE.Vector3())); camera.position.copy(controls.target).addScaledVector(direction, distance); controls.update(); reset();
}
function pose(instance: AssetInstance, length?: number): void {
  const object = instance.object, box = new THREE.Box3().setFromObject(object), size = box.getSize(new THREE.Vector3());
  // Present narrow-X Synty weapon planes alongside Asterfall's XY faces.
  if (instance.asset.pack !== 'asterfall' && size.z > size.x * 1.5) object.rotateY(-Math.PI / 2);
  const largest = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(largest) || largest <= 0) throw new Error('Weapon has no visible geometry.');
  if (length) object.scale.multiplyScalar(length / largest);
  object.updateMatrixWorld(true); box.setFromObject(object);
  const center = box.getCenter(new THREE.Vector3()); object.position.add(new THREE.Vector3(-center.x, -box.min.y, -center.z));
}
async function refresh(): Promise<void> {
  const request = ++generation, weapon = kind.value as ArmoryWeapon, counterpart = current.value;
  status.textContent = 'Loading comparison…';
  const results = await Promise.allSettled([counterpart ? assetLibrary.loadAsset(counterpart) : Promise.resolve(undefined), asterfallLibrary.loadAsset(`asterfall:${weapon}`)]);
  const loaded = results.map(result => result.status === 'fulfilled' ? result.value : undefined);
  if (disposed || request !== generation || results.some(result => result.status === 'rejected')) {
    loaded.forEach(instance => instance?.release());
    if (!disposed && request === generation) { const failure = results.find(result => result.status === 'rejected'); status.textContent = `Unable to load comparison. ${failure?.status === 'rejected' ? String(failure.reason) : ''} Run npm run assets:import-asterfall if the new pack is missing.`; }
    return;
  }
  try {
    let length: number | undefined;
    if (scale.value === 'matched') {
      if (weapon === 'pickaxe') length = .85;
      else if (weapon in itemDefinitions) length = itemDefinitions[weapon as keyof typeof itemDefinitions].length;
      else if (loaded[0]) { const size = new THREE.Box3().setFromObject(loaded[0].object).getSize(new THREE.Vector3()); length = Math.max(size.x, size.y, size.z); }
    }
    loaded.forEach(instance => { if (instance) pose(instance, length); });
    for (const [index, lane] of lanes.entries()) {
      lane.instance?.object.removeFromParent(); lane.instance?.release(); lane.instance = loaded[index];
      if (lane.instance) lane.scene.add(lane.instance.object);
      element(`weapon-caption-${index}`).textContent = lane.instance ? `${index ? weaponNames[weapon] : lane.instance.asset.name.replaceAll('_',' ')} · ${new THREE.Box3().setFromObject(lane.instance.object).getSize(new THREE.Vector3()).y.toFixed(2)} m tall` : 'No matching existing model. Choose another prepared weapon to compare.';
    }
    status.textContent = `${weaponNames[weapon]} · ${scale.value === 'authored' ? 'Authored size' : length ? 'Matched size' : 'Authored size (no comparison size available)'}${counterpart ? '' : ' · No counterpart selected'}`;
    fit();
  } catch (error) { loaded.forEach(instance => instance?.release()); status.textContent = String(error); }
}
function defaultCounterpart(): void { current.value = counterparts[kind.value as ArmoryWeapon] ?? ''; }
kind.addEventListener('change', () => { defaultCounterpart(); void refresh().catch((error: unknown) => { status.textContent = String(error); }); });
current.addEventListener('change', () => { void refresh().catch((error: unknown) => { status.textContent = String(error); }); }); scale.addEventListener('change', () => { void refresh().catch((error: unknown) => { status.textContent = String(error); }); });
element('weapon-fit').addEventListener('click', fit);
view.addEventListener('change', () => {
  const distance = camera.position.distanceTo(controls.target);
  const direction = view.value === 'side' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, view.value === 'back' ? -1 : 1);
  camera.position.copy(controls.target).addScaledVector(direction, distance); controls.update(); reset();
});
window.addEventListener('resize', resize);
window.addEventListener('pagehide', () => {
  disposed = true; generation++; controls.dispose();
  lanes.forEach(lane => { lane.instance?.release(); lane.floor.geometry.dispose(); lane.floor.material.dispose(); lane.pipeline.dispose(); lane.lighting.dispose(); void lane.renderer.dispose().catch(console.error); });
  void Promise.all([assetLibrary.dispose(), asterfallLibrary.dispose()]).catch(console.error);
}, { once: true });
function tick(): void {
  if (disposed) return;
  controls.update();
  for (const lane of lanes) { lane.camera.copy(camera); lane.pipeline.render(); }
  requestAnimationFrame(tick);
}
resize(); defaultCounterpart(); tick(); await refresh();
