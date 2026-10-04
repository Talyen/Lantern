import type { DamageType } from './damage';
import { smithing } from './smithing';
import { skillLevel } from './skills';
import { abilities, axeProgression } from './abilities';
import type { Weapon } from './equipment';
import { armoredDamage } from './combat-stats';
import { commitAction } from './action-commit';
import { enemyAttackDamage, type ActorId, type Encounter, type EncounterEvent, type Timings, type EnemyState, type ActorTiming } from './encounter-model';

/** Evaluate contact at the impact offset, before the enemy consumes the rest of this frame. */
function interruptsAttack(enemy: EnemyState, timing: ActorTiming, impactOffset: number, heavy: boolean): boolean {
  const contact = timing.contacts[0];
  const impactTime = enemy.attackTime + impactOffset;
  // The enemy step consumes contacts after player impacts; keep pending contacts protected.
  const preparing = enemy.attackTime >= 0 && enemy.contactIndex === 0 && enemy.attackTime <= contact;
  if (!preparing || enemy.interruption === 'ordinary-caster') return true;
  if (enemy.interruption === 'protected') return false;
  if (enemy.interruption === 'heavy-window') return heavy;
  return heavy || !(timing.commitLead && impactTime >= Math.max(0, contact - timing.commitLead));
}

/** Damage owns interruption and finite proficiency credit; presentation cannot decide outcomes. */
export function hit(state: Encounter, actor: ActorId, timing: Timings, events: EncounterEvent[], source?: Weapon, incoming?: {
  x:number; z:number; melee?:ActorId;
}, impactOffset=0, rawDamage=enemyAttackDamage, origin?:Extract<EncounterEvent,{type:'impact'}>['origin'], periodic=false, damageType:DamageType=source==='staff' ? 'nature' : 'physical'): void {
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
    events.push({type:'impact',actor,weapon:source ?? null,damage:0,damageType,position:{x:target.x,y:target.y,z:target.z},blocked:true,lethal:false},
      {type:'animation',actor:'player',motion:'riposte'}, {type:'action',actor:'player',action:'attack',weapon:'sword'});
    return;
  }
  let damage=actor === 'player' && !periodic ? armoredDamage(rawDamage,state.stats.armor) : rawDamage;
  if(actor==='player' && damageType==='burn' && skillLevel(state.proficiency.smithing ?? 0,'smithing')>=smithing.heatLevel)damage*=1-smithing.heatResistance;
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
    const heavy = !!origin?.ability && abilities[origin.ability].interruption === 'heavy';
    if (!periodic && (target.hp <= 0 || interruptsAttack(enemy, timing[actor], impactOffset, heavy))) {
      target.lock=timing[actor].hit; target.attackTime=-1; target.contactIndex=0;
      events.push({type:'animation',actor,motion:'hit'});
    }
  } else {
    state.invulnerability=.65+impactOffset;
    if (impactOffset<state.dodgeFrameOffset) state.invulnerabilityBeforeDodge=state.invulnerability;
  }
  if (!periodic) events.push({type:'hit',actor});
  events.push({type:'impact',actor,weapon:source ?? null,damage,damageType,position:{x:target.x,y:target.y,z:target.z},blocked,lethal:target.hp<=0,...(periodic ? {periodic:true} : {}),...(origin ? {origin} : {})});
  if (target.hp<=0) {
    const won=actor!=='player';
    if (enemy) { enemy.poison=undefined; enemy.attackTime=-1; enemy.contactIndex=0; }
    state.projectiles=won ? state.projectiles.filter(p=>p.owner!==actor) : [];
    events.push({type:'animation',actor,motion:'death'});
    if (!won || state.enemyIds.every(id=>state.enemies[id].hp<=0)) {
      state.phase=won ? 'won' : 'lost'; state.pending=null; state.blocking=false;
      if (!won) {state.berserkingRemaining=0; state.stats=state.setStats[state.activeSet]; state.player.speed=state.stats.moveSpeed; state.rains=[]; state.riposte=undefined; state.playerAction=null; state.player.attackTime=-1;}
    }
    if (!won || state.enemyIds.every(id=>state.enemies[id].hp<=0 || !state.layout.enemies && !state.enemies[id].engaged)) events.push({type:'outcome',won});
  }
}
