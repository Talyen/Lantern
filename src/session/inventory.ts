import type { GameAudio } from '../audio/audio';
import type { Adventure } from '../gameplay/adventure';
import type { CharacterSave } from '../gameplay/character';
import { inCombat, type Encounter } from '../gameplay/encounter';
import {
  removeQuantity, sameEquipment, validItems,
  type InventoryItem,
} from '../gameplay/inventory';
import { play, type Actor } from './actors';
import type { EquipmentSets } from './equipment-sets';
import type { WeaponSet } from '../gameplay/abilities';

type InventoryContext = {
  clearInput(): void;
  equipmentBlocked(): boolean;
  updateCharacter(character: CharacterSave): void;
  syncAdventure(): void;
};

/** Commits inventory only after compatible equipment and motions are ready. */
export class InventoryController {
  private preparing = false;

  constructor(
    private readonly adventure: Adventure,
    private readonly encounter: Encounter,
    private readonly player: Actor,
    private readonly equipment: Pick<EquipmentSets, 'prepare' | 'activate'>,
    private readonly audio: Pick<GameAudio, 'play'>,
    private readonly context: InventoryContext,
  ) {}

  get loading(): boolean { return this.preparing; }

  canEditEquipment(): boolean {
    const { player, phase, dodgeRemaining } = this.encounter;
    return phase !== 'loading' && player.hp > 0 && !inCombat(this.encounter) &&
      player.lock === 0 && dodgeRemaining === 0 && !this.loading && !this.context.equipmentBlocked();
  }

  async initialize(): Promise<void> {
    await this.prepareEquipment(this.adventure.character.items);
  }

  syncLoadout(): void {
    this.adventure.syncLoadout(this.encounter);
  }

  activateSet(set: WeaponSet): void {
    if (set === this.adventure.character.activeSet) return;
    const { player, phase, dodgeRemaining, attackCooldown } = this.encounter;
    if (!['playing', 'won'].includes(phase) || player.hp <= 0 || player.lock > 0 || dodgeRemaining > 0 || attackCooldown > 0 || this.loading || this.context.equipmentBlocked())
      throw new Error('Weapon set cannot change during an action.');
    this.context.clearInput(); this.equipment.activate(set);
    this.encounter.pending = null; this.encounter.blocking = false; this.encounter.player.attackTime = -1;
    this.adventure.setWeaponSet(set); this.syncLoadout(); play(this.player, 'idle');
    this.context.updateCharacter(this.adventure.character); this.audio.play('equip');
  }

  private async prepareEquipment(items: InventoryItem[], commit?: () => void): Promise<void> {
    if (this.loading || !this.player.mixer) throw new Error('Character equipment is still loading.');
    this.preparing = true;
    this.context.clearInput();
    try {
      await this.equipment.prepare(items, this.adventure.character.activeSet);
      commit?.();
      this.syncLoadout();
      play(this.player, 'idle');
      this.context.updateCharacter(this.adventure.character);
      if (commit) this.audio.play('equip');
    } finally {
      this.preparing = false;
    }
  }

  async change(items: InventoryItem[]): Promise<void> {
    if (!validItems(items)) throw new Error('Item does not fit.');
    if (!sameEquipment(items, this.adventure.character.items)) {
      if (!this.canEditEquipment()) throw new Error('Equipment cannot change during combat or an action.');
      await this.prepareEquipment(items, () => this.adventure.replaceItems(items));
    } else {
      this.adventure.replaceItems(items);
      this.inventoryChanged();
    }
  }

  changeContainers(items: InventoryItem[], stash: InventoryItem[]): void {
    this.adventure.replaceContainers(items, stash);
    this.inventoryChanged();
  }

  transfer(id: string, quantity: number, toStash: boolean, point?: { x: number; y: number }): void {
    this.adventure.transferStash(id, quantity, toStash, point);
    this.inventoryChanged();
  }

  recover(id: string): void {
    this.adventure.recoverItem(id);
    this.inventoryChanged();
  }

  async drop(id: string, quantity: number): Promise<void> {
    const entry = this.adventure.character.items.find(item => item.id === id);
    if (!entry) throw new Error('Item is no longer available.');
    const drop = () => {
      const { player } = this.encounter;
      this.adventure.dropItem(id, quantity, [player.x, player.z]);
    };
    if (entry.slot === 'bag' || entry.slot === 'overflow') {
      drop();
      this.context.updateCharacter(this.adventure.character);
    } else {
      if (!this.canEditEquipment()) throw new Error('Equipment cannot change during combat or an action.');
      const items = removeQuantity(this.adventure.character.items, id, quantity);
      await this.prepareEquipment(items, drop);
    }
    this.audio.play('inventoryDrop');
    this.context.syncAdventure();
  }

  private inventoryChanged(): void {
    this.context.updateCharacter(this.adventure.character);
    this.audio.play('inventoryMove');
  }
}
