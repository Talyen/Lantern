import { Object3D } from 'three';
import { loadEquipmentMotions, releaseCombatMotions, type CombatMotions } from '../animation/combat-animations';
import { abilities, abilityIds, type WeaponSet } from '../gameplay/abilities';
import type { ActorTiming } from '../gameplay/encounter';
import { weaponFamily, type Loadout } from '../gameplay/equipment';
import { itemLoadout, type InventoryItem } from '../gameplay/inventory';
import type { Equipment, PreparedEquipment } from '../rendering/equipment';
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { installMotions, type Actor } from './actors';

export type PreparedSets = { activate(): void; dispose(): void };
type PreparedSet = { equipment: PreparedEquipment; motions: CombatMotions; loadout: Loadout };

/** Both sets prepare before replacement; inactive attachments remain owned for instant swaps. */
export class EquipmentSets {
  private sets: [PreparedSet, PreparedSet] | undefined;
  private timings: Readonly<NonNullable<ActorTiming['abilities']>> = {};

  constructor(private readonly actor: Actor, private readonly equipment: Equipment, private readonly loader: GLTFLoader, private readonly prepareArrow: () => Promise<void>) {}

  async stage(items: readonly InventoryItem[], active: WeaponSet): Promise<PreparedSets> {
    const candidates: PreparedEquipment[] = [];
    const motionCandidates: CombatMotions[] = [];
    let next: [PreparedSet, PreparedSet];
    try {
      const prepare = async (set: WeaponSet): Promise<PreparedSet> => {
        const loadout = itemLoadout(items, set);
        if (weaponFamily(loadout.main) === 'bow') await this.prepareArrow();
        const equipment = await this.equipment.stage(loadout);
        candidates.push(equipment);
        const rig=this.actor.mixer?.getRoot();
        const motions=await loadEquipmentMotions(this.loader,'player',loadout,rig instanceof Object3D ? rig : undefined);
        motionCandidates.push(motions);
        return { equipment, motions, loadout };
      };
      next = [await prepare(0), await prepare(1)];
    } catch (error) {
      for (const candidate of candidates) this.equipment.discard(candidate);
      motionCandidates.forEach(releaseCombatMotions);
      throw error;
    }
    let adopted = false, disposed = false;
    return {
      activate: () => {
        if (disposed) throw new Error('Prepared equipment was released.');
        if (adopted) return;
        // Retain the new sets even if activation fails: recovery must use committed gear.
        const previous = this.sets;
        this.sets = next; adopted = true;
        this.refreshTimings();
        try { this.activate(active); }
        finally { for (const set of previous ?? []) { this.equipment.discard(set.equipment); releaseCombatMotions(set.motions); } }
      },
      dispose: () => {
        if (adopted || disposed) return;
        disposed = true;
        for (const set of next) { this.equipment.discard(set.equipment); releaseCombatMotions(set.motions); }
      },
    };
  }

  activate(set: WeaponSet): void {
    const prepared = this.sets?.[set];
    if (!prepared) throw new Error('Weapon set is not prepared.');
    this.equipment.commit(prepared.equipment, true);
    installMotions(this.actor, prepared.motions);
  }
  dispose(): void { for (const set of this.sets ?? []) { this.equipment.discard(set.equipment); releaseCombatMotions(set.motions); } this.sets = undefined; }

  abilityTimings(): Readonly<NonNullable<ActorTiming['abilities']>> {
    // Simulation reads these values; only replacing prepared sets changes them.
    return this.timings;
  }

  private refreshTimings(): void {
    const timings: NonNullable<ActorTiming['abilities']> = {};
    for (const prepared of this.sets ?? []) {
      const family = weaponFamily(prepared.loadout.main);
      for (const id of abilityIds) {
        const definition=abilities[id];
        if (definition.family!==family) continue;
        const role=definition.motion;
        const clip=prepared.motions.clips[role], contacts=role==='attack' ? prepared.motions.contacts : prepared.motions.skillContacts[role];
        if (clip && (contacts || id==='berserking')) timings[id]={attack:clip.duration,contacts:contacts ?? []};
      }
    }
    this.timings = timings;
  }
}
