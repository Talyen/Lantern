import { abilityMana, ultimateBonus } from './mastery';
import { abilityCooldown, commitAction } from './action-commit';
import { abilities, abilitySet, basicAbility, abilityUnlocked, berserking, type AbilityId, type WeaponSet } from './abilities';
import { itemLoadout, type InventoryItem } from './inventory';
import { resolveCombatStats } from './combat-stats';
import { constrain, boundaryDistance } from './area';
import {
  dodgeDuration, dodgeDistance, dodgeInvulnerability, dodgeCooldown, type ActorState,
  type AimPoint, type ActorTiming, type Encounter, type EncounterEvent, type Input, type Movement,
  type Timings, type PlayerAction,
} from './encounter-model';
import { smithingMeleeMultiplier } from './smithing';
import { hit } from './encounter-damage';
import { projectileLaunchClear } from './encounter-projectiles';
import { prepareThrust, advanceThrust } from './encounter-movement';

const aimDeadZone = .15;
function faceAim(player: ActorState, aim: AimPoint): void {
  const x = aim.x - player.x, z = aim.z - player.z;
  if (Math.hypot(x, z) > aimDeadZone)
    player.yaw = Math.atan2(x, z);
}

/** Commit derived equipment state only after presentation preparation succeeds. */
export function applyEquipment(state: Encounter, items: readonly InventoryItem[], active: WeaponSet): void {
  state.weaponSets = [itemLoadout(items, 0), itemLoadout(items, 1)];
  state.setStats = [resolveCombatStats(items, 0,state.proficiency), resolveCombatStats(items, 1,state.proficiency)];
  state.activeSet = active;
  applyActiveStats(state);
}

function applyActiveStats(state: Encounter): void {
  const base=state.setStats[state.activeSet];
  state.stats=state.berserkingRemaining>0 && base.family==='axe' ? {...base,damage:base.damage*berserking.damage,attackRate:base.attackRate*berserking.attackRate,moveSpeed:base.moveSpeed*berserking.moveSpeed} : base;
  state.weapon = state.stats.family;
  state.shield = !!state.weaponSets[state.activeSet].off;
  state.player.speed = state.stats.moveSpeed;
  state.player.hp = Math.min(state.player.hp, state.stats.maxHealth);
  state.playerMana = Math.min(state.playerMana, state.stats.maxMana);
}

export function attack(state: Encounter, timing: ActorTiming, paused: boolean, aim?: AimPoint): EncounterEvent[] {
  if (paused || !['playing', 'won'].includes(state.phase) || state.player.hp <= 0 || !state.weapon || state.blocking)
    return [];
  if (state.attackCooldown > 0 || state.player.lock > 0 || state.dodgeRemaining > 0) {
    state.pending = { kind: 'attack', remaining: .15, aim: aim ? { ...aim } : undefined };
    return [];
  }
  state.pending = null;
  // An accepted swing commits its direction; pointer updates cannot steer its contacts.
  if (aim)
    faceAim(state.player, aim);
  const rate = state.stats.attackRate, duration = timing.attack / rate;
  state.player.lock = duration;
  state.attackCooldown = duration;
  state.player.attackTime = 0;
  state.player.contactIndex = 0;
  state.playerAction = { damageType:state.weapon==='staff' ? 'nature' : 'physical', committed:false, mana:0, cooldown:0, baseDamage:state.stats.damage, impactId: state.nextImpact = (state.nextImpact ?? 0) + 1, duration, contacts: timing.contacts.map(contact => contact / rate), damage: state.stats.damage, rate, reach: state.stats.reach, arc: state.weapon === 'sword' ? Math.PI / 4 : Math.acos(.1), weapon: state.weapon, ability: basicAbility(state.weapon) };
  return [{ type: 'label', value: 'DEFEAT THE RAIDER' }, { type: 'animation', actor: 'player', motion: 'attack' }, { type: 'action', actor: 'player', action: 'attack', weapon: state.weapon }];
}

