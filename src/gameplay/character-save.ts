import { isRecord, parseJson } from '../data/json';
import { initialBar, validBar, type ActionBar, type WeaponSet } from './abilities';
import { itemIds, normalizeLoadout, type ItemId, type Loadout } from './equipment';
import {
  countItem,
  itemLoadout,
  receive,
  validItems,
  stackLimit,
  type InventoryItem,
  type LootItem,
} from './inventory';
import { progression } from './skills';

export const characterSaveKey = 'lantern.character.v1';
export const characterBackupKey = `${characterSaveKey}.backup`;
export type CharacterSave = {
  version: 5;
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
  const value = {
    version: 5 as const,
    activeSet: 0 as WeaponSet,
    actionBar: initialBar(itemLoadout(items).main),
    items,
    stash: [] as InventoryItem[],
    shelterRestored: false,
    restedSeconds: 0,
    campfires: ['homestead/camp'],
    xp: { woodcutting: 0, mining: 0, axeCombat: 0 },
    campClaims: [] as ItemId[],
  };
  return Object.defineProperties(value, {
    scrolls: {
      get: () =>
        countItem(
          value.items.filter((i) => i.slot !== 'overflow'),
          'scroll',
        ),
    },
    potions: {
      get: () =>
        countItem(
          value.items.filter((i) => i.slot !== 'overflow'),
          'potion',
        ),
    },
    wood: { get: () => countItem(value.items, 'wood') },
    equipment: {
      get: () =>
        value.items.filter((i) => itemIds.includes(i.item as ItemId)).map((i) => i.item as ItemId),
    },
    loadout: { get: () => itemLoadout(value.items, value.activeSet) },
  }) as CharacterSave;
}

/** Decode into an unpublished candidate; a failed migration never changes gameplay state. */
export function decodeCharacter(raw: string): CharacterSave {
  let result: CharacterSave,
    sequence = 3;
  const newId = () => `item-${++sequence}`;
  const value = parseJson(raw);
  const counter = (n: unknown): n is number =>
    typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER;
  const itemId = (id: unknown): id is ItemId => typeof id === 'string' && itemIds.includes(id as ItemId);
  if (!isRecord(value) || typeof value.version !== 'number' || ![1, 2, 3, 4, 5].includes(value.version)
    || !Array.isArray(value.campfires) || !value.campfires.every((id: unknown): id is string => typeof id === 'string'))
    throw new Error('Invalid character save');
  const hasHome = value.version >= 5 || (value.version === 4 && value.stash !== undefined);
  const hasCombat = value.version >= 5 || (value.version === 4 && value.activeSet !== undefined);
  const xp = isRecord(value.xp) ? value.xp : {};
  if (value.version === 4 && !hasHome && !hasCombat) throw new Error('Invalid character save');
  if (value.version >= 3) {
    if (!validItems(value.items) || !counter(xp.woodcutting) || !counter(xp.axeCombat)
      || !Array.isArray(value.campClaims) || !value.campClaims.every(itemId))
      throw new Error('Invalid inventory save');
    result = character(value.items);
    result.xp = { woodcutting: xp.woodcutting, axeCombat: xp.axeCombat, mining: 0 };
    result.campClaims = [...new Set(value.campClaims)];
    if (hasHome) {
      if (!validItems(value.stash) || value.stash.some(i => i.slot !== 'bag'))
        throw new Error('Invalid Homestead save');
      const storedItems = [...value.items, ...value.stash];
      if (new Set(storedItems.map(i => i.id)).size !== storedItems.length)
        throw new Error('Invalid Homestead save');
      if (typeof value.shelterRestored !== 'boolean' || !counter(value.restedSeconds)
        || value.restedSeconds > progression.restedSeconds || !counter(xp.mining)
        || (!value.shelterRestored && (value.stash.length || value.restedSeconds)))
        throw new Error('Invalid Homestead save');
      result.stash = value.stash;
      result.shelterRestored = value.shelterRestored;
      result.restedSeconds = value.restedSeconds;
      result.xp.mining = xp.mining;
    }
    if (hasCombat) {
      if ((value.activeSet !== 0 && value.activeSet !== 1) || !validBar(value.actionBar))
        throw new Error('Invalid action bar save');
      result.activeSet = value.activeSet;
      result.actionBar = [...value.actionBar];
    }
    for (const entry of [...value.items, ...result.stash])
      sequence = Math.max(sequence, Number(entry.id.match(/^item-(\d+)$/)?.[1] ?? 0));
  } else {
    if (!Number.isSafeInteger(value.scrolls) || !counter(value.scrolls) || value.scrolls > stackLimit)
      throw new Error('Invalid scroll save');
    let equipment: ItemId[] = ['axe'], loadout: Loadout = { main: 'axe', off: null }, wood = 0;
    let legacyXp = { woodcutting: 0, axeCombat: 0, mining: 0 }, claimed = false;
    if (value.version === 2) {
      const savedLoadout = isRecord(value.loadout) ? value.loadout : {};
      if (!Array.isArray(value.equipment) || !value.equipment.every(itemId)
        || !Number.isSafeInteger(value.wood) || !counter(value.wood)
        || !counter(xp.woodcutting) || !counter(xp.axeCombat) || typeof value.campEquipmentClaimed !== 'boolean'
        || !(savedLoadout.main === null || (itemId(savedLoadout.main) && savedLoadout.main !== 'shield'))
        || (savedLoadout.off !== null && savedLoadout.off !== 'shield')
        || (savedLoadout.main && !value.equipment.includes(savedLoadout.main))
        || (savedLoadout.off && !value.equipment.includes(savedLoadout.off)))
        throw new Error('Invalid equipment save');
      equipment = value.equipment;
      loadout = normalizeLoadout({ main: savedLoadout.main, off: savedLoadout.off });
      wood = value.wood;
      legacyXp = { woodcutting: xp.woodcutting, axeCombat: xp.axeCombat, mining: 0 };
      claimed = value.campEquipmentClaimed;
    }
    const items: InventoryItem[] = [];
    for (const item of new Set(equipment))
      items.push({ id: newId(), item, quantity: 1,
        slot: loadout.main === item ? 'main' : loadout.off === item ? 'off' : 'overflow', x: 0, y: 0 });
    // Recover unequipped legacy gear before supplies, preserving anything beyond capacity.
    for (const entry of [...items])
      if (entry.slot === 'overflow') {
        items.splice(items.indexOf(entry), 1);
        if (!receive(items, entry.item, 1, newId, entry.id)) items.push(entry);
      }
    for (const [item, quantity] of [['scroll', value.scrolls], ['wood', wood]] as [LootItem, number][]) {
      const remainder = quantity - receive(items, item, quantity, newId);
      if (remainder) items.push({ id: newId(), item, quantity: remainder, slot: 'overflow', x: 0, y: 0 });
    }
    result = character(items);
    if (value.version === 2) {
      result.xp = legacyXp;
      if (claimed) result.campClaims = ['sword', 'shield', 'bow', 'staff'];
    }
  }
  result.campfires = [...new Set<string>(['homestead/camp', ...value.campfires])];
  if (!hasCombat) {
    const items = result.items,
      remainder = 3 - receive(items, 'potion', 3, newId);
    if (remainder)
      items.push({
        id: newId(),
        item: 'potion',
        quantity: remainder,
        slot: 'overflow',
        x: 0,
        y: 0,
      });
  }
  return result;
}
