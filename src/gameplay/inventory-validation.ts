import { isRecord } from '../data/json';
import { isEquipmentSlot, isItemId, slotAccepts, supportsShield } from './equipment';
import { lootDefinitions, lootIds, stackLimit, type InventoryItem } from './inventory-catalog';
import { itemLoadout } from './inventory-equipment';
import { fits } from './inventory-placement';

/** Validate each untrusted entry before checking relationships between entries. */
function validItem(value: unknown): value is InventoryItem {
  if (!isRecord(value)) return false;
  const entry = value;
  if (typeof entry.id !== 'string' || !entry.id) return false;
  const item = lootIds.find((id) => id === entry.item);
  if (!item) return false;
  const slot = entry.slot;
  if (slot !== 'bag' && !isEquipmentSlot(slot) && slot !== 'overflow') return false;
  const quantityLimit = lootDefinitions[item].stackable
    ? slot === 'overflow'
      ? Number.MAX_SAFE_INTEGER
      : stackLimit
    : 1;
  if (
    typeof entry.quantity !== 'number' ||
    !Number.isSafeInteger(entry.quantity) ||
    entry.quantity < 1 ||
    entry.quantity > quantityLimit
  )
    return false;
  if (!Number.isInteger(entry.x) || !Number.isInteger(entry.y)) return false;
  if (isEquipmentSlot(slot)) {
    if (!isItemId(item) || !slotAccepts(item, slot)) return false;
    if (slot === 'main' || slot === 'off') {
      if (entry.weaponSet !== undefined && entry.weaponSet !== 0 && entry.weaponSet !== 1)
        return false;
    } else if (entry.weaponSet !== undefined) return false;
  }
  return true;
}

export function validItems(value: unknown): value is InventoryItem[] {
  if (!Array.isArray(value)) return false;
  const items: InventoryItem[] = [];
  const ids = new Set<string>();
  const slots = new Set<string>();
  for (const entry of value) {
    if (!validItem(entry)) return false;
    items.push(entry);
    if (ids.has(entry.id)) return false;
    ids.add(entry.id);
    if (isEquipmentSlot(entry.slot)) {
      const slot = entry.slot === 'main' || entry.slot === 'off' ? `${entry.weaponSet ?? 0}/${entry.slot}` : entry.slot;
      if (slots.has(slot)) return false;
      slots.add(slot);
    }
  }
  if (
    items.some(
      (entry) => entry.slot === 'bag' && !fits(items, entry.item, entry.x, entry.y, entry.id),
    )
  )
    return false;
  return ([0, 1] as const).every((set) => {
    const loadout = itemLoadout(items, set);
    return !loadout.off || supportsShield(loadout.main);
  });
}

/** Stash entries must fit the bag and cannot reuse a carried item's identity. */
export function validStash(value: unknown, carried: readonly InventoryItem[]): value is InventoryItem[] {
  if (!validItems(value) || value.some(entry => entry.slot !== 'bag')) return false;
  const carriedIds = new Set(carried.map(entry => entry.id));
  return value.every(entry => !carriedIds.has(entry.id));
}
