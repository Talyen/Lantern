import type { ItemId } from './equipment';
import type { LootItem } from './inventory';

export type EnemyRank = 'normal' | 'elite' | 'boss';
export type RewardMetadata = { level?: number; gold?: boolean };
export type EnemyRewards = RewardMetadata & { humanoid?: boolean; rank?: EnemyRank };
export type GoldSource = RewardMetadata & { areaLevel?: number } & (
  | { kind: 'enemy'; humanoid?: boolean; rank?: EnemyRank }
  | { kind: 'chest' }
);
export type BuybackEntry = { id: string; item: ItemId; price: number };
export const buybackLimit = 10;
export const goldRanks: Record<EnemyRank, { chance: number; multiplier: number }> = {
  normal: { chance: .5, multiplier: 1 }, elite: { chance: .75, multiplier: 2 }, boss: { chance: 1, multiplier: 5 },
};
/** Reward levels affect gold only. Unspecified creatures never inherit humanoid eligibility. */
export function rollGold(source: GoldSource, random = Math.random): number {
  if (source.gold === false || source.kind === 'enemy' && source.humanoid !== true) return 0;
  const { chance, multiplier } = source.kind === 'chest' ? { chance: .6, multiplier: 1 } : goldRanks[source.rank ?? 'normal'];
  if (random() >= chance) return 0;
  const level = source.level ?? source.areaLevel ?? 1;
  return Math.min(Number.MAX_SAFE_INTEGER, (3 + Math.floor(random() * 3) + level - 1) * multiplier);
}
export const shopStock: readonly { item: LootItem; price: number }[] = [
  { item: 'potion', price: 5 }, { item: 'sword', price: 60 }, { item: 'bow', price: 60 },
  { item: 'shield', price: 40 }, { item: 'quilted-coat', price: 80 }, { item: 'trail-boots', price: 60 },
];
export const sellPrices: Record<ItemId, number> = {
  axe: 15, sword: 15, bow: 15, staff: 15, shield: 10,
  'iron-broadsword': 30, 'yew-longbow': 30, 'guard-helm': 15, 'weathered-mail': 20,
  'quilted-coat': 20, 'duelist-gloves': 20, 'trail-boots': 15, 'iron-signet': 25,
  'hearth-ring': 20, 'amber-amulet': 25, 'leather-belt': 10,
};
