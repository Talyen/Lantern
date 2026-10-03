import * as THREE from 'three';
import { type Node, MeshStandardNodeMaterial } from 'three/webgpu';
import { attribute, dot, Fn, mat3, mix, modelNormalMatrix, modelWorldMatrix, modelWorldMatrixInverse, normalLocal, positionLocal, positionPrevious, sin, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { copyStandardNodeMaterial } from '../assets/environment-surfaces';
import { isMesh } from '../assets/resource-ownership';
import type { VegetationProfile } from '../levels/types';

export type VegetationActor = { id: string; x: number; y: number; z: number; yaw: number };
type Slot = { id: string | null; position: ReturnType<typeof uniform<'vec4'>>; trail: ReturnType<typeof uniform<'vec4'>>; previousPosition: ReturnType<typeof uniform<'vec4'>>; previousTrail: ReturnType<typeof uniform<'vec4'>> };
export type Plant = { profile: VegetationProfile; root: THREE.Vector3; height: number; radius: number; wind: boolean };
type Binding = { mesh: THREE.Mesh; geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[] };

/** Four render-owned influences; no per-blade simulation, uploads or ground texture. */
export class Vegetation {
  private readonly slots: Slot[] = Array.from({ length: 4 }, () => ({ id: null, position: uniform(new THREE.Vector4(0, 0, 0, 0)), trail: uniform(new THREE.Vector4(0, 0, 0, 0)), previousPosition: uniform(new THREE.Vector4(0, 0, 0, 0)), previousTrail: uniform(new THREE.Vector4(0, 0, 0, 0)) }));
  private readonly inputs: VegetationActor[] = Array.from({ length: 4 }, () => ({ id: '', x: 0, y: 0, z: 0, yaw: 0 }));
  private count = 0;
  private initialized = false;
  readonly plants = new WeakMap<THREE.Mesh, Plant[]>();
  private readonly bindings: Binding[] = [];
  private readonly materials = new Map<THREE.Material, Map<string, MeshStandardNodeMaterial>>();
  private readonly clock = uniform(0);
  private readonly previousClock = uniform(0);
  private readonly wind = uniform(new THREE.Vector3());
  private readonly previousWind = uniform(new THREE.Vector3());

  stage(actors: readonly VegetationActor[]): void {
    this.count = Math.min(actors.length, this.inputs.length);
    for (let i = 0; i < this.count; i++) Object.assign(this.inputs[i], actors[i]);
  }

  reset(): void {
    this.initialized = false; this.count = 0;
    for (const slot of this.slots) { slot.id = null; slot.position.value.set(0, 0, 0, 0); slot.trail.value.set(0, 0, 0, 0); slot.previousPosition.value.copy(slot.position.value); slot.previousTrail.value.copy(slot.trail.value); }
  }

  advance(dt: number, time: number, wind: THREE.Vector3): void {
    this.previousClock.value = this.clock.value; this.clock.value = time;
    this.previousWind.value.copy(this.wind.value); this.wind.value.copy(wind);
    if (!this.initialized) { this.previousClock.value = time; this.previousWind.value.copy(wind); }
    for (const slot of this.slots) { slot.previousPosition.value.copy(slot.position.value); slot.previousTrail.value.copy(slot.trail.value); }
    if (dt <= 0 && this.initialized) return;
    // Keep selected actors in their slots when nearest-enemy ordering changes.
    for (const slot of this.slots) if (slot.id !== null && !this.inputs.some((input, i) => i < this.count && input.id === slot.id)) { slot.id = null; slot.position.value.w = 0; }
    for (let i = 0; i < this.count; i++) {
      const input = this.inputs[i];
      let slot = this.slots.find(slot => slot.id === input.id);
      const fresh = !slot;
      slot ??= this.slots.find(slot => slot.id === null)!;
      slot.id = input.id;
      const p = slot.position.value, trail = slot.trail.value;
      if (fresh) trail.set(input.x, input.z, Math.sin(input.yaw), Math.cos(input.yaw));
      const smoothing = 1 - Math.exp(-dt / .12);
      trail.x += (input.x - trail.x) * smoothing; trail.y += (input.z - trail.y) * smoothing;
      const dx = trail.x - input.x, dz = trail.y - input.z, length = Math.hypot(dx, dz);
      if (length > .5) { trail.x = input.x + dx * .5 / length; trail.y = input.z + dz * .5 / length; }
      trail.z = Math.sin(input.yaw); trail.w = Math.cos(input.yaw);
      p.set(input.x, input.y, input.z, 1);
      if (fresh || !this.initialized) { slot.previousPosition.value.copy(p); slot.previousTrail.value.copy(trail); }
    }
    this.initialized = true;
  }

  influence(root: Node<'vec3'>, footprint: Node<'float'>, previous = false): Node<'vec3'> {
    return Fn(() => {
      const result = vec2(0).toVar();
      for (const slot of this.slots) {
        const p = previous ? slot.previousPosition : slot.position, trail = previous ? slot.previousTrail : slot.trail;
        const segment = trail.xy.sub(p.xz), relative = root.xz.sub(p.xz);
        const along = dot(relative, segment).div(dot(segment, segment).max(.0001)).clamp(0, 1);
        const delta = relative.sub(segment.mul(along)), distance = delta.length();
        const direction = mix(trail.zw, delta.div(distance.max(.0001)), distance.smoothstep(0, .08));
        const influence = distance.div(footprint.add(.65)).oneMinus().clamp(0, 1);
        const height = root.y.sub(p.y).abs().smoothstep(.3, .9).oneMinus();
        result.addAssign(direction.mul(influence.mul(influence).mul(influence.oneMinus().mul(2).add(1))).mul(height).mul(p.w));
      }
      const bounded = result.div(result.length().max(1));
      return vec3(bounded.x, 0, bounded.y);
    })();
  }

  describe(root: THREE.Object3D, profile: VegetationProfile, wind: boolean): void {
    root.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(root), size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
    const plant: Plant = { profile, root: center.setY(bounds.min.y), height: Math.max(.01, size.y), radius: Math.min(.75, Math.max(size.x, size.z) * .5), wind };
    root.traverse(object => { if (isMesh(object) && !(object instanceof THREE.SkinnedMesh)) this.plants.set(object, [plant]); });
  }

  describeInstances(mesh: THREE.InstancedMesh, profile: VegetationProfile, wind: boolean): void {
    const matrix = new THREE.Matrix4(), bounds = new THREE.Box3(), size = new THREE.Vector3();
    mesh.geometry.computeBoundingBox(); mesh.updateWorldMatrix(true, false);
    const plants: Plant[] = [];
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix); matrix.premultiply(mesh.matrixWorld);
      bounds.copy(mesh.geometry.boundingBox!).applyMatrix4(matrix); bounds.getSize(size);
      plants.push({ profile, root: bounds.getCenter(new THREE.Vector3()).setY(bounds.min.y), height: Math.max(.01, size.y), radius: Math.min(.75, Math.max(size.x, size.z) * .5), wind });
    }
    this.plants.set(mesh, plants);
  }

  batchKey(mesh: THREE.Mesh): string {
    const plant = this.plants.get(mesh)?.[0]; return plant ? `${plant.profile}:${plant.wind}` : '';
  }

  batch(mesh: THREE.Mesh, sources: THREE.Mesh[]): void { this.plants.set(mesh, sources.flatMap(source => this.plants.get(source) ?? [])); }

  prepare(root: THREE.Object3D): void {
    root.updateWorldMatrix(true, true);
    root.traverse(mesh => {
      if (!isMesh(mesh)) return;
      const plants = this.plants.get(mesh); if (!plants?.length) return;
      const originalGeometry = mesh.geometry, original = mesh.material;
      const geometry = originalGeometry.clone(), inverse = mesh.matrixWorld.clone().invert();
      const instanced = mesh instanceof THREE.InstancedMesh;
      const count = instanced ? plants.length : geometry.getAttribute('position').count;
      const roots = new Float32Array(count * 4), radii = new Float32Array(count), point = new THREE.Vector3();
      for (let i = 0; i < count; i++) {
        const plant = plants[instanced ? i : 0]; point.copy(plant.root).applyMatrix4(inverse);
        roots.set([point.x, point.y, point.z, plant.height], i * 4); radii[i] = plant.radius;
      }
      const buffer = instanced ? THREE.InstancedBufferAttribute : THREE.BufferAttribute;
      geometry.setAttribute('vegetationRoot', new buffer(roots, 4)); geometry.setAttribute('vegetationRadius', new buffer(radii, 1));
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      const smallestScale = (s: THREE.Vector3) => Math.min(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z));
      const scale = mesh.getWorldScale(new THREE.Vector3()); let minScale = smallestScale(scale);
      if (instanced) { const matrix = new THREE.Matrix4(); for (let i = 0; i < mesh.count; i++) { mesh.getMatrixAt(i, matrix); const s = new THREE.Vector3().setFromMatrixScale(matrix); minScale = Math.min(minScale, smallestScale(s) * smallestScale(scale)); } }
      const padding = (.25 + (plants[0].wind ? Math.max(...plants.map(p => p.height)) * .15 : 0)) / Math.max(.001, minScale);
      geometry.boundingBox!.expandByScalar(padding); geometry.boundingSphere!.radius += padding;
      const convert = (source: THREE.Material): THREE.Material => {
        if (!(source instanceof THREE.MeshStandardMaterial) && !(source instanceof MeshStandardNodeMaterial)) return source;
        let variants = this.materials.get(source); if (!variants) { variants = new Map(); this.materials.set(source, variants); }
        const profile = plants[0].profile, wind = plants[0].wind, key = `${profile}:${wind}`;
        let material = variants.get(key);
        if (!material) { material = this.material(source, profile, wind); variants.set(key, material); }
        return material;
      };
      this.bindings.push({ mesh, geometry: originalGeometry, material: original });
      mesh.geometry = geometry; mesh.material = Array.isArray(original) ? original.map(convert) : convert(original); mesh.userData.reactiveVegetation = true;
      if (instanced) { mesh.computeBoundingBox(); mesh.computeBoundingSphere(); }
    });
  }

  private material(source: THREE.MeshStandardMaterial | MeshStandardNodeMaterial, profile: VegetationProfile, wind: boolean): MeshStandardNodeMaterial {
    const material = copyStandardNodeMaterial(source), authored = material.positionNode;
    const info = attribute('vegetationRoot', 'vec4'), radius = attribute('vegetationRadius', 'float');
    const exponent = profile === 'shrub' ? 3 : 2, ratio = profile === 'shrub' ? .12 : .25;
    material.positionNode = Fn(() => {
      // r186 applies instance transforms before positionNode. Roots use that same space.
      const point = (authored ? vec3(authored as Node<'vec3'>) : positionLocal).toVar();
      const world = modelWorldMatrix.mul(vec4(point, 1)).xyz;
      const root = modelWorldMatrix.mul(vec4(info.xyz, 1)).xyz;
      const t = world.y.sub(root.y).div(info.w).clamp(0, 1);
      const amount = info.w.mul(ratio).min(.25), weight = t.pow(exponent);
      const current = this.influence(root, radius).mul(amount).toVar(), previous = this.influence(root, radius, true).mul(amount).toVar();
      const sway = vec3(0).toVar(), previousSway = vec3(0).toVar();
      if (wind) {
        const wave = sin(this.clock.mul(1.4).add(point.x.mul(.3))).mul(.65).add(sin(this.clock.mul(.47)).mul(.35));
        const oldWave = sin(this.previousClock.mul(1.4).add(point.x.mul(.3))).mul(.65).add(sin(this.previousClock.mul(.47)).mul(.35));
        sway.assign(this.wind.mul(info.w).mul(wave)); previousSway.assign(this.previousWind.mul(info.w).mul(oldWave));
      }
      const n = modelNormalMatrix.mul(normalLocal).normalize().toVar();
      const slope = t.pow(exponent - 1).mul(exponent).div(info.w);
      n.y.subAssign(dot(n, current).mul(slope));
      if (wind) n.y.subAssign(dot(n, sway).mul(t.sqrt().mul(1.5).div(info.w)));
      normalLocal.assign(mat3(modelWorldMatrix).transpose().mul(n).normalize());
      const displacement = modelWorldMatrixInverse.mul(vec4(current.mul(weight).add(sway.mul(t.pow(1.5))), 0)).xyz;
      const oldDisplacement = modelWorldMatrixInverse.mul(vec4(previous.mul(weight).add(previousSway.mul(t.pow(1.5))), 0)).xyz;
      positionPrevious.assign(positionPrevious.add(oldDisplacement));
      return point.add(displacement);
    })();
    return material;
  }

  diagnostics() { return { actors: this.slots.filter(slot => slot.position.value.w > 0).map(slot => slot.id), plantDraws: this.bindings.length }; }

  dispose(): void {
    for (const binding of this.bindings) { binding.mesh.geometry.dispose(); binding.mesh.geometry = binding.geometry; binding.mesh.material = binding.material; delete binding.mesh.userData.reactiveVegetation; }
    this.bindings.length = 0; for (const variants of this.materials.values()) for (const material of variants.values()) material.dispose(); this.materials.clear(); this.reset();
  }
}
