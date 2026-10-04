import { expect, test } from 'vitest';
import { character } from '../src/gameplay/character';
import { forged, reclaimed, forgeError, smithingRecipes } from '../src/gameplay/smithing';
import { receive, validItems, validStash, countItem } from '../src/gameplay/inventory';
import { createEncounter, applyEquipment, attack, stepExploration, type Timings, type EncounterEvent } from '../src/gameplay/encounter';
import { hit } from '../src/gameplay/encounter-damage';

const ids=()=>{let n=100;return()=> 'item-'+(++n);};
// Admission: these boundary cases protect against irreversible item/material loss,
// duplicate XP/rewards and a self-sustaining craft/reclaim loop in the new transactions.
test('forging publishes a complete Bag/Stash candidate without mutating the source',()=>{
  const state=character([]),id=ids();state.shelterRestored=true;state.xp.smithing=1500;state.restedSeconds=100;
  receive(state.items,'iron',3,id);receive(state.stash,'iron',5,id);
  const before=structuredClone(state),next=forged(state,'weathered-mail',id);
  expect(state).toEqual(before);
  expect(countItem(next.items,'iron')).toBe(0);expect(countItem(next.stash,'iron')).toBe(4);
  expect(next.items.filter(entry=>entry.item==='weathered-mail')).toHaveLength(1);
  expect(next.xp.smithing).toBe(4800);
  expect(validItems(next.items)&&validStash(next.stash,next.items)).toBe(true);
});
test('a full Bag blocks forging without consuming even available Stash materials',()=>{
  const state=character([]),id=ids();state.shelterRestored=true;state.xp.smithing=1500;
  for(let y=0;y<8;y++)for(let x=0;x<12;x++)state.items.push({id:id(),item:'stone',quantity:99,slot:'bag',x,y});
  receive(state.stash,'iron',4,id);
  const before=structuredClone(state);
  expect(forgeError(state,'weathered-mail')).toBe('Not enough room in Bag.');
  expect(()=>forged(state,'weathered-mail',id)).toThrow('Not enough room in Bag.');
  expect(state).toEqual(before);
});
test('consuming the last material stack can make room for the completed equipment',()=>{
  const state=character([]),id=ids();
  for(let y=0;y<8;y++)for(let x=0;x<12;x++)if(!(x===0&&y<3))state.items.push({id:id(),item:'stone',quantity:99,slot:'bag',x,y});
  state.items.push({id:id(),item:'iron',quantity:2,slot:'bag',x:0,y:0},{id:id(),item:'wood',quantity:1,slot:'bag',x:0,y:1});
  const next=forged(state,'sword',id);
  expect(validItems(next.items)).toBe(true);expect(next.items.find(entry=>entry.item==='sword')).toMatchObject({x:0,y:0,slot:'bag'});
});
test('reclamation excludes equipped and stale instances and returns to the source container',()=>{
  const state=character(),id=ids();state.shelterRestored=true;
  expect(()=>reclaimed(state,'item-1','bag',id)).toThrow('Select unequipped metal gear.');
  receive(state.stash,'shield',1,id);const selected=state.stash[0];
  const next=reclaimed(state,selected.id,'stash',id);
  expect(state.stash[0]).toEqual(selected);
  expect(next.stash.some(entry=>entry.id===selected.id)).toBe(false);
  expect(countItem(next.stash,'iron')).toBe(1);expect(countItem(next.stash,'wood')).toBe(1);
  expect(next.xp.smithing).toBe(20);
  expect(()=>reclaimed(next,selected.id,'stash',id)).toThrow('Select unequipped metal gear.');
});
test('a failed precious-metal wallet return retains the item and XP',()=>{
  const state=character([]),id=ids();state.gold=Number.MAX_SAFE_INTEGER;
  receive(state.items,'hearth-ring',1,id);const before=structuredClone(state);
  expect(()=>reclaimed(state,state.items[0].id,'bag',id)).toThrow('Gold wallet is full.');
  expect(state).toEqual(before);
});
test('repeating crafting and reclamation spends materials rather than funding unlimited XP',()=>{
  let state=character([]);const id=ids();receive(state.items,'iron',4,id);receive(state.items,'wood',4,id);
  for(let n=0;n<3;n++){
    state=forged(state,'sword',id) as ReturnType<typeof character>;
    const gear=state.items.find(entry=>entry.item==='sword')!;
    state=reclaimed(state,gear.id,'bag',id) as ReturnType<typeof character>;
  }
  expect(countItem(state.items,'iron')).toBe(1);expect(countItem(state.items,'wood')).toBe(1);expect(state.xp.smithing).toBe(810);
  expect(()=>forged(state,'sword',id)).toThrow('Need 1 more Iron.');
  for(const recipe of smithingRecipes){const input=Object.values(recipe.materials).reduce((a,b)=>a+b,0);expect(input).toBeGreaterThan(0);}
});
// Admission: direct combat boundary evidence prevents the new damage typing from
// bypassing armor/defense or granting melee-only power to ranged and periodic hits.
test('Burn Resistance follows armor and blocking, and does not protect against Freeze',()=>{
  const state=createEncounter('playing');state.proficiency.smithing=300;state.stats.armor=100;state.blocking=true;state.player.yaw=0;
  const events:EncounterEvent[]=[],timing:Timings={player:{attack:1,hit:.2,contacts:[.3]},enemy:{attack:1,hit:.2,contacts:[.3]},caster:{attack:1,hit:.2,contacts:[.3]}};
  hit(state,'player',timing,events,'staff',{x:0,z:1},0,20,undefined,false,'burn');
  expect(state.player.hp).toBeCloseTo(95.75);expect(events.find(event=>event.type==='impact')).toMatchObject({damageType:'burn',damage:4.25,blocked:true});
  state.invulnerability=0;state.blocking=false;
  hit(state,'player',timing,events,'staff',{x:0,z:1},0,20,undefined,false,'freeze');
  expect(state.player.hp).toBeCloseTo(85.75);
});
test('Hammer Arm affects a real physical melee contact without boosting the Staff projectile snapshot',()=>{
  const timing:Timings={player:{attack:1,hit:.2,contacts:[.3]},enemy:{attack:1,hit:.2,contacts:[.3]},caster:{attack:1,hit:.2,contacts:[.3]}};
  const melee=createEncounter('playing');melee.proficiency.smithing=1500;melee.player.x=0;melee.player.z=0;melee.player.yaw=0;melee.enemies.enemy.x=0;melee.enemies.enemy.z=1;
  attack(melee,timing.player,false);const events=stepExploration(melee,.31,{x:0,z:0,paused:false},undefined,timing);
  expect(events.find(event=>event.type==='impact')).toMatchObject({damageType:'physical',damage:52.5});
  const staff=createEncounter('playing');staff.proficiency.smithing=1500;
  applyEquipment(staff,[{id:'staff',item:'staff',quantity:1,slot:'main',x:0,y:0}],0);
  attack(staff,timing.player,false);stepExploration(staff,.31,{x:0,z:0,paused:false},undefined,timing);
  expect(staff.projectiles[0]).toMatchObject({damageType:'nature',damage:50});
});
