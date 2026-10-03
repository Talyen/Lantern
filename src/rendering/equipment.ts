import * as THREE from 'three';
import { assetLibrary, type AssetInstance, type AssetLibrary } from '../assets/asset-library';
import { itemDefinitions, normalizeLoadout, weaponFamily, type HandItem, type Loadout } from '../gameplay/equipment';
import { markOutline } from './outlines';

export type PreparedEquipment = { loadout: Loadout; attachments: { item: HandItem; socket: THREE.Object3D; instance: AssetInstance; grip: THREE.Group }[] };

/** Erika's authored bag/arrows are a back accessory, independent of gathering tools. */
export function setCharacterQuiver(actor: THREE.Object3D, visible: boolean): void {
  const quiver = actor.getObjectByName('character-quiver');
  if (quiver) quiver.visible = visible;
}

/** Models prepare off-scene; a failed or superseded load cannot replace a working loadout. */
export class Equipment {
  private current: PreparedEquipment | null = null;
  private candidates = new Set<PreparedEquipment>();
  private disposed = false;
  constructor(private actor: THREE.Group, private rig: 'player' | 'enemy' | 'skeleton' = 'player', private library: AssetLibrary = assetLibrary, private definitions: typeof itemDefinitions = itemDefinitions) {}
  async stage(requested: Loadout): Promise<PreparedEquipment> {
    if (this.disposed) throw new Error('Equipment has been closed.');
    const loadout = normalizeLoadout(requested);
    const items = [loadout.main, loadout.off].filter((item): item is HandItem => item !== null);
    const sockets = items.map(item => {
      const name = this.definitions[item].hand, socket = this.actor.getObjectByName(name);
      if (!socket) throw new Error(`Cannot equip ${this.definitions[item].name}: character hand is unavailable.`);
      return socket;
    });
    const results = await Promise.allSettled(items.map(item => this.library.loadAsset(this.definitions[item].asset)));
    const loaded = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
    const failed = results.find(result => result.status === 'rejected');
    if (failed || this.disposed) {
      loaded.forEach(instance => instance.release());
      throw new Error(failed ? `Unable to equip ${items.map(item => this.definitions[item].name).join(' and ')}. Prepare the selected Synty models and try again.` : 'Equipment has been closed.');
    }
    this.actor.updateMatrixWorld(true);
    let attachments: PreparedEquipment['attachments'];
    try { attachments = loaded.map((instance, index) => {
      const item = items[index], definition = this.definitions[item], socket = sockets[index];
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
  commit(candidate: PreparedEquipment, retain = false): void {
    if (this.disposed || !this.candidates.has(candidate)) throw new Error('Equipment preparation is no longer available.');
    if (this.current===candidate) { this.setVisible(true); return; }
    if (!retain) this.candidates.delete(candidate);
    const previous=this.current;
    previous?.attachments.forEach(({ instance, grip }) => { grip.removeFromParent(); if(!this.candidates.has(previous)) instance.release(); });
    for (const { socket, grip } of candidate.attachments) socket.add(grip);
    this.current = candidate;
    setCharacterQuiver(this.actor, weaponFamily(candidate.loadout.main) === 'bow');
  }
  discard(candidate: PreparedEquipment): void {
    if (!this.candidates.delete(candidate)) return;
    candidate.attachments.forEach(({ instance, grip }) => { grip.removeFromParent(); instance.release(); });
    if(this.current===candidate)this.current=null;
  }
  setVisible(visible: boolean): void { this.current?.attachments.forEach(({grip}) => { grip.visible = visible; }); }
  diagnostics() {
    return { loadout: this.current?.loadout ?? null, quiverVisible: this.actor.getObjectByName('character-quiver')?.visible ?? false, attachments: this.current?.attachments.map(({ item, socket, grip }) => ({ item, hand: socket.name, position: grip.getWorldPosition(new THREE.Vector3()).toArray() })) ?? [] };
  }
  dispose(): void {
    this.disposed = true;
    for (const candidate of this.candidates) this.discard(candidate);
    this.current?.attachments.forEach(({ instance, grip }) => { grip.removeFromParent(); instance.release(); }); this.current = null;
    setCharacterQuiver(this.actor, false);
  }
}
