import type { ItemId, Loadout, Weapon } from './equipment';

export type AbilityId = 'axe-basic' | 'sword-basic' | 'bow-basic' | 'staff-basic' | 'shield-basic' | 'sweep' | 'piercing-shot';
export type WeaponSet = 0 | 1;
export type ActionBar = (AbilityId | null)[];
export type AbilityDefinition = { name: string; family: ItemId; activation: 'tap' | 'hold'; mana: number; cooldown: number; motion: 'attack' | 'block' | 'sweep' | 'pierce'; damage: number };
export const abilities: Record<AbilityId, AbilityDefinition> = {
  'axe-basic': {name:'Axe Basic',family:'axe',activation:'tap',mana:0,cooldown:0,motion:'attack',damage:50},
  'sword-basic': {name:'Sword Basic',family:'sword',activation:'tap',mana:0,cooldown:0,motion:'attack',damage:50},
  'bow-basic': {name:'Bow Basic',family:'bow',activation:'tap',mana:0,cooldown:0,motion:'attack',damage:50},
  'staff-basic': {name:'Staff Basic',family:'staff',activation:'tap',mana:0,cooldown:0,motion:'attack',damage:50},
  'shield-basic': {name:'Shield Basic',family:'shield',activation:'hold',mana:0,cooldown:0,motion:'block',damage:0},
  sweep: {name:'Sweep',family:'sword',activation:'tap',mana:25,cooldown:5,motion:'sweep',damage:60},
  'piercing-shot': {name:'Piercing Shot',family:'bow',activation:'tap',mana:30,cooldown:6,motion:'pierce',damage:60},
};
export const abilityIds = Object.keys(abilities) as AbilityId[];
export const basicAbility = (weapon: Weapon | null): AbilityId | null => weapon ? `${weapon}-basic` : null;
export const initialBar = (weapon: Weapon | null): ActionBar => ['sweep','piercing-shot',null,null,basicAbility(weapon),null];
export function validBar(value: unknown): value is ActionBar {
  return Array.isArray(value) && value.length === 6 && value.every((id: unknown)=>id===null || typeof id==='string' && abilityIds.includes(id as AbilityId));
}
export const supportsAbility = (set: Loadout, id: AbilityId) => abilities[id].family === 'shield' ? set.off === 'shield' : set.main === abilities[id].family;
export function abilitySet(sets: readonly [Loadout,Loadout], active: WeaponSet, id: AbilityId): WeaponSet | undefined {
  if (supportsAbility(sets[active],id)) return active;
  const other = (1-active) as WeaponSet;
  return supportsAbility(sets[other],id) ? other : undefined;
}
