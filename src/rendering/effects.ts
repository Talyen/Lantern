import { isMesh } from '../assets/resource-ownership';
import * as THREE from 'three';
import type { GrassCarpets } from './grass';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { positionLocal, uniform, vec3, sin, float, max, pow } from 'three/tsl';
import { copyStandardNodeMaterial } from '../assets/environment-surfaces';

import { particlePresets, type QualityLevel } from './quality-presets';
export type ParticleKind = 'fire' | 'smoke' | 'sparks' | 'hit' | 'rain' | 'snow' | 'dust';
interface Emitter { position: THREE.Vector3; kind: ParticleKind; rate: number; carry: number; space: THREE.Object3D; }
interface Pool {
  object: THREE.Points; positions: Float32Array; velocities: Float32Array; age: Float32Array;
  life: Float32Array; colors: Float32Array; cursor: number; capacity: number; active: number; limit: number;
}
interface WaterOptions { width?: number; length?: number; flow?: number; shorelineMask?: THREE.Texture; }
interface Water { mesh: THREE.Mesh; original: Float32Array; options: WaterOptions; normal: THREE.Texture; shoreline: THREE.Texture; }
interface Foliage { mesh: THREE.Mesh; original: THREE.Material | THREE.Material[]; depth?: THREE.Material; distance?: THREE.Material; owned: THREE.Material[]; }
const colors: Record<ParticleKind, THREE.Color> = { fire: new THREE.Color(2.8, 0.65, 0.08), smoke: new THREE.Color('#626d75'), sparks: new THREE.Color(3, 1.1, 0.2), hit: new THREE.Color(2.3, 1.2, 0.3), rain: new THREE.Color('#aec5d4'), snow: new THREE.Color('#dbe6ee'), dust: new THREE.Color('#a79879') };
const sizes: Record<ParticleKind, number> = { fire: 0.22, smoke: 0.45, sparks: 0.035, hit: 0.075, rain: 0.04, snow: 0.065, dust: 0.025 };
const atmosphericKinds = new Set<ParticleKind>(['dust', 'smoke', 'sparks', 'rain', 'snow']);

