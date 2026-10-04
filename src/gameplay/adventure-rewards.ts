import type { AreaDefinition, Chest } from '../levels/types';
import type { EnemyId } from './encounter';
import type { ItemId } from './equipment';
import { rollGold, rollEquipment } from './economy';
import type { DropOptions, GroundItem } from './ground-loot';

type Reward = { item: GroundItem; quantity: number; options?: DropOptions };

function equipmentRewards(items: readonly ItemId[], claims: readonly ItemId[]): Reward[] {
  return items.filter(item => !claims.includes(item)).map(item => ({ item, quantity: 1, options: { claim: item } }));
}

/** Preserve reward order and random draw order; opening/defeat eligibility is Adventure-owned. */
export function chestRewards(
  chest: Chest, scrolls: number, areaLevel: number | undefined,
  claims: readonly ItemId[], random: () => number,
): Reward[] {
  const rewards: Reward[] = [];
  const gold = rollGold({ kind: 'chest', areaLevel, level: chest.level, gold: chest.gold }, random);
  if (gold) rewards.push({ item: 'gold', quantity: gold });
  if (scrolls) rewards.push({ item: 'scroll', quantity: scrolls });
  if (chest.potions) rewards.push({ item: 'potion', quantity: chest.potions });
  return [...rewards, ...equipmentRewards(chest.equipment ?? [], claims)];
}

export function enemyRewards(
  area: AreaDefinition, id: EnemyId, claims: readonly ItemId[], random: () => number,
): Reward[] {
  const rewards: Reward[] = [];
  if (random() < .5) rewards.push({ item: 'scroll', quantity: 1 });
  const legacySource = id === 'enemy' || id === 'caster' ? area.layout[id] : undefined;
  const source = area.layout.enemies?.find(enemy => enemy.id === id) ?? legacySource;
  const gold = rollGold({ ...source, kind: 'enemy', areaLevel: area.level }, random);
  if (gold) rewards.push({ item: 'gold', quantity: gold });
  rewards.push(...equipmentRewards(area.enemyEquipment?.[id] ?? [], claims));
  const equipment = rollEquipment(source?.equipmentDrops, random);
  if (equipment) rewards.push({ item: equipment, quantity: 1 });
  return rewards;
}
