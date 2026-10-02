import { bagWidth, bagHeight, lootDefinitions, type InventoryItem, type LootItem } from './inventory-catalog';

/** Bag geometry only; callers decide how to commit a placement. */
export function fits(
  items: readonly InventoryItem[],
  item: LootItem,
  x: number,
  y: number,
  exclude?: string,
): boolean {
  const { width, height } = lootDefinitions[item];
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    y >= 0 &&
    x + width <= bagWidth &&
    y + height <= bagHeight &&
    !items.some(
      (i) =>
        i.slot === 'bag' &&
        i.id !== exclude &&
        x < i.x + lootDefinitions[i.item].width &&
        x + width > i.x &&
        y < i.y + lootDefinitions[i.item].height &&
        y + height > i.y,
    )
  );
}
export function emptyPosition(
  items: readonly InventoryItem[],
  item: LootItem,
): { x: number; y: number } | undefined {
  for (let y = 0; y < bagHeight; y++)
    for (let x = 0; x < bagWidth; x++) if (fits(items, item, x, y)) return { x, y };
}
