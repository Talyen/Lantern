import type { WeaponSet } from './abilities';
import { itemDefinitions, isItemId, isWeaponItem, slotAccepts, supportsShield, type EquipmentSlot } from './equipment';
import { lootDefinitions, lootIds, stackLimit, type InventoryItem, type LootItem } from './inventory-catalog';
import { itemLoadout } from './inventory-equipment';
import { fits, emptyPosition } from './inventory-placement';

// Keep the public inventory API stable; leaf owners never import this transaction module.
export { bagWidth, bagHeight, stackLimit, lootDefinitions, lootIds, type InventoryItem, type LootItem } from './inventory-catalog';
export { sameEquipment, itemLoadout } from './inventory-equipment';
export { fits, emptyPosition } from './inventory-placement';
export { validItems } from './inventory-validation';

export const countItem = (items: readonly InventoryItem[], item: LootItem) =>
  items.reduce((sum, entry) => sum + (entry.item === item ? entry.quantity : 0), 0);
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
      const amount = Math.min(quantity, stackLimit - entry.quantity);
      entry.quantity += amount;
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
function returnToBag(items: InventoryItem[], entry: InventoryItem): void {
  const point = emptyPosition(items, entry.item);
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
  items: InventoryItem[],
  id: string,
  x: number,
  y: number,
  quantity: number,
  makeId: () => string,
): InventoryItem[] {
  const next = structuredClone(items),
    entry = next.find((i) => i.id === id);
  if (!entry || !Number.isInteger(quantity) || quantity < 1 || quantity > entry.quantity)
    throw new Error('Item is no longer available.');
  const set = entry.weaponSet ?? 0;
  const target = next.find((i) => i.slot === 'bag' && i.id !== id && i.x === x && i.y === y);
  if (target?.item === entry.item && lootDefinitions[entry.item].stackable) {
    const amount = Math.min(quantity, stackLimit - target.quantity);
    if (!amount) throw new Error('Stack full.');
    target.quantity += amount;
    entry.quantity -= amount;
    return next.filter((i) => i.quantity > 0);
  }
  if (!fits(next, entry.item, x, y, id)) throw new Error('Item does not fit.');
  if (lootDefinitions[entry.item].stackable) quantity = Math.min(quantity, stackLimit);
  if (quantity < entry.quantity) {
    // The source rectangle remains occupied when splitting.
    if (!fits(next, entry.item, x, y)) throw new Error('Item does not fit.');
    entry.quantity -= quantity;
    next.push({ ...entry, id: makeId(), quantity, slot: 'bag', x, y });
  } else {
    Object.assign(entry, { slot: 'bag', x, y });
    delete entry.weaponSet;
  }
  if (entry.slot === 'bag' && !itemLoadout(next, set).main)
    returnShieldToBag(next, set);
  return next;
}
export function equipInstance(
  items: InventoryItem[],
  id: string,
  slot: EquipmentSlot,
  set: WeaponSet = 0,
): InventoryItem[] {
  const next = structuredClone(items),
    entry = next.find((i) => i.id === id);
  if (!entry || !isItemId(entry.item))
    throw new Error('That item cannot be equipped.');
  if (slot === 'off' && (entry.item !== 'shield' || !supportsShield(itemLoadout(next, set).main)))
    throw new Error('Equip an Axe or Sword first.');
  if (!slotAccepts(entry.item, slot)) throw new Error('That item belongs in a different slot.');
  const sourceSet = entry.weaponSet ?? 0;
  const movingMainBetweenSets = entry.slot === 'main' && sourceSet !== set;
  const handSlot = slot === 'main' || slot === 'off';
  const needsBothHands = slot === 'main' && isWeaponItem(entry.item) && itemDefinitions[entry.item].hands === 2;
  const displace = next.filter(other => {
    if (other.id === id) return false;
    const destinationSet = (other.weaponSet ?? 0) === set;
    const occupiesSlot = other.slot === slot && (!handSlot || destinationSet);
    const occupiesOffHand = needsBothHands && other.slot === 'off' && destinationSet;
    return occupiesSlot || occupiesOffHand;
  });
  if (movingMainBetweenSets)
    displace.push(...next.filter(other => other.slot === 'off' && (other.weaponSet ?? 0) === sourceSet));
  entry.slot = slot;
  if (slot === 'main' || slot === 'off') entry.weaponSet = set;
  else delete entry.weaponSet;
  // Place bulky displaced gear before narrow pieces can fragment its free space.
  displace.sort((a, b) => {
    const first = lootDefinitions[a.item], second = lootDefinitions[b.item];
    return second.width * second.height - first.width * first.height;
  });
  for (const old of displace) {
    returnToBag(next, old);
  }
  return next;
}
export function removeQuantity(
  items: InventoryItem[],
  id: string,
  quantity: number,
): InventoryItem[] {
  const next = structuredClone(items),
    entry = next.find((i) => i.id === id);
  if (!entry || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > entry.quantity)
    throw new Error('Item is no longer available.');
  const main = entry.slot === 'main',
    set = entry.weaponSet ?? 0;
  entry.quantity -= quantity;
  const remaining = next.filter((i) => i.quantity > 0);
  if (main) returnShieldToBag(remaining, set);
  return remaining;
}
export function sortedItems(items: InventoryItem[]): InventoryItem[] {
  const fixed = structuredClone(items.filter((i) => i.slot !== 'bag'));
  const bag = structuredClone(items.filter((i) => i.slot === 'bag'));
  for (const item of lootIds.filter((i) => lootDefinitions[i].stackable)) {
    const entries = bag.filter((i) => i.item === item);
    let quantity = countItem(entries, item);
    for (const entry of entries) {
      entry.quantity = Math.min(stackLimit, quantity);
      quantity -= entry.quantity;
    }
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
  source: InventoryItem[],
  destination: InventoryItem[],
  id: string,
  quantity: number,
  makeId: () => string,
  point?: { x: number; y: number },
): { source: InventoryItem[]; destination: InventoryItem[] } {
  const nextSource = structuredClone(source),
    nextDestination = structuredClone(destination),
    entry = nextSource.find((i) => i.id === id);
  if (
    !entry ||
    !['bag', 'overflow'].includes(entry.slot) ||
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    quantity > entry.quantity
  )
    throw new Error('Move equipped gear into the bag first.');
  let amount: number;
  if (point) {
    const stack = nextDestination.find(
      (i) => i.slot === 'bag' && i.x === point.x && i.y === point.y,
    );
    if (stack && stack.item === entry.item && lootDefinitions[entry.item].stackable) {
      amount = Math.min(quantity, stackLimit - stack.quantity);
      stack.quantity += amount;
    } else {
      if (!fits(nextDestination, entry.item, point.x, point.y))
        throw new Error('Item does not fit.');
      amount = Math.min(quantity, lootDefinitions[entry.item].stackable ? stackLimit : 1);
      nextDestination.push({
        ...entry,
        id: amount === entry.quantity ? entry.id : makeId(),
        quantity: amount,
        slot: 'bag',
        ...point,
      });
    }
  } else
    amount = receive(
      nextDestination,
      entry.item,
      quantity,
      makeId,
      lootDefinitions[entry.item].stackable ? undefined : entry.id,
    );
  if (!amount) throw new Error('No space available.');
  entry.quantity -= amount;
  return { source: nextSource.filter((i) => i.quantity > 0), destination: nextDestination };
}
