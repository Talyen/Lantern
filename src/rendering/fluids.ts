import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { attribute, sin, smoothstep, uv } from 'three/tsl';
import { waterAt, waterDistance, waterHeight, type WaterDefinition } from '../levels/water';
import { particlePresets, type QualityLevel } from './quality-presets';

type Slot = { x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; life: number; size: number; yaw: number; weather: boolean };

/** Fixed slots, one instanced draw per shape, with compact visible instances. */
class FluidPool {
  readonly mesh: THREE.InstancedMesh;
  readonly slots: Slot[];
  private opacity: THREE.InstancedBufferAttribute;
  private transform = new THREE.Object3D();
  private cursor = 0;
  private pending = false;
  constructor(readonly kind: 'drop' | 'ring' | 'stain', capacity: number) {
    const geometry = kind === 'drop' ? new THREE.SphereGeometry(1, 6, 4) : kind === 'ring' ? new THREE.PlaneGeometry(2, 2) : new THREE.CircleGeometry(1, 16);
    this.opacity = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('fluidOpacity', this.opacity);
    const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    material.opacityNode = attribute('fluidOpacity', 'float');
    if (kind === 'ring') {
      const p = uv().sub(.5).mul(2), radius = p.length();
      const crest = smoothstep(.61, .72, radius).mul(smoothstep(.75, .88, radius).oneMinus());
      const broken = sin(p.x.mul(13).add(p.y.mul(17))).mul(.3).add(.7);
      material.opacityNode = attribute('fluidOpacity', 'float').mul(crest).mul(broken);
    }
    if (kind === 'stain') {
      const p = uv().sub(.5).mul(2);
      const edge = p.length().add(sin(p.x.mul(15)).mul(sin(p.y.mul(11))).mul(.10));
      material.opacityNode = attribute('fluidOpacity', 'float').mul(smoothstep(.65, 1, edge).oneMinus());
    }
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.name = `fluid-${kind}`; this.mesh.count = 0; this.mesh.visible = false; this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < capacity; i++) this.mesh.setColorAt(i, new THREE.Color());
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.slots = Array.from({ length: capacity }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 0, size: 0, yaw: 0, weather: false }));
    this.colors = this.slots.map(() => new THREE.Color());
  }
  emit(x: number, y: number, z: number, size: number, life: number, tint: THREE.Color, vx = 0, vy = 0, vz = 0, weather = false): void {
    this.pending = true;
    const index = this.cursor++ % this.slots.length, slot = this.slots[index];
    Object.assign(slot, { x, y, z, size, life, age: 0, vx, vy, vz, yaw: Math.random() * Math.PI * 2, weather });
    // Color stays with its slot while visible instances are compacted.
    this.colors[index].copy(tint);
  }
  private colors: THREE.Color[] = [];
  clear(weatherOnly = false): void { for (const slot of this.slots) if (!weatherOnly || slot.weather) slot.life = 0; if (!weatherOnly) { this.mesh.count = 0; this.mesh.visible = false; this.cursor = 0; this.pending = false; } }
  update(dt: number): void {
    if (!this.pending && !this.mesh.count) return;
    this.pending = false;
    let count = 0;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i]; if (!s.life) continue;
      s.age += dt;
      if (s.age >= s.life) { s.life = 0; continue; }
      const t = s.age / s.life;
      if (this.kind === 'drop') {
        s.vy -= dt * 6; s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
        if (s.y <= .025) { s.life = 0; continue; }
      }
      const transform = this.transform;
      transform.position.set(s.x, s.y, s.z);
      transform.rotation.set(this.kind === 'drop' ? 0 : -Math.PI / 2, 0, s.yaw);
      const size = this.kind === 'ring' ? s.size * (.25 + t * .75) : this.kind === 'stain' ? s.size * (.75 + Math.min(1, t * 8) * .25) : s.size;
      transform.scale.set(size, this.kind === 'drop' ? size * 2.4 : size * (this.kind === 'stain' ? .7 : this.kind === 'ring' ? .82 : 1), size);
      transform.updateMatrix(); this.mesh.setMatrixAt(count, transform.matrix); this.mesh.setColorAt(count, this.colors[i]);
      this.opacity.setX(count, (this.kind === 'stain' ? .6 : this.kind === 'ring' ? .20 : .75) * (this.kind === 'ring' ? Math.sin(t * Math.PI) : 1) * Math.min(1, (1 - t) * (this.kind === 'stain' ? 3 : 1.8)));
      count++;
    }
    this.mesh.count = count; this.mesh.visible = count > 0;
    if (count) { this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor!.needsUpdate = true; this.opacity.needsUpdate = true; }
  }
  dispose(): void { this.mesh.removeFromParent(); this.mesh.dispose(); this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}

