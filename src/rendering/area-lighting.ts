import { lightingPreparationKey, type LightingPreparation } from '../levels/lighting-preparation';
import { materialRecipes } from './material-recipes';
import { restoreBakeVisibility, includeCutawayShadows } from './cutaway';
import { finishSubmittedFrame } from './renderer';
import * as THREE from 'three';
import { PMREMGenerator, type WebGPURenderer, type RenderTarget } from 'three/webgpu';
import { LightProbeGrid } from 'three/addons/lighting/LightProbeGrid.js';
import { EnclosureProbeNode } from './indirect-lighting';
import { worldFirelightGain } from '../levels/local-lighting';
import type { ResolvedAreaDefinition, AreaLighting, ProbeLighting } from '../levels/types';
import { LightingCache } from './lighting-cache';
import { decodeProbeBake, exportProbeComponent, staticFlameEmitters, combinedProbeTexture, mixProbeCoefficients, lightingBakeSignature, lightingBakeVersion, type PreparedProbeBake, type ProbeCoefficients } from './lighting-bake';
import bakeIndex from '../../assets/lighting-bakes.json';
import { disposeSceneInstances, isMesh } from '../assets/resource-ownership';

type SkyResource = { target: RenderTarget; source: THREE.DataTexture };
type LightingPool = { environments: LightingCache<SkyResource>; probes: LightingCache<ProbeResource>; pmrem: PMREMGenerator; pending: Promise<unknown> };
const poolKey = Symbol.for('lantern.lightingPool');
function lightingPool(renderer: WebGPURenderer): LightingPool {
  const existing = Reflect.get(renderer, poolKey) as LightingPool | undefined;
  if (existing) return existing;
  const pool: LightingPool = {
    environments: new LightingCache(lightingCacheBudgets.skies.entries, lightingCacheBudgets.skies.bytes, sky => { sky.target.dispose(); sky.source.dispose(); }),
    probes: new LightingCache(lightingCacheBudgets.probes.entries, lightingCacheBudgets.probes.bytes, () => {}),
    pmrem: new PMREMGenerator(renderer), pending: Promise.resolve(),
  };
  Reflect.set(renderer, poolKey, pool);
  const dispose = renderer.dispose.bind(renderer);
  renderer.dispose = async () => { await pool.pending; pool.probes.dispose(); pool.environments.dispose(); pool.pmrem.dispose(); await dispose(); };
  return pool;
}
type ProbeResource = { coefficients: ProbeCoefficients; source: 'live' | 'prepared'; owners: number };
export type PreparedLighting = { environment: THREE.Texture | null; grid: LightProbeGrid | null; signature: string; probes?: ProbeLighting; release(): void; resource?: ProbeResource; preparation: { key: string; sources: string[] }; updateFlame(gain: number): void; mixMs: number };
/** Renderer-wide budgets, independent of the number of areas in the game. */
export const lightingCacheBudgets = { skies: { entries: 8, bytes: 32 * 1024 * 1024 }, probes: { entries: 8, bytes: 16 * 1024 * 1024 } };
export class AreaLightingResources {
  private pool: LightingPool;
  private get environments() { return this.pool.environments; }
  private get probes() { return this.pool.probes; }
  private active: PreparedLighting | null = null;
  private previewLease: { release(): void } | undefined;
  private disposed = false;
  private get pmrem() { return this.pool.pmrem; }
  private stage = 'idle';
  private preparedFailure: string | null = null;
  constructor(private renderer: WebGPURenderer) {
    this.pool = lightingPool(renderer);
    if (renderer.library.getLightNodeClass(LightProbeGrid) === null) renderer.library.addLight(EnclosureProbeNode, LightProbeGrid);
  }

