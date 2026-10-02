import { applyShadowQuality } from './quality-presets';
import { AreaLightingResources, type PreparedLighting } from './area-lighting';
import type { ResolvedAreaDefinition, AreaLighting } from '../levels/types';
import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { CoreEffects } from './effects';
import { type GraphicsSettings } from './graphics-settings';
import type { WebGPURenderer } from 'three/webgpu';
import type { WebGPUPipeline } from './webgpu-pipeline';

export type GraphicsContext = {
  scene: THREE.Scene; camera: THREE.OrthographicCamera;
  renderer: WebGPURenderer; controls: OrbitControls;
  sun: THREE.DirectionalLight; ambient: THREE.HemisphereLight; mount: HTMLElement;
  lighting: { definition: AreaLighting; fires: THREE.PointLight[]; readonly shadow: THREE.PointLight | null };
};
export class Graphics {
  private gpuPipeline: WebGPUPipeline | null = null;
  private areaLighting: AreaLightingResources;
  private preparingLighting = 0;
  private pendingSettings: GraphicsSettings | null = null;
  private appliedSettings?: GraphicsSettings;
  private appliedLook?: AreaLighting;
  private applyFrame = 0;
  private disposed = false;
  private casterBounds = new THREE.Box3();
  private casterBox = new THREE.Box3();
  private shadowNear = 40;
  private shadowFar = 100;
  private lightDirection = new THREE.Vector3();
  private shadowRotation = new THREE.Matrix4();
  private shadowBounds = new THREE.Box3();
  private ray = new THREE.Raycaster();
  private point = new THREE.Vector3();
  private plane = new THREE.Plane();
  private time = 0;
  private intervals: number[] = [];
  private lastFrame = 0;
  private statsAt = 0;

