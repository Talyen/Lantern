import { abilities, type AbilityId } from './abilities';
import { skillLevel, type SkillXP } from './skills';

export type WeaponSkill = 'sword' | 'bow';
export type MasteryBonus = 'damage' | 'rate' | 'reach' | 'economy' | 'firstUltimate' | 'secondUltimate';
export type Passive = { name: string; level: number; bonus: MasteryBonus; amount: number; description: string };
// Each row keeps its unlock, effect and display text together; array indexes carry no gameplay meaning.
export const passives: Record<WeaponSkill, Passive[]> = {
  sword: [
    { level: 2, bonus: 'damage', amount: .03, name: 'Honed Edge I', description: '+3% weapon damage' },
    { level: 4, bonus: 'rate', amount: .02, name: 'Measured Cuts I', description: '+2% attack rate' },
    { level: 7, bonus: 'reach', amount: .1, name: 'Long Reach I', description: '+0.10 m melee reach' },
    { level: 10, bonus: 'economy', amount: .05, name: 'Economy I', description: '−5% Skill mana cost' },
    { level: 20, bonus: 'firstUltimate', amount: .05, name: 'Heavy Hand', description: "+5% Executioner's Strike damage" },
    { level: 25, bonus: 'damage', amount: .03, name: 'Honed Edge II', description: '+3% weapon damage' },
    { level: 30, bonus: 'rate', amount: .02, name: 'Measured Cuts II', description: '+2% attack rate' },
    { level: 35, bonus: 'reach', amount: .1, name: 'Long Reach II', description: '+0.10 m melee reach' },
    { level: 40, bonus: 'economy', amount: .05, name: 'Economy II', description: '−5% Skill mana cost' },
    { level: 50, bonus: 'secondUltimate', amount: .05, name: 'Relentless', description: '+5% Onslaught damage' },
  ],
  bow: [
    { level: 2, bonus: 'damage', amount: .03, name: 'Steady Aim I', description: '+3% weapon damage' },
    { level: 4, bonus: 'rate', amount: .02, name: 'Smooth Draw I', description: '+2% attack rate' },
    { level: 7, bonus: 'reach', amount: 1, name: 'Long Shot I', description: '+1 m Bow range' },
    { level: 10, bonus: 'economy', amount: .05, name: 'Economy I', description: '−5% Skill mana cost' },
    { level: 20, bonus: 'firstUltimate', amount: .05, name: 'Arrowstorm', description: '+5% Rain of Arrows damage' },
    { level: 25, bonus: 'damage', amount: .03, name: 'Steady Aim II', description: '+3% weapon damage' },
    { level: 30, bonus: 'rate', amount: .02, name: 'Smooth Draw II', description: '+2% attack rate' },
    { level: 35, bonus: 'reach', amount: 1, name: 'Long Shot II', description: '+1 m Bow range' },
    { level: 40, bonus: 'economy', amount: .05, name: 'Economy II', description: '−5% Skill mana cost' },
    { level: 50, bonus: 'secondUltimate', amount: .05, name: 'Deadeye Mastery', description: '+5% Deadeye Shot damage' },
  ],
};
export function masteryBonuses(family: WeaponSkill, xp: Partial<SkillXP>): Record<MasteryBonus,number> {
  const result = {damage:0,rate:0,reach:0,economy:0,firstUltimate:0,secondUltimate:0};
  const level = skillLevel(xp[family] ?? 0,family);
  for (const passive of passives[family]) if (level >= passive.level) result[passive.bonus] += passive.amount;
  return result;
}
export function abilityMana(id: AbilityId, xp: Partial<SkillXP>): number {
  const definition = abilities[id];
  const discount = definition.tier === 'skill' && (definition.family === 'sword' || definition.family === 'bow') ? masteryBonuses(definition.family,xp).economy : 0;
  return definition.mana * (1-discount);
}
export function ultimateBonus(id: AbilityId, xp: Partial<SkillXP>): number {
  const definition = abilities[id];
  if (definition.family !== 'sword' && definition.family !== 'bow') return 0;
  const bonus = masteryBonuses(definition.family,xp);
  return id === 'executioner' || id === 'arrow-rain' ? bonus.firstUltimate : id === 'onslaught' || id === 'deadeye' ? bonus.secondUltimate : 0;
}
