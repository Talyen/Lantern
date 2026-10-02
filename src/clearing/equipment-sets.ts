import { loadEquipmentMotions, type CombatMotions } from '../animation/combat-animations';
import { basicAbility, type WeaponSet } from '../gameplay/abilities';
import type { ActorTiming } from '../gameplay/encounter';
import type { Loadout } from '../gameplay/equipment';
import { itemLoadout, type InventoryItem } from '../gameplay/inventory';
import type { Equipment, PreparedEquipment } from '../rendering/equipment';
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { installMotions, type Actor } from './actors';

type PreparedSet = { equipment: PreparedEquipment; motions: CombatMotions; loadout: Loadout };

/** Both sets prepare before replacement; inactive attachments remain owned for instant swaps. */
export class EquipmentSets {
  private sets: [PreparedSet, PreparedSet] | undefined;

  constructor(private readonly actor: Actor, private readonly equipment: Equipment, private readonly loader: GLTFLoader, private readonly prepareArrow: () => Promise<void>) {}

  async prepare(items: InventoryItem[], active: WeaponSet): Promise<void> {
    const candidates: PreparedEquipment[] = [];
    let next: [PreparedSet, PreparedSet];
    try {
      const prepare = async (set: WeaponSet): Promise<PreparedSet> => {
        const loadout = itemLoadout(items, set);
        if (loadout.main === 'bow') await this.prepareArrow();
        const equipment = await this.equipment.stage(loadout);
        candidates.push(equipment);
        const motions = await loadEquipmentMotions(this.loader, 'player', loadout);
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
  }

  activate(set: WeaponSet): void {
    const prepared = this.sets?.[set];
    if (!prepared) throw new Error('Weapon set is not prepared.');
    this.equipment.commit(prepared.equipment, true);
    installMotions(this.actor, prepared.motions);
  }

  abilityTimings(): NonNullable<ActorTiming['abilities']> {
    const timings: NonNullable<ActorTiming['abilities']> = {};
    for (const prepared of this.sets ?? []) {
      const basic = basicAbility(prepared.loadout.main);
      if (basic) timings[basic] = { attack: prepared.motions.clips.attack.duration, contacts: prepared.motions.contacts };
      for (const [id, role] of [['sweep', 'sweep'], ['piercing-shot', 'pierce']] as const) {
        const clip = prepared.motions.clips[role], contacts = prepared.motions.skillContacts[role];
        if (clip && contacts) timings[id] = { attack: clip.duration, contacts };
      }
    }
    return timings;
  }
}
