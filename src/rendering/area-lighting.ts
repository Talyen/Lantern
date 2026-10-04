import { restoreBakeVisibility, includeCutawayShadows } from './cutaway';
import { finishSubmittedFrame } from './renderer';
import * as THREE from 'three';
import { PMREMGenerator, type WebGPURenderer, type RenderTarget } from 'three/webgpu';
import { LightProbeGrid } from 'three/addons/lighting/LightProbeGrid.js';
import { LightProbeGridNode } from 'three/addons/tsl/lighting/LightProbeGridNode.js';
import type { ResolvedAreaDefinition, AreaLighting, ProbeLighting } from '../levels/types';
import { LightingCache } from './lighting-cache';
import { decodeProbeBake, exportProbeBake, lightingBakeSignature, type PreparedProbeBake } from './lighting-bake';
import bakeIndex from '../../assets/lighting-bakes.json';
import { disposeSceneInstances } from '../assets/resource-ownership';

type ProbeResource = { grid: LightProbeGrid; imported?: THREE.Texture; prepared?: PreparedProbeBake; source: 'live' | 'prepared' };
export type PreparedLighting = { environment: THREE.Texture | null; grid: LightProbeGrid | null; signature: string; probes?: ProbeLighting; release(): void; resource?: ProbeResource };
/** Renderer-wide budgets, independent of the number of areas in the game. */
export const lightingCacheBudgets = { skies: { entries: 8, bytes: 32 * 1024 * 1024 }, probes: { entries: 8, bytes: 16 * 1024 * 1024 } };
export class AreaLightingResources {
  private environments = new LightingCache<RenderTarget>(lightingCacheBudgets.skies.entries, lightingCacheBudgets.skies.bytes, target => target.dispose());
  private probes = new LightingCache<ProbeResource>(lightingCacheBudgets.probes.entries, lightingCacheBudgets.probes.bytes, item => { item.grid.dispose(); item.imported?.dispose(); });
  private pending: Promise<unknown> = Promise.resolve();
  private active: PreparedLighting | null = null;
  private previewLease: { release(): void } | undefined;
  private disposed = false;
  private pmrem: PMREMGenerator;
  private stage = 'idle';
  private preparedFailure: string | null = null;
  constructor(private renderer: WebGPURenderer) {
    this.pmrem = new PMREMGenerator(renderer);
    if (renderer.library.getLightNodeClass(LightProbeGrid) === null) renderer.library.addLight(LightProbeGridNode, LightProbeGrid);
  }

  environmentTexture(look: AreaLighting): THREE.Texture | null {
    const lease = this.environment(look); this.previewLease?.release(); this.previewLease = lease;
    return lease?.value.texture ?? null;
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
    try { target = this.pmrem.fromEquirectangular(texture); } finally { texture.dispose(); }
    return this.environments.insert(key, target, target.width * target.height * 8);
  }

