import { worldFirelightGain } from '../levels/local-lighting';
import { resizeDisplay } from './display-resolution';
import { isMesh } from '../assets/resource-ownership';
import { applyShadowQuality } from './quality-presets';
import { AreaLightingResources, type PreparedLighting } from './area-lighting';
import type { ResolvedAreaDefinition, AreaLighting } from '../levels/types';
import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { CoreEffects } from './effects';
import { type GraphicsSettings } from './graphics-settings';
import type { WebGPURenderer } from 'three/webgpu';
import { WebGPUPipeline } from './webgpu-pipeline';
import { previewGraphicsView, renderPreview } from './preview-graphics';
import { LocalShadows } from './local-shadows';

export type GraphicsContext = {
  invalidate(): void;
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
  private casterBox = new THREE.Box3();
  private projectedCasters: { mesh: THREE.Mesh; matrix: THREE.Matrix4; bounds: THREE.Box3 }[] = [];
  private receiverBottom = 0;
  private localShadows = new LocalShadows();
  private fitView = {
    valid: false, position: new THREE.Vector3(), rotation: new THREE.Quaternion(),
    left: 0, right: 0, top: 0, bottom: 0, zoom: 0, shadowWidth: 0, shadowHeight: 0,
  };
  private shadowSize = new THREE.Vector3();
  private shadowCenter = new THREE.Vector3();
  private corner = new THREE.Vector2();
  private origin = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
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
  private shadowTrackingMs = 0;
  private cpuSubmissionTimes: number[] = [];
  private shadowTrackingTimes: number[] = [];

  constructor(private ctx: GraphicsContext, private settings: GraphicsSettings, readonly effects: CoreEffects) {
    this.areaLighting = new AreaLightingResources(ctx.renderer);
    this.apply(settings);
  }
  async comparisonInputs() { if (!this.gpuPipeline) throw new Error('Graphics is not ready.'); return this.gpuPipeline.comparisonInputs(); }
  async ready() { await this.gpuPipeline?.ready(); }
  previewGraphics(ready: boolean) {
    return this.gpuPipeline ? previewGraphicsView({ id: 'game', renderer: this.ctx.renderer, camera: this.ctx.camera, pipeline: this.gpuPipeline, settings: this.appliedSettings ?? this.settings, ready: ready && !this.disposed }) : undefined;
  }
  pipelineDiagnostics() { return this.gpuPipeline?.diagnostics(); }
  get preparingSettings(): boolean { return this.gpuPipeline?.preparing ?? false; }
  resetMeasurements(): void { this.intervals = []; this.cpuSubmissionTimes = []; this.shadowTrackingTimes = []; this.lastFrame = 0; }
  measurements() {
    const sorted = [...this.intervals].sort((a, b) => a - b);
    const costs = (values: number[]) => {
      const sorted = [...values].sort((a,b) => a-b);
      return { median: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null, p95: sorted.length ? sorted[Math.floor(sorted.length * .95)] : null, samples: [...values] };
    };
    return { cpuSubmission: costs(this.cpuSubmissionTimes), shadowTracking: costs(this.shadowTrackingTimes), settings: this.settings, samples: [...this.intervals], pipeline: this.gpuPipeline?.diagnostics() ?? { method: 'fsr-temporal', sceneWidth: this.ctx.renderer.domElement.width, sceneHeight: this.ctx.renderer.domElement.height, outputWidth: this.ctx.renderer.domElement.width, outputHeight: this.ctx.renderer.domElement.height }, renderer: 'webgpu', median: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null, p95: sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : null,
        width: this.ctx.renderer.domElement.width, height: this.ctx.renderer.domElement.height, cameraOffset: this.ctx.camera.position.clone().sub(this.ctx.controls.target).toArray(), camera: this.ctx.camera.position.toArray(), zoom: this.ctx.camera.zoom,
        fireShadow: { enabled: this.ctx.lighting.shadow?.castShadow, map: !!this.ctx.lighting.shadow?.shadow.map, intensity: this.ctx.lighting.shadow?.intensity }, localShadows: this.localShadows.diagnostics(), shadowTrackingMs: this.shadowTrackingMs, environment: this.ctx.scene.environmentIntensity, lighting: this.areaLighting.diagnostics() };
  }
  async initialize(): Promise<void> {
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
  exportLighting() { return this.areaLighting.exportCurrent(); }
  lightingDiagnostics() { return this.areaLighting.diagnostics(); }
  commitLighting(prepared: PreparedLighting, borrowed = false): void { prepared.updateFlame(worldFirelightGain(this.settings.warmth)); this.areaLighting.commit(this.ctx.scene, prepared, borrowed); }
  detachLighting(): void { this.areaLighting.detach(this.ctx.scene); this.projectedCasters = []; this.fitView.valid = false; }
  dispose(): void { this.disposed = true; cancelAnimationFrame(this.applyFrame); this.localShadows.dispose(); this.areaLighting.dispose(); this.ctx.scene.environment = null; this.effects.dispose(); this.gpuPipeline?.dispose(); }
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
      this.fitView.valid = false; scene.updateMatrixWorld(true);
      this.projectedCasters = []; this.receiverBottom = 0;
      this.lightDirection.fromArray(look.sun.position).normalize();
      this.shadowRotation.lookAt(this.lightDirection, this.origin, this.up).invert();
      scene.traverse(object => {
        if (!isMesh(object) || (!object.castShadow && !object.receiveShadow) || object instanceof THREE.SkinnedMesh) return;
        if (object instanceof THREE.InstancedMesh) object.computeBoundingBox();
        else object.geometry.computeBoundingBox();
        const bounds = object instanceof THREE.InstancedMesh ? object.boundingBox : object.geometry.boundingBox;
        if (bounds) {
          this.casterBox.copy(bounds).applyMatrix4(object.matrixWorld);
          if (object.receiveShadow) this.receiverBottom = Math.min(this.receiverBottom, this.casterBox.min.y);
          if (object.castShadow) {
            this.projectedCasters.push({ mesh: object, matrix: object.matrixWorld.clone(), bounds: this.casterBox.clone().applyMatrix4(this.shadowRotation).expandByScalar(3) });
          }
        }
      });
    }
    if (lightingChanged || previous?.fog !== s.fog) {
      scene.fog = new THREE.Fog(look.background, Math.max(0, look.fogNear + (.7 - s.fog) * 12), Math.max(look.fogNear + 1, look.fogFar + (.7 - s.fog) * 32));
    }
    if (lightingChanged || previous?.shadowQuality !== s.shadowQuality) applyShadowQuality(scene, s.shadowQuality);
    this.localShadows.sync(this.ctx.lighting.fires);
    if (previous?.particleQuality !== s.particleQuality) this.effects.setQuality(s.particleQuality);
    if (previous?.weatherEffects !== s.weatherEffects) this.effects.setWeatherEffects(s.weatherEffects);
    if (previous?.atmosphericParticles !== s.atmosphericParticles) this.effects.setAtmosphericParticles(s.atmosphericParticles);
    if (!previous) {
      renderer.toneMapping = THREE.NoToneMapping; renderer.toneMappingExposure = 1;
      this.effects.setWeather(null); this.resize();
    }
    this.areaLighting.updateFlame(s.warmth);
    this.gpuPipeline?.update(s, look.saturation ?? .84, look);
    this.gpuPipeline?.configure(s, look.saturation ?? .84, look, delay);
    this.appliedSettings = { ...s }; this.appliedLook = look; this.ctx.invalidate();
    if (!previous || lightingChanged || previous.upscaleQuality !== s.upscaleQuality) this.resetMeasurements();
  }

  resetSceneTime(): void { this.time = 0; this.resetHistory(); }
  resetHistory(): void { this.gpuPipeline?.resetHistory(); this.ctx.invalidate(); }
  resize(): void {
    const mount = this.ctx.mount;
    resizeDisplay(this.ctx.renderer, mount.clientWidth, mount.clientHeight);
    this.gpuPipeline?.resize();
  }

  private fitLights(): void {
    const { sun, camera, lighting } = this.ctx;
    const view = this.fitView, map = sun.shadow.mapSize;
    for (const caster of this.projectedCasters) {
      if (caster.matrix.equals(caster.mesh.matrixWorld)) continue;
      const bounds = caster.mesh instanceof THREE.InstancedMesh ? caster.mesh.boundingBox : caster.mesh.geometry.boundingBox;
      if (bounds) {
        this.lightDirection.fromArray(lighting.definition.sun.position).normalize();
        this.shadowRotation.lookAt(this.lightDirection, this.origin, this.up).invert();
        caster.bounds.copy(bounds).applyMatrix4(caster.mesh.matrixWorld).applyMatrix4(this.shadowRotation).expandByScalar(3);
      }
      caster.matrix.copy(caster.mesh.matrixWorld); view.valid = false;
    }
    if (view.valid && view.position.equals(camera.position) && view.rotation.equals(camera.quaternion)
      && view.left === camera.left && view.right === camera.right && view.top === camera.top && view.bottom === camera.bottom
      && view.zoom === camera.zoom && view.shadowWidth === map.x && view.shadowHeight === map.y) return;
    view.valid = true; view.position.copy(camera.position); view.rotation.copy(camera.quaternion);
    view.left = camera.left; view.right = camera.right; view.top = camera.top; view.bottom = camera.bottom;
    view.zoom = camera.zoom; view.shadowWidth = map.x; view.shadowHeight = map.y;
    this.lightDirection.fromArray(lighting.definition.sun.position).normalize();
    this.shadowRotation.lookAt(this.lightDirection, this.origin, this.up).invert();
    this.shadowBounds.makeEmpty();
    // Include raised scenery; fit in light space, then snap to shadow texels.
    for (const height of [this.receiverBottom, 7]) for (const x of [-1, 1]) for (const y of [-1, 1]) {
      this.ray.setFromCamera(this.corner.set(x, y), camera); this.plane.set(this.up, -height);
      if (this.ray.ray.intersectPlane(this.plane, this.point)) this.shadowBounds.expandByPoint(this.point.applyMatrix4(this.shadowRotation));
    }
    const size = this.shadowBounds.getSize(this.shadowSize), center = this.shadowBounds.getCenter(this.shadowCenter);
    // Half-metre buckets prevent floating-point/view translation from breathing
    // the projection. Zoom still changes coverage, with a padded receiver border.
    const width = Math.max(10, Math.ceil((size.x + 6) * 2) / 2), height = Math.max(10, Math.ceil((size.y + 6) * 2) / 2);
    center.x = Math.round(center.x / (width / sun.shadow.mapSize.x)) * width / sun.shadow.mapSize.x;
    center.y = Math.round(center.y / (height / sun.shadow.mapSize.y)) * height / sun.shadow.mapSize.y;
    // Keep the depth origin on a world-metre grid rather than sliding every frame.
    // Project all static casters onto the light axis, including those outside the view.
    let minZ = this.shadowBounds.min.z, maxZ = this.shadowBounds.max.z;
    for (const { bounds } of this.projectedCasters) {
      if (bounds.max.x < center.x - width / 2 || bounds.min.x > center.x + width / 2 || bounds.max.y < center.y - height / 2 || bounds.min.y > center.y + height / 2) continue;
      minZ = Math.min(minZ, bounds.min.z); maxZ = Math.max(maxZ, bounds.max.z);
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

  render(dt: number, paused: boolean): boolean {
    if (this.preparingLighting || this.gpuPipeline?.preparing) return false;
    const now = performance.now();
    if (!paused) this.time += dt;
    this.ctx.lighting.fires.forEach((light, i) => { light.intensity = Number(light.userData.baseIntensity ?? 9) * worldFirelightGain(this.settings.warmth) * (1 + Math.sin(this.time * 3.3 + i * 1.7) * Number(light.userData.flicker ?? .025) + Math.sin(this.time * 7.1 + i) * Number(light.userData.flicker ?? .025) * .6); });
    this.effects.paused = paused; this.effects.update(dt);
    const shadowStart = performance.now();
    this.localShadows.update(this.ctx.scene, this.ctx.lighting.fires, paused);
    this.shadowTrackingMs = performance.now() - shadowStart;
    this.fitLights();
    const submissionStart = performance.now();
    const rendered = this.gpuPipeline ? renderPreview(this.ctx.renderer, this.gpuPipeline) : false;
    if (rendered) {
      this.cpuSubmissionTimes.push(performance.now() - submissionStart); this.shadowTrackingTimes.push(this.shadowTrackingMs);
      if (this.cpuSubmissionTimes.length > 180) { this.cpuSubmissionTimes.shift(); this.shadowTrackingTimes.shift(); }
    }
    if (rendered) { if (this.lastFrame) this.intervals.push(now - this.lastFrame); this.lastFrame = now; if (this.intervals.length > 180) this.intervals.shift(); }
    if (now - this.statsAt > 500 && this.intervals.length >= 30 && (!this.gpuPipeline || this.gpuPipeline.diagnostics().ready)) {
      this.ctx.renderer.domElement.dataset.graphics = JSON.stringify(this.measurements()); this.statsAt = now;
    }
    return rendered;
  }
}
