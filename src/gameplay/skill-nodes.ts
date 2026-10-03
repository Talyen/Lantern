import { abilities, type AbilityId } from './abilities';
import { skillDefinitions, type Skill } from './skills';

/** Proposed future milestones. Existing actions remain available from the start. */
export const majorMilestones = [1, 10, 20, 30, 40, 50] as const;
export const minorMilestones = [[3, 6], [13, 16], [23, 26], [33, 36], [43, 46]] as const;
export type SkillNode = {
  id: string;
  name: string;
  kind: 'ability' | 'major' | 'minor';
  role: string;
  index: number;
  level: number;
  ability?: AbilityId;
};
const existing: Partial<Record<Skill, readonly [AbilityId, AbilityId?, AbilityId?]>> = {
  sword: ['sword-basic', 'sweep'], axeCombat: ['axe-basic', 'crushing-blow', 'berserking'], bow: ['bow-basic', 'piercing-shot'],
  staff: ['staff-basic'], shield: ['shield-basic'],
};
export function nodesForSkill(skill: Skill): { major: SkillNode[]; minor: SkillNode[] } {
  const definition = skillDefinitions.find(entry => entry.id === skill)!;
  const profession = definition.category === 'Gathering' || definition.category === 'Crafting';
  const major = majorMilestones.map((level, index): SkillNode => {
    const ability = index === 0 ? existing[skill]?.[0] : index === 2 ? existing[skill]?.[1] : index === 4 ? existing[skill]?.[2] : undefined;
    const role = profession ? 'Major ' + (index + 1) : ['Basic I','Basic II','Skill I','Skill II','Ultimate I','Ultimate II'][index];
    return {id:skill + '-major-' + index, name:ability ? abilities[ability].name : definition.name + ' ' + role,
      kind:profession ? 'major' : 'ability', role, index, level: skill === 'axeCombat' && ability ? ability === 'berserking' ? 2 : 1 : level, ability};
  });
  const minor = minorMilestones.flatMap((pair, gap) => pair.map((level, side): SkillNode => ({
    id:skill + '-minor-' + (gap * 2 + side), name:definition.name + ' ' + (profession ? 'Minor ' : 'Passive ') + (gap * 2 + side + 1),
    kind:'minor', role:profession ? 'Minor bonus' : 'Passive bonus', index:gap * 2 + side, level,
  })));
  return {major, minor};
}
