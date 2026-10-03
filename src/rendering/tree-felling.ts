import * as THREE from 'three';
import { MeshStandardNodeMaterial, type Node } from 'three/webgpu';
import { bool, float, Fn, If, max, min, mix, positionLocal, sin, uniform, vec2 } from 'three/tsl';
import { copyStandardNodeMaterial } from '../assets/environment-surfaces';
import { isMesh } from '../assets/resource-ownership';
import { boundaryDistance, type Point } from '../gameplay/area';
import type { AreaDefinition } from '../levels/types';
import type { CoreEffects } from './effects';

type Tree = {
  model: THREE.Object3D; pivot: THREE.Group; stump: THREE.Mesh; radius: number;
  restPosition: THREE.Vector3; restQuaternion: THREE.Quaternion; restScale: THREE.Vector3;
  fade: ReturnType<typeof uniform<'float'>>; height: number; angle: number; contactDistance: number;
  materials: Map<THREE.Material, MeshStandardNodeMaterial>; bindings: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }[];
  depleted: boolean;
};
type Fall = { tree: Tree; age: number; direction: Point; axis: THREE.Vector3; contact: THREE.Vector3; landed: boolean };
const fallSeconds = .8, holdSeconds = .05, fadeSeconds = .25;

// Adaptive alpha hashing, expressed in the public TSL API so beauty and native
// shadow overrides share coverage without mixing bundled and source node runtimes.
const hash2D = (p: Node<'vec2'>) => sin(p.x.mul(17).add(p.y.mul(.1))).mul(1e4).mul(sin(p.y.mul(13).add(p.x)).abs().add(.1)).fract();
const hash3D = (p: Node<'vec3'>) => hash2D(vec2(hash2D(p.xy), p.z));
const fadeThreshold = Fn(() => {
  const derivative = max(positionLocal.dFdx().length(), positionLocal.dFdy().length()).max(1e-6);
  const scale = float(1).div(derivative.mul(.05)).log2();
  const low = scale.floor().exp2(), high = scale.ceil().exp2(), blend = scale.fract();
  const x = mix(hash3D(positionLocal.mul(low).floor()), hash3D(positionLocal.mul(high).floor()), blend);
  const a = min(blend, blend.oneMinus()), denominator = a.mul(a.oneMinus()).mul(2).max(1e-6);
  const left = x.mul(x).div(denominator), middle = x.sub(a.mul(.5)).div(a.oneMinus());
  const right = x.oneMinus().mul(x.oneMinus()).div(denominator).oneMinus();
  return x.lessThan(a).select(left, x.greaterThan(a.oneMinus()).select(right, middle)).clamp(1e-6, 1);
});

/** A presentation-only fall. Harvesting owns depletion, rewards and collision. */
export class TreeFelling {
  private readonly trees = new Map<string, Tree>();
  private readonly falling = new Map<string, Fall>();
  private effects?: CoreEffects;

  constructor(private readonly area: AreaDefinition, private readonly treeIds: ReadonlySet<string>) {}

