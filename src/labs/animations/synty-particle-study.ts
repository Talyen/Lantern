import * as THREE from 'three';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import { particlePresets, type QualityLevel } from '../../rendering/quality-presets';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

type Vector = { x: number; y: number; z: number };
type Color = { r: number; g: number; b: number; a: number };
type Key = { time: number; value: number; inSlope: number; outSlope: number };
type Curve = { minMaxState: number; scalar: number; minScalar: number; maxCurve: { m_Curve: Key[] }; minCurve: { m_Curve: Key[] } };
type Gradient = { m_NumColorKeys: number; m_NumAlphaKeys: number } & Record<string, number | Color>;
type Colors = { minMaxState: number; minColor: Color; maxColor: Color; minGradient: Gradient; maxGradient: Gradient };
type Modules = {
  InitialModule: { startLifetime: Curve; startSpeed: Curve; startSize: Curve; startSizeY: Curve; startSizeZ: Curve; size3D: boolean; startRotation: Curve; startRotationX: Curve; startRotationY: Curve; rotation3D: boolean; startColor: Colors; gravityModifier: Curve };
  EmissionModule: { rateOverTime: Curve; m_Bursts?: { time: number; countCurve: Curve; cycleCount: number; repeatInterval: number; probability?: number }[] };
  ShapeModule: { enabled: boolean; type: number; angle: number; radius: { value: number }; radiusThickness: number; m_Scale: Vector; m_Position: Vector; m_Rotation: Vector };
  SizeModule: { enabled: boolean; separateAxes: boolean; curve: Curve; y: Curve; z: Curve };
  RotationModule: { enabled: boolean; separateAxes: boolean; x: Curve; y: Curve; z: Curve };
  ColorModule: { enabled: boolean; gradient: Colors };
  UVModule: { enabled: boolean; tilesX: number; tilesY: number; cycles: number; frameOverTime: Curve };
};
type Emitter = { name: string; transforms: { position: Vector; rotation: Vector & { w: number }; scale: Vector }[]; delay: Curve; duration: number; modules: Modules; renderMode: number; alignment: number; lengthScale: number; velocityScale: number; mesh: string | null; material: { color: Color; emissive?: Color; alphaTest: number; additive: boolean; lit: boolean; texture: string | null } };
export type ParticleRecipe = { id: string; name: string; emitters: Emitter[]; warnings: string[] };
type Particle = { mesh: THREE.Mesh<THREE.BufferGeometry, MeshBasicNodeMaterial | MeshStandardNodeMaterial>; emitter: Emitter; birth: number; lifetime: number; random: number; speed: number; position: THREE.Vector3; direction: THREE.Vector3; size: THREE.Vector3; rotation: THREE.Euler; matrix: THREE.Matrix4; color: Color };

function keysValue(keys: Key[], time: number): number {
  if (!keys.length) return 1;
  if (time <= keys[0].time) return keys[0].value;
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1], b = keys[i];
    if (time > b.time) continue;
    const span = b.time - a.time, t = span ? (time - a.time) / span : 1;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * a.value + (t3 - 2 * t2 + t) * span * a.outSlope + (-2 * t3 + 3 * t2) * b.value + (t3 - t2) * span * b.inSlope;
  }
  return keys[keys.length - 1].value;
}
function curve(value: Curve | undefined, time: number, random: number, fallback = 0): number {
  if (!value) return fallback;
  const high = value.scalar * keysValue(value.maxCurve.m_Curve, time);
  const low = value.minScalar * keysValue(value.minCurve.m_Curve, time);
  return value.minMaxState === 0 ? value.scalar : value.minMaxState === 1 ? high : value.minMaxState === 3 ? THREE.MathUtils.lerp(value.minScalar, value.scalar, random) : THREE.MathUtils.lerp(low, high, random);
}
function gradient(value: Gradient, time: number): Color {
  function channel(channel: 'r' | 'g' | 'b' | 'a', count: number, prefix: string): number {
    const at = time * 65535;
    for (let i = 1; i < count; i++) {
      const a = Number(value[prefix + (i - 1)]), b = Number(value[prefix + i]);
      if (at > b) continue;
      return THREE.MathUtils.lerp((value['key' + (i - 1)] as Color)[channel], (value['key' + i] as Color)[channel], b === a ? 1 : THREE.MathUtils.clamp((at - a) / (b - a), 0, 1));
    }
    return (value['key' + Math.max(0, count - 1)] as Color)[channel];
  }
  return { r: channel('r', value.m_NumColorKeys, 'ctime'), g: channel('g', value.m_NumColorKeys, 'ctime'), b: channel('b', value.m_NumColorKeys, 'ctime'), a: channel('a', value.m_NumAlphaKeys, 'atime') };
}
function colors(value: Colors, time: number, random: number): Color {
  if (value.minMaxState === 0) return value.maxColor;
  if (value.minMaxState === 4) return gradient(value.maxGradient, random);
  const a = value.minMaxState === 2 ? value.minColor : gradient(value.minGradient, time);
  const b = value.minMaxState === 2 ? value.maxColor : gradient(value.maxGradient, time);
  if (value.minMaxState === 1) return b;
  return { r: THREE.MathUtils.lerp(a.r, b.r, random), g: THREE.MathUtils.lerp(a.g, b.g, random), b: THREE.MathUtils.lerp(a.b, b.b, random), a: THREE.MathUtils.lerp(a.a, b.a, random) };
}

