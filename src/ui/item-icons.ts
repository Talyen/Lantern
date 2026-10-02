import type { LootItem } from '../gameplay/inventory';
const shapes: Record<LootItem, string> = {
  axe: '<path d="M16 34 23 5M23 5l10 5-3 11-9-5-8 2 2-10z"/>',
  sword: '<path d="m14 34 3-8M11 24l12 4M18 25 25 5l5-2 1 5-11 19M12 35l4 2"/>',
  shield: '<path d="M9 7 20 3l11 4v14c-2 7-6 11-11 15-5-4-9-8-11-15zM20 8v22M12 15h16"/>',
  bow: '<path d="M12 3c23 10 23 24 0 34l11-17zM5 20h29M29 16l5 4-5 4"/>',
  staff: '<path d="m13 36 11-25M24 11l-6-5 7-3 5 5zM20 13l8 3"/>',
  scroll: '<path d="M11 10h19v22H12M11 10c-5-1-5-7 0-7h16c5 0 5 7 0 7M12 32c-5 0-5 6 0 6h17M16 16h10M16 21h8M16 26h10"/>',
  wood: '<path d="m7 25 20-16c6-5 14 3 8 8L15 33c-6 5-14-3-8-8zM7 25c6-4 14 3 8 8M16 18l7 7M21 14l7 7"/>',
};
export const itemIcon = (item: LootItem) => `<svg viewBox="0 0 40 40" aria-hidden="true">${shapes[item]}</svg>`;
