import type { WeaponSet } from './abilities';
import { isEquipmentSlot, isWeaponItem, type Loadout } from './equipment';
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
