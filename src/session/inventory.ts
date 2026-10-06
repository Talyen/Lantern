import type { GameAudio } from '../audio/audio';
import { removeQuantity, sameEquipment, validItems, type InventoryItem } from '../gameplay/inventory';
import { play, type Actor } from './actors';
import type { EquipmentSets } from './equipment-sets';
import type { WeaponSet } from '../gameplay/abilities';
import type { SessionRuntime } from './runtime';

type InventoryContext = {
  clearInput(): void;
  closed(): boolean;
  updateCharacter(): void;
  syncAdventure(): void;
  presentationFailed(error: unknown): void;
};

/** Stages gear before runtime commit; display failures cannot reject committed items. */
export class InventoryController {
  private preparing = false;
  private pending = new Set<Promise<void>>();
  async dispose(): Promise<void> { await Promise.allSettled([...this.pending]); }
  private track(operation: Promise<void>): Promise<void> {
    this.pending.add(operation);
    void operation.then(() => this.pending.delete(operation), () => this.pending.delete(operation));
    return operation;
  }
  constructor(
    private readonly player: Actor,
    private readonly equipment: Pick<EquipmentSets, 'stage' | 'activate'>,
    private readonly audio: Pick<GameAudio, 'play'>,
    private readonly context: InventoryContext,
    private readonly runtime: SessionRuntime,
  ) {}

  get loading(): boolean { return this.preparing; }
  canEditEquipment(): boolean { return !this.loading && this.runtime.canEditEquipment(); }

  initialize(): Promise<void> { return this.track(this.initializeEquipment()); }
  private async initializeEquipment(): Promise<void> {
    const prepared = await this.equipment.stage(this.runtime.character.items, this.runtime.character.activeSet);
    try {
      if (this.context.closed()) throw new Error('Adventure closed while equipment was preparing.');
      prepared.activate(); this.runtime.syncLoadout(); play(this.player, 'idle'); this.context.updateCharacter();
    } finally { prepared.dispose(); }
  }

  activateSet(set: WeaponSet): void {
    if (this.loading) throw new Error('Character equipment is still loading.');
    if (!this.runtime.activateSet(set)) return;
    this.present(() => { this.context.clearInput(); this.equipment.activate(set); play(this.player, 'idle'); this.context.updateCharacter(); this.audio.play('equip'); });
  }

  private async prepareEquipment(items: InventoryItem[], commit: (expected: readonly InventoryItem[]) => void, cue: 'equip' | 'inventoryDrop'): Promise<void> {
    if (this.loading || !this.player.mixer) throw new Error('Character equipment is still loading.');
    const expected = this.runtime.character.items;
    const activeSet = this.runtime.character.activeSet;
    this.preparing = true;
    try {
      this.context.clearInput();
      const prepared = await this.equipment.stage(items, activeSet);
      try {
        if (this.context.closed()) throw new Error('Adventure closed while equipment was preparing.');
        if (activeSet !== this.runtime.character.activeSet) throw new Error('Weapon set changed while equipment was preparing.');
        commit(expected);
        this.present(() => { prepared.activate(); play(this.player, 'idle'); this.context.updateCharacter(); this.audio.play(cue); this.context.syncAdventure(); });
      } finally { prepared.dispose(); }
    } finally { this.preparing = false; }
  }

  async change(items: InventoryItem[]): Promise<void> {
    if (!validItems(items)) throw new Error('Item does not fit.');
    if (!sameEquipment(items, this.runtime.character.items)) {
      if (!this.canEditEquipment()) throw new Error('Equipment cannot change during combat or an action.');
      await this.track(this.prepareEquipment(items, expected => this.runtime.commitItems(items, expected), 'equip'));
    } else { this.runtime.commitItems(items); this.inventoryChanged(); }
  }
  changeContainers(items: readonly InventoryItem[], stash: readonly InventoryItem[]): void { this.runtime.changeContainers(items, stash); this.inventoryChanged(); }
  transfer(id: string, quantity: number, toStash: boolean, point?: { x: number; y: number }): void { this.runtime.transfer(id, quantity, toStash, point); this.inventoryChanged(); }
  recover(id: string): void { this.runtime.recover(id); this.inventoryChanged(); }

  async drop(id: string, quantity: number): Promise<void> {
    const entry = this.runtime.character.items.find(item => item.id === id);
    if (!entry) throw new Error('Item is no longer available.');
    if (entry.slot === 'bag' || entry.slot === 'overflow') {
      this.runtime.drop(id, quantity);
      this.present(() => { this.context.updateCharacter(); this.audio.play('inventoryDrop'); this.context.syncAdventure(); });
    } else {
      if (!this.canEditEquipment()) throw new Error('Equipment cannot change during combat or an action.');
      const items = removeQuantity(this.runtime.character.items, id, quantity);
      await this.track(this.prepareEquipment(items, expected => this.runtime.drop(id, quantity, expected), 'inventoryDrop'));
    }
  }

  private inventoryChanged(): void { this.present(() => { this.context.updateCharacter(); this.audio.play('inventoryMove'); }); }
  private present(feedback: () => void): void {
    try { feedback(); } catch (error) { this.context.presentationFailed(error); }
  }
}
