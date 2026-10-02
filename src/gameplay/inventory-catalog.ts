import type { WeaponSet } from './abilities';
import { equipmentCatalog, itemIds, type EquipmentSlot, type ItemId } from './equipment';

/** Item identity, footprints and container limits shared by gameplay and presentation. */
export const bagWidth = 12,
  bagHeight = 8,
  stackLimit = 99;
export type LootItem = ItemId | 'scroll' | 'wood' | 'potion' | 'stone' | 'iron';
export type InventoryItem = {
  id: string;
  item: LootItem;
  quantity: number;
  slot: 'bag' | EquipmentSlot | 'overflow';
  weaponSet?: WeaponSet;
  x: number;
  y: number;
};
type LootDefinition = { name: string; width: number; height: number; stackable: boolean };
export const lootDefinitions: Record<
  LootItem,
  LootDefinition
> = {
  ...itemIds.reduce((result, id) => {
    const { name, width, height } = equipmentCatalog[id];
    result[id] = { name, width, height, stackable: false };
    return result;
  }, {} as Record<ItemId, LootDefinition>),
  scroll: { name: 'Scroll of Return', width: 1, height: 1, stackable: true },
  potion: { name: 'Health Potion', width: 1, height: 1, stackable: true },
  wood: { name: 'Wood', width: 1, height: 1, stackable: true },
  stone: { name: 'Stone', width: 1, height: 1, stackable: true },
  iron: { name: 'Iron', width: 1, height: 1, stackable: true },
};
export const lootIds = Object.keys(lootDefinitions) as LootItem[];
