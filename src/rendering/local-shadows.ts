import * as THREE from 'three';
import { pointShadow } from 'three/tsl';
import { isMesh } from '../assets/resource-ownership';

type Caster = { matrix: THREE.Matrix4; sphere: THREE.Sphere; stamp: unknown[]; cursor: number; seen: number; changed: boolean; animated: boolean; unbounded: boolean };
type LocalShadow = { light: THREE.PointLight; members: Set<THREE.Mesh>; position: THREE.Vector3; distance: number; layers: number; refreshes: number; faces: number; reason: string };

/** Stationary emitters cache depth, never brightness. Moving/deforming casters remain live. */
export class LocalShadows {
  private lights = new Map<THREE.PointLight, LocalShadow>();
  private retained = new WeakMap<THREE.PointLight, LocalShadow>();
  private casters = new Map<THREE.Mesh, Caster>();
  private frame = 0;
  private sphere = new THREE.Sphere();
  private boneMatrix = new THREE.Matrix4();
  private boneTransform = new THREE.Matrix4();
  private skeletons = new Set<THREE.Skeleton>();

  sync(lights: readonly THREE.PointLight[]): void {
    for (const light of lights) {
      if (!light.castShadow || this.lights.has(light) || (light.shadow.camera.layers.mask & 0xfffffffe) === 0) continue;
      const retained = this.retained.get(light);
      if (retained) { retained.members.clear(); light.shadow.needsUpdate = true; this.lights.set(light, retained); continue; }
      const state: LocalShadow = { light, members: new Set(), position: new THREE.Vector3(Infinity, Infinity, Infinity), distance: -1, layers: -1, refreshes: 0, faces: 0, reason: 'initial' };
      // r186 shares an analytic light node across the graph's cameras. Its native
      // updateBefore clears needsUpdate after the first successful depth update.
      // Keep native filtering/cube rendering; instrument only actual submissions.
      const node = pointShadow(light);
      const render = Reflect.get(node, 'renderShadow') as ((frame: unknown) => void) | undefined;
      const setup = Reflect.get(node, 'setupShadow') as ((builder: unknown) => unknown) | undefined;
      if (THREE.REVISION !== '186' || typeof render !== 'function' || typeof setup !== 'function') throw new Error('Local shadow integration needs updating for this three.js version.');
      Reflect.set(node, 'setupShadow', (builder: unknown) => { const result = setup.call(node, builder); light.shadow.needsUpdate = true; return result; });
      Reflect.set(node, 'renderShadow', (frame: unknown) => { render.call(node, frame); state.refreshes++; state.faces += 6; });
      Reflect.set(light.shadow, 'shadowNode', node);
      light.shadow.autoUpdate = false; light.shadow.needsUpdate = true;
      this.lights.set(light, state); this.retained.set(light, state);
    }
    for (const [light] of this.lights) if (!lights.includes(light) || !light.castShadow) this.lights.delete(light);
  }

