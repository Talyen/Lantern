import * as THREE from 'three';
import { assetLibrary, type AssetInstance } from '../assets/asset-library';
import { itemDefinitions } from '../gameplay/equipment';
import { markOutline } from './outlines';
import type { Equipment } from './equipment';
import type { ResourceKind } from '../levels/resources';

/** Gathering attachments are presentation only: the actual loadout never changes. */
export class GatheringTools {
  private tools = new Map<'axe'|'pickaxe', { instance: AssetInstance; grip: THREE.Group }>();
  constructor(private actor: THREE.Group, private equipment: Equipment) {}
  async prepare(): Promise<void> {
    const socket = this.actor.getObjectByName('Hand_R');
    if (!socket) throw new Error('Gathering hand is unavailable.');
    try {
      for (const [tool,asset,length] of [['axe','generic:model:sm-gen-wep-axe-01',itemDefinitions.axe.length],['pickaxe','generic:model:sm-gen-wep-pickaxe-01',.85]] as const) {
        const instance = await assetLibrary.loadAsset(asset), grip = new THREE.Group();
        this.tools.set(tool,{instance,grip});
        const object = instance.object, size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
        object.scale.multiplyScalar(length / Math.max(size.x,size.y,size.z)); markOutline(object,'actor'); grip.add(object);
        this.actor.updateMatrixWorld(true); const scale = socket.getWorldScale(new THREE.Vector3());
        grip.scale.set(1/scale.x,1/scale.y,1/scale.z);
        grip.position.fromArray(itemDefinitions.axe.grip.position).divide(scale);
        grip.rotation.fromArray([...itemDefinitions.axe.grip.rotation,'XYZ']);
        grip.name = `gathering-${tool}`; grip.userData.transient = true; grip.visible = false; socket.add(grip);
      }
    } catch (error) { this.dispose(); throw error; }
  }
  show(kind: ResourceKind | null): void {
    this.equipment.setVisible(kind === null);
    for (const [name,tool] of this.tools) tool.grip.visible = kind !== null && name === (kind === 'tree' ? 'axe' : 'pickaxe');
  }
  dispose(): void { this.show(null); for (const {instance,grip} of this.tools.values()) { grip.removeFromParent(); instance.release(); } this.tools.clear(); }
}
