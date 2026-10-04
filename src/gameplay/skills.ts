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
export const progression = { combatXp: 2, yieldGrowth: .25, gatheringXp: 80, restedBonus: .10, restedSeconds: 30 * 60, restedRadius: 3, checkpointSeconds: 5 };
export const skillTree = {
  completionLevel: 20,
  combat: [
    {role:'Basic I',level:1}, {role:'Skill I',level:1}, {role:'Basic II',level:3},
    {role:'Ultimate I',level:5}, {role:'Skill II',level:15}, {role:'Ultimate II',level:20},
  ],
  profession: [1,3,5,10,15,20],
  passives: [2,4,6,7,9,11,13,16,18,20],
  ruler: [5,10,15,20],
} as const;
export const combatSkills = {axe:'axeCombat',sword:'sword',bow:'bow'} as const satisfies Record<string,Skill>;
export const gathering = { reach: 1.8, workingReach: .85, threatRadius: 6, contacts: 3, baseYield: 1, resourceLevel: 1, mineralDepletedScale: .42 };
export const shelterRecipe = { wood: 12, stone: 6, iron: 3 } as const;
export const skillXpAnchors = [[1,0],[2,100],[3,250],[4,500],[5,1000],[15,5000],[20,24000]] as const;
/** Use the first/last segment outside the anchors, preserving extrapolation in both directions. */
function skillSegment(value: number, axis: 0 | 1) {
  const next = skillXpAnchors.findIndex(anchor => anchor[axis] > value);
  const upper = next < 0 ? skillXpAnchors.length - 1 : Math.max(1, next);
  return [skillXpAnchors[upper - 1], skillXpAnchors[upper]] as const;
}
export function levelXp(level: number): number {
  if (!Number.isSafeInteger(level) || level<1) throw new Error('Invalid skill level.');
  const [lo, hi] = skillSegment(level, 0);
  return lo[1] + (level - lo[0]) * (hi[1] - lo[1]) / (hi[0] - lo[0]);
}
export function skillLevel(xp: number): number {
  validXp(xp);
  const [lo, hi] = skillSegment(xp, 1);
  const step = (hi[1]-lo[1])/(hi[0]-lo[0]);
  return lo[0]+Math.floor((xp-lo[1])/step);
}
export function skillProgress(xp: number) {
  const level=skillLevel(xp),floor=levelXp(level),required=levelXp(level+1)-floor;
  return {level,earned:xp-floor,required,fraction:(xp-floor)/required};
}
function validXp(xp: number): void {
  if (!Number.isFinite(xp) || xp<0 || xp>Number.MAX_SAFE_INTEGER) throw new Error('Invalid skill progress.');
}
function roundedXp(xp: number): number {
  // Round only the fractional part so large valid counters are never multiplied by a million.
  const whole=Math.floor(xp);
  return whole+Math.round((xp-whole)*1e6)/1e6;
}
export function earnedSkillXp(baseXp: number, restedSeconds: number): number {
  validXp(baseXp);
  if (!Number.isFinite(restedSeconds) || restedSeconds<0) throw new Error('Invalid Rested duration.');
  const earned=roundedXp(baseXp*progressMultiplier(restedSeconds));
  validXp(earned);
  return earned;
}
/** Pure candidate update; publication stays with the combat, collection or crafting owner. */
export function withSkillXp(xp: SkillXP, skill: Skill, baseXp: number, restedSeconds: number): SkillXP {
  if (!earnsSkillXP(skill)) throw new Error('This skill does not earn XP yet.');
  validXp(xp[skill]);
  const earned=earnedSkillXp(baseXp,restedSeconds);
  if (earned>Number.MAX_SAFE_INTEGER-xp[skill]) throw new Error('Skill progress is full.');
  return {...xp,[skill]:earned ? roundedXp(xp[skill]+earned) : xp[skill]};
}
export const harvestQuantity = (skill: number, resource: number, baseYield = gathering.baseYield) => Math.max(1, Math.floor(baseYield * (1 + progression.yieldGrowth * Math.max(0, skill - resource))));
export const progressMultiplier = (restedSeconds: number) => 1 + (restedSeconds > 0 ? progression.restedBonus : 0);
