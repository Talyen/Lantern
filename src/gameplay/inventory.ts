import type { WeaponSet } from './abilities';
import { isItemId, slotAccepts, supportsShield, type EquipmentSlot } from './equipment';
import { lootDefinitions, lootIds, stackLimit, type InventoryItem, type LootItem } from './inventory-catalog';
import { itemLoadout, displacedEquipment } from './inventory-equipment';
import { fits, emptyPosition } from './inventory-placement';

// Keep the public inventory API stable; leaf owners never import this transaction module.
export { bagWidth, bagHeight, stackLimit, lootDefinitions, lootIds, type InventoryItem, type LootItem } from './inventory-catalog';
export { sameEquipment, itemLoadout } from './inventory-equipment';
export { fits, emptyPosition } from './inventory-placement';
export { validItems, validStash, validatedContainers } from './inventory-validation';

export const countItem = (items: readonly InventoryItem[], item: LootItem) =>
  items.reduce((sum, entry) => sum + (entry.item === item ? entry.quantity : 0), 0);
/** Movement, removal and transfers share the same whole-quantity boundary. */
function selectedQuantity(items: InventoryItem[], id: string, quantity: number, message = 'Item is no longer available.'): InventoryItem {
  const entry = items.find(item => item.id === id);
  if (!entry || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > entry.quantity) throw new Error(message);
  return entry;
}
/** Spend Bag materials on an unpublished candidate and return any unmet quantity. */
export function consumeMaterial(items: InventoryItem[], item: LootItem, quantity: number): number {
  for (const entry of items) {
    if (entry.item !== item || entry.slot !== 'bag') continue;
    const amount = Math.min(quantity, entry.quantity);
    entry.quantity -= amount;
    quantity -= amount;
    if (!quantity) break;
  }
  return quantity;
}
/** Callers establish matching bag stacks; every transfer uses the same capacity rule. */
function fillStack(entry: InventoryItem, quantity: number): number {
  const amount = Math.min(quantity, stackLimit - entry.quantity);
  entry.quantity += amount;
  return amount;
}
/** Transfer only what fits; callers commit the resulting inventory and ground remainder together. */
export function receive(
  items: InventoryItem[],
  item: LootItem,
  quantity: number,
  makeId: () => string,
  instanceId?: string,
): number {
  const initial = quantity,
    definition = lootDefinitions[item];
  if (definition.stackable)
    for (const entry of items) {
      if (entry.item !== item || entry.slot !== 'bag') continue;
      const amount = fillStack(entry, quantity);
      quantity -= amount;
      if (!quantity) return initial;
    }
  while (quantity > 0) {
    const point = emptyPosition(items, item);
    if (!point) break;
    const amount = Math.min(quantity, definition.stackable ? stackLimit : 1);
    items.push({ id: instanceId ?? makeId(), item, quantity: amount, slot: 'bag', ...point });
    quantity -= amount;
    instanceId = undefined;
  }
  return initial - quantity;
}
/** Used only on unpublished candidates; failed placement leaves the caller's inventory intact. */
function returnToBag(items: InventoryItem[], entry: InventoryItem, preferred?: { x: number; y: number }): void {
  const point = preferred && fits(items, entry.item, preferred.x, preferred.y, entry.id)
    ? preferred : emptyPosition(items, entry.item);
  if (!point) throw new Error('Inventory full.');
  Object.assign(entry, { slot: 'bag', ...point });
  delete entry.weaponSet;
}

/** A displaced main hand must leave its shield in the same unpublished candidate. */
function returnShieldToBag(items: InventoryItem[], set: WeaponSet): void {
  for (const entry of items.filter(item => item.slot === 'off' && (item.weaponSet ?? 0) === set))
    returnToBag(items, entry);
}