function activateSet(state: Encounter, set: WeaponSet): EncounterEvent[] {
  if (state.activeSet === set)
    return [];
  state.activeSet = set;
  applyActiveStats(state);
  state.blocking = false;
  state.player.attackTime = -1;
  return [{ type: 'weaponSet', set }];
}

export function swapWeaponSet(state: Encounter, paused: boolean): EncounterEvent[] {
  if (paused || state.player.hp <= 0 || !['playing', 'won'].includes(state.phase) || !state.weaponSets[(1 - state.activeSet) as WeaponSet].main)
    return [];
  if (state.player.lock > 0 || state.dodgeRemaining > 0 || state.attackCooldown > 0) {
    state.pending = { kind: 'swap', remaining: .15 };
    return [];
  }
  state.pending = null;
  return [...activateSet(state, (1 - state.activeSet) as WeaponSet), { type: 'animation', actor: 'player', motion: 'idle' }];
}

/** All slots route through one acceptance rule; duplicate icons cannot bypass a cooldown. */
export function useAbility(state: Encounter, id: AbilityId, timing: ActorTiming, paused: boolean, aim?: AimPoint, movement?: Movement): EncounterEvent[] {
  const definition = abilities[id], set = abilitySet(state.weaponSets, state.activeSet, id);
  if (paused || state.player.hp <= 0 || !['playing', 'won'].includes(state.phase) || set === undefined || !abilityUnlocked(id,state.proficiency) || state.playerMana < abilityMana(id,state.proficiency))
    return [];
  if (state.player.lock > 0 || state.dodgeRemaining > 0 || state.attackCooldown > 0 || abilityCooldown(state,id) > 0) {
    state.pending = { kind: 'ability', ability: id, remaining: .15, aim: aim ? { ...aim } : undefined };
    return [];
  }
  if (state.blocking && definition.activation !== 'hold')
    return [];
  if (id==='arrow-rain') {
    if (!aim || boundaryDistance(state.layout.boundary,[aim.x,aim.z])<0 || Math.hypot(aim.x-state.player.x,aim.z-state.player.z)>state.setStats[set].reach) return [];
    if (movement?.attackGround) {const target=movement.attackGround(state.player,aim); if (!target) return []; aim=target;}
  }
  const action = timing.abilities?.[id] ?? (definition.motion === 'attack' ? timing : undefined);
  if (definition.activation !== 'hold' && (!action || action.attack <= 0 || (!action.contacts.length && id!=='berserking')))
    return [];
  const events = activateSet(state, set);
  state.pending = null;
  if (definition.activation === 'hold') {
    if (aim)
      faceAim(state.player, aim);
    state.blocking = true;
    return [...events, { type: 'animation', actor: 'player', motion: 'block' }];
  }
  if (id==='berserking' && action) {
    if (aim) faceAim(state.player,aim);
    state.player.lock=state.attackCooldown=action.attack;
    state.player.attackTime=0; state.player.contactIndex=0;
    state.playerAction={impactId:state.nextImpact=(state.nextImpact ?? 0)+1,committed:false,mana:definition.mana,cooldown:definition.cooldown,duration:action.attack,contacts:[],damage:0,rate:1,reach:0,arc:0,weapon:'axe',ability:id,damageType:'physical'};
    return [...events,{type:'animation',actor:'player',motion:'battleCry'},{type:'action',actor:'player',action:'battleCry',weapon:'axe'}];
  }
  const attackEvents = attack(state, { ...timing, ...action }, false, aim);
  if (!attackEvents.length || !state.playerAction)
    return events;
  Object.assign(state.playerAction, { ability: id, mana:abilityMana(id,state.proficiency), cooldown:definition.cooldown,
    baseDamage:state.stats.damage + state.stats.baseDamage * ultimateBonus(id,state.proficiency),
    damage:(state.stats.damage + state.stats.baseDamage * ultimateBonus(id,state.proficiency)) * definition.damageScale,
    aim:aim ? {...aim} : undefined,
    reach:state.stats.reach + (id === 'thrust' ? .45 : 0),
    arc:id === 'sweep' ? Math.PI/2 : id === 'thrust' ? Math.PI/12 : id==='crushing-blow' ? Math.PI/6 : id === 'executioner' ? Math.PI/7 : state.playerAction.arc });
  if (id === 'thrust') prepareThrust(state, state.playerAction, movement);
  if (id === 'riposte') {
    state.riposte = {remaining:.75,action:state.playerAction};
    state.player.attackTime = -1; state.player.lock = .75; state.attackCooldown = 0;
    return [...events,{type:'animation',actor:'player',motion:'riposte-stance'}];
  }
  for (const event of attackEvents)
    if (event.type === 'animation' && event.actor === 'player')
      event.motion = definition.motion;
  return [...events, ...attackEvents];
}

