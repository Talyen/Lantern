import { type SkillXP } from './skills';
import { type Loadout, type Weapon, weaponFamily } from './equipment';

export type AbilityId = 'axe-basic' | 'sword-basic' | 'bow-basic' | 'staff-basic' | 'shield-basic' | 'sweep' | 'piercing-shot' | 'crushing-blow' | 'berserking';
export type WeaponSet = 0 | 1;
export type ActionBar = (AbilityId | null)[];
export type AbilityMotion = 'attack' | 'block' | 'sweep' | 'pierce' | 'crush' | 'battleCry';
export type AbilityDefinition = { name: string; family: Weapon | 'shield'; activation: 'tap' | 'hold'; mana: number; cooldown: number; motion: AbilityMotion; damageScale: number; tier: 'basic' | 'skill' | 'ultimate'; level: number; description: string };
export const axeProgression = { xpPerDamage: .2, ultimateXp: 100 } as const;
export const berserking = { seconds: 8, damage: 1.4, attackRate: 1.3, moveSpeed: 1.2 } as const;
export const abilityUnlocked = (id: AbilityId, xp: Partial<SkillXP>): boolean => id !== 'berserking' || (xp.axeCombat ?? 0) >= axeProgression.ultimateXp;
export const cooldownForAbility = (state: { abilityCooldowns: Partial<Record<AbilityId, number>>; ultimateCooldown: number }, id: AbilityId): number => abilities[id].tier === 'ultimate' ? state.ultimateCooldown : state.abilityCooldowns[id] ?? 0;
export const abilities: Record<AbilityId, AbilityDefinition> = {
  'crushing-blow': {name:'Crushing Blow',family:'axe',activation:'tap',tier:'skill',level:1,mana:25,cooldown:6,motion:'crush',damageScale:2,description:'A narrow heavy strike for 200% weapon damage. Interrupts eligible windups.'},
  berserking: {name:'Berserking',family:'axe',activation:'tap',tier:'ultimate',level:2,mana:50,cooldown:60,motion:'battleCry',damageScale:0,description:'Battle cry grants 8s of +40% damage, +30% attack speed and +20% movement while Axe is active.'},
  'axe-basic': {name:'Axe Basic',family:'axe',activation:'tap',tier:'basic',level:1,mana:0,cooldown:0,motion:'attack',damageScale:1,description:'A close-range axe strike.'},
  'sword-basic': {name:'Sword Basic',family:'sword',activation:'tap',tier:'basic',level:1,mana:0,cooldown:0,motion:'attack',damageScale:1,description:'A close-range sword cut.'},
  'bow-basic': {name:'Bow Basic',family:'bow',activation:'tap',tier:'basic',level:1,mana:0,cooldown:0,motion:'attack',damageScale:1,description:'Fire one aimed arrow.'},
  'staff-basic': {name:'Staff Basic',family:'staff',activation:'tap',tier:'basic',level:1,mana:0,cooldown:0,motion:'attack',damageScale:1,description:'Release a magical bolt.'},
  'shield-basic': {name:'Shield Basic',family:'shield',activation:'hold',tier:'basic',level:1,mana:0,cooldown:0,motion:'block',damageScale:0,description:'Halve incoming frontal damage while held.'},
  sweep: {name:'Sweep',family:'sword',activation:'tap',tier:'skill',level:1,mana:25,cooldown:5,motion:'sweep',damageScale:1.2,description:'A broad frontal cut for 120% weapon damage.'},
  'piercing-shot': {name:'Piercing Shot',family:'bow',activation:'tap',tier:'skill',level:1,mana:30,cooldown:6,motion:'pierce',damageScale:1.2,description:'An arrow that pierces enemies for 120% weapon damage.'},
};
export const abilityIds = Object.keys(abilities) as AbilityId[];
export const basicAbility = (weapon: Weapon | null): AbilityId | null => weapon ? `${weapon}-basic` : null;
export const initialBar = (weapon: Weapon | null): ActionBar => [weapon === 'axe' ? 'crushing-blow' : 'sweep',weapon === 'axe' ? null : 'piercing-shot',null,null,basicAbility(weapon),null];
export function validBar(value: unknown): value is ActionBar {
  return Array.isArray(value) && value.length === 6 && value.every((id: unknown)=>id===null || typeof id==='string' && abilityIds.includes(id as AbilityId));
}
export const supportsAbility = (set: Loadout, id: AbilityId) => abilities[id].family === 'shield' ? set.off === 'shield' : weaponFamily(set.main) === abilities[id].family;
export function abilitySet(sets: readonly [Loadout,Loadout], active: WeaponSet, id: AbilityId): WeaponSet | undefined {
  if (supportsAbility(sets[active],id)) return active;
  const other = (1-active) as WeaponSet;
  return supportsAbility(sets[other],id) ? other : undefined;
}