export function moveItem(
  items: readonly InventoryItem[],
  id: string,
  x: number,
  y: number,
  quantity: number,
  makeId: () => string,
): InventoryItem[] {
  const next = structuredClone([...items]), entry = selectedQuantity(next, id, quantity);
  const set = entry.weaponSet ?? 0;
  const target = next.find((i) => i.slot === 'bag' && i.id !== id && i.x === x && i.y === y);
  if (target?.item === entry.item && lootDefinitions[entry.item].stackable) {
    const amount = fillStack(target, quantity);
    if (!amount) throw new Error('Stack full.');
    entry.quantity -= amount;
    return next.filter((i) => i.quantity > 0);
  }
  if (!fits(next, entry.item, x, y, id)) throw new Error('Item does not fit.');
  if (lootDefinitions[entry.item].stackable) quantity = Math.min(quantity, stackLimit);
  if (quantity < entry.quantity) {
    // The source rectangle remains occupied when splitting.
    if (!fits(next, entry.item, x, y)) throw new Error('Item does not fit.');
    entry.quantity -= quantity;
    const split = { ...entry, id: makeId(), quantity };
    returnToBag(next, split, { x, y });
    next.push(split);
  } else returnToBag(next, entry, { x, y });
  if (entry.slot === 'bag' && !itemLoadout(next, set).main)
    returnShieldToBag(next, set);
  return next;
}
export function equipInstance(
  items: readonly InventoryItem[],
  id: string,
  slot: EquipmentSlot,
  set: WeaponSet = 0,
): InventoryItem[] {
  const next = structuredClone([...items]),
    entry = next.find((i) => i.id === id);
  if (!entry || !isItemId(entry.item))
    throw new Error('That item cannot be equipped.');
  if (slot === 'off' && (entry.item !== 'shield' || !supportsShield(itemLoadout(next, set).main)))
    throw new Error('Equip an Axe or Sword first.');
  if (!slotAccepts(entry.item, slot)) throw new Error('That item belongs in a different slot.');
  const vacated = entry.slot === 'bag' ? { x: entry.x, y: entry.y } : undefined;
  const displace = displacedEquipment(next, entry, slot, set);
  entry.slot = slot;
  if (slot === 'main' || slot === 'off') entry.weaponSet = set;
  else delete entry.weaponSet;
  // Place bulky displaced gear before narrow pieces can fragment its free space.
  displace.sort((a, b) => {
    const first = lootDefinitions[a.item], second = lootDefinitions[b.item];
    return second.width * second.height - first.width * first.height;
  });
  for (const old of displace) {
    returnToBag(next, old, vacated);
  }
  return next;
}
export function removeQuantity(
  items: readonly InventoryItem[],
  id: string,
  quantity: number,
): InventoryItem[] {
  const next = structuredClone([...items]), entry = selectedQuantity(next, id, quantity);
  const main = entry.slot === 'main',
    set = entry.weaponSet ?? 0;
  entry.quantity -= quantity;
  const remaining = next.filter((i) => i.quantity > 0);
  if (main) returnShieldToBag(remaining, set);
  return remaining;
}
export function sortedItems(items: readonly InventoryItem[]): InventoryItem[] {
  const next = structuredClone([...items]), fixed = next.filter(entry => entry.slot !== 'bag'), bag = next.filter(entry => entry.slot === 'bag');
  const quantities = new Map<LootItem, number>();
  for (const entry of bag) if (lootDefinitions[entry.item].stackable)
    quantities.set(entry.item, (quantities.get(entry.item) ?? 0) + entry.quantity);
  for (const entry of bag) if (lootDefinitions[entry.item].stackable) {
    const quantity = quantities.get(entry.item)!;
    entry.quantity = Math.min(stackLimit, quantity);
    quantities.set(entry.item, quantity - entry.quantity);
  }
  bag.sort((a, b) => {
    const da = lootDefinitions[a.item],
      db = lootDefinitions[b.item];
    return (
      db.width * db.height - da.width * da.height ||
      lootIds.indexOf(a.item) - lootIds.indexOf(b.item) ||
      a.id.localeCompare(b.id)
    );
  });
  for (const entry of bag.filter((i) => i.quantity > 0)) {
    const point = emptyPosition(fixed, entry.item);
    if (!point) throw new Error('Cannot sort without moving an item out first.');
    Object.assign(entry, point);
    fixed.push(entry);
  }
  return fixed;
}
/** Both containers commit together. Partial transfers preserve the source remainder. */
export function transferItem(
  source: readonly InventoryItem[],
  destination: readonly InventoryItem[],
  id: string,
  quantity: number,
  makeId: () => string,
  point?: { x: number; y: number },
): { source: InventoryItem[]; destination: InventoryItem[] } {
  const { source: nextSource, destination: nextDestination } = structuredClone({ source: [...source], destination: [...destination] });
  const entry = selectedQuantity(nextSource, id, quantity, 'Move equipped gear into the bag first.');
  if (entry.slot !== 'bag' && entry.slot !== 'overflow') throw new Error('Move equipped gear into the bag first.');
  const stackable = lootDefinitions[entry.item].stackable;
  let amount: number;
  if (point) {
    const stack = nextDestination.find(item => item.slot === 'bag' && item.x === point.x && item.y === point.y);
    if (stack?.item === entry.item && stackable) {
      amount = fillStack(stack, quantity);
    } else {
      if (!fits(nextDestination, entry.item, point.x, point.y)) throw new Error('Item does not fit.');
      amount = Math.min(quantity, stackable ? stackLimit : 1);
      const moved = { ...entry, id: amount === entry.quantity ? entry.id : makeId(), quantity: amount };
      returnToBag(nextDestination, moved, point);
      nextDestination.push(moved);
    }
  } else amount = receive(nextDestination, entry.item, quantity, makeId, stackable ? undefined : entry.id);
  if (!amount) throw new Error('No space available.');
  entry.quantity -= amount;
  return { source: nextSource.filter((i) => i.quantity > 0), destination: nextDestination };
}
