import type { LootItem } from '../gameplay/inventory';
const icons: Record<LootItem, { view: string; shape: string }> = {
  axe: { view: '0 0 40 60', shape: '<path class="icon-wood" d="m19 54 3-43 4 1-3 44z"/><path class="icon-metal" d="m24 10 11 5-2 17-10-7-12 3 3-15z"/><path d="m14 15 9-3M29 15l-2 10M18 53l6 1"/>' },
  sword: { view: '0 0 24 72', shape: '<path class="icon-metal" d="m12 3 5 9-3 40h-4L7 12z"/><path d="M12 12v36"/><path class="icon-metal" d="m2 51 10 2 10-2v4l-10 2-10-2z"/><path class="icon-wood" d="M10 57h4v10h-4z"/><path class="icon-metal" d="m12 66 4 3-4 2-4-2z"/>' },
  shield: { view: '0 0 40 60', shape: '<path class="icon-metal" d="M5 10 20 4l15 6v23c-2 9-8 15-15 21-7-6-13-12-15-21z"/><path d="M9 13 20 8l11 5v18c-2 7-6 12-11 17-5-5-9-10-11-17zM20 14v25M12 24h16"/>' },
  bow: { view: '0 0 40 80', shape: '<path class="icon-wood" d="M8 4c34 17 34 55 0 72l4-7c23-17 23-42 0-58z"/><path d="M8 5v70M10 35h5v10h-5M12 13c26 19 26 36 0 54"/>' },
  staff: { view: '0 0 40 80', shape: '<path class="icon-wood" d="m16 75 4-54h5l-4 54z"/><path class="icon-metal" d="m20 23-8-11L23 3l11 10-10 10z"/><path d="m23 8 5 5-5 6-5-6zM19 28h6M17 67h5"/>' },
  scroll: { view: '0 0 40 40', shape: '<path class="icon-paper" d="M11 10h19v22H12M11 10c-5-1-5-7 0-7h16c5 0 5 7 0 7M12 32c-5 0-5 6 0 6h17"/><path d="M16 16h10M16 21h8M16 26h10"/>' },
  wood: { view: '0 0 40 40', shape: '<path class="icon-wood" d="m7 25 20-16c6-5 14 3 8 8L15 33c-6 5-14-3-8-8z"/><path d="M7 25c6-4 14 3 8 8M16 18l7 7M21 14l7 7"/>' },
};
export const itemIcon = (item: LootItem) => `<svg viewBox="${icons[item].view}" aria-hidden="true">${icons[item].shape}</svg>`;
