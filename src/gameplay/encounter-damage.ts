import { axeProgression } from './abilities';
import type { Weapon } from './equipment';
import { armoredDamage } from './combat-stats';
import { commitAction } from './action-commit';
import { enemyAttackDamage, type ActorId, type Encounter, type EncounterEvent, type Timings } from './encounter-model';

/** Damage owns interruption and finite proficiency credit; presentation cannot decide outcomes. */
export function hit(state: Encounter, actor: ActorId, timing: Timings, events: EncounterEvent[], source?: Weapon, incoming?: {
  x:number; z:number; melee?:ActorId;
}, impactOffset=0, rawDamage=enemyAttackDamage, origin?:Extract<EncounterEvent,{type:'impact'}>['origin'], periodic=false): void {
  const immunity = impactOffset < state.dodgeFrameOffset ? state.invulnerabilityBeforeDodge : state.invulnerability;
  const target = actor === 'player' ? state.player : state.enemies[actor];
  if (target.hp <= 0 || actor === 'player' && immunity > impactOffset) return;
  const dx=incoming?.x ?? 0,dz=incoming?.z ?? 0,distance=Math.hypot(dx,dz);
  const frontal=distance>0 && (Math.sin(target.yaw)*dx+Math.cos(target.yaw)*dz)/distance>=.5;
  if (actor === 'player' && state.riposte && impactOffset>=(state.riposte.frameOffset ?? 0) && impactOffset<=state.riposte.remaining+(state.frameElapsed ?? 0) && incoming?.melee && frontal) {
    const action=state.riposte.action;
    state.riposte=undefined;
    commitAction(state,action,events,impactOffset);
    action.target=incoming.melee; state.playerAction=action;
    state.player.yaw=Math.atan2(dx,dz);
    state.player.attackTime=0; state.player.contactIndex=0;
    state.player.lock=action.duration; state.attackCooldown=action.duration;
    events.push({type:'impact',actor,weapon:source ?? null,damage:0,position:{x:target.x,y:target.y,z:target.z},blocked:true,lethal:false},
      {type:'animation',actor:'player',motion:'riposte'}, {type:'action',actor:'player',action:'attack',weapon:'sword'});
    return;
  }
  let damage=actor === 'player' ? armoredDamage(rawDamage,state.stats.armor) : rawDamage;
  const blocked=actor === 'player' && state.blocking && impactOffset>=state.blockFrameOffset && frontal;
  if (blocked) damage*=.5;
  const beforeHp=target.hp;
  target.hp=Math.max(0,target.hp-damage);
  const enemy=actor === 'player' ? null : state.enemies[actor];
  if (enemy) {
    const previous=enemy.lowestHp ?? beforeHp;
    const credit=Math.max(0,previous-enemy.hp);
    enemy.lowestHp=Math.min(previous,enemy.hp);
    if (credit>0 && (source === 'sword' || source === 'bow')) events.push({type:'proficiency',family:source,amount:credit});
    if (source==='axe' && credit>0) events.push({type:'proficiency',family:'axe',amount:credit*axeProgression.xpPerDamage});
    if (!enemy.returning) enemy.engaged=true;
    const contact=timing[actor].contacts[0];
    const protectedAttack=!!enemy.interruption && target.attackTime>=0 && target.hp>0 || enemy.kind==='raider' && (timing[actor].commitLead ?? 0)>0 && target.attackTime>=0 && target.attackTime+impactOffset>=Math.max(0,contact-(timing[actor].commitLead ?? 0)) && target.attackTime<contact && target.hp>0;
    const breaksCommit=(origin?.ability==='executioner' || origin?.ability==='crushing-blow') && enemy.interruption!=='protected';
    if (!periodic && (!protectedAttack || breaksCommit)) {
      target.lock=timing[actor].hit; target.attackTime=-1; target.contactIndex=0;
      events.push({type:'animation',actor,motion:'hit'});
    }
  } else {
    state.invulnerability=.65+impactOffset;
    if (impactOffset<state.dodgeFrameOffset) state.invulnerabilityBeforeDodge=state.invulnerability;
  }
  if (!periodic) events.push({type:'hit',actor});
  events.push({type:'impact',actor,weapon:source ?? null,damage,position:{x:target.x,y:target.y,z:target.z},blocked,lethal:target.hp<=0,...(periodic ? {periodic:true} : {}),...(origin ? {origin} : {})});
  if (target.hp<=0) {
    const won=actor!=='player';
    if (enemy) enemy.poison=undefined;
    state.projectiles=won ? state.projectiles.filter(p=>p.owner!==actor) : [];
    events.push({type:'animation',actor,motion:'death'});
    if (!won || state.enemyIds.every(id=>state.enemies[id].hp<=0)) {
      state.phase=won ? 'won' : 'lost'; state.pending=null; state.blocking=false;
      if (!won) {state.berserkingRemaining=0; state.stats=state.setStats[state.activeSet]; state.player.speed=state.stats.moveSpeed; state.rains=[]; state.riposte=undefined; state.playerAction=null; state.player.attackTime=-1;}
    }
    if (!won || state.enemyIds.every(id=>state.enemies[id].hp<=0 || !state.layout.enemies && !state.enemies[id].engaged)) events.push({type:'outcome',won});
  }
}
