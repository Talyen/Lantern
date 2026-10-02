import { equipmentCatalog, isItemId, isEquipmentSlot, type Bonuses, type EquipmentDefinition, type Weapon } from './equipment';
import type { InventoryItem } from './inventory';
import type { WeaponSet } from './abilities';

export type CombatStats = {
  damage: number;
  attackRate: number;
  reach: number;
  armor: number;
  maxHealth: number;
  maxMana: number;
  manaRegen: number;
  moveSpeed: number;
  family: Weapon | null;
};
export const baseStats = { maxHealth: 100, maxMana: 100, manaRegen: 8, moveSpeed: 3.2 };

/** Shared armor/accessories plus only the selected weapon set. */
export function resolveCombatStats(items: readonly InventoryItem[], set: WeaponSet = 0): CombatStats {
  const bonuses: Required<Bonuses> = {
    armor: 0, health: 0, mana: 0, manaRegen: 0, damage: 0, attackRate: 0, moveSpeed: 0,
  };
  let weapon: EquipmentDefinition['weapon'];
  for (const entry of items) {
    if (!isEquipmentSlot(entry.slot) || !isItemId(entry.item)) continue;
    const handSlot = entry.slot === 'main' || entry.slot === 'off';
    if (handSlot && (entry.weaponSet ?? 0) !== set) continue;
    const definition = equipmentCatalog[entry.item];
    if (entry.slot === 'main') weapon = definition.weapon;
    for (const key of Object.keys(definition.bonuses) as (keyof Bonuses)[])
      bonuses[key] += definition.bonuses[key]!;
  }
  return {
    damage: (weapon?.damage ?? 0) * (1 + bonuses.damage),
    attackRate: (weapon?.rate ?? 1) * (1 + bonuses.attackRate),
    reach: weapon?.reach ?? 0,
    family: weapon?.family ?? null,
    armor: bonuses.armor,
    maxHealth: baseStats.maxHealth + bonuses.health,
    maxMana: baseStats.maxMana + bonuses.mana,
    manaRegen: baseStats.manaRegen + bonuses.manaRegen,
    moveSpeed: baseStats.moveSpeed * (1 + bonuses.moveSpeed),
  };
}
export const armoredDamage = (damage: number, armor: number) => damage * 100 / (100 + armor);
