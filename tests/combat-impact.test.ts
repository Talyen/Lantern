import { expect, test } from 'vitest';
import { CombatImpact } from '../src/clearing/combat-impact';
import { attack, createEncounter, stepEncounter, type EncounterEvent, type Timings } from '../src/gameplay/encounter';
import { advanceProjectile } from '../src/gameplay/encounter-projectiles';

const timing:Timings={player:{attack:1,hit:.3,contacts:[.25]},enemy:{attack:1,hit:.3,contacts:[.5]},caster:{attack:1,hit:.3,contacts:[.5]}};
const idle={x:0,z:0,paused:false};
// Admission: a repeated piercing contact could lock controls, and catch-up clocks could expire a buffered action.
test('a confirmed contact holds gameplay clocks and a buffered command without catching up elapsed time',()=>{
  const state=createEncounter('playing');state.player.x=state.enemies.enemy.x=0;state.player.z=0;state.enemies.enemy.z=1;state.player.yaw=0;
  const impact=new CombatImpact();attack(state,timing.player,false);
  impact.present(stepEncounter(state,.25,idle,timing));expect(impact.holding).toBe(true);
  state.pending={kind:'attack',remaining:.15};const mana=state.playerMana,lock=state.player.lock,health=state.enemies.enemy.hp;
  const held=impact.advance(.02);expect(held).toBe(0);
  expect([state.playerMana,state.player.lock,state.enemies.enemy.hp,state.pending.remaining]).toEqual([mana,lock,health,.15]);
  const elapsed=impact.advance(.05);expect(elapsed).toBeLessThan(.05);stepEncounter(state,elapsed,idle,timing);
  expect(state.player.lock).toBeCloseTo(lock-elapsed);expect(state.pending?.remaining).toBeCloseTo(.15-elapsed);
});

test('piercing contacts retain their accepted ability and cannot restart impact once per target or frame',()=>{
  const state=createEncounter('playing');state.player.yaw=0;state.enemies.enemy.x=0;state.enemies.enemy.z=1;
  const projectile={id:1,owner:'player',kind:'arrow' as const,x:0,y:1,z:0,dx:0,dz:1,remaining:10,damage:20,pierced:[] as string[],impactId:8,ability:'piercing-shot' as const};
  state.weapon='axe';state.playerAction=null;
  const events:EncounterEvent[]=[];advanceProjectile(state,projectile,.05,timing,events);
  const confirmed=events.find(e=>e.type==='impact');expect(confirmed).toMatchObject({origin:{actor:'player',ability:'piercing-shot',id:8}});
  const impact=new CombatImpact();impact.present(events);impact.advance(.1);expect(impact.holding).toBe(false);
  impact.present(events);expect(impact.holding).toBe(false);
  impact.clear();impact.present(events);expect(impact.holding).toBe(true);
});

test('misses and incoming contacts do not pause or shake and disabling shake removes the active offset',()=>{
  const impact=new CombatImpact();impact.present([{type:'action',actor:'player',action:'contact',weapon:'sword'},{type:'impact',actor:'player',weapon:'axe',damage:20,position:{x:0,y:0,z:0},blocked:false,lethal:false}]);
  expect(impact.advance(.016)).toBe(.016);expect(impact.offset(true)).toEqual({x:0,y:0});
  impact.present([{type:'impact',actor:'enemy',weapon:'sword',damage:60,position:{x:0,y:0,z:0},blocked:false,lethal:false,origin:{actor:'player',ability:'sweep',id:1}}]);impact.advance(.016);
  expect(Math.abs(impact.offset(true).x)).toBeGreaterThan(0);expect(impact.offset(false)).toEqual({x:0,y:0});expect(impact.offset(true)).toEqual({x:0,y:0});
});