/** Dodge is numeric simulation state; the animation never decides displacement or immunity. */
export function dodge(state: Encounter, direction: AimPoint, paused: boolean, aim?: AimPoint): EncounterEvent[] {
  if (paused || !['playing', 'won'].includes(state.phase) || state.player.hp <= 0)
    return [];
  if (state.dodgeCooldown > 0 || state.dodgeRemaining > 0) {
    state.pending = { kind: 'dodge', remaining: .15, direction: { ...direction }, aim: aim ? { ...aim } : undefined };
    return [];
  }
  const cancelled = state.playerAction;
  if (cancelled && !cancelled.committed) state.attackCooldown = 0;
  state.playerAction = null; state.riposte = undefined; state.player.lock = 0;
  state.pending = null;
  state.blocking = false;
  const length = Math.hypot(direction.x, direction.z);
  if (length === 0 && aim)
    faceAim(state.player, aim);
  state.dodgeDirection = length > 0 ? { x: direction.x / length, z: direction.z / length } : { x: Math.sin(state.player.yaw), z: Math.cos(state.player.yaw) };
  state.player.yaw = Math.atan2(state.dodgeDirection.x, state.dodgeDirection.z);
  state.player.attackTime = -1;
  state.dodgeRemaining = dodgeDuration;
  state.dodgeCooldown = dodgeCooldown;
  state.invulnerability = Math.max(state.invulnerability, dodgeInvulnerability);
  return [...(cancelled ? [{type:'abilityCancelled' as const,ability:cancelled.ability}] : []), { type: 'animation', actor: 'player', motion: 'dodge' }, { type: 'action', actor: 'player', action: 'dodge', weapon: state.weapon }];
}

function advancePlayerClocks(state: Encounter, dt: number): void {
  state.ultimateCooldown = Math.max(0,state.ultimateCooldown-dt);
  const previousBuff=state.berserkingRemaining;
  state.berserkingRemaining=Math.max(0,previousBuff-dt);
  if (previousBuff>0 && !state.berserkingRemaining) applyActiveStats(state);
  if (state.riposte) {
    state.riposte.remaining -= dt;
  }
  state.attackCooldown = Math.max(0, state.attackCooldown - dt);
  state.player.lock = Math.max(0, state.player.lock - dt);
  state.dodgeCooldown = Math.max(0, state.dodgeCooldown - dt);
  state.playerMana = Math.min(state.stats.maxMana, state.playerMana + dt * state.stats.manaRegen);
  state.potionCooldown = Math.max(0, state.potionCooldown - dt);
  for (const key in state.abilityCooldowns) {
    if (!Object.hasOwn(state.abilityCooldowns, key)) continue;
    const id = key as AbilityId;
    state.abilityCooldowns[id] = Math.max(0, state.abilityCooldowns[id]! - dt);
  }
}

