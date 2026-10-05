import { unmatchedMotionNode } from '../../animation/rig-bindings';
import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { ReviewAsset } from '../../assets/asset-review';
import { disposeSceneResources } from '../../assets/resource-ownership';
import { createRenderer, waitForPresentedFrames } from '../../rendering/renderer';
import { resizeDisplay } from '../../rendering/display-resolution';
import { WebGPUPipeline } from '../../rendering/webgpu-pipeline';
import { AreaLightingResources } from '../../rendering/area-lighting';
import type { GraphicsSettings } from '../../rendering/graphics-settings';
import { reviewGraphics } from './review-graphics';
import { createCamera } from '../../session/camera';
import { PreparedAssets, type PreparedReviewAsset } from './prepared-assets';
import { applyShadowQuality } from '../../rendering/quality-presets';
import { updateAssetLods } from '../../rendering/asset-lods';
import { resolveLighting } from '../../levels/lighting';

export class ReviewStage {
  private scene = new THREE.Scene();
  private orbitCamera = new THREE.PerspectiveCamera(33, 1, .05, 1000);
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  private game: ReturnType<typeof createCamera>;
  private mode = 'game';
  private controls: OrbitControls;
  private renderer: Awaited<ReturnType<typeof createRenderer>>;
  private pipeline: WebGPUPipeline;
  private lighting: AreaLightingResources;
  private pool = new PreparedAssets();
  private active?: PreparedReviewAsset;
  private pipelines = new Map<string, WebGPUPipeline>();
  private compilation: Promise<void> = Promise.resolve();
  private warming = new WeakMap<PreparedReviewAsset, Map<string, Promise<void>>>();
  private reference = new THREE.Group();
  private floor: THREE.Mesh<THREE.PlaneGeometry, MeshStandardNodeMaterial>;
  private sun: THREE.DirectionalLight;
  private object?: THREE.Group;
  private content?: THREE.Group;
    private mixer?: THREE.AnimationMixer;
  private clips = new Map<string, THREE.AnimationClip>();
  private loader = new GLTFLoader();
  private generation = 0;
  private frame = 0;
  private completedFrames = 0;
  private renderError: unknown;
  private disposed = false;
  private observer: ResizeObserver;
  private readonly onResize = () => this.resize();
  private lastTime = 0;
  private paused = false;
  private motionGeneration = 0;
  private constructor(private mount: HTMLElement, renderer: Awaited<ReturnType<typeof createRenderer>>, private onError: (error: unknown) => void, private settings: GraphicsSettings) {
    this.renderer = renderer;
    const look = resolveLighting();
    this.game = createCamera(renderer.domElement); this.game.controls.enabled = false; this.game.setDistance(settings.cameraDistance); this.camera = this.game.camera;
    this.scene.background = new THREE.Color(look.background); this.scene.fog = new THREE.Fog(look.background, look.fogNear, look.fogFar);
    this.lighting = new AreaLightingResources(renderer); this.scene.environment = this.lighting.environmentTexture(look); this.scene.environmentIntensity = look.environment!.intensity;
    this.scene.add(new THREE.HemisphereLight(look.ambient.sky, look.ambient.ground, look.ambient.intensity));
    this.sun = new THREE.DirectionalLight(look.sun.color, look.sun.intensity); this.sun.position.fromArray(look.sun.position); this.sun.castShadow = true; this.scene.add(this.sun, this.sun.target);
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new MeshStandardNodeMaterial({ color: '#484137', roughness: 1 }));
    this.floor.rotation.x = -Math.PI / 2; this.floor.position.y = -.015; this.floor.receiveShadow = true; this.scene.add(this.floor);
    // A subdued human-height marker supplies scale without competing with the asset.
    const markerMaterial = new MeshStandardNodeMaterial({ color: '#ad9674', roughness: 1, wireframe: true });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(.18, .18, 1.35, 8), markerMaterial); body.position.y = .775;
    const head = new THREE.Mesh(new THREE.SphereGeometry(.15, 8, 6), markerMaterial); head.position.y = 1.65;
    this.reference.add(body, head); this.reference.visible = false; this.scene.add(this.reference);
    this.controls = new OrbitControls(this.orbitCamera, mount); this.controls.enableDamping = true; this.controls.minDistance = .08; this.controls.maxDistance = 500;
    this.controls.addEventListener('end', () => this.pipeline.resetHistory());
    this.controls.enabled = false;
    this.orbitCamera.position.set(4, 3, 5); this.controls.target.set(0, 1, 0);
    this.pipeline = new WebGPUPipeline(renderer, this.scene, this.camera, this.game.controls.target);
    applyShadowQuality(this.scene, settings.shadowQuality); this.pipeline.configure(settings, look.saturation ?? 1, look); this.pipelines.set('game', this.pipeline);
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(mount); window.addEventListener('resize', this.onResize); this.resize();
  }
  static async create(mount: HTMLElement, onError: (error: unknown) => void): Promise<ReviewStage> {
    const settings = await reviewGraphics();
    const renderer = await createRenderer(mount);
    const stage = new ReviewStage(mount, renderer, onError, settings);
    try { await stage.pipeline.ready(); stage.tick(0); return stage; }
    catch (error) { stage.dispose(); throw error; }
  }
  private resize(): void {
    if (this.disposed) return;
    const width = Math.max(1, this.mount.clientWidth), height = Math.max(1, this.mount.clientHeight);
    resizeDisplay(this.renderer, width, height); this.orbitCamera.aspect = width / height; this.orbitCamera.updateProjectionMatrix(); this.game.resize(width, height); for (const pipeline of this.pipelines.values()) pipeline.resize();
  }
  private clear(): void {
    this.mixer?.stopAllAction(); if (this.mixer) this.mixer.uncacheRoot(this.mixer.getRoot()); this.mixer = undefined;
    this.object?.removeFromParent(); this.active = undefined; this.object = undefined; this.content = undefined; this.clips.clear();
  }
  private async warm(prepared: PreparedReviewAsset): Promise<void> {
    const mode = this.mode === 'game' ? 'game' : 'orbit', camera = this.camera;
    if (prepared.compiled.has(mode)) return;
    let modes = this.warming.get(prepared); if (!modes) { modes = new Map(); this.warming.set(prepared, modes); }
    const existing = modes.get(mode); if (existing) return existing;
    const release = this.pool.keep(prepared);
    const pending = this.compilation.then(async () => {
      if (this.disposed) return;
      // Upstream targetScene applies the actual stage lights/environment in one compile.
      await this.renderer.compileAsync(prepared.object, camera, this.scene);
      prepared.compiled.add(mode);
    });
    modes.set(mode, pending); this.compilation = pending.catch(() => {});
    try { await pending; } finally { modes.delete(mode); release(); }
  }
  async preload(asset: ReviewAsset): Promise<void> { const prepared = await this.pool.get(asset); await this.warm(prepared); }
  async show(asset: ReviewAsset): Promise<string | null> {
    const generation = ++this.generation; this.motionGeneration++; this.clear();
    this.renderError = undefined;
    const prepared = await this.pool.get(asset, true);
    if (generation !== this.generation || this.disposed) return null;
    this.active = prepared; this.object = prepared.object; this.content = prepared.content;
    this.scene.add(prepared.object); this.mixer = new THREE.AnimationMixer(prepared.content); this.paused = false;
    const size = prepared.size; this.reference.position.x = size.x / 2 + .7;
    const extent = Math.max(size.x, size.z, 5) * 1.5;
    Object.assign(this.sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, far: Math.max(100, size.y * 4) }); this.sun.shadow.camera.updateProjectionMatrix();
    if (this.mode === 'game') this.game.resetFollow(new THREE.Vector3()); else this.fitOrbit();
    updateAssetLods(prepared.content, this.camera); this.pipeline.resetHistory();
    try {
      await this.warm(prepared);
      if (generation !== this.generation || this.disposed) return null;
      if (!this.frame) this.tick(performance.now());
      if (!await waitForPresentedFrames(this.renderer, () => this.completedFrames, 2, () => {
        if (generation !== this.generation || this.disposed) return false;
        if (this.renderError !== undefined) throw this.renderError;
        return true;
      })) return null;
      return `${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} m`;
    } catch (error) { if (generation === this.generation) this.clear(); throw error; }
  }
  empty(): void { this.generation++; this.motionGeneration++; this.clear(); this.pool.unpin(); this.pipeline.resetHistory(); }
  diagnostics() { return { camera: this.mode === 'game' ? 'orthographic-game' : 'perspective-inspection', settings: this.settings, projection: this.camera.projectionMatrix.toArray(), cache: this.pool.diagnostics(), pipeline: this.pipeline.diagnostics() }; }
  async fit(): Promise<void> { if (this.mode === 'game') await this.view('orbit'); this.fitOrbit(); }
  private fitOrbit(): void {
    if (!this.object) return;
    const box = new THREE.Box3().setFromObject(this.object); if (this.reference.visible) box.expandByObject(this.reference);
    const size = box.getSize(new THREE.Vector3()), target = box.getCenter(new THREE.Vector3());
    const distance = Math.max(size.y, size.x / this.orbitCamera.aspect) / (2 * Math.tan(THREE.MathUtils.degToRad(this.orbitCamera.fov / 2))) * 1.25 + size.z;
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.copy(target); this.camera.position.copy(target).addScaledVector(direction, distance); this.controls.update(); this.pipeline.resetHistory();
  }
  async view(view: string): Promise<void> {
    const game = view === 'game', key = game ? 'game' : 'orbit';
    this.mode = view; this.controls.enabled = !game; this.camera = game ? this.game.camera : this.orbitCamera;
    let pipeline = this.pipelines.get(key);
    if (!pipeline) {
      pipeline = new WebGPUPipeline(this.renderer, this.scene, this.camera, game ? this.game.controls.target : this.controls.target);
      const look = resolveLighting(); pipeline.configure(this.settings, look.saturation ?? 1, look); this.pipelines.set(key, pipeline);
      await pipeline.ready();
    }
    this.pipeline = pipeline;
    if (game) this.game.resetFollow(new THREE.Vector3());
    else {
      const direction = view === 'side' ? new THREE.Vector3(1, 0, 0) : view === 'back' ? new THREE.Vector3(0, 0, -1) : view === 'front' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, .85, 1);
      this.orbitCamera.position.copy(this.controls.target).addScaledVector(direction.normalize(), Math.max(1, this.orbitCamera.position.distanceTo(this.controls.target))); this.controls.update(); this.fitOrbit();
    }
    this.resize(); pipeline.resetHistory(); if (this.active) await this.warm(this.active);
  }
  scaleReference(visible: boolean): void { this.reference.visible = visible; if (this.mode !== 'game') this.fitOrbit(); this.pipeline.resetHistory(); }
  async motion(asset: ReviewAsset, role: string): Promise<void> {
    const generation = this.generation, motionGeneration = ++this.motionGeneration;
    this.mixer?.stopAllAction(); this.pipeline.resetHistory(); if (role === 'static') return;
    const url = asset.motions?.[role as 'idle' | 'run' | 'attack']; if (!url) throw new Error('No compatible sample is prepared for this motion.');
    let clip = this.clips.get(role);
    if (!clip) {
      const gltf = await this.loader.loadAsync(url); clip = gltf.animations[0]; disposeSceneResources(gltf.scene);
      if (!clip) throw new Error('Motion sample has no animation.');
    }
    if (this.disposed || generation !== this.generation || motionGeneration !== this.motionGeneration || !this.mixer || !this.object) return;
    const root = this.mixer.getRoot();
    if (unmatchedMotionNode(root, [clip]) !== undefined) throw new Error('Motion does not match this character. Static preview remains available.');
    this.clips.set(role, clip); this.mixer.clipAction(clip).reset().play(); this.paused = false;
  }
  pause(paused: boolean): void { this.paused = paused; }
  private tick(time: number): void {
    if (this.disposed) return;
    this.frame = 0;
    const dt = this.lastTime ? Math.min(.05, (time - this.lastTime) / 1000) : 0; this.lastTime = time;
    if (!document.hidden) {
      if (this.mode !== 'game') this.controls.update(); if (!this.paused) this.mixer?.update(dt); if (this.content) updateAssetLods(this.content, this.camera);
      try { if (this.pipeline.render()) this.completedFrames++; } catch (error) { this.renderError = error; this.onError(error); return; }
    }
    this.frame = requestAnimationFrame(next => this.tick(next));
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.generation++; cancelAnimationFrame(this.frame); this.observer.disconnect(); window.removeEventListener('resize', this.onResize); this.controls.dispose(); this.clear();
    disposeSceneResources(this.reference); disposeSceneResources(this.floor); for (const pipeline of this.pipelines.values()) pipeline.dispose(); this.lighting.dispose(); this.sun.shadow.dispose();
    this.pool.dispose(); this.game.controls.dispose();
    this.renderer.dispose().catch(this.onError);
  }
}
