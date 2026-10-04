import { bagWidth, bagHeight, lootDefinitions, type InventoryItem, type LootItem } from './inventory-catalog';

/** Bag geometry only; callers decide how to commit a placement. */
export function fits(items: readonly InventoryItem[], item: LootItem, x: number, y: number, exclude?: string): boolean {
  const { width, height } = lootDefinitions[item];
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x + width > bagWidth || y + height > bagHeight) return false;
  return !items.some(entry => {
    if (entry.slot !== 'bag' || entry.id === exclude) return false;
    const occupied = lootDefinitions[entry.item];
    return x < entry.x + occupied.width && x + width > entry.x && y < entry.y + occupied.height && y + height > entry.y;
  });
}
export function emptyPosition(items: readonly InventoryItem[], item: LootItem): { x: number; y: number } | undefined {
  for (let y = 0; y < bagHeight; y++)
    for (let x = 0; x < bagWidth; x++) if (fits(items, item, x, y)) return { x, y };
}