  constructor(private ctx: GraphicsContext, private settings: GraphicsSettings, readonly effects: CoreEffects) {
    this.areaLighting = new AreaLightingResources(ctx.renderer);
    this.apply(settings);
  }
  get preparingSettings(): boolean { return this.gpuPipeline?.preparing ?? false; }
  resetMeasurements(): void { this.intervals = []; this.lastFrame = 0; }
  async initialize(): Promise<void> {
    const { WebGPUPipeline } = await import('./webgpu-pipeline');
    this.gpuPipeline = new WebGPUPipeline(this.ctx.renderer, this.ctx.scene, this.ctx.camera, this.ctx.controls.target);
    this.applyNow(0);
    await this.gpuPipeline?.ready();
  }
  async prepareLighting(area: ResolvedAreaDefinition, root: THREE.Group): Promise<PreparedLighting> {
    await this.gpuPipeline?.ready();
    this.preparingLighting++;
    try { return await this.areaLighting.prepare(area, root); }
    finally { this.preparingLighting--; }
  }
  discardLighting(prepared: PreparedLighting): void { prepared.release(); }
  exportLighting() { return this.areaLighting.exportCurrent(); }
  lightingDiagnostics() { return this.areaLighting.diagnostics(); }
  commitLighting(prepared: PreparedLighting): void { this.areaLighting.commit(this.ctx.scene, prepared); }
  dispose(): void { this.disposed = true; cancelAnimationFrame(this.applyFrame); this.areaLighting.dispose(); this.ctx.scene.environment = null; this.effects.dispose(); this.gpuPipeline?.dispose(); }
  apply(settings: GraphicsSettings): void {
    this.pendingSettings = { ...settings };
    if (!this.applyFrame) this.applyFrame = requestAnimationFrame(() => { this.applyFrame = 0; this.applyNow(); });
  }
  flushSettings(): void {
    cancelAnimationFrame(this.applyFrame); this.applyFrame = 0;
    this.applyNow(0); this.gpuPipeline?.flush();
  }
  private applyNow(delay = 150): void {
    if (this.disposed) return;
    const s = this.pendingSettings ?? { ...this.settings };
    this.pendingSettings = null; this.settings = s;
    const previous = this.appliedSettings;
    const { scene, ambient, sun, renderer } = this.ctx;
    const look = this.ctx.lighting.definition, lightingChanged = look !== this.appliedLook;
    if (lightingChanged) {
      scene.background = new THREE.Color(look.background);
      ambient.color.set(look.ambient.sky); ambient.groundColor.set(look.ambient.ground); ambient.intensity = look.ambient.intensity;
      sun.color.set(look.sun.color); sun.intensity = look.sun.intensity;
      scene.environmentIntensity = look.environment?.intensity ?? 1; scene.environmentRotation.y = look.environment?.rotation ?? 0;
      // Static caster bounds include offscreen trees/roofs that shade visible ground.
      // Actors and wind fit inside the padded depth envelope below.
      this.casterBounds.makeEmpty(); scene.updateMatrixWorld(true);
      scene.traverse(object => {
        if (!(object instanceof THREE.Mesh) || !object.castShadow || object instanceof THREE.SkinnedMesh) return;
        if (object instanceof THREE.InstancedMesh) object.computeBoundingBox();
        else object.geometry.computeBoundingBox();
        const bounds = object instanceof THREE.InstancedMesh ? object.boundingBox : object.geometry.boundingBox;
        if (bounds) this.casterBounds.union(this.casterBox.copy(bounds).applyMatrix4(object.matrixWorld));
      });
    }
    if (lightingChanged || previous?.fog !== s.fog) {
      scene.fog = new THREE.Fog(look.background, Math.max(0, look.fogNear + (.7 - s.fog) * 12), Math.max(look.fogNear + 1, look.fogFar + (.7 - s.fog) * 32));
    }
    if (lightingChanged || previous?.shadowQuality !== s.shadowQuality) applyShadowQuality(scene, s.shadowQuality);
    if (previous?.particleQuality !== s.particleQuality) this.effects.setQuality(s.particleQuality);
    if (previous?.atmosphericParticles !== s.atmosphericParticles) this.effects.setAtmosphericParticles(s.atmosphericParticles);
    if (!previous) {
      renderer.setPixelRatio(1); renderer.toneMapping = THREE.NoToneMapping; renderer.toneMappingExposure = 1;
      this.effects.setWeather(null); this.resize();
    }
    this.gpuPipeline?.update(s, look.saturation ?? .84, look);
    this.gpuPipeline?.configure(s, look.saturation ?? .84, look, delay);
    this.appliedSettings = { ...s }; this.appliedLook = look;
    if (!previous || lightingChanged || previous.upscaleQuality !== s.upscaleQuality) this.resetMeasurements();
  }

  resetSceneTime(): void { this.time = 0; this.resetHistory(); }
  resetHistory(): void { this.gpuPipeline?.resetHistory(); }
  resize(): void {
    const mount = this.ctx.mount;
    const canvas = this.ctx.renderer.domElement;
    if (canvas.width !== mount.clientWidth || canvas.height !== mount.clientHeight) this.ctx.renderer.setSize(mount.clientWidth, mount.clientHeight);
    this.gpuPipeline?.resize();
  }

