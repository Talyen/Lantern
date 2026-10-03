import * as THREE from 'three';
import { MeshBasicNodeMaterial, type WebGPURenderer } from 'three/webgpu';
import { instanceIndex, mx_noise_float, smoothstep, vec4 } from 'three/tsl';
import { Curve1D, Manager, MeshRenderer, system, type ParticleStorage, type SystemDef } from 'three-plume';
import { isMesh } from '../assets/resource-ownership';

export type ImpactEvent = { time: number; position: THREE.Vector3; sparks: boolean };
/** Plume's mesh renderer supplies RGB; explicitly retain its GPU alpha-over-life in our material. */
class FadingMeshRenderer extends MeshRenderer {
  constructor(private material: MeshBasicNodeMaterial, geometry: THREE.BufferGeometry) { super({ material, geometry }); }
  override init(storage: ParticleStorage, capacity: number): void {
    super.init(storage, capacity);
    this.material.opacityNode = storage.color.element(instanceIndex).a.mul(storage.posAlive.element(instanceIndex).w);
  }
}

/** Plume owns particle storage, emission, integration, curves, batching and pooling. */
export class ArrowRainParticles {
  readonly root = new THREE.Group();
  private manager: Manager;
  private materials = new Set<THREE.Material>();
  private curveTextures = new Set<THREE.Texture>();
  private events: ImpactEvent[] = [];
  private next = 0;
  private step = 0;
  private current = 0;
  private replayCount = 0;
  private spawned = 0;
  private camera?: THREE.Camera;
  private disposed = false;
  constructor(renderer: WebGPURenderer, private stage: THREE.Group, map: THREE.Texture, sparkGeometry: THREE.BufferGeometry, density: number) {
    this.root.userData.transient = true; this.root.name = 'Plume ability particles';
    this.manager = new Manager({ renderer, scene: this.root, maxActive: 40, maxPoolPer: 32 });
    const curve = (keys: [number, number][]) => { const value = new Curve1D(keys.map(([t, v]) => ({ t, v }))); this.curveTextures.add(value.getTexture()); return value; };
    const smokeSize = curve([[0, .6], [.3, 1.35], [1, 2.4]]), smokeAlpha = curve([[0, 0], [.08, .21], [.35, .17], [1, 0]]);
    const sparkSize = curve([[0, 1], [.4, .85], [1, .25]]), sparkAlpha = curve([[0, 0], [.03, .95], [.35, .7], [1, 0]]);
    const count = Math.max(3, Math.round(6 * density));
    const definition = (sparks: boolean): SystemDef => {
      const builder = system('woodland-impact').duration(.05).emitter('dust', e => e.capacity(16).duration(.05).loop(false).seed(912).spawnBurst({ time: 0, count })
        .position({ shape: { kind: 'sphere', radius: .09 } }).velocity({ shape: { kind: 'cone', angle: .65 }, speed: { min: .35, max: .8 } })
        .lifetime({ min: .7, max: 1.1 }).size({ min: .18, max: .32 }).rotation({ min: 0, max: Math.PI * 2 })
        .color([.35, .26, .16]).integrate().lifetimeTick().gravity([0, .12, 0]).drag(.7).sizeOverLife(smokeSize).alphaOverLife(smokeAlpha)
        .renderSprite({ textures: map, blending: 'normal', depthWrite: false, colorNode: ({ textures, uv, particle }) => {
          const soft = smoothstep(.06, .49, uv.sub(.5).length()).oneMinus().mul(mx_noise_float(uv.mul(4)).mul(.25).add(.7));
          return vec4(particle.color.rgb, textures.base.sample(uv).a.mul(particle.color.a).mul(soft));
        } }));
      if (sparks) {
        const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false }); this.materials.add(material);
        builder.emitter('sparks', e => e.capacity(8).duration(.05).loop(false).seed(313).spawnBurst({ time: 0, count: 4 })
          .position({ shape: { kind: 'sphere', radius: .055 } }).velocity({ shape: { kind: 'cone', angle: 1 }, speed: { min: 1.1, max: 2.5 } })
          .lifetime({ min: .22, max: .4 }).size({ min: .10, max: .23 }).rotation({ min: 0, max: Math.PI * 2 }, { angularVelocity: { min: 1, max: 6 } })
          .color([1.05, .58, .17]).integrate().lifetimeTick().gravity([0, -6, 0]).drag(.2).sizeOverLife(sparkSize).alphaOverLife(sparkAlpha)
          .renderWith(new FadingMeshRenderer(material, sparkGeometry)));
      }
      return builder.build();
    };
    this.manager.register('dust', () => definition(false)); this.manager.register('impact', () => definition(true));
  }
  async prepare(): Promise<void> {
    // preload() compiles compute only. Manager.warmup() would render outside Lantern's graph.
    await this.manager.preload('dust', 4); await this.manager.preload('impact', 4);
  }
  /** Expose one live instance of each material to the shared pipeline's startup compiler. */
  stageMaterials(camera: THREE.Camera): void {
    this.manager.spawn('dust', { position: this.stage.position }); this.manager.spawn('impact', { position: this.stage.position });
    this.manager.tick(1 / 60, camera); this.camera = camera;
    this.root.traverse(object => { if (isMesh(object) && object instanceof THREE.InstancedMesh) object.count = Math.max(1, object.count); });
  }
  set(events: ImpactEvent[]): void { this.events = events.slice().sort((a, b) => a.time - b.time); this.reset(); }
  reset(): void { this.manager.clear(); this.manager.resetClock(); this.step = 0; this.current = 0; this.next = 0; this.spawned = 0; this.replayCount++; }
  seek(time: number, camera: THREE.Camera): void {
    if (this.disposed) return;
    this.camera = camera;
    const target = Math.max(0, Math.floor(time * 60 + 1e-6));
    if (target < this.step) this.reset();
    this.stage.updateMatrixWorld(true);
    while (this.step < target) {
      const nextTime = (this.step + 1) / 60;
      while (this.next < this.events.length && this.events[this.next].time <= nextTime) {
        const event = this.events[this.next++];
        const position = this.stage.localToWorld(event.position.clone()); position.y += .10;
        if (!this.manager.spawn(event.sparks ? 'impact' : 'dust', { position })) throw new Error('Plume impact capacity exceeded.');
        this.spawned++;
      }
      this.manager.tick(1 / 60, camera); this.step++; this.current = this.step / 60;
    }
  }
  /** Camera changes still update billboards and sorting while simulation is paused. */
  syncCamera(): void { if (this.camera) this.manager.tick(0, this.camera); }
  snapshot() { return { engine: 'three-plume 0.1.1', simulatedTime: this.current, events: this.events.length, spawned: this.spawned, activeSystems: this.root.children.length, replays: this.replayCount }; }
  dispose(): void { if (this.disposed) return; this.disposed = true; this.root.removeFromParent(); this.manager.dispose(); this.materials.forEach(material => material.dispose()); this.curveTextures.forEach(texture => texture.dispose()); this.materials.clear(); this.curveTextures.clear(); }
}
