import * as THREE from 'three';
import { assetLibrary, type AssetInstance, type AssetLibrary } from '../assets/asset-library';
import { itemDefinitions, normalizeLoadout, type ItemId, type Loadout } from '../gameplay/equipment';
import { markOutline } from './outlines';

export type PreparedEquipment = { loadout: Loadout; attachments: { item: ItemId; socket: THREE.Object3D; instance: AssetInstance; grip: THREE.Group }[] };

/** Models prepare off-scene; a failed or superseded load cannot replace a working loadout. */
export class Equipment {
  private current: PreparedEquipment | null = null;
  private candidates = new Set<PreparedEquipment>();
  private disposed = false;
  constructor(private actor: THREE.Group, private rig: 'player' | 'enemy' = 'player', private library: AssetLibrary = assetLibrary) {}
  async stage(requested: Loadout): Promise<PreparedEquipment> {
    if (this.disposed) throw new Error('Equipment has been closed.');
    const loadout = normalizeLoadout(requested);
    const items = [loadout.main, loadout.off].filter((item): item is ItemId => item !== null);
    const sockets = items.map(item => {
      const name = itemDefinitions[item].hand, socket = this.actor.getObjectByName(name);
      if (!socket) throw new Error(`Cannot equip ${itemDefinitions[item].name}: character hand is unavailable.`);
      return socket;
    });
    const results = await Promise.allSettled(items.map(item => this.library.loadAsset(itemDefinitions[item].asset)));
    const loaded = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
    const failed = results.find(result => result.status === 'rejected');
    if (failed || this.disposed) {
      loaded.forEach(instance => instance.release());
      throw new Error(failed ? `Unable to equip ${items.map(item => itemDefinitions[item].name).join(' and ')}. Prepare the selected Synty models and try again.` : 'Equipment has been closed.');
    }
    this.actor.updateMatrixWorld(true);
    let attachments: PreparedEquipment['attachments'];
    try { attachments = loaded.map((instance, index) => {
      const item = items[index], definition = itemDefinitions[item], socket = sockets[index];
      const object = instance.object, grip = new THREE.Group(); grip.name = `equipment-${item}`; grip.userData.transient = true;
      const bounds = new THREE.Box3().setFromObject(object), size = bounds.getSize(new THREE.Vector3()), length = Math.max(size.x, size.y, size.z);
      if (length <= 0 || !Number.isFinite(length)) throw new Error(`${definition.name} has no visible model.`);
      // Exported models keep their authored grip at the origin. Hands live in centimeter-scaled rigs.
      const factor = definition.length / length * (this.rig === 'enemy' ? .85 : 1);
      object.scale.multiplyScalar(factor); markOutline(object, 'actor'); grip.add(object);
      const worldScale = socket.getWorldScale(new THREE.Vector3());
      grip.scale.set(1 / worldScale.x, 1 / worldScale.y, 1 / worldScale.z);
      grip.position.fromArray(definition.grip.position).divide(worldScale);
      grip.rotation.fromArray([...definition.grip.rotation, 'XYZ']);
      return { item, socket, instance, grip };
    }); } catch (error) { loaded.forEach(instance => instance.release()); throw error; }
    const candidate = { loadout, attachments }; this.candidates.add(candidate); return candidate;
  }
  commit(candidate: PreparedEquipment): void {
    if (this.disposed || !this.candidates.has(candidate)) throw new Error('Equipment preparation is no longer available.');
    this.candidates.delete(candidate);
    this.current?.attachments.forEach(({ instance, grip }) => { grip.removeFromParent(); instance.release(); });
    for (const { socket, grip } of candidate.attachments) socket.add(grip);
    this.current = candidate;
  }
  discard(candidate: PreparedEquipment): void {
    if (!this.candidates.delete(candidate)) return;
    candidate.attachments.forEach(({ instance, grip }) => { grip.removeFromParent(); instance.release(); });
  }
  diagnostics() {
    return { loadout: this.current?.loadout ?? null, attachments: this.current?.attachments.map(({ item, socket, grip }) => ({ item, hand: socket.name, position: grip.getWorldPosition(new THREE.Vector3()).toArray() })) ?? [] };
  }
  dispose(): void {
    this.disposed = true;
    for (const candidate of this.candidates) this.discard(candidate);
    this.current?.attachments.forEach(({ instance, grip }) => { grip.removeFromParent(); instance.release(); }); this.current = null;
  }
}
