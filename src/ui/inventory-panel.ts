import type { CharacterSave } from '../gameplay/character';
import type { WeaponSet } from '../gameplay/abilities';
import { equipmentCatalog, isEquipmentSlot, isItemId, supportsShield, type EquipmentSlot } from '../gameplay/equipment';
import { bagWidth, bagHeight, emptyPosition, equipInstance, lootDefinitions, moveItem, sortedItems, transferItem, itemLoadout, stackLimit, type InventoryItem } from '../gameplay/inventory';
import { renderItemProperties } from './equipment-details';
import { itemIcon } from './item-icons';
import { inventoryArt } from './inventory-art';
import { inventoryGlyph, paperDoll } from './inventory-illustration';
import { bindMenuDismissal } from './menu';
import { placeInventoryItem } from './inventory-item';
import './inventory.css';

export type InventoryContext = {
  change(items: InventoryItem[]): Promise<void>;
  changeContainers(items: InventoryItem[], stash: InventoryItem[]): void;
  transfer(id: string, quantity: number, toStash: boolean, point?: { x: number; y: number }): void;
  drop(id: string, quantity: number): Promise<void>;
  recover(id: string): void;
  newId(this: void): string;
  activateSet(set: WeaponSet): void;
  potion(id: string): void;
  canEquip(): boolean;
};
type Container = 'bag' | 'stash';
type Drag = { id: string; container: Container; quantity: number; x: number; y: number; offsetX: number; offsetY: number; active: boolean; carried: boolean; pointer?: number };
const slots: { id: EquipmentSlot; name: string; glyph: InventoryItem['item']; width: number; height: number }[] = [
  { id: 'helmet', name: 'Helmet', glyph: 'guard-helm', width: 2, height: 2 },
  { id: 'amulet', name: 'Amulet', glyph: 'amber-amulet', width: 1, height: 1 },
  { id: 'main', name: 'Main hand', glyph: 'sword', width: 2, height: 4 },
  { id: 'body', name: 'Body', glyph: 'weathered-mail', width: 2, height: 4 },
  { id: 'off', name: 'Off hand', glyph: 'shield', width: 2, height: 4 },
  { id: 'gloves', name: 'Gloves', glyph: 'duelist-gloves', width: 2, height: 2 },
  { id: 'belt', name: 'Belt', glyph: 'leather-belt', width: 2, height: 1 },
  { id: 'ring-left', name: 'Left ring', glyph: 'iron-signet', width: 1, height: 1 },
  { id: 'boots', name: 'Boots', glyph: 'trail-boots', width: 2, height: 2 },
  { id: 'ring-right', name: 'Right ring', glyph: 'hearth-ring', width: 1, height: 1 },
];

/** Real inventory operations; no selected-item state or presentation-owned save data. */
export class InventoryPanel {
  readonly dialog = document.getElementById('inventory-dialog') as HTMLDialogElement;
  private character: CharacterSave | null = null;
  private key = '';
  private viewSet: WeaponSet = 0;
  private stashMode = false;
  private busy = false;
  private scrollReady = false;
  private drag: Drag | null = null;
  private splitId: string | null = null;
  private pointer = { x: 0, y: 0 };
  private grid: HTMLElement;
  private stashGrid: HTMLElement;
  private ghost: HTMLElement;
  private marker: HTMLElement;
  private tooltip: HTMLElement;
  private error: HTMLElement;
  private split: HTMLElement;

