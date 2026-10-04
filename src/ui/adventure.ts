import { bindMenuDismissal } from './menu';
import { InventoryPanel, type InventoryContext } from './inventory-panel';
import type { CharacterSave } from '../gameplay/character';
import { lootDefinitions } from '../gameplay/inventory';
import { canRepairShelter, shelterMaterials } from '../gameplay/homestead-transactions';
import { setText } from './dom';

export type TravelChoice = { name: string; travel(): void };
export type InventoryMenuContext = InventoryContext & { repair(): Promise<void> };

/** Adventure menus share input/pause ownership, while Inventory owns its presentation. */
export class AdventureMenus {
  private panel: InventoryPanel;
  private repair = document.getElementById('repair-dialog') as HTMLDialogElement;
  private travel = document.getElementById('travel-dialog') as HTMLDialogElement;
  private prompt = document.getElementById('interaction-prompt')!;
  private character: CharacterSave | null = null;
  private repairing = false;
  constructor(private clearInput: () => void, private focus: () => void, cast: (id: string) => void,
    private context: InventoryMenuContext, private sound?: (cue: 'menuOpen' | 'menuClose') => void) {
    this.panel = new InventoryPanel(context, clearInput, focus, cast, sound);
    for (const dialog of [this.travel, this.repair]) {
      dialog.querySelector<HTMLButtonElement>('[data-close]')!.onclick = () => this.close();
      bindMenuDismissal(dialog, () => this.close());
    }
    this.travel.onkeydown = event => {
      if (['Enter', ' '].includes(event.key) && event.repeat) { event.preventDefault(); return; }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault(); event.stopPropagation();
      const buttons = Array.from(this.travel.querySelectorAll<HTMLButtonElement>('#travel-destinations button'));
      if (!buttons.length) return;
      const current = buttons.findIndex(button => button === document.activeElement);
      const next = current < 0 ? (event.key === 'ArrowDown' ? 0 : buttons.length - 1)
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus();
    };
    document.getElementById('shelter-repair')!.onclick = async () => {
      if (this.repairing) return;
      this.repairing = true; this.refreshRepair(); document.getElementById('repair-error')!.textContent = '';
      try { await this.context.repair(); this.repairing = false; this.close(); }
      catch (error) { document.getElementById('repair-error')!.textContent = error instanceof Error ? error.message : 'Unable to repair shelter.'; }
      finally { this.repairing = false; this.refreshRepair(); }
    };
  }
  dispose(): void { this.panel.dispose(); this.travel.close(); this.repair.close(); }
  get paused(): boolean { return this.panel.open || this.repair.open || this.travel.open; }
  close(): void {
    if (this.repairing) return;
    this.panel.close();
    if (this.repair.open || this.travel.open) { this.sound?.('menuClose'); this.repair.close(); this.travel.close(); this.clearInput(); this.focus(); }
  }
  openInventory(stash = false): void { this.panel.openInventory(stash); }
  openRepair(): void {
    this.clearInput(); this.refreshRepair(); document.getElementById('repair-error')!.textContent = '';
    this.repair.showModal(); this.sound?.('menuOpen');
  }
  openTravel(sourceName: string, choices: TravelChoice[]): void {
    this.clearInput(); const list = document.getElementById('travel-destinations')!;
    setText(document.getElementById('travel-title')!, sourceName);
    let activated = false;
    list.replaceChildren(...choices.map(choice => {
      const button = document.createElement('button'); button.type = 'button';
      const name = document.createElement('span'); name.textContent = choice.name;
      const arrow = document.createElement('span'); arrow.textContent = '›'; arrow.setAttribute('aria-hidden', 'true');
      button.append(name, arrow);
      button.onclick = () => {
        if (activated || !this.travel.open) return;
        activated = true; this.close(); choice.travel();
      };
      return button;
    }));
    if (!choices.length) {
      const empty = document.createElement('p'); empty.textContent = 'No other campfires discovered.'; list.append(empty);
    }
    this.travel.showModal(); this.sound?.('menuOpen');
    list.scrollTop = 0;
    (list.querySelector<HTMLButtonElement>('button') ?? this.travel.querySelector<HTMLButtonElement>('[data-close]'))!.focus();
  }
  update(_scrolls: number, canUse: boolean, prompt: string, casting: number): void {
    this.panel.updateScroll(canUse); setText(this.prompt, casting > 0 ? `Scroll of Return · ${casting.toFixed(1)}s` : prompt);
  }
  updateCharacter(character: CharacterSave): void {
    this.character = character; this.panel.updateCharacter(character); if (this.repair.open) this.refreshRepair();
  }
  private refreshRepair(): void {
    const character = this.character; if (!character) return;
    document.getElementById('repair-materials')!.replaceChildren(...shelterMaterials(character.items).map(({ item, held, cost }) => {
      const row = document.createElement('div'), name = document.createElement('span'), amount = document.createElement('strong');
      name.textContent = lootDefinitions[item].name; amount.textContent = `${held} / ${cost}`; row.dataset.ready = String(held >= cost); row.append(name, amount); return row;
    }));
    (document.getElementById('shelter-repair') as HTMLButtonElement).disabled = this.repairing || !canRepairShelter(character);
  }
}