/** Development-only source-derived particles. Seeking rebuilds the same fixed-seed pose. */
export class SyntyParticleStudy {
  readonly root = new THREE.Group();
  private particles: Particle[] = [];
  private textures = new Map<string, THREE.Texture>();
  private geometries = new Map<string, THREE.BufferGeometry>();
  private plane = new THREE.PlaneGeometry(1, 1);
  private disposed = false;
  private load?: Promise<void>;
  recipes: ParticleRecipe[] = [];
  selected = '';
  trigger = 0;
  scale = 1;
  position = new THREE.Vector3(0, 1, .65);
  warnings: string[] = [];

  constructor(private readonly quality: QualityLevel = 'high') {}

  prepare(): Promise<void> {
    return this.load ??= this.prepareAssets().catch((error: unknown) => { this.releaseAssets(); this.load = undefined; throw error; });
  }
  private async prepareAssets(): Promise<void> {
    const response = await fetch('/vendor/synty/particle-study/recipes.json');
    if (!response.ok) throw new Error('Prepare the Synty study with npm run assets:prepare-particle-study.');
    const data = await response.json() as { version: number; recipes: ParticleRecipe[] };
    if (data.version !== 1 || !Array.isArray(data.recipes)) throw new Error('Unsupported Synty particle-study export.');
    this.recipes = data.recipes;
    const emitters = this.recipes.flatMap(recipe => recipe.emitters);
    // Sequential preparation keeps partial failures owned and releasable.
    for (const url of new Set(emitters.flatMap(e => e.material.texture ? [e.material.texture] : []))) {
      const texture = await new THREE.TextureLoader().loadAsync(url);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
      this.textures.set(url, texture);
    }
    for (const url of new Set(emitters.flatMap(e => e.mesh ? [e.mesh] : []))) {
      const gltf = await new GLTFLoader().loadAsync(url);
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        if (!this.geometries.has(url)) this.geometries.set(url, (object.geometry as THREE.BufferGeometry).clone().applyMatrix4(object.matrixWorld));
        (object.geometry as THREE.BufferGeometry).dispose();
        for (const material of (Array.isArray(object.material) ? object.material : [object.material]) as THREE.Material[]) material.dispose();
      });
      if (!this.geometries.has(url)) throw new Error('Synty particle mesh has no geometry.');
    }
    if (this.disposed) this.releaseAssets();
  }
  select(id: string): void {
    this.clear(); this.selected = id;
    const recipe = this.recipes.find(recipe => recipe.id === id);
    this.warnings = recipe?.warnings ?? [];
    if (!recipe || this.disposed) return;
    let seed = 1729;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (const emitter of recipe.emitters) {
      const modules = emitter.modules, initial = modules.InitialModule, emission = modules.EmissionModule;
      const matrix = new THREE.Matrix4();
      for (const t of emitter.transforms) matrix.multiply(new THREE.Matrix4().compose(new THREE.Vector3(t.position.x, t.position.y, -t.position.z), new THREE.Quaternion(-t.rotation.x, -t.rotation.y, t.rotation.z, t.rotation.w), new THREE.Vector3(t.scale.x, t.scale.y, t.scale.z)));
      const births: number[] = [];
      for (const burst of emission.m_Bursts ?? []) {
        for (let cycle = 0; cycle < Math.max(1, burst.cycleCount); cycle++) {
          if (random() > (burst.probability ?? 1)) continue;
          const count = Math.round(curve(burst.countCurve, 0, random()));
          for (let i = 0; i < count; i++) births.push(burst.time + cycle * burst.repeatInterval);
        }
      }
      const preset = particlePresets[this.quality], capacity = Math.floor(256 * preset.capacity);
      const rate = curve(emission.rateOverTime, 0, .5) * preset.emission;
      for (let i = 0; i < Math.min(capacity, Math.floor(rate * emitter.duration)); i++) births.push(i / rate);
      if (births.length > capacity) this.warnings = [...this.warnings, `Emitter limited to ${capacity} particles by the shared preset.`];
      for (const birth of births.slice(0, capacity)) {
        const r = random(), shape = modules.ShapeModule;
        const direction = new THREE.Vector3(0, 0, -1), position = new THREE.Vector3();
        if (shape.enabled) {
          const azimuth = random() * Math.PI * 2, radius = (shape.radius?.value ?? .01) * Math.sqrt(random());
          if (shape.type === 0) direction.setFromSphericalCoords(1, Math.acos(2 * random() - 1), azimuth);
          else if ([4, 8].includes(shape.type)) {
            const angle = THREE.MathUtils.degToRad(shape.angle) * Math.sqrt(random());
            direction.set(Math.sin(angle) * Math.cos(azimuth), Math.sin(angle) * Math.sin(azimuth), -Math.cos(angle));
            position.set(radius * Math.cos(azimuth), radius * Math.sin(azimuth), 0);
          } else if (shape.type === 5) position.set(random() - .5, random() - .5, random() - .5);
          const scale = shape.m_Scale;
          if (scale) position.multiply(new THREE.Vector3(scale.x, scale.y, scale.z));
          const rotation = shape.m_Rotation;
          if (rotation) {
            const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-THREE.MathUtils.degToRad(rotation.x), -THREE.MathUtils.degToRad(rotation.y), THREE.MathUtils.degToRad(rotation.z), 'YXZ'));
            position.applyQuaternion(q); direction.applyQuaternion(q);
          }
          const origin = shape.m_Position;
          if (origin) position.add(new THREE.Vector3(origin.x, origin.y, -origin.z));
        }
        const material = emitter.material.lit ? new MeshStandardNodeMaterial() : new MeshBasicNodeMaterial();
        material.transparent = !emitter.material.alphaTest; material.depthWrite = !!emitter.material.alphaTest;
        material.alphaTest = emitter.material.alphaTest; material.side = THREE.DoubleSide;
        material.blending = emitter.material.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
        if (material instanceof MeshStandardNodeMaterial) { material.roughness = 1; const e = emitter.material.emissive; if (e) material.emissive.setRGB(e.r, e.g, e.b); }
        if (emitter.material.texture) {
          material.map = this.textures.get(emitter.material.texture)!.clone();
          material.map.needsUpdate = true;
        }
        const mesh = new THREE.Mesh(emitter.mesh ? this.geometries.get(emitter.mesh)! : this.plane, material);
        mesh.visible = false; this.root.add(mesh);
        const size = curve(initial.startSize, 0, r, 1);
        this.particles.push({ mesh, emitter, birth: birth + curve(emitter.delay, 0, r), lifetime: Math.max(.001, curve(initial.startLifetime, 0, r, 1)), random: r, speed: curve(initial.startSpeed, 0, r), direction, position, matrix,
          size: new THREE.Vector3(size, initial.size3D ? curve(initial.startSizeY, 0, r, size) : size, initial.size3D ? curve(initial.startSizeZ, 0, r, size) : size),
          rotation: new THREE.Euler(initial.rotation3D ? -curve(initial.startRotationX, 0, r) : 0, initial.rotation3D ? -curve(initial.startRotationY, 0, r) : 0, curve(initial.startRotation, 0, r)), color: colors(initial.startColor, 0, r) });
      }
    }
  }
  seek(time: number, camera: THREE.Camera): void {
    this.root.position.copy(this.position); this.root.scale.setScalar(this.scale);
    this.root.updateMatrixWorld(true);
    const cameraRotation = camera.getWorldQuaternion(new THREE.Quaternion());
    for (const p of this.particles) {
      const age = time - this.trigger - p.birth;
      p.mesh.visible = age >= 0 && age < p.lifetime;
      if (!p.mesh.visible) continue;
      const t = age / p.lifetime, m = p.emitter.modules;
      p.mesh.position.copy(p.position).addScaledVector(p.direction, p.speed * age);
      p.mesh.position.y -= .5 * 9.81 * curve(m.InitialModule.gravityModifier, t, p.random) * age * age;
      p.mesh.position.applyMatrix4(p.matrix);
      p.mesh.scale.copy(p.size).multiply(new THREE.Vector3().setFromMatrixScale(p.matrix));
      if (m.SizeModule.enabled) {
        if (m.SizeModule.separateAxes) p.mesh.scale.multiply(new THREE.Vector3(curve(m.SizeModule.curve, t, p.random, 1), curve(m.SizeModule.y, t, p.random, 1), curve(m.SizeModule.z, t, p.random, 1)));
        else p.mesh.scale.multiplyScalar(curve(m.SizeModule.curve, t, p.random, 1));
      }
      const rotation = p.rotation.clone();
      if (m.RotationModule.enabled) {
        rotation.z += curve(m.RotationModule.z, t, p.random) * age;
        if (m.RotationModule.separateAxes) { rotation.x -= curve(m.RotationModule.x, t, p.random) * age; rotation.y -= curve(m.RotationModule.y, t, p.random) * age; }
      }
      if (!p.emitter.mesh && p.emitter.alignment === 0) p.mesh.quaternion.copy(cameraRotation).multiply(new THREE.Quaternion().setFromEuler(rotation));
      else {
        p.mesh.quaternion.setFromRotationMatrix(p.matrix);
        if (p.emitter.alignment === 4) p.mesh.quaternion.multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), p.direction));
        p.mesh.quaternion.multiply(new THREE.Quaternion().setFromEuler(rotation));
      }
      if (p.emitter.renderMode === 1) p.mesh.scale.y *= Math.max(1, p.emitter.lengthScale + p.emitter.velocityScale * p.speed);
      const color = m.ColorModule.enabled ? colors(m.ColorModule.gradient, t, p.random) : { r: 1, g: 1, b: 1, a: 1 };
      const tint = p.emitter.material.color;
      p.mesh.material.color.setRGB(p.color.r * color.r * tint.r, p.color.g * color.g * tint.g, p.color.b * color.b * tint.b);
      p.mesh.material.opacity = p.color.a * color.a * tint.a;
      const uv = m.UVModule, texture = p.mesh.material.map;
      if (uv.enabled && texture) {
        const columns = uv.tilesX, rows = uv.tilesY;
        const frame = Math.min(columns * rows - 1, Math.floor(curve(uv.frameOverTime, t, p.random) * columns * rows * uv.cycles) % (columns * rows));
        texture.repeat.set(1 / columns, 1 / rows); texture.offset.set((frame % columns) / columns, 1 - (Math.floor(frame / columns) + 1) / rows);
      }
    }
  }
  clear(): void { for (const p of this.particles) { p.mesh.material.map?.dispose(); p.mesh.material.dispose(); p.mesh.removeFromParent(); } this.particles = []; }
  private releaseAssets(): void { this.clear(); this.textures.forEach(t => t.dispose()); this.geometries.forEach(g => g.dispose()); this.textures.clear(); this.geometries.clear(); }
  dispose(): void {
    this.disposed = true; this.clear();
    const release = () => { this.releaseAssets(); this.plane.dispose(); };
    if (this.load) void this.load.then(release, release);
    else release();
  }
  snapshot(): { selected: string; particles: number; visible: number; warnings: string[] } { return { selected: this.selected, particles: this.particles.length, visible: this.particles.filter(p => p.mesh.visible).length, warnings: this.warnings }; }
}
