import { smithing } from './smithing';
import { abilities, weaponTrees, type AbilityId } from './abilities';
import { passives } from './mastery';
import { skillDefinitions, skillTree, type Skill } from './skills';

/** Planned and implemented nodes share the same level-20 milestone schedules. */
export type SkillNode = {id:string; name:string; kind:'ability' | 'major' | 'minor'; role:string; index:number; level:number; ability?:AbilityId; description?:string; implemented?:boolean};
const existing: Partial<Record<Skill,readonly AbilityId[]>> = {axeCombat:['axe-basic','crushing-blow','berserking'],staff:['staff-basic'],shield:['shield-basic']};
export function nodesForSkill(skill: Skill): {major:SkillNode[]; minor:SkillNode[]} {
  if (skill==='sword' || skill==='bow') return {
    major:weaponTrees[skill].map((ability,index)=>({id:skill+'-major-'+index,name:abilities[ability].name,kind:'ability',role:skillTree.combat[index].role,index,level:abilities[ability].level,ability,implemented:true})),
    minor:passives[skill].map((passive,index)=>({id:skill+'-minor-'+index,name:passive.name,kind:'minor',role:'Passive',index,level:passive.level,description:passive.description,implemented:true})),
  };
  const definition=skillDefinitions.find(entry=>entry.id===skill)!;
  const profession=definition.category==='Gathering' || definition.category==='Crafting';
  const positions=profession
    ? skillTree.profession.map((level,index)=>({role:'Major '+(index+1),level}))
    : skillTree.combat;
  const major=positions.map(({level,role},index):SkillNode=> {
    const tier=role.startsWith('Basic') ? 'basic' : role.startsWith('Skill') ? 'skill' : 'ultimate';
    const ability=existing[skill]?.find(id=>abilities[id].tier===tier && abilities[id].level===level);
    return {id:skill+'-major-'+index,name:ability ? abilities[ability].name : definition.name+' '+role,kind:profession ? 'major' : 'ability',role,index,level,ability,implemented:!!ability};
  });
  const minor=skillTree.passives.map((level,index):SkillNode=>({id:skill+'-minor-'+index,name:definition.name+' '+(profession ? 'Minor ' : 'Passive ')+(index+1),kind:'minor',role:profession ? 'Minor bonus' : 'Passive bonus',index,level}));
  if(skill==='smithing'){
    Object.assign(major[0],{name:'Reclamation',role:'Reclamation',description:'Reclaim unequipped metal gear for materials and a little Smithing XP.',implemented:true});
    Object.assign(minor[0],{name:'Heat Seasoned',level:smithing.heatLevel,description:'Long exposure to forge heat grants 15% Burn Resistance.',implemented:true});
    Object.assign(minor[1],{name:'Hammer Arm',level:smithing.hammerLevel,description:'Hammer work builds strength. Deal 5% more physical melee damage.',implemented:true});
  }
  return {major,minor};
}
