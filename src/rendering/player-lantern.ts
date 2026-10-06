import { disposeSceneResources, sceneTextures, isMesh } from '../assets/resource-ownership';
import * as THREE from 'three';
import type { RuntimeAssets } from '../assets/runtime-assets';
import { resolveLocalLight } from '../levels/local-lighting';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import characters from '../../assets/playable-characters.json';

/** Personal light follows the verified player rig; it never contributes to static bakes. */
export class PlayerLantern {
  readonly root = new THREE.Group();
  readonly light: THREE.PointLight;
  private readonly ownerBounce: THREE.PointLight;
  private model: THREE.Group | null = null;
  private hook: THREE.Mesh | null = null;
  private authoredLantern: THREE.Object3D | null = null;
  private disposed = false;
  constructor(private actor: THREE.Group, enabled: boolean, private resources: RuntimeAssets) {
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
    this.actor.updateMatrixWorld(true);
    const emitterPosition = this.light.getWorldPosition(new THREE.Vector3());
    const bouncePosition = this.ownerBounce.getWorldPosition(new THREE.Vector3());
    this.authoredLantern = this.actor.getObjectByName(characters.player.lanternNode) ?? null;
    if (this.authoredLantern) this.authoredLantern.visible = this.root.visible;
    const url = characters.player.lanternModel;
    if (!this.authoredLantern) try {
      const { scene } = await this.resources.loader.loadAsync(url); sceneTextures(scene);
      this.model = scene;
      const height = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3()).y;
      if (height > 0) scene.scale.multiplyScalar(.22 / height);
      scene.updateMatrixWorld(true); const bounds = new THREE.Box3().setFromObject(scene), center = bounds.getCenter(new THREE.Vector3());
      scene.position.set(-center.x, -bounds.min.y, -center.z);
      scene.traverse(object => { if (isMesh(object)) { object.castShadow = true; object.receiveShadow = true; } });
      if (this.disposed) { this.disposeModel(); return; }
      this.root.add(scene);
    } catch { /* Optional cage art: the personal light remains available. */ }
    const socket = this.actor.getObjectByName('lantern-socket');
    const parent = socket ?? this.actor.getObjectByName('Hips');
    if (parent) {
      this.actor.updateMatrixWorld(true);
      const position = socket ? socket.getWorldPosition(new THREE.Vector3()) : this.root.getWorldPosition(new THREE.Vector3());
      const rotation = this.root.getWorldQuaternion(new THREE.Quaternion());
      const scale = this.root.getWorldScale(new THREE.Vector3());
      parent.add(this.root); this.root.position.copy(parent.worldToLocal(position));
      this.root.quaternion.copy(parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rotation));
      this.root.scale.copy(scale.divide(parent.getWorldScale(new THREE.Vector3())));
      if (socket) {
        // Put the top of the authored handle against the belt socket.
        if (this.model) {
          this.model.position.y -= .22;
          this.hook = new THREE.Mesh(new THREE.TorusGeometry(.014, .003, 6, 16), new MeshStandardNodeMaterial({ color: '#8d7147', metalness: .55, roughness: .7 }));
          this.hook.position.y = .01; this.root.add(this.hook);
        }
        this.root.updateMatrixWorld(true);
        // Keep the proven chest emitter/bounce placement while moving cage art.
        this.light.position.copy(this.root.worldToLocal(emitterPosition));
        this.ownerBounce.position.copy(this.root.worldToLocal(bouncePosition));
      }
    }
  }
  setEnabled(value: boolean): void { this.root.visible = value; if (this.authoredLantern) this.authoredLantern.visible = value; }
  diagnostics() { return { enabled: this.root.visible, model: !!this.model || !!this.authoredLantern, attachment: this.root.parent?.name, handlePosition: this.root.getWorldPosition(new THREE.Vector3()).toArray(), position: this.light.getWorldPosition(new THREE.Vector3()).toArray(), intensity: this.light.intensity, distance: this.light.distance, ownerBounce: { intensity: this.ownerBounce.intensity, distance: this.ownerBounce.distance }, attachedToRig: !!this.root.parent && ['Hips', 'lantern-socket'].includes(this.root.parent.name) }; }
  private disposeModel(): void {
    if (!this.model) return;
    this.model.removeFromParent();
    disposeSceneResources(this.model);
    this.model = null;
  }
  dispose(): void { this.disposed = true; this.root.removeFromParent(); this.light.dispose(); this.ownerBounce.dispose(); this.disposeModel(); if (this.hook) { disposeSceneResources(this.hook); this.hook = null; } }
}
