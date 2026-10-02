import type { WeaponSet } from './abilities';
import { itemDefinitions, itemIds, supportsShield, type ItemId, type Loadout } from './equipment';

export const bagWidth = 12, bagHeight = 8, stackLimit = 99;
export type LootItem = ItemId | 'scroll' | 'wood' | 'potion' | 'stone' | 'iron';
export type InventoryItem = { id: string; item: LootItem; quantity: number; slot: 'bag' | 'main' | 'off' | 'overflow'; weaponSet?: WeaponSet; x: number; y: number };
export const lootDefinitions: Record<LootItem, { name: string; width: number; height: number; stackable: boolean }> = {
  axe: { name: 'Axe', width: 2, height: 3, stackable: false },
  sword: { name: 'Sword', width: 1, height: 3, stackable: false },
  shield: { name: 'Shield', width: 2, height: 3, stackable: false },
  bow: { name: 'Bow', width: 2, height: 4, stackable: false },
  staff: { name: 'Staff', width: 2, height: 4, stackable: false },
  scroll: { name: 'Scroll of Return', width: 1, height: 1, stackable: true },
  potion: { name: 'Health Potion', width: 1, height: 1, stackable: true },
  wood: { name: 'Wood', width: 1, height: 1, stackable: true },
  stone: { name: 'Stone', width: 1, height: 1, stackable: true },
  iron: { name: 'Iron', width: 1, height: 1, stackable: true },
};
export const lootIds = Object.keys(lootDefinitions) as LootItem[];
export const countItem = (items: InventoryItem[], item: LootItem) => items.reduce((sum, entry) => sum + (entry.item === item ? entry.quantity : 0), 0);
export function itemLoadout(items: InventoryItem[], set: WeaponSet = 0): Loadout {
  return { main: (items.find(i => i.slot === 'main' && (i.weaponSet ?? 0) === set)?.item as Loadout['main']) ?? null, off: items.some(i => i.slot === 'off' && (i.weaponSet ?? 0) === set) ? 'shield' : null };
}
export function fits(items: InventoryItem[], item: LootItem, x: number, y: number, exclude?: string): boolean {
  const { width, height } = lootDefinitions[item];
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x + width <= bagWidth && y + height <= bagHeight
    && !items.some(i => i.slot === 'bag' && i.id !== exclude && x < i.x + lootDefinitions[i.item].width && x + width > i.x && y < i.y + lootDefinitions[i.item].height && y + height > i.y);
}
export function emptyPosition(items: InventoryItem[], item: LootItem): { x: number; y: number } | undefined {
  for (let y = 0; y < bagHeight; y++) for (let x = 0; x < bagWidth; x++) if (fits(items, item, x, y)) return { x, y };
}
/** Transfer only what fits; callers commit the resulting inventory and ground remainder together. */
export function receive(items: InventoryItem[], item: LootItem, quantity: number, makeId: () => string, instanceId?: string): number {
  const initial = quantity, definition = lootDefinitions[item];
  if (definition.stackable) for (const entry of items) {
    if (entry.item !== item || entry.slot !== 'bag') continue;
    const amount = Math.min(quantity, stackLimit - entry.quantity); entry.quantity += amount; quantity -= amount;
    if (!quantity) return initial;
  }
  while (quantity > 0) {
    const point = emptyPosition(items, item); if (!point) break;
    const amount = Math.min(quantity, definition.stackable ? stackLimit : 1);
    items.push({ id: instanceId ?? makeId(), item, quantity: amount, slot: 'bag', ...point }); quantity -= amount; instanceId = undefined;
  }
  return initial - quantity;
}
export function moveItem(items: InventoryItem[], id: string, x: number, y: number, quantity: number, makeId: () => string): InventoryItem[] {
  const next = structuredClone(items), entry = next.find(i => i.id === id);
  if (!entry || !Number.isInteger(quantity) || quantity < 1 || quantity > entry.quantity) throw new Error('Item is no longer available.');
  const set = entry.weaponSet ?? 0;
  const target = next.find(i => i.slot === 'bag' && i.id !== id && i.x === x && i.y === y);
  if (target?.item === entry.item && lootDefinitions[entry.item].stackable) {
    const amount = Math.min(quantity, stackLimit - target.quantity);
    if (!amount) throw new Error('Stack full.');
    target.quantity += amount; entry.quantity -= amount;
    return next.filter(i => i.quantity > 0);
  }
  if (!fits(next, entry.item, x, y, id)) throw new Error('Item does not fit.');
  if (quantity < entry.quantity) {
    // The source rectangle remains occupied when splitting.
    if (!fits(next, entry.item, x, y)) throw new Error('Item does not fit.');
    entry.quantity -= quantity; next.push({ ...entry, id: makeId(), quantity, slot: 'bag', x, y });
  } else { Object.assign(entry, { slot: 'bag', x, y }); delete entry.weaponSet; }
  if (entry.slot === 'bag' && !itemLoadout(next,set).main) for (const off of next.filter(i => i.slot === 'off' && (i.weaponSet ?? 0) === set)) {
    const point = emptyPosition(next, off.item); if (!point) throw new Error('Inventory full.');
    Object.assign(off, { slot: 'bag', ...point }); delete off.weaponSet;
  }
  return next;
}
export function equipInstance(items: InventoryItem[], id: string, slot: 'main' | 'off', set: WeaponSet = 0): InventoryItem[] {
  const next = structuredClone(items), entry = next.find(i => i.id === id);
  if (!entry || !itemIds.includes(entry.item as ItemId)) throw new Error('That item cannot be equipped.');
  if (slot === 'off' && (entry.item !== 'shield' || !supportsShield(itemLoadout(next,set).main))) throw new Error('Equip an Axe or Sword first.');
  if (slot === 'main' && entry.item === 'shield') throw new Error('A Shield belongs in the off hand.');
  const sourceSet = entry.weaponSet ?? 0, sourceMain = entry.slot === 'main';
  const displace = next.filter(i => i.id !== id && (i.weaponSet ?? 0) === set && (i.slot === slot || slot === 'main' && itemDefinitions[entry.item as ItemId].hands === 2 && i.slot === 'off' && (i.weaponSet ?? 0) === set));
  if (sourceMain && sourceSet !== set) displace.push(...next.filter(i=>i.slot==='off' && (i.weaponSet ?? 0)===sourceSet));
  entry.slot = slot; entry.weaponSet = set;
  for (const old of displace) {
    const point = emptyPosition(next, old.item); if (!point) throw new Error('Inventory full.');
    Object.assign(old, { slot: 'bag', ...point }); delete old.weaponSet;
  }
  return next;
}
export function removeQuantity(items: InventoryItem[], id: string, quantity: number): InventoryItem[] {
  const next = structuredClone(items), entry = next.find(i => i.id === id);
  if (!entry || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > entry.quantity) throw new Error('Item is no longer available.');
  const main = entry.slot === 'main', set = entry.weaponSet ?? 0; entry.quantity -= quantity;
  const remaining = next.filter(i => i.quantity > 0);
  if (main) for (const off of remaining.filter(i => i.slot === 'off' && (i.weaponSet ?? 0) === set)) {
    const point = emptyPosition(remaining, off.item); if (!point) throw new Error('Inventory full.');
    Object.assign(off, { slot: 'bag', ...point }); delete off.weaponSet;
  }
  return remaining;
}
export function sortedItems(items: InventoryItem[]): InventoryItem[] {
  const fixed = structuredClone(items.filter(i => i.slot !== 'bag'));
  const bag = structuredClone(items.filter(i => i.slot === 'bag'));
  for (const item of lootIds.filter(i => lootDefinitions[i].stackable)) {
    const entries = bag.filter(i => i.item === item); let quantity = countItem(entries, item);
    for (const entry of entries) { entry.quantity = Math.min(stackLimit, quantity); quantity -= entry.quantity; }
  }
  bag.sort((a, b) => {
    const da = lootDefinitions[a.item], db = lootDefinitions[b.item];
    return db.width * db.height - da.width * da.height || lootIds.indexOf(a.item) - lootIds.indexOf(b.item) || a.id.localeCompare(b.id);
  });
  for (const entry of bag.filter(i => i.quantity > 0)) {
    const point = emptyPosition(fixed, entry.item); if (!point) throw new Error('Cannot sort without moving an item out first.');
    Object.assign(entry, point); fixed.push(entry);
  }
  return fixed;
}
export function validItems(value: unknown): value is InventoryItem[] {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>(), slots = new Set<string>();
  for (const i of value) {
    if (!i || typeof i.id !== 'string' || !i.id || ids.has(i.id) || !lootIds.includes(i.item) || !Number.isSafeInteger(i.quantity) || i.quantity < 1 || i.quantity > (lootDefinitions[i.item as LootItem].stackable ? i.slot === 'overflow' ? Number.MAX_SAFE_INTEGER : stackLimit : 1) || !['bag', 'main', 'off', 'overflow'].includes(i.slot) || !Number.isInteger(i.x) || !Number.isInteger(i.y)) return false;
    ids.add(i.id);
    if (i.slot === 'main' || i.slot === 'off') {
      if (i.weaponSet !== undefined && i.weaponSet !== 0 && i.weaponSet !== 1) return false;
      if (slots.has(`${i.weaponSet ?? 0}/${i.slot}`) || i.slot === 'main' && (!itemIds.includes(i.item) || i.item === 'shield') || i.slot === 'off' && i.item !== 'shield') return false;
      slots.add(`${i.weaponSet ?? 0}/${i.slot}`);
    }
  }
  if (value.some(i => i.slot === 'bag' && !fits(value, i.item, i.x, i.y, i.id))) return false;
  return ([0,1] as const).every(set => { const loadout = itemLoadout(value,set); return !loadout.off || supportsShield(loadout.main); });
}

