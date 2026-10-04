import { Object3D } from 'three';
import { loadEquipmentMotions, type CombatMotions } from '../animation/combat-animations';
import { abilities, abilityIds, type WeaponSet } from '../gameplay/abilities';
import type { ActorTiming } from '../gameplay/encounter';
import { weaponFamily, type Loadout } from '../gameplay/equipment';
import { itemLoadout, type InventoryItem } from '../gameplay/inventory';
import type { Equipment, PreparedEquipment } from '../rendering/equipment';
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { installMotions, type Actor } from './actors';

type PreparedSet = { equipment: PreparedEquipment; motions: CombatMotions; loadout: Loadout };

/** Both sets prepare before replacement; inactive attachments remain owned for instant swaps. */
export class EquipmentSets {
  private sets: [PreparedSet, PreparedSet] | undefined;
  private timings: Readonly<NonNullable<ActorTiming['abilities']>> = {};

  constructor(private readonly actor: Actor, private readonly equipment: Equipment, private readonly loader: GLTFLoader, private readonly prepareArrow: () => Promise<void>) {}

  async prepare(items: InventoryItem[], active: WeaponSet): Promise<void> {
    const candidates: PreparedEquipment[] = [];
    let next: [PreparedSet, PreparedSet];
    try {
      const prepare = async (set: WeaponSet): Promise<PreparedSet> => {
        const loadout = itemLoadout(items, set);
        if (weaponFamily(loadout.main) === 'bow') await this.prepareArrow();
        const equipment = await this.equipment.stage(loadout);
        candidates.push(equipment);
        const rig=this.actor.mixer?.getRoot();
        const motions=await loadEquipmentMotions(this.loader,'player',loadout,rig instanceof Object3D ? rig : undefined);
        return { equipment, motions, loadout };
      };
      next = [await prepare(0), await prepare(1)];
      installMotions(this.actor, next[active].motions);
      this.equipment.commit(next[active].equipment, true);
    } catch (error) {
      for (const candidate of candidates) this.equipment.discard(candidate);
      throw error;
    }
    for (const previous of this.sets ?? []) this.equipment.discard(previous.equipment);
    this.sets = next;
    this.refreshTimings();
  }

  activate(set: WeaponSet): void {
    const prepared = this.sets?.[set];
    if (!prepared) throw new Error('Weapon set is not prepared.');
    this.equipment.commit(prepared.equipment, true);
    installMotions(this.actor, prepared.motions);
  }

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
