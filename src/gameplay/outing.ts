import { isRecord } from '../data/json';
import { abilities, type AbilityId } from './abilities';
import { lootDefinitions } from './inventory';
import { isItemId } from './equipment';
import { dropLandingSeconds, type GroundDrop } from './ground-loot';
import { enemyMaxHealth } from './encounter-model';
import type { Spawn } from './area';

export const renewalSeconds = 45 * 60;
export const renewalDistance = 12;
export type RewardSource = { kind: 'enemy' | 'chest' | 'resource'; id: string };
export type SavedEnemy = { hp: number; lowestHp: number; rewarded: boolean; renewAt?: number };
export type SavedChest = { opened: boolean; remaining: number; renewAt?: number };
export type SavedResource = { hits: number; regrowAt?: number };
export type SavedArea = {
  enemies: Record<string, SavedEnemy>;
  chests: Record<string, SavedChest>;
  resources: Record<string, SavedResource>;
  drops: GroundDrop[];
};
export type SavedCooldowns = {
  abilityCooldowns: Partial<Record<AbilityId, number>>;
  ultimateCooldown: number;
  potionCooldown: number;
  dodgeCooldown: number;
  attackCooldown: number;
};
export type OutingSave = {
  elapsed: number;
  checkpoint: string;
  portal: { area: string; departure: Spawn & { height?: number } } | null;
  cooldowns: SavedCooldowns;
  areas: Record<string, SavedArea>;
};
export const emptyCooldowns = (): SavedCooldowns => ({ abilityCooldowns: {}, ultimateCooldown: 0, potionCooldown: 0, dodgeCooldown: 0, attackCooldown: 0 });
export const freshOuting = (): OutingSave => ({ elapsed: 0, checkpoint: 'homestead/camp', portal: null, cooldowns: emptyCooldowns(), areas: {} });
export const sameSource = (a: RewardSource | undefined, b: RewardSource): boolean => a?.kind === b.kind && a.id === b.id;
const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER;
const counter = (v: unknown): v is number => number(v) && v >= 0;
const point = (v: unknown): boolean => Array.isArray(v) && v.length === 2 && v.every(number);
const deadline = (v: unknown): boolean => v === undefined || counter(v);
const record = (v: unknown, check: (entry: Record<string, unknown>) => boolean): boolean => isRecord(v) && Object.values(v).every(entry => isRecord(entry) && check(entry));
function validDrop(drop: Record<string, unknown>): boolean {
  return typeof drop.id === 'string' && (drop.item === 'gold' || typeof drop.item === 'string' && Object.hasOwn(lootDefinitions, drop.item))
    && counter(drop.quantity) && Number.isSafeInteger(drop.quantity) && drop.quantity > 0
    && point(drop.position) && point(drop.origin) && number(drop.height) && counter(drop.age)
    && (drop.claim === undefined || isItemId(drop.claim))
    && (drop.instanceId === undefined || typeof drop.instanceId === 'string')
    && (drop.blocked === undefined || typeof drop.blocked === 'boolean')
    && (drop.source === undefined || isRecord(drop.source) && ['enemy', 'chest', 'resource'].includes(String(drop.source.kind)) && typeof drop.source.id === 'string')
    && (drop.harvestXp === undefined || isRecord(drop.harvestXp) && ['woodcutting', 'mining'].includes(String(drop.harvestXp.skill)) && counter(drop.harvestXp.perUnit));
}
/** Reject malformed snapshots as a unit so existing backup recovery remains authoritative. */
export function decodeOuting(value: unknown): OutingSave {
  if (!isRecord(value) || !counter(value.elapsed) || typeof value.checkpoint !== 'string' || !isRecord(value.cooldowns)
    || !isRecord(value.cooldowns.abilityCooldowns)
    || !Object.entries(value.cooldowns.abilityCooldowns).every(([key, time]) => Object.hasOwn(abilities, key) && counter(time))
    || !['ultimateCooldown', 'potionCooldown', 'dodgeCooldown', 'attackCooldown'].every(key => counter((value.cooldowns as Record<string, unknown>)[key])))
    throw new Error('Invalid outing save');
  if (!(value.portal === null || isRecord(value.portal) && typeof value.portal.area === 'string'
    && isRecord(value.portal.departure) && point(value.portal.departure.position) && number(value.portal.departure.yaw)
    && (value.portal.departure.height === undefined || number(value.portal.departure.height)))) throw new Error('Invalid portal save');
  if (!record(value.areas, area => record(area.enemies, enemy => typeof enemy.rewarded === 'boolean' && counter(enemy.hp) && enemy.hp <= enemyMaxHealth && counter(enemy.lowestHp) && enemy.lowestHp <= enemyMaxHealth && deadline(enemy.renewAt) && (enemy.hp > 0 ? enemy.renewAt === undefined : enemy.renewAt !== undefined))
    && record(area.chests, chest => typeof chest.opened === 'boolean' && counter(chest.remaining) && Number.isSafeInteger(chest.remaining) && deadline(chest.renewAt) && (chest.opened ? chest.renewAt !== undefined : chest.renewAt === undefined))
    && record(area.resources, resource => counter(resource.hits) && Number.isSafeInteger(resource.hits) && deadline(resource.regrowAt))
    && Array.isArray(area.drops) && area.drops.every(drop => isRecord(drop) && validDrop(drop)))) throw new Error('Invalid area save');
  const candidate = structuredClone(value) as OutingSave;
  const ids = new Set<string>();
  for (const area of Object.values(candidate.areas)) for (const drop of area.drops) {
    if (ids.has(drop.id)) throw new Error('Duplicate ground item');
    ids.add(drop.id);
    // Land restored drops without replaying their creation or impact sounds.
    drop.age = Math.max(drop.age, dropLandingSeconds);
  }
  return candidate;
}
