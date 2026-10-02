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
  let result = character(),
    sequence = 3;
  const newId = () => `item-${++sequence}`;
  const value = JSON.parse(raw),
    counter = (n: unknown) =>
      typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER;
  if (
    ![1, 2, 3, 4, 5].includes(value?.version) ||
    !Array.isArray(value.campfires) ||
    !value.campfires.every((id: unknown) => typeof id === 'string')
  )
    throw new Error('Invalid character save');
  const hasHome = value.version >= 5 || (value.version === 4 && value.stash !== undefined);
  const hasCombat = value.version >= 5 || (value.version === 4 && value.activeSet !== undefined);
  if (value.version === 4 && !hasHome && !hasCombat) throw new Error('Invalid character save');
  if (value.version >= 3) {
    if (
      !validItems(value.items) ||
      !counter(value.xp?.woodcutting) ||
      !counter(value.xp?.axeCombat) ||
      !Array.isArray(value.campClaims) ||
      !value.campClaims.every((id: ItemId) => itemIds.includes(id))
    )
      throw new Error('Invalid inventory save');
    if (hasHome) {
      if (!validItems(value.stash) || value.stash.some((i: InventoryItem) => i.slot !== 'bag')) {
        throw new Error('Invalid Homestead save');
      }
      const storedItems: InventoryItem[] = [...value.items, ...value.stash];
      if (new Set(storedItems.map((i) => i.id)).size !== storedItems.length) {
        throw new Error('Invalid Homestead save');
      }
      if (
        typeof value.shelterRestored !== 'boolean' ||
        !counter(value.restedSeconds) ||
        value.restedSeconds > progression.restedSeconds ||
        !counter(value.xp.mining) ||
        (!value.shelterRestored && (value.stash.length || value.restedSeconds))
      ) {
        throw new Error('Invalid Homestead save');
      }
    }
    if (hasCombat && (![0, 1].includes(value.activeSet) || !validBar(value.actionBar)))
      throw new Error('Invalid action bar save');
    result = character(value.items);
    if (hasCombat) {
      result.activeSet = value.activeSet;
      result.actionBar = [...value.actionBar];
    }
    result.xp = {
      woodcutting: value.xp.woodcutting,
      axeCombat: value.xp.axeCombat,
      mining: hasHome ? value.xp.mining : 0,
    };
    result.campClaims = [...new Set<ItemId>(value.campClaims)];
    if (hasHome) {
      result.stash = value.stash;
      result.shelterRestored = value.shelterRestored;
      result.restedSeconds = value.restedSeconds;
    }
    for (const entry of [...value.items, ...result.stash])
      sequence = Math.max(sequence, Number(entry.id.match(/^item-(\d+)$/)?.[1] ?? 0));
  } else {
    if (
      !Number.isSafeInteger(value.scrolls) ||
      !counter(value.scrolls) ||
      value.scrolls > stackLimit
    )
      throw new Error('Invalid scroll save');
    if (
      value.version === 2 &&
      (!Array.isArray(value.equipment) ||
        !value.equipment.every((id: ItemId) => itemIds.includes(id)) ||
        !Number.isSafeInteger(value.wood) ||
        !counter(value.wood) ||
        !counter(value.xp?.woodcutting) ||
        !counter(value.xp?.axeCombat) ||
        typeof value.campEquipmentClaimed !== 'boolean' ||
        !value.loadout ||
        !(
          value.loadout.main === null ||
          (itemIds.includes(value.loadout.main) && value.loadout.main !== 'shield')
        ) ||
        ![null, 'shield'].includes(value.loadout.off) ||
        (value.loadout.main && !value.equipment.includes(value.loadout.main)) ||
        (value.loadout.off && !value.equipment.includes(value.loadout.off)))
    )
      throw new Error('Invalid equipment save');
    const items: InventoryItem[] = [],
      loadout = value.version === 2 ? normalizeLoadout(value.loadout) : { main: 'axe', off: null };
    for (const item of new Set<ItemId>(value.version === 2 ? value.equipment : ['axe']))
      items.push({
        id: newId(),
        item,
        quantity: 1,
        slot: loadout.main === item ? 'main' : loadout.off === item ? 'off' : 'overflow',
        x: 0,
        y: 0,
      });
    // Recover unequipped legacy gear before supplies, preserving anything beyond capacity.
    for (const entry of [...items])
      if (entry.slot === 'overflow') {
        items.splice(items.indexOf(entry), 1);
        if (!receive(items, entry.item, 1, newId, entry.id)) items.push(entry);
      }
    for (const [item, quantity] of [
      ['scroll', value.scrolls],
      ['wood', value.version === 2 ? value.wood : 0],
    ] as [LootItem, number][]) {
      const remainder = quantity - receive(items, item, quantity, newId);
      if (remainder)
        items.push({ id: newId(), item, quantity: remainder, slot: 'overflow', x: 0, y: 0 });
    }
    result = character(items);
    if (value.version === 2) {
      result.xp = { woodcutting: value.xp.woodcutting, axeCombat: value.xp.axeCombat, mining: 0 };
      if (value.campEquipmentClaimed) result.campClaims = ['sword', 'shield', 'bow', 'staff'];
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
