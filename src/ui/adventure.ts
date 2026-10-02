import { bindMenuDismissal } from './menu';
import type { CharacterSave } from '../gameplay/adventure';
import { emptyPosition, equipInstance, lootDefinitions, moveItem, sortedItems, type InventoryItem } from '../gameplay/inventory';
import { itemIcon } from './item-icons';

export type TravelChoice = { name: string; available: boolean; travel(): void };
export type InventoryMenuContext = { change(items: InventoryItem[]): Promise<void>; drop(id: string, quantity: number): Promise<void>; recover(id: string): void; newId(): string };
type Drag = { id: string; quantity: number; startX: number; startY: number; offsetX: number; offsetY: number; active: boolean; carried: boolean };
/** Menus submit complete inventory operations; simulation remains the owner of transfers. */
export class AdventureMenus {
  private inventory = document.getElementById('inventory-dialog') as HTMLDialogElement;
  private travel = document.getElementById('travel-dialog') as HTMLDialogElement;
  private grid = document.getElementById('inventory-grid')!;
  private use = document.getElementById('scroll-use') as HTMLButtonElement;
  private prompt = document.getElementById('interaction-prompt')!;
  private error = document.getElementById('equipment-error')!;
  private detail = document.getElementById('inventory-selection')!;
  private split = document.getElementById('stack-split')!;
  private ghost = document.getElementById('inventory-ghost')!;
  private marker = document.getElementById('inventory-placement')!;
  private character: CharacterSave | null = null;
  private characterKey = '';
  private busy = false;
  private selected: string | null = null;
  private drag: Drag | null = null;
  private splitId: string | null = null;
  constructor(private clearInput: () => void, private focus: () => void, private cast: () => void, private context: InventoryMenuContext, private sound?: (cue: 'menuOpen' | 'menuClose') => void) {
    for (const dialog of [this.inventory, this.travel]) {
      dialog.querySelector('button[data-close]')!.addEventListener('click', () => this.close());
      bindMenuDismissal(dialog, () => this.close());
    }
    this.use.addEventListener('click', () => { if (this.busy || this.drag || !this.character?.scrolls) return; this.close(); this.cast(); });
    document.getElementById('inventory-sort')!.onclick = () => { this.cancelDrag(); void this.perform(() => this.context.change(sortedItems(this.character!.items))); };
    document.getElementById('inventory-equip')!.onclick = () => { const item = this.selectedItem(); if (item) void this.perform(() => this.context.change(equipInstance(this.character!.items, item.id, item.item === 'shield' ? 'off' : 'main'))); };
    document.getElementById('inventory-remove')!.onclick = () => { const item = this.selectedItem(); if (!item) return; void this.perform(() => { const point = emptyPosition(this.character!.items, item.item); if (!point) throw new Error('Inventory full.'); return this.context.change(moveItem(this.character!.items, item.id, point.x, point.y, item.quantity, this.context.newId)); }); };
    document.getElementById('inventory-recover')!.onclick = () => { const item = this.selectedItem(); if (item) void this.perform(() => this.context.recover(item.id)); };
    document.getElementById('inventory-split')!.onclick = () => { const item = this.selectedItem(); if (item) this.openSplit(item); };
    document.getElementById('split-cancel')!.onclick = () => { this.split.hidden = true; this.splitId = null; };
    document.getElementById('split-confirm')!.onclick = () => {
      const entry = this.character?.items.find(i => i.id === this.splitId), input = document.getElementById('split-amount') as HTMLInputElement, quantity = Number(input.value);
      if (!entry || !Number.isSafeInteger(quantity) || quantity < 1 || quantity >= entry.quantity) { input.reportValidity(); return; }
      this.split.hidden = true; this.splitId = null;
      const rect = this.grid.getBoundingClientRect();
      this.drag = { id: entry.id, quantity, startX: rect.left, startY: rect.top, offsetX: 0, offsetY: 0, active: true, carried: true };
      this.showGhost(entry); this.ghost.style.left = `${rect.left}px`; this.ghost.style.top = `${rect.top}px`;
    };
    this.inventory.addEventListener('pointerdown', event => {
      if (event.button !== 0 || this.busy || !this.split.hidden) return;
      if (this.drag?.carried) { event.preventDefault(); event.stopPropagation(); void this.release(event.clientX, event.clientY); return; }
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-instance]'); if (!target) return;
      const entry = this.character?.items.find(i => i.id === target.dataset.instance); if (!entry) return;
      this.selected = entry.id; this.refreshSelection();
      if (event.shiftKey && entry.quantity > 1) { event.preventDefault(); this.openSplit(entry); return; }
      const rect = target.getBoundingClientRect();
      target.setPointerCapture(event.pointerId);
      this.drag = { id: entry.id, quantity: entry.quantity, startX: event.clientX, startY: event.clientY, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, active: false, carried: false };
    });
    window.addEventListener('pointermove', event => {
      const drag = this.drag; if (!drag) return;
      if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 5) {
        drag.active = true; const entry = this.character?.items.find(i => i.id === drag.id); if (entry) this.showGhost(entry);
      }
      if (!drag.active) return;
      this.ghost.style.left = `${event.clientX - drag.offsetX}px`; this.ghost.style.top = `${event.clientY - drag.offsetY}px`;
      this.previewPlacement(event.clientX, event.clientY);
    });
    window.addEventListener('pointerup', event => { if (event.button === 0 && this.drag && !this.drag.carried) void this.release(event.clientX, event.clientY); });
    window.addEventListener('pointercancel', () => this.cancelDrag());
    window.addEventListener('blur', () => this.cancelDrag());
    this.inventory.addEventListener('keydown', event => { if (event.key === 'Escape' && (this.drag || !this.split.hidden)) { event.preventDefault(); event.stopPropagation(); this.cancelDrag(); } });
  }
  get paused(): boolean { return this.inventory.open || this.travel.open; }
  close(): void { if (this.busy) return; if (this.paused) this.sound?.('menuClose'); this.cancelDrag(); this.inventory.close(); this.travel.close(); this.clearInput(); this.focus(); }
  openInventory(): void { this.clearInput(); this.error.textContent = ''; this.inventory.showModal(); this.sound?.('menuOpen'); }
  openTravel(choices: TravelChoice[]): void {
    this.clearInput(); const list = document.getElementById('travel-destinations')!;
    list.replaceChildren(...choices.map(choice => { const button = document.createElement('button'); button.textContent = choice.available ? choice.name : `${choice.name} · Enemies nearby`; button.disabled = !choice.available; button.onclick = () => { this.close(); choice.travel(); }; return button; }));
    if (!choices.length) list.textContent = 'No destinations available.'; this.travel.showModal(); this.sound?.('menuOpen');
  }
  update(scrolls: number, canUse: boolean, prompt: string, casting: number): void {
    document.getElementById('scroll-count')!.textContent = String(scrolls); this.use.disabled = !canUse || this.busy;
    this.prompt.textContent = casting > 0 ? `Scroll of Return · ${casting.toFixed(1)}s` : prompt;
  }
  updateCharacter(character: CharacterSave): void {
    const key = JSON.stringify(character); if (key === this.characterKey) return;
    this.characterKey = key; this.character = character; this.refresh();
  }
  private button(entry: InventoryItem): HTMLButtonElement {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'bag-item'; button.dataset.instance = entry.id;
    const definition = lootDefinitions[entry.item]; button.setAttribute('aria-label', `${definition.name}${definition.stackable ? `, ${entry.quantity}` : ''}`);
    button.title = definition.name; button.innerHTML = `${itemIcon(entry.item)}${entry.slot === 'main' || entry.slot === 'off' ? `<span class="equip-name">${definition.name}</span>` : ''}${definition.stackable ? `<span class="stack-count">${entry.quantity}</span>` : ''}`;
    button.onclick = () => { this.selected = entry.id; this.refreshSelection(); };
    button.ondblclick = () => { if (!definition.stackable && entry.slot === 'bag') void this.perform(() => this.context.change(equipInstance(this.character!.items, entry.id, entry.item === 'shield' ? 'off' : 'main'))); };
    button.disabled = this.busy; return button;
  }
  private refresh(): void {
    const character = this.character; if (!character) return;
    this.grid.querySelectorAll('[data-instance]').forEach(el => el.remove());
    for (const entry of character.items.filter(i => i.slot === 'bag')) {
      const button = this.button(entry), definition = lootDefinitions[entry.item];
      Object.assign(button.style, { gridColumn: `${entry.x + 1} / span ${definition.width}`, gridRow: `${entry.y + 1} / span ${definition.height}` }); this.grid.append(button);
    }
    for (const slot of ['main', 'off'] as const) {
      const host = document.getElementById(`equipment-${slot}`)!; host.replaceChildren();
      const entry = character.items.find(i => i.slot === slot);
      if (entry) host.append(this.button(entry));
      else host.textContent = slot === 'off' && ['bow', 'staff'].includes(character.loadout.main ?? '') ? 'Two-handed' : 'Empty';
    }
    const overflow = document.getElementById('inventory-overflow')!; overflow.replaceChildren();
    const pending = character.items.filter(i => i.slot === 'overflow'); overflow.hidden = !pending.length;
    if (pending.length) { const title = document.createElement('span'); title.textContent = 'Unpacked items'; overflow.append(title); for (const entry of pending) overflow.append(this.button(entry)); }
    document.getElementById('woodcutting-xp')!.textContent = `${character.xp.woodcutting} XP`;
    document.getElementById('axe-combat-xp')!.textContent = `${character.xp.axeCombat} XP`;
    (document.getElementById('inventory-sort') as HTMLButtonElement).disabled = this.busy;
    this.inventory.setAttribute('aria-busy', String(this.busy)); this.refreshSelection();
  }
  private selectedItem(): InventoryItem | undefined { return this.character?.items.find(i => i.id === this.selected); }
  private refreshSelection(): void {
    const entry = this.selectedItem(); this.detail.textContent = entry ? `${lootDefinitions[entry.item].name}${lootDefinitions[entry.item].stackable ? ` · ${entry.quantity}` : ''}` : '';
    for (const [id, visible] of [['inventory-equip', entry?.slot === 'bag' && !lootDefinitions[entry.item].stackable], ['inventory-remove', entry?.slot === 'main' || entry?.slot === 'off'], ['inventory-recover', entry?.slot === 'overflow'], ['inventory-split', entry && entry.quantity > 1]] as const) {
      const button = document.getElementById(id) as HTMLButtonElement; button.hidden = !visible; button.disabled = this.busy;
    }
    this.inventory.querySelectorAll<HTMLElement>('[data-instance]').forEach(el => el.classList.toggle('selected', el.dataset.instance === this.selected));
  }
  private openSplit(entry: InventoryItem): void {
    this.cancelDrag(); this.splitId = entry.id; this.split.hidden = false;
    const input = document.getElementById('split-amount') as HTMLInputElement; input.max = String(Math.min(99, entry.quantity - 1)); input.value = String(Math.min(99, Math.floor(entry.quantity / 2))); input.focus(); input.select();
  }
  private showGhost(entry: InventoryItem): void {
    const cell = this.grid.getBoundingClientRect().width / 12, definition = lootDefinitions[entry.item];
    this.ghost.innerHTML = `${itemIcon(entry.item)}<span class="stack-count">${this.drag!.quantity > 1 ? this.drag!.quantity : ''}</span>`;
    this.ghost.style.width = `${cell * definition.width}px`; this.ghost.style.height = `${cell * definition.height}px`; this.ghost.hidden = false;
  }
  private destination(x: number, y: number): { x: number; y: number } {
    const rect = this.grid.getBoundingClientRect(), cell = rect.width / 12;
    return { x: Math.floor((x - (this.drag?.offsetX ?? 0) - rect.left + cell * .3) / cell), y: Math.floor((y - (this.drag?.offsetY ?? 0) - rect.top + cell * .3) / cell) };
  }
  private previewPlacement(x: number, y: number): void {
    const entry = this.character?.items.find(i => i.id === this.drag?.id); if (!entry) return;
    const point = this.destination(x, y), definition = lootDefinitions[entry.item];
    Object.assign(this.marker.style, { gridColumn: `${Math.max(0, point.x) + 1} / span ${definition.width}`, gridRow: `${Math.max(0, point.y) + 1} / span ${definition.height}` });
    const rect = this.grid.getBoundingClientRect(); this.marker.hidden = x < rect.left || x > rect.right || y < rect.top || y > rect.bottom || point.x < 0 || point.y < 0 || point.x + definition.width > 12 || point.y + definition.height > 8;
    try { moveItem(this.character!.items, entry.id, point.x, point.y, this.drag!.quantity, () => 'preview'); this.marker.dataset.valid = 'true'; } catch { this.marker.dataset.valid = 'false'; }
  }
  private async release(x: number, y: number): Promise<void> {
    const drag = this.drag; if (!drag) return;
    const point = this.destination(x, y), entry = this.character?.items.find(i => i.id === drag.id), active = drag.active;
    this.cancelDrag(); if (!active || !entry) return;
    const panel = this.inventory.getBoundingClientRect();
    await this.perform(() => {
      if (x < panel.left || x > panel.right || y < panel.top || y > panel.bottom) return this.context.drop(entry.id, drag.quantity);
      const slot = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-equipment-slot]')?.dataset.equipmentSlot;
      if (slot === 'main' || slot === 'off') return this.context.change(equipInstance(this.character!.items, entry.id, slot));
      const rect = this.grid.getBoundingClientRect(); if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) throw new Error('Item does not fit.');
      return this.context.change(moveItem(this.character!.items, entry.id, point.x, point.y, drag.quantity, this.context.newId));
    });
  }
  private cancelDrag(): void { this.drag = null; this.ghost.hidden = true; this.marker.hidden = true; this.split.hidden = true; this.splitId = null; }
  private async perform(operation: () => Promise<void> | void): Promise<void> {
    if (this.busy || !this.character) return; this.busy = true; this.error.textContent = ''; this.refresh();
    try { await operation(); }
    catch (error) { this.error.textContent = error instanceof Error ? error.message : 'Unable to move item.'; }
    finally { this.busy = false; this.refresh(); }
  }
}
