import type { LootItem } from '../gameplay/inventory';
const icons: Record<LootItem, { view: string; shape: string }> = {
  'iron-broadsword': {view:'0 0 32 72',shape:'<path class="icon-metal" d="m16 3 11 12-7 34h-8L5 15z"/><path d="M16 13v33"/><path class="icon-metal" d="M3 49h26v7H3zM10 65h12l-6 6z"/><path class="icon-wood" d="M13 56h6v10h-6z"/>'},
  'yew-longbow': {view:'0 0 40 88',shape:'<path class="icon-wood" d="m8 3 12 10 10 18 2 13-2 13-10 18-12 10 3-10 11-21 3-10-3-10-11-21z"/><path d="M8 3v82M21 34h8v20h-8M12 15l8 13M12 73l8-13"/>'},
  'guard-helm': {view:'0 0 48 48',shape:'<path class="icon-metal" d="M8 34V21C8 3 40 3 40 21v13l-8 8-3-19H19l-3 19z"/><path d="M24 8v13M9 26l10-3M39 26l-10-3"/>'},
  'weathered-mail': {view:'0 0 48 56',shape:'<path class="icon-metal" d="m17 5-12 8-3 15 11 3v21h22V31l11-3-3-15-12-8-7 7z"/><path d="m17 18 7 7 7-7M15 31l9 8 9-8M16 43h16"/>'},
  'quilted-coat': {view:'0 0 48 56',shape:'<path class="icon-wood" d="m17 5-12 8-3 15 11 3-2 21h26l-2-21 11-3-3-15-12-8-7 7z"/><path d="M24 13v38M14 21l20 20M14 31l16 16M34 21 14 41"/>'},
  'duelist-gloves': {view:'0 0 48 48',shape:'<path class="icon-wood" d="M8 42 5 25 9 7h5l1 16 5-19h5l-1 20 7-15h5l-7 24-7 9z"/><path d="m7 31 19 1M11 37h12"/>'},
  'trail-boots': {view:'0 0 48 48',shape:'<path class="icon-wood" d="M11 5h22l-3 24 12 7v8H8v-9l5-7z"/><path d="M11 12h21M12 19h19M9 39h32M20 29l9 6"/>'},
  'iron-signet': {view:'0 0 48 48',shape:'<path class="icon-metal" d="M11 24a13 13 0 1 0 26 0l-6 2a7 7 0 1 1-14 0zM15 7h18v15H15z"/><path d="m24 10 5 5-5 4-5-4z"/>'},
  'hearth-ring': {view:'0 0 48 48',shape:'<path class="icon-metal" d="M12 23a12 12 0 1 0 24 0l-6 2a6 6 0 1 1-12 0z"/><path class="icon-wood" d="m24 5 9 11-9 9-9-9z"/><path d="M24 10v10"/>'},
  'amber-amulet': {view:'0 0 48 56',shape:'<path d="M10 5c-3 14 4 24 14 30C34 29 41 19 38 5"/><path class="icon-metal" d="m24 31 11 10-11 12-11-12z"/><path class="icon-wood" d="m24 36 6 5-6 7-6-7z"/>'},
  'leather-belt': {view:'0 0 64 32',shape:'<path class="icon-wood" d="M3 9h58v15H3z"/><path class="icon-metal" d="M22 5h20v23H22z"/><path d="M27 10h10v13H27M33 16h12M10 16h2M15 16h2M51 16h2"/>'},
  potion: { view: '0 0 40 52', shape: '<path class="icon-metal" d="M15 3h10v8H15z"/><path class="icon-potion" d="M14 12h12v8l8 9v16l-6 4H12l-6-4V29l8-9z"/><path d="M14 33h12M20 27v12"/>' },
  axe: { view: '0 0 40 60', shape: '<path class="icon-wood" d="m19 54 3-43 4 1-3 44z"/><path class="icon-metal" d="m24 10 11 5-2 17-10-7-12 3 3-15z"/><path d="m14 15 9-3M29 15l-2 10M18 53l6 1"/>' },
  sword: { view: '0 0 24 72', shape: '<path class="icon-metal" d="m12 3 5 9-3 40h-4L7 12z"/><path d="M12 12v36"/><path class="icon-metal" d="m2 51 10 2 10-2v4l-10 2-10-2z"/><path class="icon-wood" d="M10 57h4v10h-4z"/><path class="icon-metal" d="m12 66 4 3-4 2-4-2z"/>' },
  shield: { view: '0 0 40 60', shape: '<path class="icon-metal" d="M5 10 20 4l15 6v23c-2 9-8 15-15 21-7-6-13-12-15-21z"/><path d="M9 13 20 8l11 5v18c-2 7-6 12-11 17-5-5-9-10-11-17zM20 14v25M12 24h16"/>' },
  bow: { view: '0 0 40 80', shape: '<path class="icon-wood" d="M8 4c34 17 34 55 0 72l4-7c23-17 23-42 0-58z"/><path d="M8 5v70M10 35h5v10h-5M12 13c26 19 26 36 0 54"/>' },
  staff: { view: '0 0 40 80', shape: '<path class="icon-wood" d="m16 75 4-54h5l-4 54z"/><path class="icon-metal" d="m20 23-8-11L23 3l11 10-10 10z"/><path d="m23 8 5 5-5 6-5-6zM19 28h6M17 67h5"/>' },
  scroll: { view: '0 0 40 40', shape: '<path class="icon-paper" d="M11 10h19v22H12M11 10c-5-1-5-7 0-7h16c5 0 5 7 0 7M12 32c-5 0-5 6 0 6h17"/><path d="M16 16h10M16 21h8M16 26h10"/>' },
  stone: { view: '0 0 40 40', shape: '<path class="icon-metal" d="m5 25 6-15 17-5 9 14-6 14-17 3z"/><path d="m11 10 10 10 16-1M21 20l-7 16M21 20l10 13"/>' },
  iron: { view: '0 0 40 40', shape: '<path class="icon-metal" d="m4 27 7-15 13-7 12 17-8 13-16-2z"/><path d="m11 12 9 13 16-3M20 25l-8 8M24 5l-4 20"/><path class="icon-wood" d="m12 18 7-4 3 5-7 4z"/>' },
  wood: { view: '0 0 40 40', shape: '<path class="icon-wood" d="m7 25 20-16c6-5 14 3 8 8L15 33c-6 5-14-3-8-8z"/><path d="M7 25c6-4 14 3 8 8M16 18l7 7M21 14l7 7"/>' },
};
export const itemIcon = (item: LootItem) => {
  const icon = icons[item];
  return `<svg viewBox="${icon.view}" aria-hidden="true">${icon.shape}</svg>`;
};