/** Area-local visual feedback only. It never changes collision, damage or save state. */
export class FluidEffects {
  readonly root = new THREE.Group();
  private drops = new FluidPool('drop', 96);
  private rings = new FluidPool('ring', 64);
  private stains = new FluidPool('stain', 16);
  private waters: readonly WaterDefinition[] = [];
  private emission = 1;
  private last: { x: number; z: number; phase: number } | undefined;
  private wakeCarry = 0;
  private waterColor = new THREE.Color('#9eafb0');
  private bloodColor = new THREE.Color('#8e2728');
  private magicColor = new THREE.Color('#8bd8db');
  constructor() {
    this.root.name = 'fluid-feedback'; this.root.userData.transient = true;
    for (const pool of [this.drops, this.rings, this.stains]) this.root.add(pool.mesh);
  }
  configure(waters: readonly WaterDefinition[]): void { this.clear(); this.waters = waters; }
  setQuality(quality: QualityLevel): void { this.emission = particlePresets[quality].emission; }
  clearWeather(): void { this.drops.clear(true); this.rings.clear(true); this.update(0); }
  rainContact(x: number, z: number): void {
    const water = waterAt(this.waters, x, z);
    this.ripple(x, z, water ? .32 : .09, true);
    if (Math.random() < .3 * this.emission) this.drops.emit(x, water ? waterHeight + .025 : .025, z, .016, .23, this.waterColor, 0, .65, 0, true);
  }
  private ripple(x: number, z: number, radius: number, weather = false): void {
    const water = waterAt(this.waters, x, z);
    if (water) {
      const dx = x - water.position[0], dz = z - water.position[1], yaw = water.yaw ?? 0;
      const distance = waterDistance(water, (dx * Math.cos(yaw) - dz * Math.sin(yaw)) * 2 / water.width, (dx * Math.sin(yaw) + dz * Math.cos(yaw)) * 2 / water.length);
      radius = Math.min(radius, distance * Math.min(water.width, water.length) / 2);
    }
    if (radius < .025) return;
    this.rings.emit(x, water ? waterHeight + .02 : .019, z, radius, weather ? .48 : .75, this.waterColor, 0, 0, 0, weather);
  }
  locomotion(x: number, y: number, z: number, yaw: number, gait: number, running: boolean, paused: boolean, dt: number): void {
    const phase = Math.floor(gait * 2), previous = this.last;
    this.last ??= { x, z, phase };
    const dx = x - (previous?.x ?? x), dz = z - (previous?.z ?? z), distance = Math.hypot(dx, dz), oldPhase = previous?.phase;
    this.last.x = x; this.last.z = z; this.last.phase = phase;
    if (!previous || paused || !running || dt <= 0 || distance < .001 || distance > 1 || Math.abs(y) > .08 || !waterAt(this.waters, x, z)) { this.wakeCarry = 0; return; }
    if (phase !== oldPhase) {
      const side = phase === 0 ? -.12 : .12, fx = x + Math.cos(yaw) * side, fz = z - Math.sin(yaw) * side;
      if (waterAt(this.waters, fx, fz)) {
        this.ripple(fx, fz, .38);
        this.splash(fx, waterHeight + .03, fz, this.waterColor, dx / distance, dz / distance, 4, .024);
      }
    }
    this.wakeCarry += distance * 1.3 * this.emission;
    if (this.wakeCarry >= 1) { this.wakeCarry %= 1; this.ripple(x - dx / distance * .15, z - dz / distance * .15, .28); }
  }
  private splash(x: number, y: number, z: number, tint: THREE.Color, dx: number, dz: number, count: number, size: number): void {
    for (let i = 0; i < count; i++) {
      const spread = (i / Math.max(1, count - 1) - .5) * 1.6, speed = .8 + Math.random() * .7;
      const radial = dx === 0 && dz === 0, angle = i / count * Math.PI * 2;
      const vx = radial ? Math.cos(angle) * speed * .65 : dx * speed + dz * spread;
      const vz = radial ? Math.sin(angle) * speed * .65 : dz * speed - dx * spread;
      this.drops.emit(x, y, z, size * (.8 + Math.random() * .4), .48, tint, vx, .7 + Math.random() * .8, vz);
    }
  }
  blood(x: number, y: number, z: number, dx: number, dz: number, strong: boolean): void {
    this.splash(x, y + .85, z, this.bloodColor, dx, dz, strong ? 9 : 6, strong ? .045 : .032);
    this.stains.emit(x + dx * .22, y + .018, z + dz * .22, strong ? .29 : .20, 3.5, this.bloodColor);
  }
  magic(x: number, y: number, z: number): void { this.splash(x, y, z, this.magicColor, 0, 0, 7, .038); }
  update(dt: number): void { this.drops.update(dt); this.rings.update(dt); this.stains.update(dt); }
  snapshot() { return { droplets: this.drops.mesh.count, ripples: this.rings.mesh.count, stains: this.stains.mesh.count }; }
  clear(): void { this.drops.clear(); this.rings.clear(); this.stains.clear(); this.last = undefined; this.wakeCarry = 0; }
  dispose(): void { this.clear(); this.drops.dispose(); this.rings.dispose(); this.stains.dispose(); this.root.removeFromParent(); }
}