  update(scene: THREE.Scene, lights: readonly THREE.PointLight[], paused: boolean): void {
    this.sync(lights);
    scene.updateMatrixWorld(true);
    if (!this.lights.size) { this.casters.clear(); return; }
    this.frame++; this.skeletons.clear();
    scene.traverseVisible(object => {
      if (!isMesh(object) || !object.castShadow) return;
      const geometry: THREE.BufferGeometry = object.geometry;
      const materials = object.material;
      let caster = this.casters.get(object);
      if (!caster) { caster = { matrix: new THREE.Matrix4(), sphere: new THREE.Sphere(), stamp: [], cursor: 0, seen: 0, changed: true, animated: false, unbounded: false }; this.casters.set(object, caster); }
      caster.changed = !caster.matrix.equals(object.matrixWorld); caster.cursor = 0;
      const record = (value: unknown) => {
        const changed = caster.stamp[caster.cursor] !== value;
        caster.changed ||= changed;
        caster.stamp[caster.cursor++] = value; return changed;
      };
      let geometryChanged = record(geometry); record(object.layers.mask);
      for (const name in geometry.attributes) {
        const attribute = geometry.attributes[name];
        const identityChanged = record(attribute);
        const versionChanged = record('data' in attribute ? attribute.data.version : attribute.version);
        geometryChanged ||= identityChanged || versionChanged;
      }
      record(geometry.index); record(geometry.index?.version);
      caster.animated = object instanceof THREE.SkinnedMesh; caster.unbounded = false;
      let visible = false;
      const materialState = (material: THREE.Material) => {
        record(material); record(material.version); record(material.visible);
        record(material.opacity); record(material.alphaTest); record(material.side);
        for (const key of ['map', 'alphaMap']) { const value: unknown = Reflect.get(material, key); record(value); if (value instanceof THREE.Texture) record(value.version); }
        const position: unknown = Reflect.get(material, 'positionNode'); record(position);
        caster.animated ||= !!position; caster.unbounded ||= !!position && !object.userData.reactiveVegetation; visible ||= material.visible;
      };
      if (Array.isArray(materials)) materials.forEach(materialState); else materialState(materials);
      if (object instanceof THREE.InstancedMesh) { record(object.instanceMatrix.version); record(object.count); }
      for (const value of object.morphTargetInfluences ?? []) record(value);
      if (object instanceof THREE.SkinnedMesh) {
        if (!this.skeletons.has(object.skeleton)) { object.skeleton.update(); this.skeletons.add(object.skeleton); }
        for (const value of object.skeleton.boneMatrices!) record(value);
      }
      if (caster.cursor !== caster.stamp.length) { caster.changed = true; caster.stamp.length = caster.cursor; }
      if (!visible) return;
      // GPU deformation still refreshes depth below. Its unchanged CPU bounds need no rebuild.
      if (caster.changed || object instanceof THREE.SkinnedMesh) {
        // Keep author-expanded deformation bounds on first registration.
        if (geometryChanged && caster.seen !== 0) geometry.computeBoundingSphere();
        if (object instanceof THREE.InstancedMesh) {
          object.computeBoundingSphere(); caster.sphere.copy(object.boundingSphere!).applyMatrix4(object.matrixWorld);
        } else {
          if (!geometry.boundingSphere) geometry.computeBoundingSphere();
          caster.sphere.copy(geometry.boundingSphere!).applyMatrix4(object.matrixWorld);
        }
        if (object instanceof THREE.SkinnedMesh) {
          // Union transformed bind spheres rather than CPU-skinning every vertex.
          // Every weighted skin position lies inside this conservative envelope.
          for (let bone = 0; bone < object.skeleton.bones.length; bone++) {
            this.boneMatrix.fromArray(object.skeleton.boneMatrices!, bone * 16);
            this.boneTransform.copy(object.matrixWorld).multiply(object.bindMatrixInverse).multiply(this.boneMatrix).multiply(object.bindMatrix);
            this.sphere.copy(geometry.boundingSphere!).applyMatrix4(this.boneTransform); caster.sphere.union(this.sphere);
          }
        }
      }
      caster.matrix.copy(object.matrixWorld); caster.seen = this.frame;
    });
    for (const state of this.lights.values()) {
      const { light, members } = state;
      light.getWorldPosition(this.sphere.center);
      let reason = light.shadow.needsUpdate ? 'requested' : '';
      if (!state.position.equals(this.sphere.center) || state.distance !== light.distance || state.layers !== light.shadow.camera.layers.mask) reason = 'light';
      state.position.copy(this.sphere.center); state.distance = light.distance; state.layers = light.shadow.camera.layers.mask;
      for (const [object, caster] of this.casters) {
        const relevant = caster.seen === this.frame && object.layers.test(light.shadow.camera.layers)
          && (caster.unbounded || light.distance === 0 || caster.sphere.distanceToPoint(state.position) <= light.distance);
        if (relevant) {
          if (!members.has(object)) reason = 'caster-entered';
          else if (caster.changed || caster.unbounded || (caster.animated && !paused)) reason = caster.animated ? 'animation' : 'caster-changed';
          members.add(object);
        } else if (members.delete(object)) reason = 'caster-left';
      }
      if (reason) { light.shadow.needsUpdate = true; state.reason = reason; }
    }
    for (const [object, caster] of this.casters) if (caster.seen !== this.frame) this.casters.delete(object);
  }

  diagnostics() {
    return [...this.lights.values()].map(state => ({ position: state.position.toArray(), refreshes: state.refreshes, cubeFaces: state.faces, casters: state.members.size, lastInvalidation: state.reason, pending: state.light.shadow.needsUpdate }));
  }
  dispose(): void { this.lights.clear(); this.casters.clear(); }
}
