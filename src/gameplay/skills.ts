/** Shared progression tuning. Levels are derived from XP, never independently saved. */
export type GatheringSkill = 'woodcutting' | 'mining';
export type Skill = GatheringSkill | 'axeCombat';
export const progression = { xpStep: 100, yieldGrowth: .25, gatheringXp: 10, restedBonus: .10, restedSeconds: 30 * 60, restedRadius: 3, checkpointSeconds: 5 };
export const gathering = { reach: 1.8, workingReach: .85, facingCone: Math.PI / 6, threatRadius: 6, contacts: 3, renewalSeconds: 120, baseYield: 1, resourceLevel: 1, mineralDepletedScale: .42 };
export const shelterRecipe = { wood: 12, stone: 6, iron: 3 } as const;
export const levelXp = (level: number) => progression.xpStep * level * (level - 1) / 2;
export const skillLevel = (xp: number) => Math.floor((1 + Math.sqrt(1 + 8 * xp / progression.xpStep)) / 2);
export const harvestQuantity = (skill: number, resource: number, baseYield = gathering.baseYield) => Math.max(1, Math.floor(baseYield * (1 + progression.yieldGrowth * Math.max(0, skill - resource))));
export const progressMultiplier = (restedSeconds: number) => 1 + (restedSeconds > 0 ? progression.restedBonus : 0);
export function skillProgress(xp: number): string {
  const level = skillLevel(xp);
  return `Lv ${level} · ${Math.floor(xp - levelXp(level))} / ${levelXp(level + 1) - levelXp(level)} XP`;
}
