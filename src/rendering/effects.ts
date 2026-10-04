import { isMesh } from '../assets/resource-ownership';
import * as THREE from 'three';
import type { GrassCarpets } from './grass';
import type { Vegetation, VegetationActor } from './vegetation';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { fsrComparison } from '../labs/fsr/settings';
import { Fn, positionPrevious, positionLocal, uniform, vec3, sin, float, max, pow } from 'three/tsl';
import { copyStandardNodeMaterial } from '../assets/environment-surfaces';
import { RainField } from './rain';
import type { AreaDefinition } from '../levels/types';
import { createWaterSurface, waterNormalTexture, type WaterOptions } from './water';
import { FluidEffects } from './fluids';

import { particlePresets, type QualityLevel } from './quality-presets';
export type ParticleKind = 'fire' | 'smoke' | 'sparks' | 'hit' | 'rain' | 'snow' | 'dust' | 'debris' | 'chips';
interface Emitter { position: THREE.Vector3; kind: ParticleKind; rate: number; carry: number; space: THREE.Object3D; }
type UploadRange = { start: number; count: number };
interface Pool {
  object: THREE.Points; positions: Float32Array; velocities: Float32Array; age: Float32Array;
  positionRange: UploadRange; colorRange: UploadRange;
  life: Float32Array; live: Uint16Array; colors: Float32Array; cursor: number; capacity: number; active: number; limit: number;
}
type Water = ReturnType<typeof createWaterSurface>;
interface Foliage { mesh: THREE.Mesh; original: THREE.Material | THREE.Material[]; depth?: THREE.Material; distance?: THREE.Material; }
const colors: Record<ParticleKind, THREE.Color> = { fire: new THREE.Color(2.8, 0.65, 0.08), smoke: new THREE.Color('#626d75'), sparks: new THREE.Color(3, 1.1, 0.2), hit: new THREE.Color(2.3, 1.2, 0.3), rain: new THREE.Color('#aec5d4'), snow: new THREE.Color('#dbe6ee'), dust: new THREE.Color('#a79879'), debris: new THREE.Color('#846342'), chips: new THREE.Color('#aaa08a') };
const sizes: Record<ParticleKind, number> = { fire: 0.22, smoke: 0.45, sparks: 0.035, hit: 0.075, rain: 0.04, snow: 0.065, dust: 0.025, debris: .065, chips: .045 };
const atmosphericKinds = new Set<ParticleKind>(['dust', 'smoke', 'sparks']);

/** Merge pending writes until the renderer consumes them, including hidden pools.
 * One retained range per attribute avoids per-frame range records/queue writes. */
function uploadRange(attribute: THREE.BufferAttribute, range: UploadRange, first: number, last: number): void {
  const start = first * attribute.itemSize, end = (last + 1) * attribute.itemSize;
  if (attribute.updateRanges.length) {
    const previousEnd = range.start + range.count;
    range.start = Math.min(range.start, start);
    range.count = Math.max(previousEnd, end) - range.start;
  } else {
    range.start = start; range.count = end - start;
    attribute.updateRanges.push(range);
  }
  attribute.needsUpdate = true;
}

