import { abilities, type AbilityId } from './abilities';
import { skillLevel, type SkillXP } from './skills';

export type WeaponSkill = 'sword' | 'bow';
export type MasteryBonus = 'damage' | 'rate' | 'reach' | 'economy' | 'firstUltimate' | 'secondUltimate';
export type Passive = { name: string; level: number; bonus: MasteryBonus; amount: number; description: string };
const levels = [2,4,7,10,20,25,30,35,40,50];
const bonus: MasteryBonus[] = ['damage','rate','reach','economy','firstUltimate','damage','rate','reach','economy','secondUltimate'];
export const passives: Record<WeaponSkill, Passive[]> = Object.fromEntries((['sword','bow'] as const).map(family => {
  const names = family === 'sword' ? ['Honed Edge I','Measured Cuts I','Long Reach I','Economy I','Heavy Hand','Honed Edge II','Measured Cuts II','Long Reach II','Economy II','Relentless'] : ['Steady Aim I','Smooth Draw I','Long Shot I','Economy I','Arrowstorm','Steady Aim II','Smooth Draw II','Long Shot II','Economy II','Deadeye Mastery'];
  const amounts = [.03,.02,family === 'sword' ? .1 : 1,.05,.05,.03,.02,family === 'sword' ? .1 : 1,.05,.05];
  const descriptions = ['+3% weapon damage','+2% attack rate',family === 'sword' ? '+0.10 m melee reach' : '+1 m Bow range','−5% Skill mana cost',family === 'sword' ? "+5% Executioner's Strike damage" : '+5% Rain of Arrows damage','+3% weapon damage','+2% attack rate',family === 'sword' ? '+0.10 m melee reach' : '+1 m Bow range','−5% Skill mana cost',family === 'sword' ? '+5% Onslaught damage' : '+5% Deadeye Shot damage'];
  return [family,names.map((name,i)=>({name,level:levels[i],bonus:bonus[i],amount:amounts[i],description:descriptions[i]}))];
})) as Record<WeaponSkill,Passive[]>;
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