  constructor(private ctx: InventoryContext, private clear: () => void, private focus: () => void,
    private cast: (id: string) => void, private sound?: (cue: 'menuOpen' | 'menuClose') => void) {
    this.dialog.className = 'inventory-panel';
    this.dialog.innerHTML = `<header class="inv-toolbar"><div class="inv-toolbar-left"><nav class="inv-sets" aria-label="Weapon sets"></nav><nav class="inv-stash-tools" aria-label="Stash tools" hidden><button type="button" data-sort="stash" aria-label="Sort stash" title="Sort stash">${inventoryGlyph('sort')}<span class="inv-sort-badge">${inventoryGlyph('stash')}</span></button></nav></div>
      <h2 id="inventory-title">Inventory</h2><div class="inv-tools"><button type="button" data-sort="bag" aria-label="Sort bag" title="Sort bag">${inventoryGlyph('sort')}<span class="inv-sort-badge">${inventoryGlyph('bag')}</span></button><button type="button" data-close aria-label="Close inventory" title="Close">${inventoryGlyph('close')}</button></div></header>
      <div class="inv-layout"><section class="inv-equipment" aria-label="Equipment">${paperDoll}<div class="inv-equipment-grid"></div></section>
      <section class="inv-stash-pane" aria-label="Stash" hidden><div class="inv-grid-scroll"><div id="stash-grid" class="inv-grid" aria-label="Stash"></div></div></section>
      <section class="inv-bag-pane" aria-label="Bag"><div class="inv-grid-scroll"><div id="inventory-grid" class="inv-grid" aria-label="Bag"><div class="inv-placement" hidden></div></div></div><div class="inv-overflow" aria-label="Unpacked items" hidden></div></section></div>
      <p class="inv-error" role="status"></p><div class="inv-tooltip" id="inventory-tooltip" role="tooltip" hidden></div><div class="inv-ghost inv-item" aria-hidden="true" hidden></div>
      <div class="inv-split" hidden><label>Split stack<input type="number" min="1" step="1" aria-label="Quantity"></label><div><button type="button" data-cancel aria-label="Cancel split">${inventoryGlyph('close')}</button><button type="button" data-confirm aria-label="Split stack">${inventoryGlyph('check')}</button></div></div>`;
    const el = (selector: string) => this.dialog.querySelector<HTMLElement>(selector)!;
    this.grid = el('#inventory-grid'); this.stashGrid = el('#stash-grid'); this.ghost = el('.inv-ghost'); this.marker = el('.inv-placement');
    this.tooltip = el('.inv-tooltip'); this.error = el('.inv-error'); this.split = el('.inv-split');
    for (const slot of slots) {
      const host = document.createElement('div'); host.className = 'inv-slot'; host.dataset.equipmentSlot = slot.id;
      host.setAttribute('role', 'group'); host.setAttribute('aria-label', slot.name);
      host.style.setProperty('--slot-w', String(slot.width)); host.style.setProperty('--slot-h', String(slot.height));
      el('.inv-equipment-grid').append(host);
    }
    for (const set of [0, 1] as const) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.set = String(set);
      button.onclick = () => { this.cancelDrag(); void this.perform(() => { this.ctx.activateSet(set); this.viewSet = set; }); };
      el('.inv-sets').append(button);
    }
    el('[data-close]').onclick = () => this.close(); bindMenuDismissal(this.dialog, () => this.close());
    this.dialog.querySelectorAll<HTMLButtonElement>('[data-sort]').forEach(button => {
      button.onclick = () => { this.cancelDrag(); void this.perform(() => {
        const container = button.dataset.sort as Container, next = sortedItems(this.contents(container));
        return container === 'stash' ? this.ctx.changeContainers(this.character!.items, next) : this.ctx.change(next);
      }); };
    });
    el('[data-cancel]').onclick = () => this.cancelDrag(); el('[data-confirm]').onclick = () => this.confirmSplit();
    this.dialog.addEventListener('contextmenu', event => {
      event.preventDefault(); event.stopPropagation();
      if (this.drag) { this.cancelDrag(); return; }
      const entry = this.entry((event.target as Element).closest<HTMLElement>('[data-instance]')?.dataset.instance);
      if (entry && !this.drag && this.split.hidden) void this.primary(entry);
    });
    this.dialog.addEventListener('pointerdown', event => this.pointerDown(event));
    this.dialog.addEventListener('pointerover', event => this.showTooltip((event.target as Element).closest<HTMLElement>('[data-instance],[data-empty]')));
    this.dialog.addEventListener('pointerout', event => {
      const next = event.relatedTarget instanceof Element ? event.relatedTarget.closest('[data-instance],[data-empty]') : null;
      if (!next) this.hideTooltip();
    });
    this.dialog.addEventListener('focusin', event => this.showTooltip((event.target as Element).closest<HTMLElement>('[data-instance],[data-empty]')));
    this.dialog.addEventListener('focusout', () => this.hideTooltip());
    this.dialog.addEventListener('scroll', () => this.hideTooltip(), true);
    this.dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape' && (this.drag || !this.split.hidden)) { event.preventDefault(); event.stopPropagation(); this.cancelDrag(); return; }
      if (this.drag?.carried) {
        if (event.key === ' ') { event.preventDefault(); event.stopPropagation(); if (!event.repeat) this.cancelDrag(); return; }
        if (event.key === 'Enter') {
          event.preventDefault(); event.stopPropagation(); if (event.repeat) return;
          const slot = (event.target as Element).closest<HTMLElement>('[data-equipment-slot]');
          const target = (event.target as HTMLElement).dataset.instance;
          const rect = slot && target !== this.drag.id ? slot.getBoundingClientRect() : null;
          void this.release(rect ? rect.left + rect.width / 2 : this.pointer.x, rect ? rect.top + rect.height / 2 : this.pointer.y); return;
        }
        const delta: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (delta[event.key]) {
          event.preventDefault(); event.stopPropagation(); const cell = this.grid.clientWidth / bagWidth;
          this.pointer.x += delta[event.key][0] * cell; this.pointer.y += delta[event.key][1] * cell;
          this.ghost.style.left = `${this.pointer.x - this.drag.offsetX}px`; this.ghost.style.top = `${this.pointer.y - this.drag.offsetY}px`;
          this.previewPlacement(this.pointer.x, this.pointer.y); return;
        }
      }
      const entry = this.entry((event.target as Element).closest<HTMLElement>('[data-instance]')?.dataset.instance);
      if (!entry || this.busy || !this.split.hidden) return;
      if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); if (!event.repeat) void this.primary(entry); }
      else if (event.key === ' ' && !event.repeat) {
        event.preventDefault(); event.stopPropagation();
        if (event.shiftKey && entry.quantity > 1) this.openSplit(entry);
        else {
          const grid = this.source(entry.id) === 'stash' ? this.stashGrid : this.grid, rect = grid.getBoundingClientRect(), cell = grid.clientWidth / bagWidth;
          const point = entry.slot === 'bag' ? entry : emptyPosition(this.character!.items, entry.item) ?? { x: 0, y: 0 };
          this.pointer = { x: rect.left + grid.clientLeft + (point.x + .5) * cell, y: rect.top + grid.clientTop + (point.y + .5) * cell };
          this.drag = { id: entry.id, container: this.source(entry.id), quantity: entry.quantity, x: this.pointer.x, y: this.pointer.y, offsetX: cell / 2, offsetY: cell / 2, active: true, carried: true };
          this.showGhost(); this.ghost.style.left = `${this.pointer.x - cell / 2}px`; this.ghost.style.top = `${this.pointer.y - cell / 2}px`; this.previewPlacement(this.pointer.x, this.pointer.y);
        }
      }
    });
    window.addEventListener('pointermove', event => this.pointerMove(event));
    window.addEventListener('pointerup', event => { if (event.button === 0 && this.drag && !this.drag.carried && this.drag.pointer === event.pointerId) void this.release(event.clientX, event.clientY); });
    window.addEventListener('pointercancel', event => { if (this.drag?.carried || this.drag?.pointer === event.pointerId) this.cancelDrag(); });
    window.addEventListener('blur', () => this.cancelDrag());
    window.addEventListener('resize', () => { this.cancelDrag(); this.hideTooltip(); });
  }

  get open(): boolean { return this.dialog.open; }
  openInventory(stash = false): void {
    this.clear(); this.stashMode = stash; this.dialog.classList.toggle('with-stash', stash); this.viewSet = this.character?.activeSet ?? 0;
    this.error.textContent = ''; this.refresh(); this.dialog.showModal(); this.sound?.('menuOpen');
  }
  close(): void {
    if (this.busy || !this.open) return;
    this.cancelDrag(); this.dialog.close(); this.stashMode = false; this.clear(); this.focus(); this.sound?.('menuClose');
  }
  updateScroll(canUse: boolean): void { this.scrollReady = canUse; }
  updateCharacter(character: CharacterSave): void {
    this.character = character;
    if (!this.open) return;
    const key = JSON.stringify([character.items, character.stash, character.activeSet]);
    if (key !== this.key) this.refresh();
  }
  private contents(container: Container): InventoryItem[] { return container === 'stash' ? this.character!.stash : this.character!.items; }
  private entries(): InventoryItem[] { return this.character ? [...this.character.items, ...(this.stashMode ? this.character.stash : [])] : []; }
  private entry(id?: string): InventoryItem | undefined { return this.entries().find(item => item.id === id); }
  private source(id: string): Container { return this.character?.stash.some(item => item.id === id) ? 'stash' : 'bag'; }

  private button(entry: InventoryItem): HTMLButtonElement {
    const button = document.createElement('button'), definition = lootDefinitions[entry.item];
    button.type = 'button'; button.className = 'inv-item'; button.dataset.instance = entry.id;
    button.setAttribute('aria-label', `${definition.name}${definition.stackable ? `, ${entry.quantity}` : ''}`);
    button.style.setProperty('--item-w', String(definition.width)); button.style.setProperty('--item-h', String(definition.height));
    button.innerHTML = inventoryArt(entry.item) + (definition.stackable ? `<span class="inv-count">${entry.quantity}</span>` : '');
    button.disabled = this.busy;
    return button;
  }
  private refresh(): void {
    if (!this.character) return;
    const focused = this.dialog.contains(document.activeElement) ? (document.activeElement as HTMLElement)?.dataset.instance : undefined;
    this.key = JSON.stringify([this.character.items, this.character.stash, this.character.activeSet]);
    this.hideTooltip();
    for (const [grid, container] of [[this.grid, 'bag'], [this.stashGrid, 'stash']] as const) {
      grid.querySelectorAll('[data-instance]').forEach(item => item.remove());
      for (const entry of this.contents(container).filter(item => item.slot === 'bag')) {
        const button = this.button(entry); placeInventoryItem(button, entry); grid.append(button);
      }
    }
    for (const slot of slots) {
      const host = this.dialog.querySelector<HTMLElement>(`[data-equipment-slot="${slot.id}"]`)!;
      const entry = this.character.items.find(item => item.slot === slot.id && (!['main', 'off'].includes(slot.id) || (item.weaponSet ?? 0) === this.viewSet));
      host.replaceChildren(); host.classList.toggle('inv-occupied', !!entry);
      const blocked = slot.id === 'off' && !!itemLoadout(this.character.items, this.viewSet).main && !supportsShield(itemLoadout(this.character.items, this.viewSet).main);
      host.classList.toggle('inv-blocked', blocked);
      if (entry) host.append(this.button(entry));
      else {
        const empty = document.createElement('button'); empty.type = 'button'; empty.className = 'inv-empty'; empty.dataset.empty = blocked ? 'Two-handed weapon' : slot.name;
        empty.setAttribute('aria-label', `${slot.name}${blocked ? ', two-handed weapon' : ', empty'}`); empty.innerHTML = itemIcon(slot.glyph); host.append(empty);
      }
    }
    this.dialog.querySelectorAll<HTMLButtonElement>('[data-set]').forEach(button => {
      const set = Number(button.dataset.set) as WeaponSet, main = itemLoadout(this.character!.items, set).main;
      button.innerHTML = itemIcon(main ?? 'sword'); button.innerHTML += `<small>${set === 0 ? 'I' : 'II'}</small>`;
      button.dataset.emptySet = String(!main);
      button.setAttribute('aria-label', `Weapon set ${set === 0 ? 'I' : 'II'}${main ? `, ${lootDefinitions[main].name}` : ', empty'}`);
      button.title = button.getAttribute('aria-label')!;
      button.setAttribute('aria-pressed', String(set === this.viewSet)); button.disabled = this.busy;
    });
    this.dialog.querySelector<HTMLElement>('.inv-stash-pane')!.hidden = !this.stashMode;
    this.dialog.querySelector<HTMLElement>('.inv-equipment')!.hidden = this.stashMode;
    this.dialog.querySelector<HTMLElement>('.inv-sets')!.hidden = this.stashMode;
    this.dialog.querySelector<HTMLElement>('.inv-stash-tools')!.hidden = !this.stashMode;
    this.dialog.querySelector<HTMLElement>('#inventory-title')!.textContent = this.stashMode ? 'Stash' : 'Inventory';
    this.dialog.querySelector<HTMLElement>('[data-close]')!.setAttribute('aria-label', this.stashMode ? 'Close stash' : 'Close inventory');
    const overflow = this.dialog.querySelector<HTMLElement>('.inv-overflow')!;
    const pending = this.character.items.filter(item => item.slot === 'overflow'); overflow.replaceChildren(...pending.map(entry => this.button(entry))); overflow.hidden = !pending.length;
    this.dialog.setAttribute('aria-busy', String(this.busy));
    if (focused) this.dialog.querySelector<HTMLButtonElement>(`[data-instance="${CSS.escape(focused)}"]`)?.focus();
  }
  private destinationSlot(entry: InventoryItem): EquipmentSlot {
    if (!isItemId(entry.item)) throw new Error('That item cannot be equipped.');
    const slot = equipmentCatalog[entry.item].slot;
    return slot === 'ring' ? this.character!.items.some(item => item.slot === 'ring-left') && !this.character!.items.some(item => item.slot === 'ring-right') ? 'ring-right' : 'ring-left' : slot;
  }
  private async primary(entry: InventoryItem): Promise<void> {
    if (!this.stashMode && entry.slot === 'bag' && !isItemId(entry.item) && !['potion', 'scroll'].includes(entry.item)) return;
    await this.perform(() => {
      if (entry.slot === 'overflow') return this.ctx.recover(entry.id);
      if (this.source(entry.id) === 'stash' || this.stashMode && entry.slot === 'bag') return this.ctx.transfer(entry.id, entry.quantity, this.source(entry.id) === 'bag');
      if (isEquipmentSlot(entry.slot)) {
        const point = emptyPosition(this.character!.items, entry.item); if (!point) throw new Error('Inventory full.');
        return this.ctx.change(moveItem(this.character!.items, entry.id, point.x, point.y, entry.quantity, this.ctx.newId));
      }
      if (isItemId(entry.item)) return this.ctx.change(equipInstance(this.character!.items, entry.id, this.destinationSlot(entry), this.viewSet));
      if (entry.item === 'potion') return this.ctx.potion(entry.id);
      if (entry.item === 'scroll') {
        if (!this.scrollReady) throw new Error('Return is unavailable here.');
        // Closing before casting allows its gameplay clock to run.
        this.busy = false; this.close(); this.busy = true; this.cast(entry.id);
      }
    });
  }
  private showTooltip(target: HTMLElement | null): void {
    if (!target || this.drag?.active || !this.split.hidden || !this.open) return;
    this.hideTooltip();
    const entry = this.entry(target.dataset.instance); this.tooltip.replaceChildren();
    const name = document.createElement('strong'); name.textContent = entry ? lootDefinitions[entry.item].name : target.dataset.empty ?? '';
    this.tooltip.append(name);
    if (entry) {
      const properties = document.createElement('div'); properties.id = 'inventory-tooltip-properties'; renderItemProperties(properties, entry); this.tooltip.append(properties);
      if (properties.textContent) target.setAttribute('aria-describedby', properties.id);
    }
    this.tooltip.hidden = false;
    const rect = target.getBoundingClientRect(), box = this.tooltip.getBoundingClientRect();
    this.tooltip.style.left = `${Math.max(8, Math.min(innerWidth - box.width - 8, rect.left))}px`;
    this.tooltip.style.top = `${rect.bottom + box.height + 14 < innerHeight ? rect.bottom + 10 : Math.max(8, rect.top - box.height - 10)}px`;
  }
  private hideTooltip(): void { this.tooltip.hidden = true; this.dialog.querySelectorAll('[aria-describedby^="inventory-tooltip"]').forEach(target => target.removeAttribute('aria-describedby')); }
  private pointerDown(event: PointerEvent): void {
    if (event.button !== 0 || this.busy || !this.split.hidden) return;
    if (this.drag && !this.drag.carried && this.drag.pointer !== event.pointerId) return;
    if (this.drag?.carried) { event.preventDefault(); event.stopPropagation(); void this.release(event.clientX, event.clientY); return; }
    const target = (event.target as Element).closest<HTMLElement>('[data-instance]'), entry = this.entry(target?.dataset.instance);
    if (!entry || !target) return;
    if (event.shiftKey && entry.quantity > 1) { event.preventDefault(); this.openSplit(entry); return; }
    const rect = target.getBoundingClientRect(); target.setPointerCapture(event.pointerId);
    this.drag = { id: entry.id, container: this.source(entry.id), quantity: entry.quantity, x: event.clientX, y: event.clientY, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, active: false, carried: false, pointer: event.pointerId };
  }
  private pointerMove(event: PointerEvent): void {
    this.pointer = { x: event.clientX, y: event.clientY };
    const drag = this.drag; if (!drag || !drag.carried && drag.pointer !== event.pointerId) return;
    if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 5) { drag.active = true; this.showGhost(); }
    if (!drag.active) return;
    this.ghost.style.left = `${event.clientX - drag.offsetX}px`; this.ghost.style.top = `${event.clientY - drag.offsetY}px`; this.previewPlacement(event.clientX, event.clientY);
  }
  private showGhost(): void {
    const entry = this.entry(this.drag?.id); if (!entry || !this.drag) return;
    const definition = lootDefinitions[entry.item]; this.hideTooltip(); this.ghost.innerHTML = inventoryArt(entry.item) + (this.drag.quantity > 1 ? `<span class="inv-count">${this.drag.quantity}</span>` : '');
    this.ghost.style.setProperty('--item-w', String(definition.width)); this.ghost.style.setProperty('--item-h', String(definition.height)); this.ghost.hidden = false;
    this.dialog.querySelector(`[data-instance="${CSS.escape(entry.id)}"]`)?.classList.add('inv-carried');
  }
  private targetGrid(x: number, y: number): { grid: HTMLElement; container: Container } | null {
    const target = document.elementFromPoint(x, y)?.closest('.inv-grid');
    if (target === this.grid) return { grid: this.grid, container: 'bag' };
    if (this.stashMode && target === this.stashGrid) return { grid: this.stashGrid, container: 'stash' };
    return null;
  }
  private point(grid: HTMLElement, x: number, y: number): { x: number; y: number } {
    const rect = grid.getBoundingClientRect(), cell = grid.clientWidth / bagWidth;
    return { x: Math.floor((x - (this.drag?.offsetX ?? 0) - rect.left - grid.clientLeft + cell * .3) / cell), y: Math.floor((y - (this.drag?.offsetY ?? 0) - rect.top - grid.clientTop + cell * .3) / cell) };
  }
  private previewPlacement(x: number, y: number): void {
    const entry = this.entry(this.drag?.id), target = this.targetGrid(x, y), point = target ? this.point(target.grid, x, y) : null; this.marker.hidden = !entry || !point;
    this.dialog.querySelectorAll('.inv-drop-target').forEach(el => el.classList.remove('inv-drop-target'));
    const slot = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-equipment-slot]');
    if (slot) {
      slot.classList.add('inv-drop-target');
      try {
        if (!entry || this.drag?.container !== 'bag' || !this.ctx.canEquip()) throw new Error('Unavailable');
        equipInstance(this.character!.items, entry.id, slot.dataset.equipmentSlot as EquipmentSlot, this.viewSet);
        slot.dataset.dropValid = 'true';
      } catch { slot.dataset.dropValid = 'false'; }
    }
    if (!entry || !point || !this.drag || !target) return;
    target.grid.append(this.marker);
    const definition = lootDefinitions[entry.item]; Object.assign(this.marker.style, { gridColumn: `${Math.max(0, point.x) + 1} / span ${definition.width}`, gridRow: `${Math.max(0, point.y) + 1} / span ${definition.height}` });
    this.marker.hidden = point.x < 0 || point.y < 0 || point.x + definition.width > bagWidth || point.y + definition.height > bagHeight;
    try {
      if (target.container === this.drag.container) moveItem(this.contents(target.container), entry.id, point.x, point.y, this.drag.quantity, () => 'preview');
      else transferItem(this.drag.container === 'bag' ? this.character!.items : this.character!.stash, this.contents(target.container), entry.id, this.drag.quantity, () => 'preview', point);
      this.marker.dataset.valid = 'true';
    } catch { this.marker.dataset.valid = 'false'; }
  }
  private async release(x: number, y: number): Promise<void> {
    const drag = this.drag, entry = this.entry(drag?.id), target = this.targetGrid(x, y), point = target ? this.point(target.grid, x, y) : null;
    const slot = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-equipment-slot]')?.dataset.equipmentSlot;
    this.cancelDrag(); if (!drag?.active || !entry) return;
    await this.perform(() => {
      const panel = this.dialog.getBoundingClientRect();
      if (x < panel.left || x > panel.right || y < panel.top || y > panel.bottom) {
        if (drag.container === 'stash') throw new Error('Take the item into your bag first.');
        return this.ctx.drop(entry.id, drag.quantity);
      }
      if (slot && isEquipmentSlot(slot)) {
        if (drag.container === 'stash') throw new Error('Take the item into your bag first.');
        return this.ctx.change(equipInstance(this.character!.items, entry.id, slot, this.viewSet));
      }
      if (!point || !target) throw new Error('Item does not fit.');
      if (drag.container !== target.container) return this.ctx.transfer(entry.id, drag.quantity, target.container === 'stash', point);
      const next = moveItem(this.contents(target.container), entry.id, point.x, point.y, drag.quantity, this.ctx.newId);
      return target.container === 'stash' ? this.ctx.changeContainers(this.character!.items, next) : this.ctx.change(next);
    });
  }
  private openSplit(entry: InventoryItem): void {
    this.cancelDrag(); this.hideTooltip(); this.splitId = entry.id; this.split.hidden = false;
    const input = this.split.querySelector('input')!; input.max = String(Math.min(stackLimit, entry.quantity - 1)); input.value = String(Math.min(stackLimit, Math.floor(entry.quantity / 2))); input.focus(); input.select();
  }
  private confirmSplit(): void {
    const entry = this.entry(this.splitId ?? undefined), input = this.split.querySelector('input')!, quantity = Number(input.value);
    if (!entry || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > stackLimit || quantity >= entry.quantity) { input.reportValidity(); return; }
    this.split.hidden = true; this.splitId = null;
    this.drag = { id: entry.id, container: this.source(entry.id), quantity, x: this.pointer.x, y: this.pointer.y, offsetX: 0, offsetY: 0, active: true, carried: true }; this.showGhost();
    this.ghost.style.left = `${this.pointer.x}px`; this.ghost.style.top = `${this.pointer.y}px`;
  }
  private cancelDrag(): void {
    this.drag = null; this.ghost.hidden = true; this.marker.hidden = true; this.split.hidden = true; this.splitId = null;
    this.dialog.querySelectorAll('.inv-carried,.inv-drop-target').forEach(el => el.classList.remove('inv-carried', 'inv-drop-target'));
  }
  private async perform(operation: () => Promise<void> | void): Promise<void> {
    if (this.busy || !this.character) return;
    const focused = (document.activeElement as HTMLElement)?.dataset.instance;
    this.busy = true; this.error.textContent = ''; this.hideTooltip(); this.dialog.setAttribute('aria-busy', 'true');
    this.dialog.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = true; });
    try { await operation(); }
    catch (error) { this.error.textContent = error instanceof Error ? error.message : 'Unable to move item.'; }
    finally {
      this.busy = false; this.dialog.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = false; }); this.refresh();
      if (focused) this.dialog.querySelector<HTMLButtonElement>(`[data-instance="${CSS.escape(focused)}"]`)?.focus();
    }
  }
}