/** Fixed particle pools, shared wind clock and lightweight water; no per-frame object allocation. */
export class CoreEffects {
  readonly root = new THREE.Group();
  paused = false;
  enabled = true;
  private atmosphericParticles = true;
  private quality: QualityLevel = 'high';
  private time = 0;
  private clock = uniform(0);
  private previousClock = uniform(0);
  private previousWind = uniform(new THREE.Vector3(.08, 0, .035));
  private wind = uniform(new THREE.Vector3(0.08, 0, 0.035));
  private pools = new Map<ParticleKind, Pool>();
  private emitters: Emitter[] = [];
  private waters: Water[] = [];
  private foliage: Foliage[] = [];
  private readonly foliageMeshes = new Set<THREE.Mesh>();
  // Wind depends only on source material and local geometry bounds. Repeated
  // placements borrow one node graph; the area owns and retires it once.
  private readonly foliageMaterials = new Map<THREE.BufferGeometry, Map<THREE.Material, MeshStandardNodeMaterial>>();
  private grass: GrassCarpets[] = [];
  private vegetation?: Vegetation;
  private texture: THREE.CanvasTexture;
  private weather: ParticleKind | null = null;
  private weatherEffects = true;
  readonly fluids = new FluidEffects();
  private readonly rain = new RainField((x, z, height) => this.fluids.rainContact(x, z, height));
  private readonly waterNormal = waterNormalTexture();
  resetComparisonPools(): void {
    if (!fsrComparison) throw new Error('Pool reset requires an authoring comparison.');
    for (const pool of this.pools.values()) pool.cursor = 0;
  }
  comparisonState() {
    if (!fsrComparison) throw new Error('Effect snapshots require an authoring comparison.');
    let hash = 2166136261;
    for (const pool of this.pools.values()) for (let i = 0; i < pool.positions.length; i++) hash = Math.imul(hash ^ Math.round(pool.positions[i] * 100000), 16777619);
    return { time: this.time, particleHash: hash >>> 0, foliageMeshes: this.foliage.length };
  }
  setWeatherEffects(enabled: boolean): void { this.weatherEffects=enabled; if(!enabled){this.rain.clear();this.fluids.clearWeather();} }
  configureWeather(area: AreaDefinition): void { this.weather=area.effects.weather?.kind ?? null; this.rain.configure(area); this.fluids.configure(area.effects.water); }
  weatherView(camera: THREE.Camera, position: THREE.Vector3): void { this.rain.view(camera,position); }
  private weatherCarry = 0;
  private scratch = new THREE.Vector3();
  private disposed = false;
  private gameplayDelta: number | undefined;
  setGameplayDelta(dt: number): void { this.gameplayDelta = dt; }
  constructor(particleTextures: Partial<Record<ParticleKind, THREE.Texture>> = {}) {
    this.root.name = 'Lantern core effects'; this.root.add(this.rain.root, this.fluids.root);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d')!; const gradient = ctx.createRadialGradient(16, 16, 1, 16, 16, 16);
    gradient.addColorStop(0, '#ffffff'); gradient.addColorStop(0.45, '#ffffffb0'); gradient.addColorStop(1, '#ffffff00');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 32, 32); this.texture = new THREE.CanvasTexture(canvas);
    for (const kind of Object.keys(colors) as ParticleKind[]) {
      const capacity = kind === 'rain' || kind === 'snow' ? 384 : 192;
      const positions = new Float32Array(capacity * 3); positions.fill(1e6);
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
      const normals = new Float32Array(capacity * 3); for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
      geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3)); geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(capacity * 2).fill(0.5), 2));
      const vertexColors = new Float32Array(capacity * 3); geometry.setAttribute('color', new THREE.BufferAttribute(vertexColors, 3).setUsage(THREE.DynamicDrawUsage));
      const material = new THREE.PointsMaterial({ map: particleTextures[kind] ?? this.texture, vertexColors: true, transparent: true, depthWrite: false,
        size: sizes[kind], opacity: kind === 'smoke' ? 0.25 : kind === 'dust' ? 0.32 : 0.8, blending: ['fire', 'sparks', 'hit'].includes(kind) ? THREE.AdditiveBlending : THREE.NormalBlending });
      const object = new THREE.Points(geometry, material); object.frustumCulled = false; object.visible = false; object.name = kind; this.root.add(object);
      this.pools.set(kind, { object, positions, colors: vertexColors, velocities: new Float32Array(capacity * 3), age: new Float32Array(capacity), life: new Float32Array(capacity), live: new Uint16Array(capacity), positionRange: { start: 0, count: 0 }, colorRange: { start: 0, count: 0 }, cursor: 0, capacity, active: 0, limit: capacity });
    }
  }
  setQuality(quality: QualityLevel): void {
    this.quality = quality; this.fluids.setQuality(quality);
    for (const pool of this.pools.values()) {
      pool.limit = Math.max(1, Math.floor(pool.capacity * particlePresets[quality].capacity));
      pool.object.geometry.setDrawRange(0, pool.limit);
      for (let i = pool.limit; i < pool.capacity; i++) { pool.life[i] = 0; pool.positions[i * 3 + 1] = 1e6; }
      // Compact surviving slots after a quality change; pool capacity and draw
      // order stay unchanged, including particles overwritten by the ring cursor.
      let active = 0;
      for (let i = 0; i < pool.active; i++) if (pool.life[pool.live[i]] > 0) pool.live[active++] = pool.live[i];
      pool.active = active;
      if (!pool.active) pool.object.visible = false;
      uploadRange(pool.object.geometry.getAttribute('position') as THREE.BufferAttribute, pool.positionRange, 0, pool.capacity - 1);
    }
  }
  setAtmosphericParticles(enabled: boolean): void {
    if (this.atmosphericParticles === enabled) return;
    this.atmosphericParticles = enabled;
    for (const [kind, pool] of this.pools) if (atmosphericKinds.has(kind)) {
      pool.object.visible = enabled && pool.active > 0;
      if (!enabled) { pool.active = 0; pool.life.fill(0); pool.positions.fill(1e6); uploadRange(pool.object.geometry.getAttribute('position') as THREE.BufferAttribute, pool.positionRange, 0, pool.capacity - 1); }
    }
    for (const emitter of this.emitters) if (atmosphericKinds.has(emitter.kind)) emitter.carry = 0;
    this.weatherCarry = 0;
  }
  setWeather(kind: 'rain' | 'snow' | null): void { this.weather = kind; this.weatherCarry = 0; }
  addEmitter(kind: ParticleKind, position: THREE.Vector3, space: THREE.Object3D, rate = 12): () => void {
    const emitter = { kind, position: position.clone(), space, rate, carry: 0 }; this.emitters.push(emitter);
    return () => { const index = this.emitters.indexOf(emitter); if (index >= 0) this.emitters.splice(index, 1); };
  }
  private visible(object: THREE.Object3D): boolean { for (let o: THREE.Object3D | null = object; o; o = o.parent) if (!o.visible) return false; return true; }
  burst(kind: 'hit' | 'sparks' | 'debris' | 'chips', position: THREE.Vector3, count = 14): void {
    if (!this.enabled || this.paused || this.disposed || (!this.atmosphericParticles && atmosphericKinds.has(kind))) return;
    for (let i = 0; i < count; i++) this.spawn(kind, position.x, position.y + 0.9, position.z);
  }
  private spawn(kind: ParticleKind, x: number, y: number, z: number): void {
    const p = this.pools.get(kind)!;
    const i = p.cursor++ % p.limit, k = i * 3; const spread = kind === 'rain' || kind === 'snow' ? 0 : kind === 'dust' ? 1.8 : 0.1;
    if (p.life[i] === 0) p.live[p.active++] = i;
    p.object.visible = true;
    p.positions[k] = x + (Math.random() - 0.5) * spread; p.positions[k + 1] = y + (kind === 'dust' ? (Math.random() - 0.5) * 1.2 : 0); p.positions[k + 2] = z + (Math.random() - 0.5) * spread;
    p.age[i] = 0; p.life[i] = kind === 'rain' ? 1.4 : kind === 'snow' ? 5 : kind === 'dust' ? 4 + Math.random() * 3 : kind === 'smoke' ? 2.2 : kind === 'fire' ? 0.65 : kind === 'hit' ? .22 : 0.5;
    const speed = kind === 'hit' ? 2 : kind === 'sparks' ? 1.2 : kind === 'dust' ? 0.06 : 0.2;
    p.velocities[k] = (Math.random() - 0.5) * speed; p.velocities[k + 2] = (Math.random() - 0.5) * speed;
    p.velocities[k + 1] = kind === 'rain' ? -7 : kind === 'snow' ? -0.8 : kind === 'fire' ? 0.7 : kind === 'smoke' ? 0.4 : kind === 'dust' ? (Math.random() - 0.5) * 0.06 : Math.random() * 2;
  }
  addWater(parent: THREE.Object3D, x: number, z: number, options: WaterOptions = {}): THREE.Mesh {
    const water = createWaterSurface(parent, x, z, options, this.waterNormal, this.clock, this.previousClock);
    this.waters.push(water); return water.mesh;
  }

  addGrass(carpet: GrassCarpets): void { this.grass.push(carpet); carpet.update(this.time, this.wind.value); }
  addVegetation(vegetation: Vegetation): void { this.vegetation = vegetation; }
  setVegetationActors(actors: readonly VegetationActor[]): void { this.vegetation?.stage(actors); }
  resetVegetation(): void { this.vegetation?.reset(); }
  addFoliage(root: THREE.Object3D): void {
    root.traverse((o) => {
      if (!isMesh(o) || o instanceof THREE.SkinnedMesh || this.foliageMeshes.has(o) || o.userData.reactiveVegetation) return;
      o.geometry.computeBoundingBox(); const box = o.geometry.boundingBox!; const height = Math.max(0.01, box.max.y - box.min.y);
      const original = o.material; const sources = Array.isArray(original) ? original : [original];
      let shared = this.foliageMaterials.get(o.geometry);
      if (!shared) { shared = new Map(); this.foliageMaterials.set(o.geometry, shared); }
      const materials = sources.map((source) => {
        if (!(source instanceof THREE.MeshStandardMaterial) && !(source instanceof MeshStandardNodeMaterial)) return source;
        const existing = shared.get(source);
        if (existing) return existing;
        const m = copyStandardNodeMaterial(source);
        const anchor = pow(max(positionLocal.y.sub(float(box.min.y)).div(float(height)), float(0)), float(1.5));
        const gust = sin(this.clock.mul(1.4).add(positionLocal.x.mul(0.3))).mul(0.65).add(sin(this.clock.mul(0.47)).mul(0.35));
        const displaced = positionLocal.add(vec3(this.wind.x, float(0), this.wind.z).mul(anchor).mul(float(height)).mul(gust));
        // Private comparisons retain the old motion output; every normal route
        // supplies the previous wind deformation to temporal reconstruction.
        m.positionNode = (fsrComparison?.foliageMotion ?? true) ? Fn(() => {
          const previousGust = sin(this.previousClock.mul(1.4).add(positionLocal.x.mul(.3))).mul(.65).add(sin(this.previousClock.mul(.47)).mul(.35));
          positionPrevious.assign(positionLocal.add(this.previousWind.mul(anchor).mul(float(height)).mul(previousGust)));
          return displaced;
        })() : displaced;
        shared.set(source, m); return m;
      });
      const record: Foliage = { mesh: o, original, depth: o.customDepthMaterial, distance: o.customDistanceMaterial };
      o.material = Array.isArray(original) ? materials : materials[0];
      // Small displacement remains inside expanded culling bounds.
      o.geometry.computeBoundingSphere(); if (o.geometry.boundingSphere) o.geometry.boundingSphere.radius *= 1.12;
      this.foliage.push(record);
      this.foliageMeshes.add(o);
    });
  }
  update(dt: number): void {
    if (this.disposed) return;
    this.root.visible = this.enabled;
    const actionDt = this.gameplayDelta ?? dt; this.gameplayDelta = undefined;
    this.previousClock.value = this.clock.value;
    this.previousWind.value.copy(this.wind.value);
    if (this.paused || !this.enabled) { this.vegetation?.advance(0, this.time, this.wind.value); for (const carpet of this.grass) carpet.update(this.time, this.wind.value); return; }
    dt = Math.min(dt, 0.05);
    this.time += dt; this.clock.value = this.time;
    this.vegetation?.advance(actionDt, this.time, this.wind.value);
    for (const carpet of this.grass) carpet.update(this.time, this.wind.value);
    for (const emitter of this.emitters) {
      if (!this.atmosphericParticles && atmosphericKinds.has(emitter.kind)) continue;
      if (!this.visible(emitter.space)) continue;
      emitter.carry += dt * emitter.rate * particlePresets[this.quality].emission;
      if (emitter.carry < 1) continue;
      this.scratch.copy(emitter.position); emitter.space.localToWorld(this.scratch);
      while (emitter.carry >= 1) { emitter.carry--; this.spawn(emitter.kind, this.scratch.x, this.scratch.y, this.scratch.z); }
    }
    this.fluids.update(actionDt);
    this.rain.update(dt,this.weatherEffects && this.weather==='rain',particlePresets[this.quality].weather,this.wind.value);
    if (this.weather === 'snow' && this.weatherEffects) {
      this.weatherCarry += dt * particlePresets[this.quality].weather;
      while (this.weatherCarry >= 1) { this.weatherCarry--; this.spawn(this.weather, (Math.random() - 0.5) * 16, 6, (Math.random() - 0.5) * 16); }
    }
    for (const [kind, p] of this.pools) {
      if (!this.atmosphericParticles && atmosphericKinds.has(kind)) continue;
      // Empty pools contribute no pixels. Leave their buffers alone until the
      // next spawn, rather than scanning/uploading clipped vertices every frame.
      if (!p.active) continue;
      // Each slot evolves independently. Swap-remove expired entries without
      // changing GPU slot order or visiting the unused portion of the pool.
      let first = p.capacity, last = -1;
      for (let live = 0; live < p.active;) {
        const i = p.live[live], k = i * 3; const elapsed = kind === 'hit' || kind==='debris' || kind==='chips' ? actionDt : dt; p.age[i] += elapsed;
        first = Math.min(first, i); last = Math.max(last, i);
        if (p.age[i] >= p.life[i]) { p.positions[k + 1] = 1e6; p.life[i] = 0; p.live[live] = p.live[--p.active]; continue; }
        p.positions[k] += (p.velocities[k] + this.wind.value.x) * elapsed; p.positions[k + 1] += p.velocities[k + 1] * elapsed; p.positions[k + 2] += (p.velocities[k + 2] + this.wind.value.z) * elapsed;
        if (kind === 'hit' || kind === 'sparks' || kind === 'debris' || kind === 'chips') p.velocities[k + 1] -= elapsed * 4;
        const fade = kind === 'dust' ? Math.sin(Math.PI * p.age[i] / p.life[i]) : 1 - p.age[i] / p.life[i]; const color = colors[kind];
        p.colors[k] = color.r * fade; p.colors[k + 1] = color.g * fade; p.colors[k + 2] = color.b * fade;
        live++;
      }
      uploadRange(p.object.geometry.getAttribute('position') as THREE.BufferAttribute, p.positionRange, first, last);
      uploadRange(p.object.geometry.getAttribute('color') as THREE.BufferAttribute, p.colorRange, first, last);
      p.object.visible = p.active > 0;
    }
  }
  clear(): void { this.fluids.clear(); for (const p of this.pools.values()) { p.active = 0; p.object.visible = false; p.life.fill(0); p.positions.fill(1e6); uploadRange(p.object.geometry.getAttribute('position') as THREE.BufferAttribute, p.positionRange, 0, p.capacity - 1); } }

  clearArea(): void {
    this.vegetation?.reset(); this.vegetation = undefined;
    this.rain.configure(undefined); this.fluids.configure([]); this.weather=null;
    for (const f of this.foliage) { f.mesh.material = f.original; f.mesh.customDepthMaterial = f.depth; f.mesh.customDistanceMaterial = f.distance; }
    for (const materials of this.foliageMaterials.values()) for (const material of materials.values()) material.dispose();
    this.foliageMaterials.clear();
    for (const water of this.waters) water.dispose();
    this.emitters.length = 0; this.foliage.length = 0; this.foliageMeshes.clear(); this.grass.length = 0; this.waters.length = 0; this.time = 0; this.clock.value = 0; this.previousClock.value = 0; this.clear();
  }
  dispose(): void {
    if (this.disposed) return; this.disposed = true; this.rain.dispose(); this.fluids.dispose(); this.root.removeFromParent();
    this.clearArea();
    for (const p of this.pools.values()) { p.object.geometry.dispose(); (p.object.material as THREE.Material).dispose(); }
    this.texture.dispose(); this.waterNormal.dispose(); this.emitters.length = 0; this.foliage.length = 0;
  }
}