  prepare(area: ResolvedAreaDefinition, root: THREE.Group): Promise<PreparedLighting> {
    const result = this.pending.then(() => this.prepareResources(area, root)); this.pending = result.catch(() => {}); return result;
  }
  private async prepareResources(area: ResolvedAreaDefinition, root: THREE.Group): Promise<PreparedLighting> {
    if (this.disposed) throw new Error('Lighting resources are closed.');
    this.preparedFailure = null;
    const sky = this.environment(area.lighting);
    let probe: ReturnType<LightingCache<ProbeResource>['acquire']>;
    try {
      const spec = area.lighting.probes;
      this.stage = this.renderer.domElement.dataset.lightingStage = 'fingerprint';
      const signature = spec ? await lightingBakeSignature(area, root) : '';
      if (this.disposed) throw new Error('Lighting resources are closed.');
      if (spec) {
        probe = this.probes.acquire(signature);
        if (!probe) {
          this.stage = this.renderer.domElement.dataset.lightingStage = 'prepared-load';
          const resource = await this.loadPrepared(signature, spec) ?? await this.bake(area, root, sky?.value.texture ?? null);
          const [nx, ny, nz] = spec.resolution;
          probe = this.probes.insert(signature, resource, nx * ny * 7 * (nz + 2) * 8 * (resource.source === 'live' ? 2 : 1));
        }
      }
      return { environment: sky?.value.texture ?? null, grid: probe?.value.grid ?? null, signature, probes: spec,
        resource: probe?.value, release: () => { sky?.release(); probe?.release(); } };
    } catch (error) { sky?.release(); probe?.release(); throw error; }
    finally { this.stage = this.renderer.domElement.dataset.lightingStage = 'idle'; }
  }
  private async loadPrepared(signature: string, probes: ProbeLighting): Promise<ProbeResource | null> {
    const entry = (bakeIndex.bakes as Record<string, { url: string }>)[signature];
    if (!entry) return null;
    try {
      const response = await fetch(entry.url); if (!response.ok) throw new Error(`Prepared bake unavailable (${response.status}).`);
      const prepared = await response.json() as PreparedProbeBake;
      const imported = decodeProbeBake(prepared, signature, probes);
      const grid = new LightProbeGrid(...probes.size, ...probes.resolution);
      grid.position.fromArray(probes.position); grid.intensity = probes.intensity; grid.texture = imported; grid.updateBoundingBox();
      this.preparedFailure = null; return { grid, imported, prepared, source: 'prepared' };
    } catch (error) { this.preparedFailure = String(error); return null; }
  }
  private async bake(area: ResolvedAreaDefinition, root: THREE.Group, environment: THREE.Texture | null): Promise<ProbeResource> {
    const spec = area.lighting.probes!;
    const bake = new THREE.Scene(); bake.environment = environment; bake.environmentIntensity = area.lighting.environment?.intensity ?? 1;
    bake.environmentRotation.y = area.lighting.environment?.rotation ?? 0;
    const scenery = root.clone(true); restoreBakeVisibility(scenery);
    scenery.traverse(object => { if (object instanceof THREE.Light || object.userData.transient) object.visible = false; }); bake.add(scenery);
    const sun = new THREE.DirectionalLight(area.lighting.sun.color, area.lighting.sun.intensity);
    sun.target.position.set(spec.position[0], 0, spec.position[2]); sun.position.copy(sun.target.position).addScaledVector(new THREE.Vector3(...area.lighting.sun.position).normalize(), 70); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.radius = 4; sun.shadow.normalBias = .025; sun.shadow.bias = -.00015;
    const extent = Math.max(area.lighting.sun.shadowExtent, Math.max(spec.size[0], spec.size[2]) / 2 + 7);
    Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: .1, far: 150 });
    includeCutawayShadows(sun);
    sun.shadow.camera.updateProjectionMatrix(); bake.add(sun, sun.target);
    const grid = new LightProbeGrid(...spec.size, ...spec.resolution);
    grid.position.fromArray(spec.position); grid.intensity = spec.intensity; grid.updateBoundingBox();
    const count = spec.resolution.reduce((a,b) => a*b, 1);
    try {
      this.stage = this.renderer.domElement.dataset.lightingStage = 'compile';
      await this.renderer.compileAsync(bake, new THREE.PerspectiveCamera());
      for (let pass = 0; pass <= spec.bounces; pass++) for (let start = 0; start < count; start += 8) {
        if (this.disposed) throw new Error('Lighting resources are closed.');
        this.stage = this.renderer.domElement.dataset.lightingStage = `capture:${pass}:${start}/${count}`;
        grid.bake(this.renderer, bake, { cubemapSize: 16, sampleCount: 128, near: .08, far: 100, pass, start, count: Math.min(8, count - start) });
        // Yielding JavaScript alone can enqueue the entire multi-bounce bake
        // before Safari finishes its first captures. Bound in-flight GPU work
        // to this batch without changing probe order or capture settings.
        await finishSubmittedFrame(this.renderer);
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      grid.removeFromParent(); return { grid, source: 'live' };
    } catch (error) { grid.dispose(); throw error; }
    finally { sun.dispose(); disposeSceneInstances(scenery); scenery.traverse(object => { if (object instanceof THREE.Light) object.dispose(); }); }
  }
  commit(scene: THREE.Scene, prepared: PreparedLighting): void {
    this.active?.grid?.removeFromParent(); this.active?.release(); this.active = prepared;
    scene.environment = prepared.environment; if (prepared.grid) scene.add(prepared.grid);
  }
  async exportCurrent(): Promise<PreparedProbeBake> {
    const active = this.active;
    if (!active?.grid || !active.probes) throw new Error('This scene has no irradiance probes.');
    return active.resource?.prepared ?? exportProbeBake(this.renderer, active.grid, active.probes, active.signature);
  }
  diagnostics() { return { stage: this.stage, skies: this.environments.stats(), probes: this.probes.stats(), signature: this.active?.signature, source: this.active?.resource?.source ?? 'none', preparedFailure: this.preparedFailure }; }
  dispose(): void {
    this.disposed = true; this.active?.grid?.removeFromParent(); this.active?.release(); this.previewLease?.release();
    this.probes.dispose(); this.environments.dispose(); this.pmrem.dispose();
  }
}