/** Both containers commit together. Partial transfers preserve the source remainder. */
export function transferItem(source: InventoryItem[], destination: InventoryItem[], id: string, quantity: number, makeId: () => string, point?: {x:number;y:number}): { source: InventoryItem[]; destination: InventoryItem[] } {
  const nextSource = structuredClone(source), nextDestination = structuredClone(destination), entry = nextSource.find(i => i.id === id);
  if (!entry || !['bag','overflow'].includes(entry.slot) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > entry.quantity) throw new Error('Move equipped gear into the bag first.');
  let amount: number;
  if (point) {
    const stack = nextDestination.find(i => i.slot === 'bag' && i.x === point.x && i.y === point.y);
    if (stack && stack.item === entry.item && lootDefinitions[entry.item].stackable) {
      amount = Math.min(quantity, stackLimit - stack.quantity); stack.quantity += amount;
    } else {
      if (!fits(nextDestination,entry.item,point.x,point.y)) throw new Error('Item does not fit.');
      amount = Math.min(quantity, lootDefinitions[entry.item].stackable ? stackLimit : 1);
      nextDestination.push({...entry,id: amount === entry.quantity ? entry.id : makeId(),quantity:amount,slot:'bag',...point});
    }
  } else amount = receive(nextDestination,entry.item,quantity,makeId,lootDefinitions[entry.item].stackable ? undefined : entry.id);
  if (!amount) throw new Error('No space available.');
  entry.quantity -= amount;
  return { source: nextSource.filter(i => i.quantity > 0), destination: nextDestination };
}