export function movePlayer(state: Encounter, dt: number, input: Input, movementWorld?: Movement): EncounterEvent[] {
  const player = state.player, events: EncounterEvent[] = [];
  const move = (x: number, z: number, elapsed = dt, rolling = false) => {
    if (movementWorld)
      movementWorld.move('player', player, x, z, elapsed, rolling ? 'dodge' : 'walk', dodgeDistance);
    else {
      player.x += x;
      player.z += z;
    }
    [player.x, player.z] = constrain(state.layout.boundary, [player.x, player.z]);
  };
  if (state.dodgeRemaining > 0) {
    const elapsed = Math.min(dt, state.dodgeRemaining);
    move(state.dodgeDirection.x * elapsed * dodgeDistance / dodgeDuration, state.dodgeDirection.z * elapsed * dodgeDistance / dodgeDuration, elapsed, true);
    state.dodgeRemaining = Math.max(0, state.dodgeRemaining - dt);
    if (state.dodgeRemaining === 0) {
      movementWorld?.releaseDodge?.('player');
      events.push({ type: 'animation', actor: 'player', motion: 'idle' }, { type: 'action', actor: 'player', action: 'land', weapon: state.weapon });
      if (dt - elapsed > 1e-6 && Math.hypot(input.x, input.z) > 0) events.push(...movePlayer(state, dt - elapsed, input, movementWorld));
    }
    return events;
  }
  const length = Math.hypot(input.x, input.z);
  const beforeX = player.x, beforeZ = player.z;
  if (player.lock <= 0 && length > 0) {
    move(input.x / length * dt * player.speed * (state.blocking ? .5 : 1), input.z / length * dt * player.speed * (state.blocking ? .5 : 1));
    if (!input.aim)
      player.yaw = Math.atan2(input.x, input.z);
    events.push({ type: 'animation', actor: 'player', motion: Math.hypot(player.x - beforeX, player.z - beforeZ) > .0001 ? 'run' : state.blocking ? 'block' : 'idle' });
  }
  else {
    move(0, 0);
    if (player.lock <= 0)
      events.push({ type: 'animation', actor: 'player', motion: state.blocking ? 'block' : 'idle' });
  }
  // Resolve from the post-movement position, preserving facing during action/hit locks.
  if (player.lock <= 0 && input.aim)
    faceAim(player, input.aim);
  return events;
}

