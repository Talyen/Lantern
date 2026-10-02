import { initialBar, type ActionBar, type WeaponSet } from './abilities';
import { isItemId, weaponFamily, type ItemId, type Loadout } from './equipment';
import { countItem, itemLoadout, type InventoryItem } from './inventory';
import type { BuybackEntry } from './economy';

/** Live character state; save decoding and browser storage have separate owners. */
export type CharacterSave = {
  version: 7;
  gold: number;
  buyback: BuybackEntry[];
  activeSet: WeaponSet;
  actionBar: ActionBar;
  items: InventoryItem[];
  stash: InventoryItem[];
  shelterRestored: boolean;
  restedSeconds: number;
  campfires: string[];
  xp: { woodcutting: number; mining: number; axeCombat: number };
  campClaims: ItemId[];
  readonly scrolls: number;
  readonly potions: number;
  readonly wood: number;
  readonly equipment: ItemId[];
  readonly loadout: Loadout;
};
export function character(
  items: InventoryItem[] = [
    { id: 'item-1', item: 'axe', quantity: 1, slot: 'main', x: 0, y: 0 },
    { id: 'item-2', item: 'scroll', quantity: 3, slot: 'bag', x: 0, y: 0 },
    { id: 'item-3', item: 'potion', quantity: 3, slot: 'bag', x: 1, y: 0 },
  ],
): CharacterSave {
  const value: CharacterSave = {
    version: 7,
    gold: 0,
    buyback: [],
    activeSet: 0,
    actionBar: initialBar(weaponFamily(itemLoadout(items).main)),
    items,
    stash: [],
    shelterRestored: false,
    restedSeconds: 0,
    campfires: ['homestead/camp'],
    xp: { woodcutting: 0, mining: 0, axeCombat: 0 },
    campClaims: [],
    get scrolls() {
      return countItem(value.items.filter(entry => entry.slot !== 'overflow'), 'scroll');
    },
    get potions() {
      return countItem(value.items.filter(entry => entry.slot !== 'overflow'), 'potion');
    },
    get wood() { return countItem(value.items, 'wood'); },
    get equipment() { return value.items.map(entry => entry.item).filter(isItemId); },
    get loadout() { return itemLoadout(value.items, value.activeSet); },
  };
  // Derived values remain live, read-only and absent from saves/object copies.
  for (const key of ['scrolls', 'potions', 'wood', 'equipment', 'loadout'] as const)
    Object.defineProperty(value, key, { enumerable: false, configurable: false });
  return value;
}
