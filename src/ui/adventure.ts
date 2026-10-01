import { bindMenuDismissal } from './menu';
import type { CharacterSave } from '../gameplay/adventure';
import { equipItem, itemDefinitions, supportsShield, type ItemId, type Loadout } from '../gameplay/equipment';

export type TravelChoice = { name: string; available: boolean; travel(): void };
export type EquipmentMenuContext = { change(loadout: Loadout): Promise<void> };
const itemMarks: Record<ItemId, string> = {
  axe: '<path d="M14 29 21 5M21 5l9 4-3 10-8-4-6 2 2-10z"/>',
  sword: '<path d="m12 29 3-7M9 21l11 4M16 22 23 5l5-2 1 5-10 16M10 30l4 2"/>',
  shield: '<path d="M9 6 20 3l11 3v13c-2 6-6 10-11 13-5-3-9-7-11-13zM20 7v20M12 14h16"/>',
  bow: '<path d="M13 3c21 9 21 21 0 30l10-15zM7 18h25M28 14l5 4-5 4"/>',
  staff: '<path d="m13 32 10-22M23 10l-5-5 6-3 5 5zM19 12l8 3"/>',
};
/** Compact menus. Coordinator owns travel, casting, pause and save behavior. */
export class AdventureMenus {
  private inventory = document.getElementById('inventory-dialog') as HTMLDialogElement;
  private travel = document.getElementById('travel-dialog') as HTMLDialogElement;
  private count = document.getElementById('scroll-count')!;
  private use = document.getElementById('scroll-use') as HTMLButtonElement;
  private prompt = document.getElementById('interaction-prompt')!;
  private character: CharacterSave | null = null;
  private characterKey = '';
  private equipmentBusy = false;
  private equipmentError = document.getElementById('equipment-error')!;
  constructor(private clearInput: () => void, private focus: () => void, private cast: () => void, private equipment?: EquipmentMenuContext) {
    for (const dialog of [this.inventory, this.travel]) {
      dialog.querySelector('button[data-close]')!.addEventListener('click', () => this.close());
      bindMenuDismissal(dialog, () => this.close());
    }
    this.use.addEventListener('click', () => { this.close(); this.cast(); });
    document.getElementById('equipment-main-remove')!.addEventListener('click', () => { if (this.character) void this.changeEquipment({ main: null, off: null }); });
    document.getElementById('equipment-off-remove')!.addEventListener('click', () => { if (this.character) void this.changeEquipment({ ...this.character.loadout, off: null }); });
  }
  get paused(): boolean { return this.inventory.open || this.travel.open; }
  close(): void { this.inventory.close(); this.travel.close(); this.clearInput(); this.focus(); }
  openInventory(): void { this.clearInput(); this.inventory.showModal(); }
  openTravel(choices: TravelChoice[]): void {
    this.clearInput();
    const list = document.getElementById('travel-destinations')!;
    list.replaceChildren(...choices.map(choice => { const button = document.createElement('button'); button.textContent = choice.available ? choice.name : `${choice.name} · Enemies nearby`; button.disabled = !choice.available; button.onclick = () => { this.close(); choice.travel(); }; return button; }));
    if (!choices.length) list.textContent = 'No destinations available.';
    this.travel.showModal();
  }
  update(scrolls: number, canUse: boolean, prompt: string, casting: number): void {
    this.count.textContent = `${scrolls} / 99`; this.use.disabled = !canUse;
    this.prompt.textContent = casting > 0 ? `Scroll of Return · ${casting.toFixed(1)}s` : prompt;
  }
  updateCharacter(character: CharacterSave): void {
    const key = JSON.stringify([character.equipment, character.loadout, character.wood, character.xp]);
    if (key === this.characterKey) return;
    this.characterKey = key; this.character = structuredClone(character); this.refreshEquipment();
  }
  private refreshEquipment(): void {
    const character = this.character; if (!character) return;
    const { loadout } = character;
    document.getElementById('equipment-main')!.textContent = loadout.main ? itemDefinitions[loadout.main].name : 'Empty';
    document.getElementById('equipment-off')!.textContent = loadout.off ? 'Shield' : loadout.main && itemDefinitions[loadout.main].hands === 2 ? 'Two-handed' : 'Empty';
    (document.getElementById('equipment-main-remove') as HTMLButtonElement).disabled = !loadout.main || this.equipmentBusy || !this.equipment;
    (document.getElementById('equipment-off-remove') as HTMLButtonElement).disabled = !loadout.off || this.equipmentBusy || !this.equipment;
    document.getElementById('equipment-items')!.replaceChildren(...character.equipment.map(item => {
      const button = document.createElement('button'), definition = itemDefinitions[item];
      const equipped = loadout.main === item || loadout.off === item;
      button.type = 'button'; button.className = 'equipment-item'; button.dataset.item = item;
      button.setAttribute('aria-pressed', String(equipped));
      button.innerHTML = `<svg viewBox="0 0 40 36" aria-hidden="true">${itemMarks[item]}</svg><span class="equipment-item-name">${definition.name}</span><span class="equipment-item-action">${equipped ? 'Equipped' : 'Equip'}</span>`;
      button.disabled = this.equipmentBusy || !this.equipment || equipped || item === 'shield' && !supportsShield(loadout.main);
      if (item === 'shield' && !supportsShield(loadout.main)) button.title = 'Equip an Axe or Sword first.';
      else if (definition.hands === 2) button.title = 'Uses both hands.';
      button.onclick = () => { if (this.character) void this.changeEquipment(equipItem(this.character.loadout, item)); };
      return button;
    }));
    document.getElementById('wood-count')!.textContent = String(character.wood);
    document.getElementById('woodcutting-xp')!.textContent = `${character.xp.woodcutting} XP`;
    document.getElementById('axe-combat-xp')!.textContent = `${character.xp.axeCombat} XP`;
    this.inventory.setAttribute('aria-busy', String(this.equipmentBusy));
  }
  private async changeEquipment(loadout: Loadout): Promise<void> {
    if (!this.equipment || this.equipmentBusy) return;
    this.equipmentBusy = true; this.equipmentError.textContent = ''; this.refreshEquipment();
    try { await this.equipment.change(loadout); }
    catch (error) { this.equipmentError.textContent = error instanceof Error ? error.message : 'Unable to equip this item. Try again.'; }
    finally { this.equipmentBusy = false; this.refreshEquipment(); }
  }
}
