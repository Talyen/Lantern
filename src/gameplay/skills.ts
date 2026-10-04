/** Shared progression tuning. Levels are derived from XP, never independently saved. */
export type GatheringSkill = 'woodcutting' | 'mining';
export const skillCategories = ['Combat', 'Magic', 'Gathering', 'Crafting'] as const;
export type SkillCategory = typeof skillCategories[number];
export const skillDefinitions = [
  {id:'sword',name:'Sword',category:'Combat'}, {id:'axeCombat',name:'Axe',category:'Combat'},
  {id:'mace',name:'Mace',category:'Combat'}, {id:'dagger',name:'Dagger',category:'Combat'},
  {id:'spear',name:'Spear',category:'Combat'}, {id:'greatsword',name:'Greatsword',category:'Combat'},
  {id:'greathammer',name:'Greathammer',category:'Combat'}, {id:'bow',name:'Bow',category:'Combat'},
  {id:'crossbow',name:'Crossbow',category:'Combat'}, {id:'staff',name:'Staff',category:'Combat'},
  {id:'wand',name:'Wand',category:'Combat'}, {id:'shield',name:'Shield',category:'Combat'},
  {id:'defense',name:'Defense',category:'Combat'}, {id:'evasion',name:'Evasion',category:'Combat'},
  {id:'burn',name:'Burn',category:'Magic'}, {id:'freeze',name:'Freeze',category:'Magic'},
  {id:'nature',name:'Nature',category:'Magic'}, {id:'healing',name:'Healing',category:'Magic'},
  {id:'woodcutting',name:'Woodcutting',category:'Gathering'}, {id:'mining',name:'Mining',category:'Gathering'},
  {id:'herbalism',name:'Herbalism',category:'Gathering'}, {id:'smithing',name:'Smithing',category:'Crafting'},
  {id:'leatherworking',name:'Leatherworking',category:'Crafting'}, {id:'tailoring',name:'Tailoring',category:'Crafting'},
  {id:'woodworking',name:'Woodworking',category:'Crafting'}, {id:'alchemy',name:'Alchemy',category:'Crafting'},
  {id:'cooking',name:'Cooking',category:'Crafting'}, {id:'jewelcrafting',name:'Jewelcrafting',category:'Crafting'},
] as const;
export type Skill = typeof skillDefinitions[number]['id'];
export type SkillXP = Record<Skill, number>;
export const skillIds = skillDefinitions.map(skill => skill.id);
export const initialSkillXP = (): SkillXP => Object.fromEntries(skillIds.map(id => [id, 0])) as SkillXP;
export const earnsSkillXP = (id: Skill): boolean => id === 'sword' || id === 'bow' || id === 'axeCombat' || id === 'woodcutting' || id === 'mining' || id === 'smithing';
export const progression = { xpStep: 100, yieldGrowth: .25, gatheringXp: 10, restedBonus: .10, restedSeconds: 30 * 60, restedRadius: 3, checkpointSeconds: 5 };
export const gathering = { reach: 1.8, workingReach: .85, threatRadius: 6, contacts: 3, baseYield: 1, resourceLevel: 1, mineralDepletedScale: .42 };
export const shelterRecipe = { wood: 12, stone: 6, iron: 3 } as const;
const weaponAnchors = [[1,0],[2,100],[3,250],[4,500],[5,1000],[15,5000],[50,24000]] as const;
const weaponTrack = (skill?: Skill) => skill === 'sword' || skill === 'bow';
/** Use the first/last segment outside the anchors, preserving extrapolation in both directions. */
function weaponSegment(value: number, axis: 0 | 1) {
  const next = weaponAnchors.findIndex(anchor => anchor[axis] > value);
  const upper = next < 0 ? weaponAnchors.length - 1 : Math.max(1, next);
  return [weaponAnchors[upper - 1], weaponAnchors[upper]] as const;
}
export function levelXp(level: number, skill?: Skill): number {
  if (!weaponTrack(skill)) return progression.xpStep * level * (level - 1) / 2;
  const [lo, hi] = weaponSegment(level, 0);
  return lo[1] + (level - lo[0]) * (hi[1] - lo[1]) / (hi[0] - lo[0]);
}
export function skillLevel(xp: number, skill?: Skill): number {
  if (!weaponTrack(skill)) return Math.floor((1 + Math.sqrt(1 + 8 * xp / progression.xpStep)) / 2);
  const [lo, hi] = weaponSegment(xp, 1);
  return Math.max(1, Math.floor(lo[0] + (xp - lo[1]) * (hi[0] - lo[0]) / (hi[1] - lo[1]) + 1e-9));
}
export const harvestQuantity = (skill: number, resource: number, baseYield = gathering.baseYield) => Math.max(1, Math.floor(baseYield * (1 + progression.yieldGrowth * Math.max(0, skill - resource))));
export const progressMultiplier = (restedSeconds: number) => 1 + (restedSeconds > 0 ? progression.restedBonus : 0);
