import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { resolveLocalLight } from '../levels/local-lighting';

/** Personal light follows the verified player rig; it never contributes to static bakes. */
export class PlayerLantern {
  readonly root = new THREE.Group();
  readonly light: THREE.PointLight;
  private readonly ownerBounce: THREE.PointLight;
  private model: THREE.Group | null = null;
  private disposed = false;
  constructor(private actor: THREE.Group, enabled: boolean) {
    const recipe = resolveLocalLight({ role: 'lantern' });
    this.light = new THREE.PointLight(recipe.color, recipe.intensity, recipe.distance, 2);
    // Lift the effective emitter toward the chest and forward of the torso.
    // A hip-level point overlights the belt while leaving face/armor normals dark.
    this.light.position.set(.15, .45, .5);
    // Approximate lantern bounce on the opposite side of the owner, not a camera fill.
    // Its short cutoff keeps the far woodland dark when the character turns away.
    this.ownerBounce = new THREE.PointLight(recipe.color, recipe.intensity * .35, 2.8, 2);
    this.ownerBounce.position.set(-1.05, .5, -.65);
    this.root.add(this.ownerBounce);
    this.root.name = 'player-lantern'; this.root.userData.transient = true;
    this.root.position.set(.45, .95, .12); this.root.add(this.light); this.root.visible = enabled; actor.add(this.root);
  }
  async initialize(): Promise<void> {
    const url = '/vendor/synty/environment/sm-prop-lantern-01.glb';
    try {
      const { scene } = await new GLTFLoader().loadAsync(url);
      this.model = scene;
      const height = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3()).y;
      if (height > 0) scene.scale.multiplyScalar(.22 / height);
      scene.updateMatrixWorld(true); const bounds = new THREE.Box3().setFromObject(scene), center = bounds.getCenter(new THREE.Vector3());
      scene.position.set(-center.x, -bounds.min.y, -center.z);
      scene.traverse(object => { if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; } });
      if (this.disposed) { this.disposeModel(); return; }
      this.root.add(scene);
    } catch { /* Optional cage art: the personal light remains available. */ }
    const hips = this.actor.getObjectByName('Hips');
    if (hips) {
      this.actor.updateMatrixWorld(true);
      const position = this.root.getWorldPosition(new THREE.Vector3());
      const rotation = this.root.getWorldQuaternion(new THREE.Quaternion());
      const scale = this.root.getWorldScale(new THREE.Vector3());
      hips.add(this.root); this.root.position.copy(hips.worldToLocal(position));
      this.root.quaternion.copy(hips.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rotation));
      this.root.scale.copy(scale.divide(hips.getWorldScale(new THREE.Vector3())));
    }
  }
  setEnabled(value: boolean): void { this.root.visible = value; }
  diagnostics() { return { enabled: this.root.visible, model: !!this.model, position: this.light.getWorldPosition(new THREE.Vector3()).toArray(), intensity: this.light.intensity, distance: this.light.distance, ownerBounce: { intensity: this.ownerBounce.intensity, distance: this.ownerBounce.distance }, attachedToRig: this.root.parent?.name === 'Hips' }; }
  private disposeModel(): void {
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
    this.model?.traverse(object => { if (object instanceof THREE.Mesh) { geometries.add(object.geometry); for (const material of Array.isArray(object.material) ? object.material : [object.material]) { materials.add(material); for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value); } } });
    textures.forEach(texture => texture.dispose()); materials.forEach(material => material.dispose()); geometries.forEach(geometry => geometry.dispose()); this.model = null;
  }
  dispose(): void { this.disposed = true; this.root.removeFromParent(); this.light.dispose(); this.ownerBounce.dispose(); this.disposeModel(); }
}
