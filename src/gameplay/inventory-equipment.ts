import type { WeaponSet } from './abilities';
import { isEquipmentSlot, isWeaponItem, supportsShield, type EquipmentSlot, type Loadout } from './equipment';
import type { InventoryItem } from './inventory-catalog';

/** Bag arrangement does not require preparing equipment again. */
export function sameEquipment(a: readonly InventoryItem[], b: readonly InventoryItem[]): boolean {
  const equipped = (items: readonly InventoryItem[]) =>
    items.filter(item => isEquipmentSlot(item.slot));
  const first = equipped(a), second = equipped(b);
  return first.length === second.length && first.every(item => second.some(other =>
    item.id === other.id && item.item === other.item && item.slot === other.slot &&
    (item.weaponSet ?? 0) === (other.weaponSet ?? 0)));
}
export function itemLoadout(items: readonly InventoryItem[], set: WeaponSet = 0): Loadout {
  const main = items.find(entry => entry.slot === 'main' && (entry.weaponSet ?? 0) === set);
  return {
    main: main && isWeaponItem(main.item) ? main.item : null,
    off: items.some(entry => entry.slot === 'off' && (entry.weaponSet ?? 0) === set && entry.item === 'shield') ? 'shield' : null,
  };
}

/** The same displacement rules drive equipped candidates and Shop comparisons. */
export function occupiesEquipmentSlot(entry: InventoryItem, slot: EquipmentSlot, set: WeaponSet): boolean {
  return entry.slot === slot && (slot !== 'main' && slot !== 'off' || (entry.weaponSet ?? 0) === set);
}
export function displacedEquipment(items: readonly InventoryItem[], entry: InventoryItem, slot: EquipmentSlot, set: WeaponSet): InventoryItem[] {
  const needsBothHands = slot === 'main' && isWeaponItem(entry.item) && !supportsShield(entry.item);
  const movingMain = entry.slot === 'main' && (entry.weaponSet ?? 0) !== set;
  const displaced = items.filter(other => other.id !== entry.id && (
    occupiesEquipmentSlot(other, slot, set) || needsBothHands && occupiesEquipmentSlot(other, 'off', set)));
  if (movingMain) displaced.push(...items.filter(other => occupiesEquipmentSlot(other, 'off', entry.weaponSet ?? 0)));
  return displaced;
}
