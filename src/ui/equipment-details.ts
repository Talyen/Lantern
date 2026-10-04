import { smithingMeleeMultiplier } from '../gameplay/smithing';
import type { CharacterSave } from '../gameplay/character';
import type { WeaponSet } from '../gameplay/abilities';
import { resolveCombatStats, type CombatStats } from '../gameplay/combat-stats';
import { equipmentCatalog, isItemId, isWeaponItem, supportsShield, type Bonuses, type EquipmentSlot } from '../gameplay/equipment';
import { lootDefinitions, type InventoryItem } from '../gameplay/inventory';

const statLabels: Record<keyof CombatStats, string> = {
  baseDamage: 'Weapon damage', damage: 'Damage', attackRate: 'Attack speed', reach: 'Reach / Range', armor: 'Armor',
  maxHealth: 'Health', maxMana: 'Mana', manaRegen: 'Mana recovery', moveSpeed: 'Movement', family: 'Weapon',
};
const bonusLabels: Record<keyof Bonuses, string> = {
  armor: 'Armor', health: 'Health', mana: 'Mana', manaRegen: 'Mana recovery',
  damage: 'Damage', attackRate: 'Attack speed', moveSpeed: 'Movement',
};
const comparisonStats = ['damage', 'attackRate', 'reach', 'armor', 'maxHealth', 'maxMana', 'manaRegen', 'moveSpeed'] as const;

function statLabel(key: keyof CombatStats): string {
  return statLabels[key];
}
function statValue(key: keyof CombatStats, value: number): string {
  if (key === 'attackRate') return `${Math.round(value * 100)}%`;
  const amount = Number(value.toFixed(2));
  if (key === 'reach') return `${amount} m`;
  if (key === 'moveSpeed') return `${amount} m/s`;
  if (key === 'manaRegen') return `${amount}/s`;
  return String(amount);
}
function statRow(label: string, value: string): HTMLDivElement {
  const row = document.createElement('div');
  const name = document.createElement('span');
  const amount = document.createElement('strong');
  name.textContent = label;
  amount.textContent = value;
  row.append(name, amount);
  return row;
}
function bonusValue(key: keyof Bonuses, value: number): string {
  if (key === 'damage' || key === 'attackRate' || key === 'moveSpeed') return `+${Math.round(value * 100)}%`;
  return `+${value}${key === 'manaRegen' ? '/s' : ''}`;
}

/** Useful authored properties without category, instruction or comparison. */
export function renderItemProperties(details: HTMLElement, entry: InventoryItem): void {
  if (!isItemId(entry.item)) {
    if (entry.item === 'potion') details.textContent = 'Restores 40 Health';
    if (entry.item === 'scroll') details.textContent = 'Opens a return portal';
    return;
  }
  const definition = equipmentCatalog[entry.item];
  if (definition.weapon) {
    for (const [key, value] of [
      ['damage', definition.weapon.damage], ['attackRate', definition.weapon.rate], ['reach', definition.weapon.reach],
    ] as const) details.append(statRow(statLabel(key), statValue(key, value)));
  }
  for (const key of Object.keys(definition.bonuses) as (keyof Bonuses)[]) {
    const value = definition.bonuses[key]!;
    details.append(statRow(bonusLabels[key], bonusValue(key, value)));
  }
  if (entry.item === 'shield') details.append(statRow('Frontal block', '50% damage reduction'));

}

/** Trading retains its effective-loadout comparison. */
export function renderEquipmentDetails(
  details: HTMLElement, comparison: HTMLElement, entry: InventoryItem,
  character: CharacterSave, set: WeaponSet, slot: EquipmentSlot,
): void {
  if (!isItemId(entry.item)) return;
  renderItemProperties(details, entry);
  const hand = slot === 'main' || slot === 'off';
  const occupiesDestination = (item: InventoryItem) => item.slot === slot && (!hand || (item.weaponSet ?? 0) === set);
  const equipped = character.items.find(occupiesDestination);
  if (equipped?.id === entry.id) return;
  const label = document.createElement('p');
  label.textContent = equipped ? `Compared with ${lootDefinitions[equipped.item].name}` : 'Compared with empty slot';
  comparison.append(label);

  const displacesShield = slot === 'main' && isWeaponItem(entry.item) && !supportsShield(entry.item);
  const candidate = character.items.filter(item =>
    item.id !== entry.id && !occupiesDestination(item) &&
    !(displacesShield && item.slot === 'off' && (item.weaponSet ?? 0) === set));
  candidate.push({ ...entry, slot, weaponSet: hand ? set : undefined });
  const before = resolveCombatStats(character.items, set,character.xp);
  const after = resolveCombatStats(candidate, set,character.xp);
  for (const key of comparisonStats) {
    const value=(stats:CombatStats)=>key==='damage' && stats.family && stats.family!=='bow' && stats.family!=='staff'
      ? stats.damage*smithingMeleeMultiplier(character.xp.smithing) : stats[key];
    const delta = value(after) - value(before);
    if (Math.abs(delta) < .00001) continue;
    const amount = statValue(key, delta);
    const row = statRow(statLabel(key), `${delta > 0 ? '+' : ''}${amount}`);
    row.dataset.gain = String(delta > 0);
    comparison.append(row);
  }
}