export function preparePlayer(state: Encounter, dt: number, input: Input, timing: ActorTiming, movementWorld?: Movement): {
  events: EncounterEvent[];
  attackElapsed: number;
  attackOffset: number;
  movementElapsed: number;
} {
  state.frameManaStart = state.playerMana; state.frameElapsed = dt;
  if (state.riposte) state.riposte.frameOffset=0;
  const pending = state.pending;
  // A held shield cannot protect contacts that precede recovery in this frame.
  state.blockFrameOffset = state.blocking ? 0 : Math.min(dt, Math.max(state.player.lock, state.dodgeRemaining));
  const cooldown = () => pending?.kind === 'dodge' ? state.dodgeCooldown : Math.max(state.attackCooldown, pending?.kind === 'ability' ? abilityCooldown(state,pending.ability) : 0);
  const availableAfter = pending ? Math.max(pending.kind === 'dodge' ? 0 : state.player.lock, state.dodgeRemaining, cooldown()) : 0;
  const prepared = { events: [] as EncounterEvent[], attackElapsed: dt, attackOffset: 0,
    movementElapsed: state.dodgeRemaining > 0 ? dt : Math.max(0, dt - state.player.lock) };
  const validAtUnlock = availableAfter <= (pending?.remaining ?? 0) + 1e-6;
  // Resolve landing before held shielding and buffered actions become eligible.
  // Its remaining travel belongs to the roll, not the newly accepted action.
  if (state.dodgeRemaining > 0 && state.dodgeRemaining <= dt &&
    (input.block && state.shield || pending && validAtUnlock && availableAfter <= dt)) {
    const landedAfter = state.dodgeRemaining;
    prepared.events.push(...movePlayer(state, state.dodgeRemaining, input, movementWorld));
    prepared.movementElapsed = Math.max(0, dt - Math.max(landedAfter, state.player.lock, pending ? availableAfter : 0));
  }
  advancePlayerClocks(state, dt);
  state.blocking = !!(input.block && state.shield && state.player.lock <= 0 && state.dodgeRemaining === 0);
  // Held facing applies to projectile contacts as well as later melee contacts.
  if (state.blocking && input.aim) faceAim(state.player, input.aim);
  if (!pending)
    return prepared;
  if (state.playerAction?.ability==='berserking' && state.player.attackTime>=0 && pending.kind!=='dodge') {
    pending.remaining-=dt; if (pending.remaining<0) state.pending=null; return prepared;
  }
  if (validAtUnlock && (pending.kind === 'dodge' || state.player.lock === 0) && state.dodgeRemaining === 0 && cooldown() === 0) {
    const previousImmunity = state.invulnerability;
    const alreadyBlocking = state.blocking;
    state.pending = null;
    if (pending.kind === 'swap')
      prepared.events.push(...swapWeaponSet(state, false));
    else if (pending.kind === 'ability')
      prepared.events.push(...useAbility(state, pending.ability, timing, false, pending.aim, movementWorld));
    else
      prepared.events.push(...(pending.kind === 'attack' ? attack(state, timing, false, pending.aim) : dodge(state, pending.direction, false, pending.aim)));
    if (state.riposte && pending.kind==='ability' && pending.ability==='riposte') {
      state.riposte.frameOffset=Math.min(dt,availableAfter);
      state.riposte.remaining-=dt-state.riposte.frameOffset;
      state.player.lock=Math.max(0,state.player.lock-(dt-state.riposte.frameOffset));
    }
    if (!alreadyBlocking && state.blocking)
      state.blockFrameOffset = Math.max(state.blockFrameOffset, Math.min(dt, availableAfter));
    if (state.dodgeRemaining > 0 && pending.kind === 'dodge') {
      // Recovery time belongs to the previous action, not the new roll.
      state.dodgeFrameOffset = Math.min(dt, availableAfter);
      state.invulnerabilityBeforeDodge = previousImmunity;
      state.invulnerability = Math.max(previousImmunity, state.dodgeFrameOffset + dodgeInvulnerability);
      prepared.movementElapsed = dt - state.dodgeFrameOffset;
      state.dodgeCooldown = Math.max(0, state.dodgeCooldown - prepared.movementElapsed);
    }
    if (prepared.events.length && state.player.attackTime === 0 && (pending.kind === 'attack' || pending.kind === 'ability')) {
      // A buffered swing begins at unlock, so only the rest of this frame belongs to it.
      prepared.attackOffset = Math.min(dt, availableAfter);
      prepared.attackElapsed = dt - prepared.attackOffset;
      state.player.lock = Math.max(0, state.player.lock - prepared.attackElapsed);
      state.attackCooldown = Math.max(0, state.attackCooldown - prepared.attackElapsed);

    }
    return prepared;
  }
  pending.remaining -= dt;
  if (pending.remaining < 0) {
    if (validAtUnlock && state.dodgeRemaining <= dt + 1e-6)
      pending.remaining = 0;
    else
      state.pending = null;
  }
  return prepared;
}