  private fitLights(): void {
    const { sun, camera, lighting } = this.ctx;
    this.lightDirection.fromArray(lighting.definition.sun.position).normalize();
    this.shadowRotation.lookAt(this.lightDirection, new THREE.Vector3(), new THREE.Vector3(0, 1, 0)).invert();
    this.shadowBounds.makeEmpty();
    // Include raised scenery; fit in light space, then snap to shadow texels.
    for (const height of [0, 7]) for (const x of [-1, 1]) for (const y of [-1, 1]) {
      this.ray.setFromCamera(new THREE.Vector2(x, y), camera); this.plane.set(new THREE.Vector3(0, 1, 0), -height);
      if (this.ray.ray.intersectPlane(this.plane, this.point)) this.shadowBounds.expandByPoint(this.point.applyMatrix4(this.shadowRotation));
    }
    const size = this.shadowBounds.getSize(new THREE.Vector3()), center = this.shadowBounds.getCenter(new THREE.Vector3());
    const width = Math.max(10, size.x + 6), height = Math.max(10, size.y + 6);
    center.x = Math.round(center.x / (width / sun.shadow.mapSize.x)) * width / sun.shadow.mapSize.x;
    center.y = Math.round(center.y / (height / sun.shadow.mapSize.y)) * height / sun.shadow.mapSize.y;
    // Keep the depth origin on a world-metre grid rather than sliding every frame.
    // Project all static casters onto the light axis, including those outside the view.
    let minZ = this.shadowBounds.min.z, maxZ = this.shadowBounds.max.z;
    if (!this.casterBounds.isEmpty()) for (const x of [this.casterBounds.min.x, this.casterBounds.max.x]) for (const y of [this.casterBounds.min.y, this.casterBounds.max.y]) for (const z of [this.casterBounds.min.z, this.casterBounds.max.z]) {
      this.point.set(x, y, z).applyMatrix4(this.shadowRotation);
      minZ = Math.min(minZ, this.point.z); maxZ = Math.max(maxZ, this.point.z);
    }
    center.z = Math.round((minZ + maxZ) / 2);
    const depth = Math.ceil((maxZ - minZ + 12) / 4) * 4;
    const distance = depth / 2 + 4;
    this.shadowNear = 1; this.shadowFar = depth + 8;
    center.applyMatrix4(this.shadowRotation.invert());
    sun.target.position.copy(center); sun.position.copy(center).addScaledVector(this.lightDirection, distance);
    Object.assign(sun.shadow.camera, { left: -width / 2, right: width / 2, top: height / 2, bottom: -height / 2, near: this.shadowNear, far: this.shadowFar });
    sun.shadow.camera.updateProjectionMatrix(); sun.target.updateMatrixWorld(); sun.shadow.needsUpdate = true;

  }

  render(dt: number, paused: boolean): void {
    if (this.preparingLighting || this.gpuPipeline?.preparing) return;
    this.fitLights();
    const now = performance.now(); if (this.lastFrame) this.intervals.push(now - this.lastFrame); this.lastFrame = now; if (this.intervals.length > 180) this.intervals.shift();
    if (!paused) this.time += dt;
    this.ctx.lighting.fires.forEach((light, i) => { light.intensity = Number(light.userData.baseIntensity ?? 9) * (.65 + this.settings.warmth * .5) * (1 + Math.sin(this.time * 3.3 + i * 1.7) * Number(light.userData.flicker ?? .025) + Math.sin(this.time * 7.1 + i) * Number(light.userData.flicker ?? .025) * .6); });
    this.effects.paused = paused; this.effects.update(dt);
    this.gpuPipeline?.render();
    if (now - this.statsAt > 500 && this.intervals.length >= 30 && (!this.gpuPipeline || this.gpuPipeline.diagnostics().ready)) { const sorted = [...this.intervals].sort((a, b) => a - b);
      this.ctx.renderer.domElement.dataset.graphics = JSON.stringify({ settings: this.settings, samples: [...this.intervals], pipeline: this.gpuPipeline?.diagnostics() ?? { method: 'fsr-temporal', sceneWidth: this.ctx.renderer.domElement.width, sceneHeight: this.ctx.renderer.domElement.height, outputWidth: this.ctx.renderer.domElement.width, outputHeight: this.ctx.renderer.domElement.height }, renderer: 'webgpu', median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.floor(sorted.length * 0.95)],
        width: this.ctx.renderer.domElement.width, height: this.ctx.renderer.domElement.height, cameraOffset: this.ctx.camera.position.clone().sub(this.ctx.controls.target).toArray(), camera: this.ctx.camera.position.toArray(), zoom: this.ctx.camera.zoom,
        fireShadow: { enabled: this.ctx.lighting.shadow?.castShadow, map: !!this.ctx.lighting.shadow?.shadow.map, intensity: this.ctx.lighting.shadow?.intensity }, environment: this.ctx.scene.environmentIntensity, lighting: this.areaLighting.diagnostics() }); this.statsAt = now; }
  }
}
