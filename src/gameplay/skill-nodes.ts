import { abilities, weaponTrees, type AbilityId } from './abilities';
import { passives } from './mastery';
import { skillDefinitions, type Skill } from './skills';

/** Unimplemented tracks retain proposals; Sword/Bow use live unlock definitions. */
const majorMilestones = [1,10,20,30,40,50] as const;
const minorMilestones = [[3,6],[13,16],[23,26],[33,36],[43,46]] as const;
export type SkillNode = {id:string; name:string; kind:'ability' | 'major' | 'minor'; role:string; index:number; level:number; ability?:AbilityId; description?:string; implemented?:boolean};
const existing: Partial<Record<Skill,readonly [AbilityId,AbilityId?,AbilityId?]>> = {axeCombat:['axe-basic','crushing-blow','berserking'],staff:['staff-basic'],shield:['shield-basic']};
export function nodesForSkill(skill: Skill): {major:SkillNode[]; minor:SkillNode[]} {
  if (skill==='sword' || skill==='bow') return {
    major:weaponTrees[skill].map((ability,index)=>({id:skill+'-major-'+index,name:abilities[ability].name,kind:'ability',role:['Basic I','Skill I','Basic II','Ultimate I','Skill II','Ultimate II'][index],index,level:abilities[ability].level,ability,implemented:true})),
    minor:passives[skill].map((passive,index)=>({id:skill+'-minor-'+index,name:passive.name,kind:'minor',role:'Passive',index,level:passive.level,description:passive.description,implemented:true})),
  };
  const definition=skillDefinitions.find(entry=>entry.id===skill)!;
  const profession=definition.category==='Gathering' || definition.category==='Crafting';
  const major=majorMilestones.map((level,index):SkillNode=> {
    const ability=index===0 ? existing[skill]?.[0] : index===2 ? existing[skill]?.[1] : index===4 ? existing[skill]?.[2] : undefined;
    const role=profession ? 'Major '+(index+1) : ['Basic I','Basic II','Skill I','Skill II','Ultimate I','Ultimate II'][index];
    return {id:skill+'-major-'+index,name:ability ? abilities[ability].name : definition.name+' '+role,kind:profession ? 'major' : 'ability',role,index,level:ability ? abilities[ability].level : level,ability,implemented:!!ability};
  });
  const minor=minorMilestones.flatMap((pair,gap)=>pair.map((level,side):SkillNode=>({id:skill+'-minor-'+(gap*2+side),name:definition.name+' '+(profession ? 'Minor ' : 'Passive ')+(gap*2+side+1),kind:'minor',role:profession ? 'Minor bonus' : 'Passive bonus',index:gap*2+side,level})));
  return {major,minor};
}