export function stepPlayerAttack(state: Encounter, dt: number, timing: Timings, events: EncounterEvent[], movementWorld?: Movement, frameOffset = 0): void {
  const { player } = state;
  if (player.attackTime < 0 || !state.weapon)
    return;
  const action: PlayerAction = state.playerAction ?? { impactId: undefined, duration: timing.player.attack / state.stats.attackRate, contacts: timing.player.contacts.map(contact => contact / state.stats.attackRate), damage: state.stats.damage, rate: state.stats.attackRate, reach: state.stats.reach, arc: Math.acos(.1), weapon: state.weapon, ability: null };
  if (action.ability==='berserking') {player.attackTime+=dt; return;}
  const contacts = action.contacts;
  player.attackTime += dt;
  advanceThrust(player, action, Math.min(player.attackTime, contacts[0]), movementWorld);
  while (player.contactIndex < contacts.length && player.attackTime >= contacts[player.contactIndex]) {
    const index=player.contactIndex++;
    const offset=frameOffset+Math.max(0,contacts[index]-(player.attackTime-dt));
    commitAction(state,action,events,offset);
    events.push({type:'action',actor:'player',action:'contact',weapon:action.weapon,...(action.ability && ['thrust','riposte','executioner','onslaught'].includes(action.ability) ? {ability:action.ability} : {})});
    if (action.ability === 'arrow-rain' && action.aim) {
      state.rains.push({damageType:action.damageType ?? 'physical',id:action.impactId!,x:action.aim.x,y:action.aim.y ?? player.y,z:action.aim.z,age:.93,damage:action.damage/3,pulse:0,rate:action.rate,firstStep:Math.max(0,(state.frameElapsed ?? dt)-offset)});
    } else if (action.weapon === 'bow' || action.weapon === 'staff') {
      const angles=action.ability==='multishot' ? [-Math.PI/6,-Math.PI/12,0,Math.PI/12,Math.PI/6] : [0];
      const sharedHits: string[]=[];
      for (const angle of angles) {
        const dx=Math.sin(player.yaw+angle),dz=Math.cos(player.yaw+angle);
        const projectile={id:++state.nextProjectile,owner:'player',kind:action.weapon==='bow' ? 'arrow' as const : 'bolt' as const,damageType:action.damageType ?? (action.weapon==='bow' ? 'physical' as const : 'nature' as const),x:player.x+dx*.35,y:player.y+1.22,z:player.z+dz*.35,dx,dz,remaining:action.reach,damage:action.damage,impactId:action.impactId,ability:action.ability,poisonDamage:action.ability==='poison-arrow' ? (action.baseDamage ?? 0)*.8 : undefined,sharedHits:action.ability==='multishot' ? sharedHits : undefined,pierced:action.ability==='piercing-shot' ? [] : undefined,firstStep:Math.min(dt,player.attackTime-contacts[index])};
        if (projectileLaunchClear(projectile,player,events,movementWorld)) state.projectiles.push(projectile);
      }
    } else {
      const single=action.ability==='crushing-blow' || action.ability==='thrust' || action.ability==='executioner' || action.ability==='riposte';
      const targets=state.enemyIds.filter(id=> {
        const enemy=state.enemies[id],dx=enemy.x-player.x,dz=enemy.z-player.z,distance=Math.hypot(dx,dz);
        return enemy.home && enemy.hp>0 && (!action.target || action.target===id) && distance<action.reach && (distance===0 || (Math.sin(player.yaw)*dx+Math.cos(player.yaw)*dz)/distance>=Math.cos(action.arc)-1e-6) && (!movementWorld || movementWorld.lineOfSight(player,enemy)) && Math.abs(player.y-enemy.y)<.8;
      });
      if (single) targets.sort((a,b)=>Math.hypot(state.enemies[a].x-player.x,state.enemies[a].z-player.z)-Math.hypot(state.enemies[b].x-player.x,state.enemies[b].z-player.z));
      for (const id of single ? targets.slice(0,1) : targets) {
        const damage=action.ability==='onslaught' ? (action.baseDamage ?? action.damage)*[1,1.5,2][index] : action.damage;
        hit(state,id,timing,events,action.weapon ?? undefined,undefined,offset,damage*((action.damageType ?? 'physical')==='physical' ? smithingMeleeMultiplier(state.proficiency.smithing ?? 0) : 1),action.impactId===undefined ? undefined : {actor:'player',ability:action.ability,id:action.impactId},false,action.damageType ?? 'physical');
      }
    }
  }
  if (player.attackTime >= action.duration) { player.attackTime = -1; }
}

/** Cry completion resolves after enemy contacts, so death cannot spend or grant a buff. */
export function finishBattleCry(state:Encounter,dt:number,events:EncounterEvent[]): void {
  const action=state.playerAction;
  if (action?.ability!=='berserking' || state.player.attackTime<action.duration) return;
  const remainder=Math.min(dt,Math.max(0,state.player.attackTime-action.duration));
  state.player.attackTime=-1;
  if (state.player.hp<=0 || state.phase==='lost') return;
  commitAction(state,action,events,Math.max(0,dt-remainder));
  state.berserkingRemaining=Math.max(0,berserking.seconds-remainder);
  applyActiveStats(state);
  events.push({type:'action',actor:'player',action:'berserking',weapon:'axe'});
}