/** Fixed particle pools, shared wind clock and lightweight water; no per-frame object allocation. */
export class CoreEffects {
  readonly root = new THREE.Group();
  paused = false;
  enabled = true;
  private atmosphericParticles = true;
  private quality: QualityLevel = 'high';
  private time = 0;
  private clock = uniform(0);
  private wind = uniform(new THREE.Vector3(0.08, 0, 0.035));
  private pools = new Map<ParticleKind, Pool>();
  private emitters: Emitter[] = [];
  private waters: Water[] = [];
  private foliage: Foliage[] = [];
  private grass: GrassCarpets[] = [];
  private texture: THREE.CanvasTexture;
  private weather: ParticleKind | null = null;
  private weatherCarry = 0;
  private scratch = new THREE.Vector3();
  private disposed = false;
  constructor(particleTextures: Partial<Record<ParticleKind, THREE.Texture>> = {}) {
    this.root.name = 'Lantern core effects';
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
      this.pools.set(kind, { object, positions, colors: vertexColors, velocities: new Float32Array(capacity * 3), age: new Float32Array(capacity), life: new Float32Array(capacity), cursor: 0, capacity, active: 0, limit: capacity });
    }
  }
  setQuality(quality: QualityLevel): void {
    this.quality = quality;
    for (const pool of this.pools.values()) {
      pool.limit = Math.max(1, Math.floor(pool.capacity * particlePresets[quality].capacity));
      pool.object.geometry.setDrawRange(0, pool.limit);
      for (let i = pool.limit; i < pool.capacity; i++) { if (pool.life[i] > 0) pool.active--; pool.life[i] = 0; pool.positions[i * 3 + 1] = 1e6; }
      if (!pool.active) pool.object.visible = false;
      pool.object.geometry.attributes.position.needsUpdate = true;
    }
  }
  setAtmosphericParticles(enabled: boolean): void {
    if (this.atmosphericParticles === enabled) return;
    this.atmosphericParticles = enabled;
    for (const [kind, pool] of this.pools) if (atmosphericKinds.has(kind)) {
      pool.object.visible = enabled && pool.active > 0;
      if (!enabled) { pool.active = 0; pool.life.fill(0); pool.positions.fill(1e6); pool.object.geometry.attributes.position.needsUpdate = true; }
    }
    for (const emitter of this.emitters) if (atmosphericKinds.has(emitter.kind)) emitter.carry = 0;
    this.weatherCarry = 0;
  }
  setWind(x: number, z: number): void { this.wind.value.set(x, 0, z); }
  setWeather(kind: 'rain' | 'snow' | null): void { this.weather = kind; this.weatherCarry = 0; }
  addEmitter(kind: ParticleKind, position: THREE.Vector3, space: THREE.Object3D, rate = 12): () => void {
    const emitter = { kind, position: position.clone(), space, rate, carry: 0 }; this.emitters.push(emitter);
    return () => { const index = this.emitters.indexOf(emitter); if (index >= 0) this.emitters.splice(index, 1); };
  }
  private visible(object: THREE.Object3D): boolean { for (let o: THREE.Object3D | null = object; o; o = o.parent) if (!o.visible) return false; return true; }
  burst(kind: 'hit' | 'sparks', position: THREE.Vector3, count = 14): void {
    if (!this.enabled || this.paused || this.disposed || (!this.atmosphericParticles && atmosphericKinds.has(kind))) return;
    for (let i = 0; i < count; i++) this.spawn(kind, position.x, position.y + 0.9, position.z);
  }
  private spawn(kind: ParticleKind, x: number, y: number, z: number): void {
    const p = this.pools.get(kind)!;
    const i = p.cursor++ % p.limit, k = i * 3; const spread = kind === 'rain' || kind === 'snow' ? 0 : kind === 'dust' ? 1.8 : 0.1;
    if (p.life[i] === 0) p.active++;
    p.object.visible = true;
    p.positions[k] = x + (Math.random() - 0.5) * spread; p.positions[k + 1] = y + (kind === 'dust' ? (Math.random() - 0.5) * 1.2 : 0); p.positions[k + 2] = z + (Math.random() - 0.5) * spread;
    p.age[i] = 0; p.life[i] = kind === 'rain' ? 1.4 : kind === 'snow' ? 5 : kind === 'dust' ? 4 + Math.random() * 3 : kind === 'smoke' ? 2.2 : kind === 'fire' ? 0.65 : kind === 'hit' ? .22 : 0.5;
    const speed = kind === 'hit' ? 2 : kind === 'sparks' ? 1.2 : kind === 'dust' ? 0.06 : 0.2;
    p.velocities[k] = (Math.random() - 0.5) * speed; p.velocities[k + 2] = (Math.random() - 0.5) * speed;
    p.velocities[k + 1] = kind === 'rain' ? -7 : kind === 'snow' ? -0.8 : kind === 'fire' ? 0.7 : kind === 'smoke' ? 0.4 : kind === 'dust' ? (Math.random() - 0.5) * 0.06 : Math.random() * 2;
  }
  addWater(parent: THREE.Object3D, x: number, z: number, options: WaterOptions = {}): THREE.Mesh {
    const width = options.width ?? 4, length = options.length ?? 2;
    const geometry = new THREE.PlaneGeometry(width, length, 32, 24); geometry.rotateX(-Math.PI / 2);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64; const ctx = canvas.getContext('2d')!;
    const image = ctx.createImageData(64, 64);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) { const i = (y * 64 + x) * 4;
      image.data[i] = 128 + Math.sin(x * Math.PI / 8) * 18; image.data[i + 1] = 128 + Math.cos(y * Math.PI / 8) * 18; image.data[i + 2] = 250; image.data[i + 3] = 255; }
    ctx.putImageData(image, 0, 0); const normal = new THREE.CanvasTexture(canvas); normal.wrapS = normal.wrapT = THREE.RepeatWrapping; normal.repeat.set(3, 3);
    const shoreline = document.createElement('canvas'); shoreline.width = shoreline.height = 256;
    const shore = shoreline.getContext('2d')!; const pixels = shore.createImageData(256, 256);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const u = x / 255 * 2 - 1, v = y / 255 * 2 - 1;
      const radius = options.flow && options.flow > 0.05 ? Math.max(Math.abs(u + Math.sin(v * 3) * 0.12), Math.abs(v) * 0.96) : Math.hypot(u, v);
      const rim = Math.max(0, 1 - Math.abs(radius - 0.94) * 22); const i = (y * 256 + x) * 4;
      pixels.data[i] = 160 + rim * 65; pixels.data[i + 1] = 185 + rim * 55; pixels.data[i + 2] = 190 + rim * 50;
      pixels.data[i + 3] = Math.round(Math.max(0, Math.min(1, (1 - radius) * 35)) * 255);
    }
    shore.putImageData(pixels, 0, 0); const shoreTexture = new THREE.CanvasTexture(shoreline); shoreTexture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshStandardMaterial({ map: options.shorelineMask ?? shoreTexture, alphaTest: 0.1, color: '#335b65', roughness: 0.32, metalness: 0, normalMap: normal, normalScale: new THREE.Vector2(0.3, 0.3), side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, 0.04, z); mesh.receiveShadow = true; mesh.name = 'water'; parent.add(mesh);
    // A separate shallow foam rim avoids scene-depth/refraction passes; callers can supply an authored shoreline mask.
    // Both layers have exactly the same wave vertices. Share the dynamic buffer
    // while retaining the foam's own colors, material and local height offset.
    const foamGeometry = geometry.clone(); foamGeometry.setAttribute('position', geometry.getAttribute('position'));
    const uv = foamGeometry.getAttribute('uv'); const foamColors = new Float32Array(uv.count * 3);
    for (let i = 0; i < uv.count; i++) { const edge = Math.min(uv.getX(i), 1 - uv.getX(i), uv.getY(i), 1 - uv.getY(i)); const foam = Math.max(0, 1 - edge * 28) * 0.55;
      foamColors[i * 3] = foam; foamColors[i * 3 + 1] = foam * 1.1; foamColors[i * 3 + 2] = foam * 1.15; }
    foamGeometry.setAttribute('color', new THREE.BufferAttribute(foamColors, 3));
    const foam = new THREE.Mesh(foamGeometry, new THREE.MeshBasicMaterial({ vertexColors: true, alphaTest: 0.1, map: options.shorelineMask ?? shoreTexture, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false }));
    foam.position.y = 0.015; mesh.add(foam);
    this.waters.push({ mesh, original: new Float32Array(geometry.getAttribute('position').array), options, normal, shoreline: shoreTexture }); return mesh;
  }
  addGrass(carpet: GrassCarpets): void { this.grass.push(carpet); carpet.update(this.time, this.wind.value); }
  addFoliage(root: THREE.Object3D): void {
    root.traverse((o) => {
      if (!isMesh(o) || o instanceof THREE.SkinnedMesh || this.foliage.some((f) => f.mesh === o)) return;
      o.geometry.computeBoundingBox(); const box = o.geometry.boundingBox!; const height = Math.max(0.01, box.max.y - box.min.y);
      const original = o.material; const sources = Array.isArray(original) ? original : [original]; const owned: THREE.Material[] = [];
      const materials = sources.map((source) => {
        if (!(source instanceof THREE.MeshStandardMaterial) && !(source instanceof MeshStandardNodeMaterial)) return source;
        const m = copyStandardNodeMaterial(source);
        const anchor = pow(max(positionLocal.y.sub(float(box.min.y)).div(float(height)), float(0)), float(1.5));
        const gust = sin(this.clock.mul(1.4).add(positionLocal.x.mul(0.3))).mul(0.65).add(sin(this.clock.mul(0.47)).mul(0.35));
        m.positionNode = positionLocal.add(vec3(this.wind.x, float(0), this.wind.z).mul(anchor).mul(float(height)).mul(gust));
        owned.push(m); return m;
      });
      const record: Foliage = { mesh: o, original, depth: o.customDepthMaterial, distance: o.customDistanceMaterial, owned };
      o.material = Array.isArray(original) ? materials : materials[0];
      // Small displacement remains inside expanded culling bounds.
      o.geometry.computeBoundingSphere(); if (o.geometry.boundingSphere) o.geometry.boundingSphere.radius *= 1.12;
      this.foliage.push(record);
    });
  }
  update(dt: number): void {
    if (this.disposed) return;
    this.root.visible = this.enabled;
    if (this.paused || !this.enabled) { for (const carpet of this.grass) carpet.update(this.time, this.wind.value); return; }
    dt = Math.min(dt, 0.05); this.time += dt; this.clock.value = this.time;
    for (const carpet of this.grass) carpet.update(this.time, this.wind.value);
    for (const emitter of this.emitters) {
      if (!this.atmosphericParticles && atmosphericKinds.has(emitter.kind)) continue;
      if (!this.visible(emitter.space)) continue;
      emitter.carry += dt * emitter.rate * particlePresets[this.quality].emission;
      if (emitter.carry < 1) continue;
      this.scratch.copy(emitter.position); emitter.space.localToWorld(this.scratch);
      while (emitter.carry >= 1) { emitter.carry--; this.spawn(emitter.kind, this.scratch.x, this.scratch.y, this.scratch.z); }
    }
    if (this.weather && this.atmosphericParticles) {
      this.weatherCarry += dt * particlePresets[this.quality].weather;
      while (this.weatherCarry >= 1) { this.weatherCarry--; this.spawn(this.weather, (Math.random() - 0.5) * 16, 6, (Math.random() - 0.5) * 16); }
    }
    for (const [kind, p] of this.pools) {
      if (!this.atmosphericParticles && atmosphericKinds.has(kind)) continue;
      // Empty pools contribute no pixels. Leave their buffers alone until the
      // next spawn, rather than scanning/uploading clipped vertices every frame.
      if (!p.active) continue;
      for (let i = 0; i < p.limit; i++) {
        if (p.life[i] === 0) continue;
        const k = i * 3; p.age[i] += dt;
        if (p.age[i] >= p.life[i]) { p.positions[k + 1] = 1e6; p.life[i] = 0; p.active--; continue; }
        p.positions[k] += (p.velocities[k] + this.wind.value.x) * dt; p.positions[k + 1] += p.velocities[k + 1] * dt; p.positions[k + 2] += (p.velocities[k + 2] + this.wind.value.z) * dt;
        if (kind === 'hit' || kind === 'sparks') p.velocities[k + 1] -= dt * 4;
        const fade = kind === 'dust' ? Math.sin(Math.PI * p.age[i] / p.life[i]) : 1 - p.age[i] / p.life[i]; const color = colors[kind];
        p.colors[k] = color.r * fade; p.colors[k + 1] = color.g * fade; p.colors[k + 2] = color.b * fade;
      }
      p.object.geometry.attributes.position.needsUpdate = true; p.object.geometry.attributes.color.needsUpdate = true;
      p.object.visible = p.active > 0;
    }
    for (const water of this.waters) {
      if (!this.visible(water.mesh)) continue;
      water.normal.offset.set(this.time * (water.options.flow ?? 0.035), this.time * 0.018);
      const position = water.mesh.geometry.getAttribute('position'); const normal = water.mesh.geometry.getAttribute('normal');
      for (let i = 0; i < position.count; i++) {
        const x = water.original[i * 3], z = water.original[i * 3 + 2]; const a = x * 2 + this.time, b = z * 3 - this.time * 0.8;
        const y = Math.sin(a) * 0.018 + Math.cos(b) * 0.012; position.setY(i, y);
        this.scratch.set(-Math.cos(a) * 0.036, 1, Math.sin(b) * 0.036).normalize(); normal.setXYZ(i, this.scratch.x, this.scratch.y, this.scratch.z);
      }
      position.needsUpdate = normal.needsUpdate = true;
    }
  }
  clear(): void { for (const p of this.pools.values()) { p.active = 0; p.object.visible = false; p.life.fill(0); p.positions.fill(1e6); p.object.geometry.attributes.position.needsUpdate = true; } }
  clearArea(): void {
    for (const f of this.foliage) { f.mesh.material = f.original; f.mesh.customDepthMaterial = f.depth; f.mesh.customDistanceMaterial = f.distance; f.owned.forEach((m) => m.dispose()); }
    for (const w of this.waters) { w.mesh.removeFromParent(); w.mesh.traverse((o) => { if (isMesh(o)) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } }); w.normal.dispose(); w.shoreline.dispose(); }
    this.emitters.length = 0; this.foliage.length = 0; this.grass.length = 0; this.waters.length = 0; this.time = 0; this.clock.value = 0; this.clear();
  }
  dispose(): void {
    if (this.disposed) return; this.disposed = true; this.root.removeFromParent();
    this.clearArea();
    for (const p of this.pools.values()) { p.object.geometry.dispose(); (p.object.material as THREE.Material).dispose(); }
    this.texture.dispose(); this.emitters.length = 0; this.foliage.length = 0;
  }
}
