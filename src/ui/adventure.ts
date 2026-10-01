import { bindMenuDismissal } from './menu';

export type TravelChoice = { name: string; available: boolean; travel(): void };
/** Compact menus. Coordinator owns travel, casting, pause and save behavior. */
export class AdventureMenus {
  private inventory = document.getElementById('inventory-dialog') as HTMLDialogElement;
  private travel = document.getElementById('travel-dialog') as HTMLDialogElement;
  private count = document.getElementById('scroll-count')!;
  private use = document.getElementById('scroll-use') as HTMLButtonElement;
  private prompt = document.getElementById('interaction-prompt')!;
  constructor(private clearInput: () => void, private focus: () => void, private cast: () => void) {
    for (const dialog of [this.inventory, this.travel]) {
      dialog.querySelector('button[data-close]')!.addEventListener('click', () => this.close());
      bindMenuDismissal(dialog, () => this.close());
    }
    this.use.addEventListener('click', () => { this.close(); this.cast(); });
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
}
