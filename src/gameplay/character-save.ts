import { decodeOuting } from './outing';
import { isRecord, parseJson } from '../data/json';
import { validBar, abilityUnlocked } from './abilities';
import { character, type CharacterSave } from './character';
import { isItemId, isWeaponItem, normalizeLoadout, type ItemId, type Loadout } from './equipment';
import {
  receive,
  validItems,
  validStash,
  stackLimit,
  type InventoryItem,
  type LootItem,
} from './inventory';
import { buybackLimit, type BuybackEntry } from './economy';
import { progression, skillIds } from './skills';

export const characterSaveKey = 'lantern.character.v1';
export const characterBackupKey = `${characterSaveKey}.backup`;
type SavedFields = Record<string, unknown>;

function counter(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER;
}

/** Decode into an unpublished candidate; a failed migration never changes gameplay state. */
export function decodeCharacter(raw: string): CharacterSave {
  return restoreCharacter(parseJson(raw));
}
/** Validate and detach in-memory snapshots without a JSON serialization round trip. */
export function copyCharacter(value: unknown): CharacterSave {
  return restoreCharacter(structuredClone(value));
}
function restoreCharacter(value: unknown): CharacterSave {
  if (!isRecord(value) || typeof value.version !== 'number' || ![1, 2, 3, 4, 5, 6, 7, 8, 9].includes(value.version)
    || !Array.isArray(value.campfires) || !value.campfires.every((id: unknown): id is string => typeof id === 'string'))
    throw new Error('Invalid character save');

  // Revision 4 shipped with independently optional Homestead and combat fields.
  const hasHome = value.version >= 5 || (value.version === 4 && value.stash !== undefined);
  const hasCombat = value.version >= 5 || (value.version === 4 && value.activeSet !== undefined);
  if (value.version === 4 && !hasHome && !hasCombat) throw new Error('Invalid character save');
  const xp = isRecord(value.xp) ? value.xp : {};
  let sequence = 3;
  const newId = () => `item-${++sequence}`;
  const result = value.version >= 3
    ? restoreInventory(value, xp, hasHome, hasCombat)
    : migrateLegacyInventory(value, xp, newId);

  if (value.version >= 3) {
    for (const entry of [...result.items, ...result.stash])
      sequence = Math.max(sequence, Number(entry.id.match(/^item-(\d+)$/)?.[1] ?? 0));
  }
  if (value.version >= 7) restoreEconomy(value, result);
  if (value.version >= 8) {
    for (const id of skillIds) {
      if (!counter(xp[id])) throw new Error('Invalid skill progress');
      result.xp[id] = xp[id];
    }
  }
  if (value.version >= 9) {
    result.outing = decodeOuting(value.outing);
    const ids = new Set([...result.items, ...result.stash, ...result.buyback].map(entry => entry.id));
    for (const area of Object.values(result.outing.areas)) for (const drop of area.drops) {
      for (const id of new Set([drop.id, drop.instanceId].filter((id): id is string => id !== undefined))) {
        if (ids.has(id)) throw new Error('Duplicate saved item');
        ids.add(id);
      }
    }
  }
  result.campfires = [...new Set<string>(['homestead/camp', ...value.campfires])];
  if (!hasCombat) recoverSupplies(result.items, 'potion', 3, newId);
  result.actionBar=result.actionBar.map(id=>id && abilityUnlocked(id,result.xp) ? id : null);
  return result;
}

function restoreInventory(value: SavedFields, xp: SavedFields, hasHome: boolean, hasCombat: boolean): CharacterSave {
  if (!validItems(value.items) || !counter(xp.woodcutting) || !counter(xp.axeCombat)
    || !Array.isArray(value.campClaims) || !value.campClaims.every(isItemId))
    throw new Error('Invalid inventory save');
  const result = character(value.items);
  Object.assign(result.xp, { woodcutting: xp.woodcutting, axeCombat: xp.axeCombat });
  result.campClaims = [...new Set(value.campClaims)];
  if (hasHome) restoreHomestead(value, xp, result);
  if (hasCombat) restoreCombat(value, result);
  return result;
}

function restoreHomestead(value: SavedFields, xp: SavedFields, result: CharacterSave): void {
  if (!validStash(value.stash, result.items))
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

function restoreCombat(value: SavedFields, result: CharacterSave): void {
  if ((value.activeSet !== 0 && value.activeSet !== 1) || !validBar(value.actionBar))
    throw new Error('Invalid action bar save');
  result.activeSet = value.activeSet;
  result.actionBar = [...value.actionBar];
}

function migrateLegacyInventory(value: SavedFields, xp: SavedFields, newId: () => string): CharacterSave {
  if (!Number.isSafeInteger(value.scrolls) || !counter(value.scrolls) || value.scrolls > stackLimit)
    throw new Error('Invalid scroll save');
  let equipment: ItemId[] = ['axe'], loadout: Loadout = { main: 'axe', off: null }, wood = 0;
  let legacyXp = { woodcutting: 0, axeCombat: 0, mining: 0 }, claimed = false;
  if (value.version === 2) {
    const savedLoadout = isRecord(value.loadout) ? value.loadout : {};
    if (!Array.isArray(value.equipment) || !value.equipment.every(isItemId)
      || !Number.isSafeInteger(value.wood) || !counter(value.wood)
      || !counter(xp.woodcutting) || !counter(xp.axeCombat) || typeof value.campEquipmentClaimed !== 'boolean'
      || !(savedLoadout.main === null || isWeaponItem(savedLoadout.main))
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
  recoverSupplies(items, 'scroll', value.scrolls, newId);
  recoverSupplies(items, 'wood', wood, newId);
  const result = character(items);
  if (value.version === 2) {
    Object.assign(result.xp, legacyXp);
    if (claimed) result.campClaims = ['sword', 'shield', 'bow', 'staff'];
  }
  return result;
}

function restoreEconomy(value: SavedFields, result: CharacterSave): void {
  if (!Number.isSafeInteger(value.gold) || !counter(value.gold) || !Array.isArray(value.buyback)
    || value.buyback.length > buybackLimit) throw new Error('Invalid gold save');
  const buyback: BuybackEntry[] = [];
  for (const entry of value.buyback) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id || !isItemId(entry.item)
      || !Number.isSafeInteger(entry.price) || !counter(entry.price) || entry.price < 1)
      throw new Error('Invalid buyback save');
    buyback.push({ id: entry.id, item: entry.item, price: entry.price });
  }
  const ids = [...result.items, ...result.stash, ...buyback].map(entry => entry.id);
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate buyback identity');
  result.gold = value.gold;
  result.buyback = buyback;
}

/** Migrations never discard supplies when a legacy bag is full. */
function recoverSupplies(items: InventoryItem[], item: LootItem, quantity: number, newId: () => string): void {
  const remainder = quantity - receive(items, item, quantity, newId);
  if (remainder) items.push({ id: newId(), item, quantity: remainder, slot: 'overflow', x: 0, y: 0 });
}