  environmentTexture(look: AreaLighting): THREE.Texture | null {
    const lease = this.environment(look); this.previewLease?.release(); this.previewLease = lease;
    return lease?.value.target.texture ?? null;
  }
  private environment(look: AreaLighting) {
    const spec = look.environment;
    if (!spec) return;
    const key = JSON.stringify([{ ...spec, intensity: undefined, rotation: undefined }, new THREE.Vector3(...look.sun.position).normalize().toArray()]);
    const cached = this.environments.acquire(key); if (cached) return cached;
    const width = 512, height = 256, pixels = new Float32Array(width * height * 4);
    const sky = new THREE.Color(spec.sky), horizon = new THREE.Color(spec.horizon), ground = new THREE.Color(spec.ground);
    const sun = new THREE.Color(spec.sunColor), direction = new THREE.Vector3(...look.sun.position).normalize();
    const ray = new THREE.Vector3(), color = new THREE.Color();
    // Longitude depends only on the column. Retain double precision and the
    // original multiplication order so the uploaded sky pixels stay identical.
    const longitudeCos = new Float64Array(width), longitudeSin = new Float64Array(width);
    for (let x = 0; x < width; x++) {
      const phi = 2 * Math.PI * (x + .5) / width;
      longitudeCos[x] = Math.cos(phi); longitudeSin[x] = Math.sin(phi);
    }
    for (let y = 0; y < height; y++) {
      const theta = Math.PI * (y + .5) / height, latitudeSin = Math.sin(theta), latitudeCos = Math.cos(theta);
      const blend = Math.pow(Math.abs(latitudeCos), .55);
      for (let x = 0; x < width; x++) {
        ray.set(-latitudeSin * longitudeCos[x], latitudeCos, latitudeSin * longitudeSin[x]);
        color.copy(horizon).lerp(ray.y >= 0 ? sky : ground, blend);
        const panel = Math.pow(Math.max(0, ray.dot(direction)), 32) * spec.sunIntensity;
        color.r += sun.r * panel; color.g += sun.g * panel; color.b += sun.b * panel;
        const i = (y * width + x) * 4; pixels[i] = color.r; pixels[i + 1] = color.g; pixels[i + 2] = color.b; pixels[i + 3] = 1;
      }
    }
    const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.FloatType);
    texture.colorSpace = THREE.LinearSRGBColorSpace; texture.mapping = THREE.EquirectangularReflectionMapping; texture.needsUpdate = true;
    let target: RenderTarget;
    try { target = this.pmrem.fromEquirectangular(texture); } catch (error) { texture.dispose(); throw error; }
    return this.environments.insert(key, { target, source: texture }, target.width * target.height * 8 + pixels.byteLength * 2);
  }

  prepare(area: ResolvedAreaDefinition, root: THREE.Group): Promise<PreparedLighting> {
    const result = this.pool.pending.then(() => this.prepareResources(area, root)); this.pool.pending = result.catch(() => {}); return result;
  }
  private async prepareResources(area: ResolvedAreaDefinition, root: THREE.Group): Promise<PreparedLighting> {
    if (this.disposed) throw new Error('Lighting resources are closed.');
    this.preparedFailure = null;
    const sky = this.environment(area.lighting);
    let probe: ReturnType<LightingCache<ProbeResource>['acquire']>;
    try {
      const spec = area.lighting.probes;
      this.stage = this.renderer.domElement.dataset.lightingStage = 'prepared-lookup';
      const key = await lightingPreparationKey(area, String(root.userData.surfaceMode ?? 'projected'), Boolean(root.userData.shelterRestored), THREE.REVISION, materialRecipes);
      const sources = [...new Set((root.userData.lightingSources as string[] ?? []).map(url => new URL(url, 'http://localhost').pathname))].sort();
      const authoring = import.meta.env.DEV && new URLSearchParams(location.search).get('author') === 'levels';
      const indexed = Object.entries(bakeIndex.bakes).find(([, value]) => {
        const prepared = (value as { preparation?: LightingPreparation }).preparation;
        // Production texture URLs are content-hashed by Vite. Staging verifies
        // canonical source bytes; development also checks loaded URL identity.
        return prepared?.key === key && (!import.meta.env.DEV || JSON.stringify(prepared.sources.map(item => item.url).sort()) === JSON.stringify(sources));
      });
      if (indexed && import.meta.env.DEV && !authoring) {
        const check = await fetch(`/__prepared-lighting?signature=${indexed[0]}`).then(response => response.json()) as { valid: boolean; error?: string };
        if (!check.valid) throw new Error(check.error ?? 'Prepared lighting needs refreshing.');
      }
      this.stage = this.renderer.domElement.dataset.lightingStage = authoring ? 'fingerprint' : 'prepared-load';
      const signature = spec ? authoring ? await lightingBakeSignature(area, root) : indexed?.[0] ?? '' : '';
      if (this.disposed) throw new Error('Lighting resources are closed.');
      if (spec) {
        probe = this.probes.acquire(signature);
        if (!probe) {
          this.stage = this.renderer.domElement.dataset.lightingStage = 'prepared-load';
          let resource = signature ? await this.loadPrepared(signature, spec) : null;
          if (!resource && !authoring) throw new Error(`Lighting for ${area.name} needs preparation. Prepare this area in the level authoring preview, then reload.`);
          resource ??= await this.bake(area, root, signature, sky?.value ?? null);
          probe = this.probes.insert(signature, resource, this.resourceBytes(resource));
        }
      }
      if (this.disposed) throw new Error('Lighting resources are closed.');
      const resource = probe?.value;
      const texture = resource ? combinedProbeTexture(resource.coefficients, worldFirelightGain(.85)) : null;
      const grid = texture && spec ? new LightProbeGrid(...spec.size, ...spec.resolution) : null;
      if (grid && spec) { grid.position.fromArray(spec.position); grid.intensity = spec.intensity; grid.texture = texture; grid.updateBoundingBox(); }
      if (resource) { resource.owners++; this.probes.setBytes(signature, this.resourceBytes(resource)); }
      let released = false, lastGain = worldFirelightGain(.85);
      const prepared: PreparedLighting = { environment: sky?.value.target.texture ?? null, grid, signature, probes: spec,
        resource, preparation: { key, sources }, mixMs: 0,
        updateFlame: gain => {
          if (!texture || !resource?.coefficients.flame || gain === lastGain || released) return;
          const start = performance.now();
          mixProbeCoefficients(resource.coefficients, gain, texture.image.data as Uint16Array);
          texture.needsUpdate = true; lastGain = gain; prepared.mixMs = performance.now() - start;
        },
        release: () => {
          if (released) return; released = true;
          grid?.removeFromParent(); grid?.dispose(); texture?.dispose();
          if (resource) { resource.owners--; this.probes.setBytes(signature, this.resourceBytes(resource)); }
          sky?.release(); probe?.release();
        } };
      return prepared;
    } catch (error) { sky?.release(); probe?.release(); throw error; }
    finally { this.stage = this.renderer.domElement.dataset.lightingStage = 'idle'; }
  }
  private async loadPrepared(signature: string, probes: ProbeLighting): Promise<ProbeResource | null> {
    const entry = (bakeIndex.bakes as Record<string, { url: string }>)[signature];
    if (!entry) return null;
    try {
      const response = await fetch(entry.url); if (!response.ok) throw new Error(`Prepared bake unavailable (${response.status}).`);
      const prepared = await response.json() as PreparedProbeBake;
      const coefficients = decodeProbeBake(prepared, signature, probes);
      this.preparedFailure = null; return { coefficients, source: 'prepared', owners: 0 };
    } catch (error) { this.preparedFailure = String(error); return null; }
  }
  private resourceBytes(resource: ProbeResource): number {
    const { daylight, flame } = resource.coefficients;
    return daylight.byteLength + (flame?.byteLength ?? 0) + resource.owners * daylight.byteLength * 2;
  }
  private async bake(area: ResolvedAreaDefinition, root: THREE.Group, signature: string, sky: SkyResource | null): Promise<ProbeResource> {
    const spec = area.lighting.probes!;
    const bake = new THREE.Scene(), scenery = root.clone(true), captureMaterials = new Set<THREE.Material>();
    restoreBakeVisibility(scenery);
    const materialClones = new Map<THREE.Material, THREE.Material>();
    const withoutEmission = (source: THREE.Material) => {
      const emissive = Reflect.get(source, 'emissive') as THREE.Color | undefined;
      if ((!emissive || emissive.r === 0 && emissive.g === 0 && emissive.b === 0) && !Reflect.get(source, 'emissiveNode') && !Reflect.get(source, 'emissiveMap')) return source;
      const existing = materialClones.get(source); if (existing) return existing;
      const material = source.clone(); captureMaterials.add(material); materialClones.set(source, material);
      (Reflect.get(material, 'emissive') as THREE.Color | undefined)?.set(0);
      if (Reflect.has(material, 'emissiveNode')) Reflect.set(material, 'emissiveNode', null);
      if (Reflect.has(material, 'emissiveMap')) Reflect.set(material, 'emissiveMap', null);
      return material;
    };
    scenery.traverse(object => { if (object instanceof THREE.Light || object instanceof THREE.SkinnedMesh || object.userData.transient) object.visible = false; });
    scenery.traverseVisible(object => {
      if (!isMesh(object)) return;
      object.material = Array.isArray(object.material) ? object.material.map(withoutEmission) : withoutEmission(object.material);
    });
    bake.add(scenery);
    const sun = new THREE.DirectionalLight(area.lighting.sun.color, area.lighting.sun.intensity);
    sun.target.position.set(spec.position[0], 0, spec.position[2]); sun.position.copy(sun.target.position).addScaledVector(new THREE.Vector3(...area.lighting.sun.position).normalize(), 70); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.radius = 4; sun.shadow.normalBias = .025; sun.shadow.bias = -.00015;
    const extent = Math.max(area.lighting.sun.shadowExtent, Math.max(spec.size[0], spec.size[2]) / 2 + 7);
    Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: .1, far: 150 });
    includeCutawayShadows(sun); sun.shadow.camera.updateProjectionMatrix();
    const emitters = staticFlameEmitters(root);
    const flames = emitters.map(spec => {
      const light = new THREE.PointLight(spec.color, spec.intensity, spec.distance, spec.decay); light.position.fromArray(spec.position);
      light.castShadow = true; light.shadow.mapSize.set(1024, 1024); light.shadow.camera.near = .12; light.shadow.radius = spec.shadowRadius;
      light.shadow.normalBias = .012; light.shadow.bias = -.0001; return light;
    });
    const capture = async (kind: 'daylight' | 'flame') => {
      const daylight = kind === 'daylight';
      bake.environment = daylight ? sky?.target.texture ?? null : null;
      bake.background = daylight ? sky?.source ?? null : new THREE.Color(0);
      bake.environmentIntensity = bake.backgroundIntensity = area.lighting.environment?.intensity ?? 1;
      bake.environmentRotation.y = bake.backgroundRotation.y = area.lighting.environment?.rotation ?? 0;
      if (daylight) bake.add(sun, sun.target); else bake.add(...flames);
      const grid = new LightProbeGrid(...spec.size, ...spec.resolution);
      grid.position.fromArray(spec.position); grid.intensity = spec.intensity; grid.updateBoundingBox();
      const count = spec.resolution.reduce((a,b) => a*b, 1);
      try {
        this.stage = this.renderer.domElement.dataset.lightingStage = `compile:${kind}`;
        await this.renderer.compileAsync(bake, new THREE.PerspectiveCamera());
        for (let pass = 0; pass <= spec.bounces; pass++) for (let start = 0; start < count; start += 8) {
          if (this.disposed) throw new Error('Lighting resources are closed.');
          this.stage = this.renderer.domElement.dataset.lightingStage = `capture:${kind}:${pass}:${start}/${count}`;
          grid.bake(this.renderer, bake, { cubemapSize: 16, sampleCount: 128, near: .08, far: 100, pass, start, count: Math.min(8, count - start) });
          await finishSubmittedFrame(this.renderer);
          await new Promise<void>(resolve => setTimeout(resolve, 0));
        }
        return await exportProbeComponent(this.renderer, grid, spec);
      } finally { grid.removeFromParent(); grid.dispose(); sun.removeFromParent(); sun.target.removeFromParent(); flames.forEach(light => light.removeFromParent()); }
    };
    const wetness = root.userData.rainWetness as { value: number } | undefined, previousWetness = wetness?.value;
    if (wetness) wetness.value = 0;
    try {
      const daylight = await capture('daylight'), flame = emitters.length ? await capture('flame') : undefined;
      const prepared: PreparedProbeBake = { version: lightingBakeVersion, three: THREE.REVISION, signature, probes: spec, flameEmitterCount: emitters.length, daylight, flame };
      return { coefficients: decodeProbeBake(prepared, signature, spec), source: 'live', owners: 0 };
    } finally { if (wetness) wetness.value = previousWetness!; sun.dispose(); flames.forEach(light => light.dispose()); disposeSceneInstances(scenery); captureMaterials.forEach(material => material.dispose()); }
  }
  updateFlame(warmth: number): void { this.active?.updateFlame(worldFirelightGain(warmth)); }
  commit(scene: THREE.Scene, prepared: PreparedLighting): void {
    this.active?.grid?.removeFromParent(); this.active?.release(); this.active = prepared;
    scene.environment = prepared.environment; if (prepared.grid) scene.add(prepared.grid);
  }
  async exportCurrent(): Promise<PreparedProbeBake> {
    const active = this.active;
    if (!active?.grid || !active.probes) throw new Error('This scene has no irradiance probes.');
    const source = active.resource!.coefficients;
    const component = (data: Uint16Array) => ({ dimensions: source.dimensions, data: Array.from(data) });
    const value: PreparedProbeBake = { version: lightingBakeVersion, three: THREE.REVISION, signature: active.signature, probes: active.probes, flameEmitterCount: source.flameEmitterCount,
      daylight: component(source.daylight), flame: source.flame ? component(source.flame) : undefined };
    return { ...value, preparation: { key: active.preparation.key, sources: active.preparation.sources.map(url => ({ url, hash: '' })) } };
  }
  diagnostics() { return { stage: this.stage, skies: this.environments.stats(), probes: this.probes.stats(), signature: this.active?.signature, source: this.active?.resource?.source ?? 'none', preparedFailure: this.preparedFailure, components: this.active?.resource?.coefficients.flame ? 2 : 1, mixMs: this.active?.mixMs ?? 0 }; }
  dispose(): void {
    this.disposed = true; this.active?.grid?.removeFromParent(); this.active?.release(); this.previewLease?.release();
    this.active = null; this.previewLease = undefined;
  }
}
