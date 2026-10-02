import { renderEquipmentDetails, statLabel, statValue } from './equipment-details';
import { bindMenuDismissal } from './menu';
import type { CharacterSave } from '../gameplay/character';
import { bagWidth, bagHeight, stackLimit, emptyPosition, equipInstance, lootDefinitions, moveItem, sortedItems, transferItem, itemLoadout, type InventoryItem } from '../gameplay/inventory';
import { progression, skillProgress } from '../gameplay/skills';
import { canRepairShelter, shelterMaterials } from '../gameplay/homestead-transactions';
import { inventoryItemButton, placeInventoryItem } from './inventory-item';
import type { WeaponSet } from '../gameplay/abilities';
import { equipmentCatalog, isEquipmentSlot, isItemId, sharedSlots, supportsShield, type EquipmentSlot } from '../gameplay/equipment';
import { resolveCombatStats } from '../gameplay/combat-stats';
import { itemIcon } from './item-icons';
import { setText, setDisabled } from './dom';

export type TravelChoice = { name: string; available: boolean; travel(): void };
export type InventoryMenuContext = {
  change(items: InventoryItem[]): Promise<void>;
  drop(id: string, quantity: number): Promise<void>;
  recover(id: string): void;
  newId(this: void): string;
  changeContainers(items: InventoryItem[], stash: InventoryItem[]): void;
  transfer(id: string, quantity: number, toStash: boolean, point?: { x: number; y: number }): void;
  repair(): Promise<void>;
};
type Container = 'bag' | 'stash';
type Drag = {
  container: Container;
  id: string;
  quantity: number;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  active: boolean;
  carried: boolean;
  pointer?: number;
};
/** Menus submit complete inventory operations; simulation remains the owner of transfers. */
export class AdventureMenus {
  private inventory = document.getElementById('inventory-dialog') as HTMLDialogElement;
  private repair = document.getElementById('repair-dialog') as HTMLDialogElement;
  private stashGrid = document.getElementById('stash-grid')!;
  private stashMode = false;
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
  private rested = document.getElementById('rested-status')!;
  private scrollCount = document.getElementById('scroll-count')!;
  private busy = false;
  private viewSet: WeaponSet = 0;
  private selected: string | null = null;
  private comparisonId: string | null = null;
  private ringSlot: 'ring-left' | 'ring-right' = 'ring-left';
  private ringChoices = document.createElement('div');
  private drag: Drag | null = null;
  private splitId: string | null = null;
  constructor(private clearInput: () => void, private focus: () => void, private cast: () => void, private context: InventoryMenuContext, private sound?: (cue: 'menuOpen' | 'menuClose') => void) {
    const sets=document.createElement('div');sets.className='equipment-set-tabs';
    for(const set of [0,1] as const){const button=document.createElement('button');button.type='button';button.textContent=`Weapon Set ${set===0 ? 'I' : 'II'}`;button.dataset.set=String(set);button.onclick=()=>{this.viewSet=set;this.selected=null;this.cancelDrag();this.refresh();};sets.append(button);}
    this.inventory.querySelector('.equipment-slots')!.before(sets);
    const shared = this.inventory.querySelector('.shared-equipment')!;
    const labels = {'helmet':'Helmet','body':'Body','gloves':'Gloves','boots':'Boots','ring-left':'Left Ring','ring-right':'Right Ring','amulet':'Amulet','belt':'Belt'};
    for (const slot of sharedSlots) {
      const host=document.createElement('div');host.className='equipment-slot';host.dataset.equipmentSlot=slot;
      const label=document.createElement('span');label.textContent=labels[slot];const contents=document.createElement('div');contents.id=`equipment-${slot}`;host.append(label,contents);shared.append(host);
    }
    this.ringChoices.className='ring-choices';
    for(const slot of ['ring-left','ring-right'] as const) {const button=document.createElement('button');button.type='button';button.textContent=slot==='ring-left' ? 'Left Ring' : 'Right Ring';button.dataset.ring=slot;button.onclick=()=>{this.ringSlot=slot;this.refreshSelection();};this.ringChoices.append(button);}
    this.detail.after(this.ringChoices);
    for (const dialog of [this.inventory, this.travel, this.repair]) {
      dialog.querySelector('button[data-close]')!.addEventListener('click', () => this.close());
      bindMenuDismissal(dialog, () => this.close());
    }
    document.getElementById('shelter-repair')!.onclick = async () => { let repaired=false; await this.perform(async()=>{await this.context.repair();repaired=true;});if(repaired)this.close(); };
    document.getElementById('stash-sort')!.onclick = () => { this.cancelDrag();void this.perform(()=>this.context.changeContainers(this.character!.items,sortedItems(this.character!.stash))).catch(this.failed); };
    document.getElementById('inventory-transfer')!.onclick = () => { const entry=this.selectedItem();if(entry)void this.perform(()=>this.context.transfer(entry.id,entry.quantity,this.container(entry.id)==='bag')).catch(this.failed); };
    this.use.addEventListener('click', () => { if (this.busy || this.drag || !this.character?.scrolls) return; this.close(); this.cast(); });
    document.getElementById('inventory-sort')!.onclick = () => { this.cancelDrag(); void this.perform(() => this.context.change(sortedItems(this.character!.items))).catch(this.failed); };
    document.getElementById('inventory-equip')!.onclick = () => { const item = this.selectedItem(); if (item) void this.perform(() => this.context.change(equipInstance(this.character!.items, item.id, this.destinationSlot(item),this.viewSet))).catch(this.failed); };
    document.getElementById('inventory-remove')!.onclick = () => { const item = this.selectedItem(); if (!item) return; void this.perform(() => { const point = emptyPosition(this.character!.items, item.item); if (!point) throw new Error('Inventory full.'); return this.context.change(moveItem(this.character!.items, item.id, point.x, point.y, item.quantity, this.context.newId)); }).catch(this.failed); };
    document.getElementById('inventory-recover')!.onclick = () => { const item = this.selectedItem(); if (item) void this.perform(() => this.context.recover(item.id)).catch(this.failed); };
    document.getElementById('inventory-split')!.onclick = () => { const item = this.selectedItem(); if (item) this.openSplit(item); };
    document.getElementById('split-cancel')!.onclick = () => { this.split.hidden = true; this.splitId = null; };
    document.getElementById('split-confirm')!.onclick = () => {
      const entry = this.entries().find(i => i.id === this.splitId), input = document.getElementById('split-amount') as HTMLInputElement, quantity = Number(input.value);
      if (!entry || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > stackLimit || quantity >= entry.quantity) { input.reportValidity(); return; }
      this.split.hidden = true; this.splitId = null;
      const rect = (this.container(entry.id)==='stash' ? this.stashGrid : this.grid).getBoundingClientRect();
      this.drag = { container:this.container(entry.id), id: entry.id, quantity, startX: rect.left, startY: rect.top, offsetX: 0, offsetY: 0, active: true, carried: true };
      this.showGhost(entry); this.ghost.style.left = `${rect.left}px`; this.ghost.style.top = `${rect.top}px`;
    };
    this.inventory.addEventListener('pointerdown', event => {
      if (event.button !== 0 || this.busy || !this.split.hidden) return;
      if (this.drag && !this.drag.carried && this.drag.pointer !== event.pointerId) return;
      if (this.drag?.carried) { event.preventDefault(); event.stopPropagation(); void this.release(event.clientX, event.clientY).catch(this.failed); return; }
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-instance]'); if (!target) return;
      const entry = this.entries().find(i => i.id === target.dataset.instance); if (!entry) return;
      this.selected = entry.id; this.refreshSelection();
      if (event.shiftKey && entry.quantity > 1) { event.preventDefault(); this.openSplit(entry); return; }
      const rect = target.getBoundingClientRect();
      target.setPointerCapture(event.pointerId);
      this.drag = { container:this.container(entry.id), id: entry.id, quantity: entry.quantity, startX: event.clientX, startY: event.clientY, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, active: false, carried: false, pointer: event.pointerId };
    });
    window.addEventListener('pointermove', event => {
      const drag = this.drag; if (!drag || !drag.carried && drag.pointer !== event.pointerId) return;
      if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 5) {
        drag.active = true; const entry = this.entries().find(i => i.id === drag.id); if (entry) this.showGhost(entry);
      }
      if (!drag.active) return;
      this.ghost.style.left = `${event.clientX - drag.offsetX}px`; this.ghost.style.top = `${event.clientY - drag.offsetY}px`;
      this.previewPlacement(event.clientX, event.clientY);
    });
    window.addEventListener('pointerup', event => { if (event.button === 0 && this.drag && !this.drag.carried && this.drag.pointer === event.pointerId) void this.release(event.clientX, event.clientY).catch(this.failed); });
    window.addEventListener('pointercancel', event => { if (this.drag?.carried || this.drag?.pointer === event.pointerId) this.cancelDrag(); });
    window.addEventListener('blur', () => this.cancelDrag());
    this.inventory.addEventListener('keydown', event => { if (event.key === 'Escape' && (this.drag || !this.split.hidden)) { event.preventDefault(); event.stopPropagation(); this.cancelDrag(); } });
  }
  get paused(): boolean { return this.inventory.open || this.travel.open || this.repair.open; }
  close(): void { if (this.busy) return; if (this.paused) this.sound?.('menuClose'); this.cancelDrag(); this.inventory.close(); this.travel.close(); this.repair.close(); this.stashMode=false; this.clearInput(); this.focus(); }
  openInventory(stash = false): void { this.clearInput(); this.stashMode=stash; this.refresh(); this.updateRested(); this.error.textContent = ''; this.inventory.showModal(); this.sound?.('menuOpen'); }
  openRepair(): void { this.clearInput();this.refresh();document.getElementById('repair-error')!.textContent='';this.repair.showModal();this.sound?.('menuOpen'); }
  openTravel(choices: TravelChoice[]): void {
    this.clearInput(); const list = document.getElementById('travel-destinations')!;
    list.replaceChildren(...choices.map(choice => { const button = document.createElement('button'); button.textContent = choice.available ? choice.name : `${choice.name} · Enemies nearby`; button.disabled = !choice.available; button.onclick = () => { this.close(); choice.travel(); }; return button; }));
    if (!choices.length) list.textContent = 'No destinations available.'; this.travel.showModal(); this.sound?.('menuOpen');
  }
  update(scrolls: number, canUse: boolean, prompt: string, casting: number): void {
    setText(this.scrollCount, String(scrolls)); setDisabled(this.use, !canUse || this.busy);
    setText(this.prompt, casting > 0 ? `Scroll of Return · ${casting.toFixed(1)}s` : prompt);
  }
  updateCharacter(character: CharacterSave): void {
    this.character=character;
    // Closed menus read the latest character when opened. Avoid serializing the
    // whole bag/stash and rebuilding hidden grids during active gameplay.
    if (!this.inventory.open && !this.repair.open) return;
    if (this.inventory.open) this.updateRested();
    const key = JSON.stringify({...character,restedSeconds:undefined}); if (key === this.characterKey) return;
    this.refresh();
  }
  private updateRested(): void {
    const seconds=Math.ceil(this.character?.restedSeconds ?? 0);
    if (this.rested.hidden !== (seconds<=0)) this.rested.hidden=seconds<=0;
    setText(this.rested, `Rested · ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')} · +${progression.restedBonus*100}% skill XP`);
  }
  private entries():InventoryItem[] { return this.character ? [...this.character.items,...(this.stashMode ? this.character.stash : [])] : []; }
  private container(id:string):Container { return this.character?.stash.some(i=>i.id===id) ? 'stash' : 'bag'; }
  private contents(container:Container):InventoryItem[] { return container==='stash' ? this.character!.stash : this.character!.items; }
  private button(entry: InventoryItem): HTMLButtonElement {
    const button = inventoryItemButton(entry, isEquipmentSlot(entry.slot));
    const definition = lootDefinitions[entry.item];
    button.dataset.instance = entry.id;
    button.onclick = () => {
      this.selected = entry.id;
      this.refreshSelection();
    };
    button.ondblclick = () => {
      if (this.stashMode && (entry.slot === 'bag' || entry.slot === 'overflow')) {
        void this.perform(() => this.context.transfer(entry.id, entry.quantity, this.container(entry.id) === 'bag')).catch(this.failed);
      } else if (!definition.stackable && entry.slot === 'bag') {
        void this.perform(() => this.context.change(equipInstance(
          this.character!.items, entry.id, this.destinationSlot(entry), this.viewSet,
        ))).catch(this.failed);
      }
    };
    button.disabled = this.busy;
    return button;
  }
  private refresh(): void {
    const character = this.character; if (!character) return;
    setText(document.getElementById('inventory-gold')!, `${character.gold} Gold`);
    this.characterKey = JSON.stringify({...character,restedSeconds:undefined});
    document.getElementById('stash-section')!.hidden=!this.stashMode;this.inventory.classList.toggle('with-stash',this.stashMode);
    this.stashGrid.querySelectorAll('[data-instance]').forEach(el=>el.remove());
    for (const entry of character.stash) {
      const button = this.button(entry);
      placeInventoryItem(button, entry);
      this.stashGrid.append(button);
    }
    this.grid.querySelectorAll('[data-instance]').forEach(el => el.remove());
    for (const entry of character.items.filter(i => i.slot === 'bag')) {
      const button = this.button(entry);
      placeInventoryItem(button, entry);
      this.grid.append(button);
    }
    for (const slot of ['main', 'off',...sharedSlots] as const) {
      const host = document.getElementById(`equipment-${slot}`)!; host.replaceChildren();
      const entry = character.items.find(i => i.slot === slot && (slot !== 'main' && slot !== 'off' || (i.weaponSet ?? 0)===this.viewSet));
      if (entry) host.append(this.button(entry));
      else host.textContent = slot === 'off' && itemLoadout(character.items,this.viewSet).main !== null && !supportsShield(itemLoadout(character.items,this.viewSet).main) ? 'Two-handed' : 'Empty';
    }
    this.inventory.querySelectorAll<HTMLElement>('[data-set]').forEach(button=>{button.setAttribute('aria-pressed',String(Number(button.dataset.set)===this.viewSet));button.title=Number(button.dataset.set)===character.activeSet ? 'Active weapon set' : 'Alternate weapon set';});
    const overflow = document.getElementById('inventory-overflow')!; overflow.replaceChildren();
    const pending = character.items.filter(i => i.slot === 'overflow'); overflow.hidden = !pending.length;
    if (pending.length) { const title = document.createElement('span'); title.textContent = 'Unpacked items'; overflow.append(title); for (const entry of pending) overflow.append(this.button(entry)); }
    document.getElementById('woodcutting-xp')!.textContent = skillProgress(character.xp.woodcutting);
    document.getElementById('axe-combat-xp')!.textContent = `${Math.floor(character.xp.axeCombat)} XP`;
    document.getElementById('mining-xp')!.textContent=skillProgress(character.xp.mining);
    const materials = document.getElementById('repair-materials')!;
    materials.replaceChildren(...shelterMaterials(character.items).map(({ item, held, cost }) => {
      const row = document.createElement('div');
      const name = document.createElement('span');
      const amount = document.createElement('strong');
      name.textContent = lootDefinitions[item].name;
      amount.textContent = `${held} / ${cost}`;
      row.dataset.ready = String(held >= cost);
      row.append(name, amount);
      return row;
    }));
    (document.getElementById('shelter-repair') as HTMLButtonElement).disabled = this.busy || !canRepairShelter(character);
    (document.getElementById('stash-sort') as HTMLButtonElement).disabled=this.busy;
    (document.getElementById('inventory-sort') as HTMLButtonElement).disabled = this.busy;
    const stats=resolveCombatStats(character.items,this.viewSet);
    document.getElementById('loadout-stats')!.replaceChildren(...(['maxHealth','maxMana','armor','damage'] as const).map(key=>{const row=document.createElement('div'),label=document.createElement('span'),value=document.createElement('strong');label.textContent=statLabel(key);value.textContent=statValue(key,stats[key]);row.append(label,value);return row;}));
    this.inventory.setAttribute('aria-busy', String(this.busy)); this.refreshSelection();
  }
  private selectedItem(): InventoryItem | undefined { return this.entries().find(i => i.id === this.selected); }
  private refreshSelection(): void {
    const entry = this.selectedItem(); this.inventory.classList.toggle('has-selection',!!entry); this.detail.textContent = entry ? `${lootDefinitions[entry.item].name}${lootDefinitions[entry.item].stackable ? ` · ${entry.quantity}` : ''}` : '';
    this.renderComparison(entry);
    const ringMove=entry && isItemId(entry.item) && equipmentCatalog[entry.item].slot==='ring' && isEquipmentSlot(entry.slot) && entry.slot!==this.ringSlot;
    for (const [id, visible] of [['inventory-equip', entry && this.container(entry.id)==='bag' && (entry.slot === 'bag' || ringMove) && !lootDefinitions[entry.item].stackable], ['inventory-remove', entry && isEquipmentSlot(entry.slot)], ['inventory-recover', entry?.slot === 'overflow'], ['inventory-transfer', this.stashMode && entry && ['bag','overflow'].includes(entry.slot)], ['inventory-split', entry && entry.quantity > 1]] as const) {
      const button = document.getElementById(id) as HTMLButtonElement; button.hidden = !visible; button.disabled = this.busy;
    }
    document.getElementById('inventory-transfer')!.textContent=entry && this.container(entry.id)==='stash' ? 'Take' : 'Store';
    this.inventory.querySelectorAll<HTMLElement>('[data-instance]').forEach(el => el.classList.toggle('selected', el.dataset.instance === this.selected));
  }
  private destinationSlot(entry: InventoryItem): EquipmentSlot {
    if (!isItemId(entry.item)) throw new Error('That item cannot be equipped.');
    const slot = equipmentCatalog[entry.item].slot;
    return slot === 'ring' ? this.ringSlot : slot;
  }
  private renderComparison(entry: InventoryItem | undefined): void {
    const details=document.getElementById('inventory-item-stats')!,comparison=document.getElementById('inventory-comparison')!;
    details.replaceChildren();comparison.replaceChildren();this.ringChoices.hidden=true;
    if(!entry || !isItemId(entry.item)) {this.comparisonId=null;return;}
    const definition=equipmentCatalog[entry.item];
    if(this.comparisonId!==entry.id) {
      this.comparisonId=entry.id;
      this.ringSlot=entry.slot==='ring-left' || entry.slot==='ring-right' ? entry.slot : this.character!.items.some(item=>item.slot==='ring-left') && !this.character!.items.some(item=>item.slot==='ring-right') ? 'ring-right' : 'ring-left';
    }
    this.ringChoices.hidden=definition.slot!=='ring';
    this.ringChoices.querySelectorAll<HTMLElement>('[data-ring]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.ring===this.ringSlot)));
    renderEquipmentDetails(details,comparison,entry,this.character!,this.viewSet,this.destinationSlot(entry));
  }
  private openSplit(entry: InventoryItem): void {
    this.cancelDrag(); this.splitId = entry.id; this.split.hidden = false;
    const input = document.getElementById('split-amount') as HTMLInputElement; input.max = String(Math.min(stackLimit, entry.quantity - 1)); input.value = String(Math.min(stackLimit, Math.floor(entry.quantity / 2))); input.focus(); input.select();
  }
  private showGhost(entry: InventoryItem): void {
    const cell = (this.drag?.container==='stash' ? this.stashGrid : this.grid).getBoundingClientRect().width / bagWidth, definition = lootDefinitions[entry.item];
    this.ghost.innerHTML = `${itemIcon(entry.item)}<span class="stack-count">${this.drag!.quantity > 1 ? this.drag!.quantity : ''}</span>`;
    this.ghost.style.width = `${cell * definition.width}px`; this.ghost.style.height = `${cell * definition.height}px`; this.ghost.hidden = false;
  }
  private targetGrid(x: number, y: number): { grid: HTMLElement; container: Container } | null {
    for (const [grid, container] of [[this.grid, 'bag'], [this.stashGrid, 'stash']] as const) {
      if (container === 'stash' && !this.stashMode) continue;
      const rect = grid.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return { grid, container };
    }
    return null;
  }
  private destination(grid: HTMLElement, x: number, y: number): { x: number; y: number } {
    const rect = grid.getBoundingClientRect();
    const cell = rect.width / bagWidth;
    return {
      x: Math.floor((x - (this.drag?.offsetX ?? 0) - rect.left + cell * .3) / cell),
      y: Math.floor((y - (this.drag?.offsetY ?? 0) - rect.top + cell * .3) / cell),
    };
  }
  private previewPlacement(x: number, y: number): void {
    const drag = this.drag;
    if (!drag) return;
    const entry = this.entries().find(item => item.id === drag.id);
    const target = this.targetGrid(x, y);
    this.marker.hidden = !target;
    if (!entry || !target) return;
    const point = this.destination(target.grid, x, y);
    const { width, height } = lootDefinitions[entry.item];
    target.grid.append(this.marker);
    Object.assign(this.marker.style, {
      gridColumn: `${Math.max(0, point.x) + 1} / span ${width}`,
      gridRow: `${Math.max(0, point.y) + 1} / span ${height}`,
    });
    this.marker.hidden = point.x < 0 || point.y < 0 || point.x + width > bagWidth || point.y + height > bagHeight;
    // Exercise the same candidate builders as a release, without committing or allocating real IDs.
    try {
      if (target.container === drag.container) {
        moveItem(this.contents(target.container), entry.id, point.x, point.y, drag.quantity, () => 'preview');
      } else {
        transferItem(this.contents(drag.container), this.contents(target.container), entry.id, drag.quantity, () => 'preview', point);
      }
      this.marker.dataset.valid = 'true';
    } catch {
      this.marker.dataset.valid = 'false';
    }
  }
  private async release(x: number, y: number): Promise<void> {
    const drag = this.drag;
    if (!drag) return;
    const entry = this.entries().find(item => item.id === drag.id);
    const target = this.targetGrid(x, y);
    // Capture the destination before cancellation clears the drag's pointer offset.
    const point = target ? this.destination(target.grid, x, y) : null;
    this.cancelDrag();
    if (!drag.active || !entry) return;
    const panel = this.inventory.getBoundingClientRect();
    await this.perform(() => {
      if (x < panel.left || x > panel.right || y < panel.top || y > panel.bottom) {
        this.requireBag(drag.container);
        return this.context.drop(entry.id, drag.quantity);
      }
      const slot = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-equipment-slot]')?.dataset.equipmentSlot;
      if (slot && isEquipmentSlot(slot)) {
        this.requireBag(drag.container);
        return this.context.change(equipInstance(this.character!.items, entry.id, slot, this.viewSet));
      }
      if (!target || !point) throw new Error('Item does not fit.');
      if (target.container !== drag.container) {
        return this.context.transfer(entry.id, drag.quantity, target.container === 'stash', point);
      }
      const next = moveItem(this.contents(drag.container), entry.id, point.x, point.y, drag.quantity, this.context.newId);
      if (drag.container === 'stash') return this.context.changeContainers(this.character!.items, next);
      return this.context.change(next);
    });
  }
  private requireBag(container: Container): void {
    if (container === 'stash') throw new Error('Take the item into your bag first.');
  }
  private cancelDrag(): void { this.drag = null; this.ghost.hidden = true; this.marker.hidden = true; this.split.hidden = true; this.splitId = null; }
  private failed = (error: unknown): void => {
    (this.repair.open ? document.getElementById('repair-error')! : this.error).textContent = error instanceof Error ? error.message : 'Unable to move item.';
  };
  private async perform(operation: () => Promise<void> | void): Promise<void> {
    if (this.busy || !this.character) return; this.busy = true; this.error.textContent = ''; this.refresh();
    try { await operation(); }
    catch (error) { this.failed(error); }
    finally { this.busy = false; this.refresh(); }
  }
}
