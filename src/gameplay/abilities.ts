import { type Loadout, type Weapon, weaponFamily } from './equipment';
import { combatSkills, skillLevel, skillTree, type SkillXP } from './skills';

export type AbilityId = 'axe-basic' | 'sword-basic' | 'bow-basic' | 'staff-basic' | 'shield-basic' | 'sweep' | 'piercing-shot' | 'thrust' | 'riposte' | 'executioner' | 'onslaught' | 'poison-arrow' | 'multishot' | 'arrow-rain' | 'deadeye' | 'crushing-blow' | 'berserking';
export type AbilityMotion = 'attack' | 'block' | 'sweep' | 'pierce' | 'thrust' | 'riposte' | 'executioner' | 'onslaught' | 'arrow-rain' | 'deadeye' | 'crush' | 'battleCry';
export type WeaponSet = 0 | 1;
export type ActionBar = (AbilityId | null)[];
export type AbilityDefinition = { name: string; family: Weapon | 'shield'; activation: 'tap' | 'hold'; tier: 'basic' | 'skill' | 'ultimate'; level: number; mana: number; cooldown: number; motion: AbilityMotion; damageScale: number; interruption?: 'heavy'; description: string };
export const berserking = { seconds: 8, damage: 1.4, attackRate: 1.3, moveSpeed: 1.2 } as const;
export const abilities: Record<AbilityId, AbilityDefinition> = {
  berserking: {name:'Berserking',family:'axe',activation:'tap',tier:'ultimate',level:skillTree.combat[3].level,mana:50,cooldown:60,motion:'battleCry',damageScale:0,description:'Battle cry grants 8s of +40% damage, +30% attack speed and +20% movement while Axe is active.'},
  'crushing-blow': {name:'Crushing Blow',family:'axe',activation:'tap',tier:'skill',level:skillTree.combat[1].level,mana:25,cooldown:6,motion:'crush',damageScale:2,interruption:'heavy',description:'A narrow heavy strike for 200% weapon damage. Interrupts eligible windups.'},
  'axe-basic': {name:'Axe Basic',family:'axe',activation:'tap',tier:'basic',level:skillTree.combat[0].level,mana:0,cooldown:0,motion:'attack',damageScale:1,description:'A close-range axe strike.'},
  'sword-basic': {name:'Sword Basic',family:'sword',activation:'tap',tier:'basic',level:skillTree.combat[0].level,mana:0,cooldown:0,motion:'attack',damageScale:1,description:'A close-range sword cut.'},
  'bow-basic': {name:'Bow Basic',family:'bow',activation:'tap',tier:'basic',level:skillTree.combat[0].level,mana:0,cooldown:0,motion:'attack',damageScale:1,description:'Fire one aimed arrow.'},
  'staff-basic': {name:'Staff Basic',family:'staff',activation:'tap',tier:'basic',level:skillTree.combat[0].level,mana:0,cooldown:0,motion:'attack',damageScale:1,description:'Release a magical bolt.'},
  'shield-basic': {name:'Shield Basic',family:'shield',activation:'hold',tier:'basic',level:skillTree.combat[0].level,mana:0,cooldown:0,motion:'block',damageScale:0,description:'Halve incoming frontal damage while held.'},
  sweep: {name:'Sweep',family:'sword',activation:'tap',tier:'skill',level:skillTree.combat[1].level,mana:25,cooldown:5,motion:'sweep',damageScale:1.2,description:'A broad frontal cut for 120% weapon damage.'},
  'piercing-shot': {name:'Piercing Shot',family:'bow',activation:'tap',tier:'skill',level:skillTree.combat[4].level,mana:30,cooldown:6,motion:'pierce',damageScale:1.2,description:'An arrow that pierces enemies for 120% weapon damage.'},
  thrust: {name:'Thrust',family:'sword',activation:'tap',tier:'basic',level:skillTree.combat[2].level,mana:0,cooldown:0,motion:'thrust',damageScale:1.3,description:'A narrow strike for 130% damage with 0.45 m extra reach.'},
  riposte: {name:'Riposte',family:'sword',activation:'tap',tier:'skill',level:skillTree.combat[4].level,mana:20,cooldown:6,motion:'riposte',damageScale:2,description:'Counter stance for 0.75s. Prevent one frontal melee hit and counter for 200% damage.'},
  executioner: {name:"Executioner's Strike",family:'sword',activation:'tap',tier:'ultimate',level:skillTree.combat[3].level,mana:50,cooldown:30,motion:'executioner',damageScale:3.5,interruption:'heavy',description:'A heavy cut for 350% damage. Breaks interruptible committed attacks.'},
  onslaught: {name:'Onslaught',family:'sword',activation:'tap',tier:'ultimate',level:skillTree.combat[5].level,mana:50,cooldown:30,motion:'onslaught',damageScale:1,description:'Three frontal cuts for 100%, 150% and 200% damage.'},
  'poison-arrow': {name:'Poison Arrow',family:'bow',activation:'tap',tier:'basic',level:skillTree.combat[2].level,mana:0,cooldown:0,motion:'attack',damageScale:.6,description:'60% arrow damage plus 80% Poison damage over 4s. Reapplication refreshes one Poison effect.'},
  multishot: {name:'Multishot',family:'bow',activation:'tap',tier:'skill',level:skillTree.combat[1].level,mana:25,cooldown:5,motion:'attack',damageScale:.8,description:'Five arrows in a 60° fan. Each enemy takes at most one 80% hit.'},
  'arrow-rain': {name:'Rain of Arrows',family:'bow',activation:'tap',tier:'ultimate',level:skillTree.combat[3].level,mana:50,cooldown:30,motion:'arrow-rain',damageScale:3,description:'Rain arrows over a 2.2 m ground area for 300% total damage.'},
  deadeye: {name:'Deadeye Shot',family:'bow',activation:'tap',tier:'ultimate',level:skillTree.combat[5].level,mana:50,cooldown:30,motion:'deadeye',damageScale:5,description:'A deliberate draw releases one aimed arrow for 500% damage.'},
};
export const abilityIds = Object.keys(abilities) as AbilityId[];
export const weaponTrees: Record<keyof typeof combatSkills, readonly AbilityId[]> = {
  axe: ['axe-basic','crushing-blow','berserking'],
  sword: ['sword-basic','sweep','thrust','executioner','riposte','onslaught'],
  bow: ['bow-basic','multishot','poison-arrow','arrow-rain','piercing-shot','deadeye'],
};
export const abilityUnlocked = (id: AbilityId, xp: Partial<SkillXP>): boolean => {
  const {family,level} = abilities[id];
  return level === 1 || (family === 'axe' || family === 'sword' || family === 'bow') && skillLevel(xp[combatSkills[family]] ?? 0) >= level;
};
export const basicAbility = (weapon: Weapon | null): AbilityId | null => weapon ? `${weapon}-basic` : null;
export const initialBar = (weapon: Weapon | null): ActionBar => [weapon==='axe' ? 'crushing-blow' : 'sweep',weapon==='axe' ? null : 'multishot',null,null,basicAbility(weapon),null];
export function validBar(value: unknown): value is ActionBar {
  return Array.isArray(value) && value.length === 6 && value.every((id: unknown)=>id===null || typeof id==='string' && abilityIds.includes(id as AbilityId));
}
const supportsAbility = (set: Loadout, id: AbilityId) => abilities[id].family === 'shield' ? set.off === 'shield' : weaponFamily(set.main) === abilities[id].family;
export function abilitySet(sets: readonly [Loadout,Loadout], active: WeaponSet, id: AbilityId): WeaponSet | undefined {
  if (supportsAbility(sets[active],id)) return active;
  const other = (1-active) as WeaponSet;
  return supportsAbility(sets[other],id) ? other : undefined;
}

export const cooldownForAbility=(state:{abilityCooldowns:Partial<Record<AbilityId,number>>;ultimateCooldown:number},id:AbilityId):number=>abilities[id].tier==='ultimate' ? state.ultimateCooldown : state.abilityCooldowns[id] ?? 0;