  register(id: string, model: THREE.Object3D, stump: THREE.Mesh, radius: number): void {
    const pivot = new THREE.Group(); pivot.name = `${id}:fall-pivot`; pivot.position.copy(stump.position); pivot.position.y -= .125;
    model.parent!.add(pivot); pivot.updateWorldMatrix(true, false); pivot.attach(model);
    const inverse = pivot.matrixWorld.clone().invert(), height = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).y;
    // Eight coarse vertical support bands avoid using an AABB's imaginary low canopy corners.
    const supports = Array.from({ length: 8 }, () => ({ y: Infinity, radius: 0 }));
    const point = new THREE.Vector3(), matrix = new THREE.Matrix4();
    model.traverse(mesh => {
      if (!isMesh(mesh)) return;
      const positions = mesh.geometry.getAttribute('position');
      matrix.multiplyMatrices(inverse, mesh.matrixWorld);
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).applyMatrix4(matrix);
        if (point.y <= .3) continue;
        const band = supports[Math.min(7, Math.floor(Math.max(0, point.y) / Math.max(.01, height) * 8))];
        band.y = Math.min(band.y, point.y); band.radius = Math.max(band.radius, Math.hypot(point.x, point.z));
      }
    });
    let angle = Math.PI * .47, contactDistance = height * .7;
    for (const band of supports) if (Number.isFinite(band.y)) {
      const contactAngle = Math.atan2(Math.max(.01, band.y - .015), Math.max(.001, band.radius));
      if (contactAngle < angle) { angle = contactAngle; contactDistance = band.y * Math.sin(angle) + band.radius * Math.cos(angle); }
    }
    const tree: Tree = { model, pivot, stump, radius, restPosition: model.position.clone(), restQuaternion: model.quaternion.clone(), restScale: model.scale.clone(), fade: uniform(1), height, angle, contactDistance, materials: new Map(), bindings: [], depleted: false };
    // Prepare fade variants once; felling only changes uniforms, never materials or shader graphs.
    model.traverse(mesh => {
      if (!isMesh(mesh)) return;
      const original = mesh.material;
      const convert = (source: THREE.Material): THREE.Material => {
        if (!(source instanceof THREE.MeshStandardMaterial) && !(source instanceof MeshStandardNodeMaterial)) return source;
        let material = tree.materials.get(source);
        if (!material) {
          material = copyStandardNodeMaterial(source);
          const coverage = Fn(() => {
            const visible = bool(true).toVar();
            If(tree.fade.lessThan(1), () => { visible.assign(tree.fade.greaterThanEqual(fadeThreshold())); });
            return visible;
          })();
          // r186 forwards maskShadowNode but not opacityNode/alphaHash. Preserve
          // authored opacity/maps and use the same additional mask in every pass.
          const shadowMask = material.maskShadowNode ?? material.maskNode;
          material.maskShadowNode = shadowMask ? bool(shadowMask as Node<'bool'>).and(coverage) : coverage;
          material.maskNode = material.maskNode ? bool(material.maskNode as Node<'bool'>).and(coverage) : coverage;
          tree.materials.set(source, material);
        }
        return material;
      };
      tree.bindings.push({ mesh, material: original }); mesh.material = Array.isArray(original) ? original.map(convert) : convert(original);
    });
    this.trees.set(id, tree);
  }

  activate(effects: CoreEffects): void { this.effects = effects; }

  restore(id: string, depleted: boolean): void {
    const tree = this.trees.get(id); if (!tree) return;
    this.falling.delete(id); tree.depleted = depleted; tree.fade.value = 1;
    tree.pivot.quaternion.identity(); tree.model.position.copy(tree.restPosition); tree.model.quaternion.copy(tree.restQuaternion); tree.model.scale.copy(tree.restScale);
    tree.model.visible = !depleted; tree.stump.visible = depleted;
  }

  fell(id: string, from: Point): void {
    const tree = this.trees.get(id); if (!tree || tree.depleted) return;
    this.restore(id, false); tree.depleted = true; tree.stump.visible = true;
    const base = tree.pivot.position;
    const preferred = Math.atan2(base.x - from[0], base.z - from[1]);
    let direction: Point = [Math.sin(preferred), Math.cos(preferred)], best = Infinity;
    const reach = tree.height * Math.sin(tree.angle);
    for (let candidate = 0; candidate < 8; candidate++) {
      const heading = preferred + candidate * Math.PI / 4, dx = Math.sin(heading), dz = Math.cos(heading);
      let score = Math.min(candidate, 8 - candidate) * .001;
      for (let sample = 1; sample <= 6; sample++) {
        const x = base.x + dx * reach * sample / 6, z = base.z + dz * reach * sample / 6;
        score += Math.max(0, -boundaryDistance(this.area.layout.boundary, [x, z])) * 4;
        for (const obstacle of this.area.traversal?.obstacles ?? []) {
          if (this.treeIds.has(obstacle.id) || obstacle.position[1] + obstacle.size[1] / 2 <= base.y + .25) continue;
          const ox = x - obstacle.position[0], oz = z - obstacle.position[2], c = Math.cos(obstacle.yaw), s = Math.sin(obstacle.yaw);
          if (Math.abs(ox * c - oz * s) < obstacle.size[0] / 2 + tree.radius && Math.abs(ox * s + oz * c) < obstacle.size[2] / 2 + tree.radius) score += 10;
        }
      }
      if (score < best) { best = score; direction = [dx, dz]; }
    }
    const contact = new THREE.Vector3(base.x + direction[0] * tree.contactDistance, base.y + .04, base.z + direction[1] * tree.contactDistance);
    this.falling.set(id, { tree, age: 0, direction, axis: new THREE.Vector3(direction[1], 0, -direction[0]), contact, landed: false });
  }

  update(dt: number): void {
    if (dt <= 0) return;
    for (const [id, fall] of this.falling) {
      fall.age += dt;
      const t = Math.min(1, fall.age / fallSeconds);
      fall.tree.pivot.quaternion.setFromAxisAngle(fall.axis, fall.tree.angle * t * t);
      if (!fall.landed && t === 1) { fall.landed = true; this.effects?.burst('debris', fall.contact, 7); }
      fall.tree.fade.value = 1 - THREE.MathUtils.clamp((fall.age - fallSeconds - holdSeconds) / fadeSeconds, 0, 1);
      if (fall.tree.fade.value === 0) { fall.tree.model.visible = false; this.falling.delete(id); }
    }
  }

  diagnostics() { return [...this.falling].map(([id, fall]) => ({ id, age: fall.age, angle: fall.tree.angle, fade: fall.tree.fade.value })); }

  dispose(): void {
    this.falling.clear(); this.effects = undefined;
    for (const tree of this.trees.values()) { for (const binding of tree.bindings) binding.mesh.material = binding.material; for (const material of tree.materials.values()) material.dispose(); }
    this.trees.clear();
  }
}
