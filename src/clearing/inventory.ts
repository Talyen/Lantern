import type { GameAudio } from '../audio/audio';
import type { Adventure, CharacterSave } from '../gameplay/adventure';
import { applyEquipment, inCombat, type Encounter } from '../gameplay/encounter';
import {
  lootDefinitions, removeQuantity, sameEquipment, validItems,
  type InventoryItem,
} from '../gameplay/inventory';
import { play, type Actor } from './actors';
import type { EquipmentSets } from './equipment-sets';

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
    private readonly equipment: Pick<EquipmentSets, 'prepare'>,
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
    await this.prepareEquipment(this.adventure.character.items, false);
  }

  syncLoadout(): void {
    const { character } = this.adventure;
    applyEquipment(this.encounter,character.items,character.activeSet);
  }

  private async prepareEquipment(items: InventoryItem[], save: boolean): Promise<void> {
    if (this.loading || !this.player.mixer) throw new Error('Character equipment is still loading.');
    this.preparing = true;
    this.context.clearInput();
    try {
      await this.equipment.prepare(items, this.adventure.character.activeSet);
      if (save) this.adventure.replaceItems(items);
      this.syncLoadout();
      play(this.player, 'idle');
      this.context.updateCharacter(this.adventure.character);
      if (save) this.audio.play('equip');
    } finally {
      this.preparing = false;
    }
  }

  async change(items: InventoryItem[]): Promise<void> {
    if (!validItems(items)) throw new Error('Item does not fit.');
    if (!sameEquipment(items, this.adventure.character.items)) {
      if (!this.canEditEquipment()) throw new Error('Equipment cannot change during combat or an action.');
      await this.prepareEquipment(items, true);
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
    if (entry.slot === 'bag' || entry.slot === 'overflow') {
      const { player } = this.encounter;
      this.adventure.dropItem(id, quantity, [player.x, player.z]);
      this.context.updateCharacter(this.adventure.character);
    } else {
      await this.change(removeQuantity(this.adventure.character.items, id, quantity));
      const { stackable } = lootDefinitions[entry.item];
      const { player } = this.encounter;
      this.adventure.spawnDrop(entry.item, quantity, [player.x, player.z], {
        blocked: stackable,
        instanceId: stackable ? undefined : entry.id,
      });
    }
    this.audio.play('inventoryDrop');
    this.context.syncAdventure();
  }

  private inventoryChanged(): void {
    this.context.updateCharacter(this.adventure.character);
    this.audio.play('inventoryMove');
  }
}
