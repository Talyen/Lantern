import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { ReviewAsset } from '../../assets/asset-review';
import { AssetLibrary } from '../../assets/asset-library';
import { sceneryLoader } from '../../assets/scenery-loader';
import { disposeSceneResources } from '../../assets/resource-ownership';
import { prepareEnvironmentMaterials } from '../../assets/environment-surfaces';
import { createRenderer } from '../../rendering/renderer';
import { WebGPUPipeline } from '../../rendering/webgpu-pipeline';
import { AreaLightingResources } from '../../rendering/area-lighting';
import { defaults } from '../../rendering/graphics-settings';
import { applyShadowQuality } from '../../rendering/quality-presets';
import { prepareStandardMaterials } from '../../rendering/surface-detail';
import { updateAssetLods } from '../../rendering/asset-lods';
import { resolveLighting } from '../../levels/lighting';

export class ReviewStage {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(33, 1, .05, 1000);
  private controls: OrbitControls;
  private renderer: Awaited<ReturnType<typeof createRenderer>>;
  private pipeline: WebGPUPipeline;
  private lighting: AreaLightingResources;
  private library?: AssetLibrary;
  private reference = new THREE.Group();
  private floor: THREE.Mesh<THREE.PlaneGeometry, MeshStandardNodeMaterial>;
  private sun: THREE.DirectionalLight;
  private object?: THREE.Group;
  private content?: THREE.Group;
  private release?: () => void;
  private mixer?: THREE.AnimationMixer;
  private clips = new Map<string, THREE.AnimationClip>();
  private loader = new GLTFLoader();
  private generation = 0;
  private frame = 0;
  private disposed = false;
  private observer: ResizeObserver;
  private lastTime = 0;
  private paused = false;
  private motionGeneration = 0;
  private constructor(private mount: HTMLElement, renderer: Awaited<ReturnType<typeof createRenderer>>, private onError: (error: unknown) => void) {
    this.renderer = renderer;
    const look = resolveLighting(), settings = defaults();
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
    this.controls = new OrbitControls(this.camera, mount); this.controls.enableDamping = true; this.controls.minDistance = .08; this.controls.maxDistance = 500;
    this.controls.addEventListener('change', () => this.pipeline.resetHistory());
    this.camera.position.set(4, 3, 5); this.controls.target.set(0, 1, 0);
    this.pipeline = new WebGPUPipeline(renderer, this.scene, this.camera, this.controls.target);
    applyShadowQuality(this.scene, settings.shadowQuality); this.pipeline.configure(settings, look.saturation ?? 1, look);
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(mount); this.resize();
  }
  static async create(mount: HTMLElement, onError: (error: unknown) => void): Promise<ReviewStage> {
    const renderer = await createRenderer(mount); renderer.setPixelRatio(1);
    const stage = new ReviewStage(mount, renderer, onError);
    try { await stage.pipeline.ready(); stage.tick(0); return stage; }
    catch (error) { stage.dispose(); throw error; }
  }
  private resize(): void {
    if (this.disposed) return;
    const width = Math.max(1, this.mount.clientWidth), height = Math.max(1, this.mount.clientHeight);
    this.renderer.setSize(width, height); this.camera.aspect = width / height; this.camera.updateProjectionMatrix(); this.pipeline.resize();
  }
  private clear(): void {
    this.mixer?.stopAllAction(); if (this.mixer) this.mixer.uncacheRoot(this.mixer.getRoot()); this.mixer = undefined;
    this.object?.removeFromParent(); this.release?.(); this.release = undefined; this.object = undefined; this.content = undefined; this.clips.clear();
  }
  async show(asset: ReviewAsset): Promise<string | null> {
    const generation = ++this.generation; this.motionGeneration++; this.clear();
    // A reexport can retain its catalog ID and URL. Review must display the bytes
    // fingerprinted for this selection rather than a previous cached appearance.
    this.library?.dispose().catch(this.onError); this.library = undefined;
    if (!asset.available) throw new Error('Prepared asset unavailable. Restore its export or inspect its conversion warnings.');
    let object: THREE.Group, release: () => void;
    if (asset.libraryId && asset.catalogUrl) {
      const library = new AssetLibrary(asset.catalogUrl); this.library = library;
      const instance = await library.loadAsset(asset.libraryId); object = instance.object; release = () => instance.release();
    } else {
      const gltf = await sceneryLoader.loadAsync(asset.url); object = gltf.scene; release = () => disposeSceneResources(object);
      try { if (asset.url.startsWith('/vendor/synty/environment/')) await prepareEnvironmentMaterials(object, asset.url); prepareStandardMaterials(object); }
      catch (error) { release(); throw error; }
    }
    if (generation !== this.generation || this.disposed) { release(); return null; }
    let installed = false;
    try {
      object.updateMatrixWorld(true);
      let box = new THREE.Box3().setFromObject(object), size = box.getSize(new THREE.Vector3());
      if (size.length() <= 0 || !size.toArray().every(Number.isFinite)) throw new Error('Asset has no visible geometry.');
      const wrapper = new THREE.Group(); wrapper.add(object);
      if (asset.height && size.y > 0) wrapper.scale.setScalar(asset.height / size.y);
      wrapper.updateMatrixWorld(true); box = new THREE.Box3().setFromObject(wrapper); const center = box.getCenter(new THREE.Vector3());
      wrapper.position.set(-center.x, -box.min.y, -center.z); wrapper.updateMatrixWorld(true);
      object.traverse(node => { if (node instanceof THREE.Mesh) node.castShadow = node.receiveShadow = true; });
      await this.renderer.compileAsync(wrapper, this.camera);
      if (generation !== this.generation || this.disposed) { release(); return null; }
      this.object = wrapper; this.content = object; this.release = release; installed = true; this.scene.add(wrapper); this.mixer = new THREE.AnimationMixer(object); this.paused = false;
      size = new THREE.Box3().setFromObject(wrapper).getSize(new THREE.Vector3());
      this.reference.position.x = size.x / 2 + .7;
      const extent = Math.max(size.x, size.z, 5) * 1.5;
      Object.assign(this.sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, far: Math.max(100, size.y * 4) }); this.sun.shadow.camera.updateProjectionMatrix();
      this.view('gameplay'); this.fit(); updateAssetLods(object, this.camera); this.pipeline.resetHistory();
      await this.renderer.compileAsync(this.scene, this.camera);
      if (generation !== this.generation || this.disposed) return null;
      this.pipeline.render();
      if (!this.frame) this.tick(performance.now());
      await new Promise<void>(accept => requestAnimationFrame(() => accept()));
      if (generation !== this.generation || this.disposed) return null;
      return `${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} m`;
    } catch (error) { if (installed && generation === this.generation) this.clear(); else if (!installed) release(); throw error; }
  }
  empty(): void {
    this.generation++; this.motionGeneration++; this.clear(); this.library?.dispose().catch(this.onError); this.library = undefined; this.pipeline.resetHistory();
  }
  fit(): void {
    if (!this.object) return;
    const box = new THREE.Box3().setFromObject(this.object); if (this.reference.visible) box.expandByObject(this.reference);
    const size = box.getSize(new THREE.Vector3()), target = box.getCenter(new THREE.Vector3());
    const distance = Math.max(size.y, size.x / this.camera.aspect) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.25 + size.z;
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.copy(target); this.camera.position.copy(target).addScaledVector(direction, distance); this.controls.update(); this.pipeline.resetHistory();
  }
  view(view: string): void {
    const distance = Math.max(1, this.camera.position.distanceTo(this.controls.target));
    const direction = view === 'side' ? new THREE.Vector3(1, 0, 0) : view === 'back' ? new THREE.Vector3(0, 0, -1) : view === 'front' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, .85, 1);
    this.camera.position.copy(this.controls.target).addScaledVector(direction.normalize(), distance); this.controls.update(); this.pipeline.resetHistory();
  }
  scaleReference(visible: boolean): void { this.reference.visible = visible; this.fit(); }
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
    for (const track of clip.tracks) if (!THREE.PropertyBinding.findNode(root, THREE.PropertyBinding.parseTrackName(track.name).nodeName)) throw new Error('Motion does not match this character. Static preview remains available.');
    this.clips.set(role, clip); this.mixer.clipAction(clip).reset().play(); this.paused = false;
  }
  pause(paused: boolean): void { this.paused = paused; }
  private tick(time: number): void {
    if (this.disposed) return;
    this.frame = 0;
    const dt = this.lastTime ? Math.min(.05, (time - this.lastTime) / 1000) : 0; this.lastTime = time;
    if (!document.hidden) {
      this.controls.update(); if (!this.paused) this.mixer?.update(dt); if (this.content) updateAssetLods(this.content, this.camera);
      try { this.pipeline.render(); } catch (error) { this.onError(error); return; }
    }
    this.frame = requestAnimationFrame(next => this.tick(next));
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.generation++; cancelAnimationFrame(this.frame); this.observer.disconnect(); this.controls.dispose(); this.clear();
    disposeSceneResources(this.reference); disposeSceneResources(this.floor); this.pipeline.dispose(); this.lighting.dispose(); this.sun.shadow.dispose();
    this.library?.dispose().catch(this.onError);
    this.renderer.dispose().catch(this.onError);
  }
}
