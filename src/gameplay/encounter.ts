import type { Weapon } from './equipment';
import { constrain, legacyLayout, type EncounterLayout } from './area';
/** Encounter simulation. Positions, clocks and animation timings use world units and seconds. */
export type ActorId = 'player' | 'enemy';
export type EnemyKind = 'raider' | 'caster';
export type Motion = 'idle' | 'run' | 'attack' | 'hit' | 'death' | 'dodge' | 'block' | 'chop';
export type Phase = 'loading' | 'playing' | 'won' | 'lost';
export type ActorState = {
  x: number; y: number; z: number; yaw: number; hp: number; speed: number;
  lock: number; attackTime: number; contactIndex: number;
};
export const playerMaxHealth = 100, enemyMaxHealth = 100, playerMaxMana = 100;
export const playerAttackDamage = 50, enemyAttackDamage = 20;
export const enemyNoticeRadius = 6, enemyLeashRadius = 10;
export const dodgeDuration = 0.45, dodgeDistance = 2.4, dodgeInvulnerability = 0.25, dodgeCooldown = 1;
export type Projectile = { id: number; owner: ActorId; kind: 'arrow' | 'bolt'; x: number; y: number; z: number; dx: number; dz: number; remaining: number; firstStep?: number };
export const casterAttackRange = 6, casterBoltSpeed = 8;
export type PendingInput = { kind: 'attack' | 'dodge'; remaining: number; aim?: AimPoint; direction?: {x:number;z:number} };
export type Encounter = {
  phase: Phase; layout: EncounterLayout; enemyKind: EnemyKind; engaged: boolean; returning: boolean; player: ActorState; enemy: ActorState;
  weapon: Weapon | null; shield: boolean; blocking: boolean; pending: PendingInput | null; projectiles: Projectile[]; nextProjectile: number;
  attackCooldown: number; invulnerability: number; enemyCooldown: number; playerMana: number;
  dodgeRemaining: number; dodgeCooldown: number; dodgeDirection: { x: number; z: number };
};
export type ActorTiming = { attack: number; hit: number; contacts: readonly number[] };
export type Timings = Record<ActorId, ActorTiming>;
export type Movement = { move(id: ActorId, actor: ActorState, dx: number, dz: number, dt: number): void; direction(from: ActorState, to: ActorState, dt: number): { x: number; z: number }; lineOfSight(from: ActorState, to: ActorState): boolean; segmentHit?(from: {x:number;y:number;z:number}, to: {x:number;y:number;z:number}): number | null };
export type AimPoint = { x: number; z: number };
export type Input = { x: number; z: number; paused: boolean; aim?: AimPoint; block?: boolean };
const aimDeadZone = .15;
function faceAim(player: ActorState, aim: AimPoint): void {
  const x = aim.x - player.x, z = aim.z - player.z;
  if (Math.hypot(x, z) > aimDeadZone) player.yaw = Math.atan2(x, z);
}
export type EncounterEvent =
  | { type: 'animation'; actor: ActorId; motion: Motion }
  | { type: 'hit'; actor: ActorId }
  | { type: 'axeXp' }
  | { type: 'label'; value: 'MOVE TO BEGIN' | 'DEFEAT THE RAIDER' | 'RAIDER ATTACKING' | 'DEFEAT THE CASTER' | 'CASTER ATTACKING' }
  | { type: 'outcome'; won: boolean };

export function createEncounter(phase: Phase = 'loading', layout: EncounterLayout = legacyLayout, enemyKind: EnemyKind = 'raider'): Encounter {
  const actor = (x: number, z: number, hp: number, speed: number): ActorState =>
    ({ x, y: 0, z, yaw: 0, hp, speed, lock: 0, attackTime: -1, contactIndex: 0 });
  const enemySpawn = layout.enemy ?? layout.player;
  const player = actor(...layout.player.position, phase === 'loading' ? 0 : playerMaxHealth, 3.2), enemy = actor(...enemySpawn.position, phase === 'loading' ? 0 : enemyMaxHealth, 1.45);
  player.yaw = layout.player.yaw; enemy.yaw = enemySpawn.yaw;
  return { weapon: 'axe', shield: false, blocking: false, pending: null, projectiles: [], nextProjectile: 0, phase, layout, enemyKind, engaged: false, returning: false, player, enemy,
    attackCooldown: 0, invulnerability: 0, enemyCooldown: 0.8, playerMana: playerMaxMana,
    dodgeRemaining: 0, dodgeCooldown: 0, dodgeDirection: { x: 0, z: 0 } };
}
export function resetEncounter(state: Encounter): EncounterEvent[] {
  const { weapon, shield } = state;
  Object.assign(state, createEncounter('playing', state.layout, state.enemyKind), { weapon, shield });
  return [{ type: 'label', value: 'MOVE TO BEGIN' },
    { type: 'animation', actor: 'player', motion: 'idle' }, { type: 'animation', actor: 'enemy', motion: 'idle' }];
}
export function attack(state: Encounter, timing: ActorTiming, paused: boolean, aim?: AimPoint): EncounterEvent[] {
  if (paused || !['playing', 'won'].includes(state.phase) || state.player.hp <= 0 || !state.weapon || state.blocking) return [];
  if (state.attackCooldown > 0 || state.player.lock > 0 || state.dodgeRemaining > 0) {
    state.pending = { kind: 'attack', remaining: .15, aim: aim ? {...aim} : undefined }; return [];
  }
  state.pending = null;
  // An accepted swing commits its direction; pointer updates cannot steer its contacts.
  if (aim) faceAim(state.player, aim);
  state.player.lock = timing.attack;
  state.attackCooldown = timing.attack;
  state.player.attackTime = 0;
  state.player.contactIndex = 0;
  return [{ type: 'label', value: state.enemyKind === 'caster' ? 'DEFEAT THE CASTER' : 'DEFEAT THE RAIDER' }, { type: 'animation', actor: 'player', motion: 'attack' }];
}
/** Dodge is numeric simulation state; the animation never decides displacement or immunity. */
export function dodge(state: Encounter, direction: { x: number; z: number }, paused: boolean, aim?: AimPoint): EncounterEvent[] {
  if (paused || !['playing', 'won'].includes(state.phase) || state.player.hp <= 0) return [];
  if (state.player.lock > 0 || state.dodgeCooldown > 0 || state.dodgeRemaining > 0) {
    state.pending = { kind: 'dodge', remaining: .15, direction: {...direction}, aim: aim ? {...aim} : undefined }; return [];
  }
  state.pending = null; state.blocking = false;
  const length = Math.hypot(direction.x, direction.z);
  if (length === 0 && aim) faceAim(state.player, aim);
  state.dodgeDirection = length > 0 ? { x: direction.x / length, z: direction.z / length } : { x: Math.sin(state.player.yaw), z: Math.cos(state.player.yaw) };
  state.player.yaw = Math.atan2(state.dodgeDirection.x, state.dodgeDirection.z);
  state.player.attackTime = -1;
  state.dodgeRemaining = dodgeDuration; state.dodgeCooldown = dodgeCooldown;
  state.invulnerability = Math.max(state.invulnerability, dodgeInvulnerability);
  return [{ type: 'animation', actor: 'player', motion: 'dodge' }];
}
function advancePlayerClocks(state: Encounter, dt: number): void {
  state.attackCooldown = Math.max(0, state.attackCooldown - dt);
  state.invulnerability = Math.max(0, state.invulnerability - dt);
  state.player.lock = Math.max(0, state.player.lock - dt);
  state.dodgeCooldown = Math.max(0, state.dodgeCooldown - dt);
}
function movePlayer(state: Encounter, dt: number, input: Input, movementWorld?: Movement): EncounterEvent[] {
  const player = state.player, events: EncounterEvent[] = [];
  const move = (x: number, z: number) => {
    if (movementWorld) movementWorld.move('player', player, x, z, dt);
    else { player.x += x; player.z += z; }
    [player.x, player.z] = constrain(state.layout.boundary, [player.x, player.z]);
  };
  if (state.dodgeRemaining > 0) {
    const elapsed = Math.min(dt, state.dodgeRemaining);
    move(state.dodgeDirection.x * elapsed * dodgeDistance / dodgeDuration, state.dodgeDirection.z * elapsed * dodgeDistance / dodgeDuration);
    state.dodgeRemaining = Math.max(0, state.dodgeRemaining - dt);
    if (state.dodgeRemaining === 0) events.push({ type: 'animation', actor: 'player', motion: 'idle' });
    return events;
  }
  const length = Math.hypot(input.x, input.z);
  const beforeX = player.x, beforeZ = player.z;
  if (player.lock <= 0 && length > 0) {
    move(input.x / length * dt * player.speed * (state.blocking ? .5 : 1), input.z / length * dt * player.speed * (state.blocking ? .5 : 1));
    if (!input.aim) player.yaw = Math.atan2(input.x, input.z);
    events.push({ type: 'animation', actor: 'player', motion: Math.hypot(player.x - beforeX, player.z - beforeZ) > .0001 ? 'run' : state.blocking ? 'block' : 'idle' });
  } else {
    move(0, 0);
    if (player.lock <= 0) events.push({ type: 'animation', actor: 'player', motion: state.blocking ? 'block' : 'idle' });
  }
  // Resolve from the post-movement position, preserving facing during action/hit locks.
  if (player.lock <= 0 && input.aim) faceAim(player, input.aim);
  return events;
}
function preparePlayer(state: Encounter, dt: number, input: Input, timing: ActorTiming): EncounterEvent[] {
  const pending = state.pending;
  const availableAfter = pending ? Math.max(state.player.lock,state.dodgeRemaining,pending.kind==='attack' ? state.attackCooldown : state.dodgeCooldown) : 0;
  advancePlayerClocks(state,dt);
  state.blocking=!!(input.block && state.shield && state.player.lock<=0 && state.dodgeRemaining===0);
  if (!pending) return [];
  // A frame can cross both recovery and buffer expiry; accept if recovery crossed first.
  const validAtUnlock=availableAfter<=pending.remaining+1e-6;
  if (validAtUnlock && state.player.lock===0 && state.dodgeRemaining===0 && (pending.kind==='attack' ? state.attackCooldown : state.dodgeCooldown)===0) {
    state.pending=null;
    return pending.kind==='attack' ? attack(state,timing,false,pending.aim) : dodge(state,pending.direction ?? {x:0,z:0},false,pending.aim);
  }
  pending.remaining-=dt;
  if (pending.remaining<0) {
    if (validAtUnlock && state.dodgeRemaining<=dt+1e-6) pending.remaining=0;
    else state.pending=null;
  }
  return [];
}
function hit(state: Encounter, actor: ActorId, timing: Timings, events: EncounterEvent[], source?: Weapon, incoming?: { x: number; z: number }): void {
  if (state[actor].hp <= 0 || actor === 'player' && state.invulnerability > 0) return;
  const target = state[actor];
  let damage = actor === 'enemy' ? playerAttackDamage : enemyAttackDamage;
  if (actor === 'player' && state.blocking) {
    // Projectiles are blocked by their incoming direction, even if the caster has moved.
    const dx = incoming?.x ?? state.enemy.x - target.x, dz = incoming?.z ?? state.enemy.z - target.z, distance = Math.hypot(dx,dz);
    if (distance && (Math.sin(target.yaw)*dx + Math.cos(target.yaw)*dz) / distance >= .5) damage *= .5;
  }
  target.hp = Math.max(0, target.hp - damage);
  if (actor === 'enemy' && source === 'axe') events.push({type:'axeXp'});
  if (actor === 'enemy' && !state.returning) state.engaged = true;
  // A successful shield block retains the stance; rear hits interrupt normally.
  const blocked = actor === 'player' && damage < enemyAttackDamage;
  if (!blocked) { target.lock = timing[actor].hit; target.attackTime = -1; }
  if (actor === 'player') { state.invulnerability = .65; state.dodgeRemaining = 0; state.pending = null; if (!blocked) state.blocking = false; }
  else target.contactIndex = 0;
  events.push({type:'hit',actor});
  if (!blocked) events.push({type:'animation',actor,motion:'hit'});
  if (target.hp <= 0) {
    const won = actor === 'enemy'; state.phase = won ? 'won' : 'lost'; state.pending = null; state.blocking = false;
    state.projectiles = won ? state.projectiles.filter(projectile => projectile.owner === 'player') : [];
    events.push({type:'outcome',won}, {type:'animation',actor,motion:'death'});
  }
}
function stepPlayerAttack(state: Encounter, dt: number, timing: Timings, events: EncounterEvent[], movementWorld?: Movement): void {
  const {player,enemy} = state;
  if (player.attackTime < 0) return;
  player.attackTime += dt;
  while (player.contactIndex < timing.player.contacts.length && player.attackTime >= timing.player.contacts[player.contactIndex]) {
    player.contactIndex++;
    if (state.weapon === 'bow' || state.weapon === 'staff') {
      const dx = Math.sin(player.yaw), dz = Math.cos(player.yaw);
      state.projectiles.push({id: ++state.nextProjectile, owner: 'player', kind: state.weapon === 'bow' ? 'arrow' : 'bolt', x:player.x + dx * .35, y:player.y + 1.22, z:player.z + dz * .35, dx, dz, remaining:12, firstStep: Math.min(dt,player.attackTime-timing.player.contacts[player.contactIndex-1])});
    } else if (state.layout.enemy && enemy.hp > 0) {
      const dx = enemy.x-player.x, dz = enemy.z-player.z, distance = Math.hypot(dx,dz);
      const facing = distance > 0 ? (Math.sin(player.yaw)*dx + Math.cos(player.yaw)*dz)/distance : 0;
      if (distance < 1.95 && facing > .1 && (!movementWorld || movementWorld.lineOfSight(player,enemy)) && Math.abs(player.y-enemy.y)<.8) hit(state,'enemy',timing,events,state.weapon ?? undefined);
    }
  }
  if (player.attackTime >= timing.player.attack) player.attackTime = -1;
}
/** Numeric swept projectiles share terrain collision with movement, never apply damage twice. */
function advanceProjectile(state: Encounter, projectile: Projectile, dt: number, timing: Timings, events: EncounterEvent[], movementWorld?: Movement): boolean {
  if (state.phase === 'lost' || projectile.owner === 'enemy' && state.enemy.hp <= 0) return false;
  const speed = projectile.owner === 'enemy' ? casterBoltSpeed : projectile.kind === 'arrow' ? 24 : 16;
  const distance = Math.min(projectile.remaining, (projectile.firstStep ?? dt) * speed);
  projectile.firstStep = undefined;
  const to = { x: projectile.x + projectile.dx * distance, y: projectile.y, z: projectile.z + projectile.dz * distance };
  const wall = movementWorld?.segmentHit?.(projectile, to) ?? null;
  const targetId = projectile.owner === 'player' ? 'enemy' : 'player', target = state[targetId];
  const x = target.x - projectile.x, z = target.z - projectile.z;
  const along = x * projectile.dx + z * projectile.dz, perpendicular = Math.abs(x * projectile.dz - z * projectile.dx);
  const radiusAlong = Math.sqrt(Math.max(0, .42 * .42 - perpendicular * perpendicular));
  const entry = along - radiusAlong, exit = along + radiusAlong;
  const targetT = Math.max(0, entry) / Math.max(.0001, distance);
  if (state.layout.enemy && target.hp > 0 && perpendicular <= .42 && exit >= 0 && entry <= distance && projectile.y >= target.y + .15 && projectile.y <= target.y + 1.6 && (wall === null || targetT < wall)) {
    hit(state, targetId, timing, events, undefined, { x: -projectile.dx, z: -projectile.dz });
    return false;
  }
  if (wall !== null) return false;
  projectile.x = to.x; projectile.z = to.z; projectile.remaining -= distance;
  return projectile.remaining > 0;
}
function stepProjectiles(state: Encounter, dt: number, timing: Timings, events: EncounterEvent[], movementWorld?: Movement): void {
  state.projectiles = state.projectiles.filter(projectile => advanceProjectile(state, projectile, dt, timing, events, movementWorld));
  // A lethal player projectile may occur after an enemy bolt was retained earlier in the list.
  if (state.enemy.hp <= 0) state.projectiles = state.projectiles.filter(projectile => projectile.owner === 'player');
  if (state.player.hp <= 0) state.projectiles = [];
}
/** Safe and cleared areas retain attacks and projectile presentation without enemy AI. */
export function stepExploration(state: Encounter, dt: number, input: Input, movementWorld?: Movement, timing?: Timings): EncounterEvent[] {
  if (input.paused || state.player.hp <= 0 || !['playing','won'].includes(state.phase)) return [];
  const fallback: ActorTiming = {attack:.7,hit:.3,contacts:[.28]};
  const clocks = timing ?? {player:fallback,enemy:fallback};
  const events = preparePlayer(state,dt,input,clocks.player);
  stepPlayerAttack(state,dt,clocks,events,movementWorld); stepProjectiles(state,dt,clocks,events,movementWorld);
  events.push(...movePlayer(state,dt,input,movementWorld)); return events;
}
export function stepEncounter(state: Encounter, dt: number, input: Input, timing: Timings, movementWorld?: Movement): EncounterEvent[] {
  if (input.paused || state.phase !== 'playing') return [];
  const {player,enemy} = state;
  const events = preparePlayer(state,dt,input,timing.player);
  enemy.lock = Math.max(0,enemy.lock-dt); state.enemyCooldown=Math.max(0,state.enemyCooldown-dt);
  const animate = (actor:ActorId,motion:Motion) => events.push({type:'animation',actor,motion});
  stepPlayerAttack(state,dt,timing,events,movementWorld); stepProjectiles(state,dt,timing,events,movementWorld);
  if (state.phase !== 'playing') return events;
  events.push(...movePlayer(state, dt, input, movementWorld));
  const spawn = state.layout.enemy ?? state.layout.player;
  const dx = player.x - enemy.x, dz = player.z - enemy.z;
  const homeDistance = Math.hypot(enemy.x - spawn.position[0], enemy.z - spawn.position[1]);
  if (!state.engaged && !state.returning && Math.hypot(dx, dz) <= enemyNoticeRadius && (!movementWorld || movementWorld.lineOfSight(enemy, player))) state.engaged = true;
  if (state.engaged && (homeDistance > enemyLeashRadius || Math.hypot(dx, dz) > enemyLeashRadius)) {
    state.engaged = false; state.returning = true; enemy.attackTime = -1; enemy.contactIndex = 0;
  }
  if (state.returning) {
    if (homeDistance <= .2) {
      enemy.x = spawn.position[0]; enemy.z = spawn.position[1]; enemy.yaw = spawn.yaw;
      enemy.hp = enemyMaxHealth; enemy.lock = 0; state.enemyCooldown = .8; state.returning = false;
      movementWorld?.move('enemy', enemy, 0, 0, dt); animate('enemy', 'idle');
    } else if (enemy.lock <= 0) {
      const home = { ...enemy, x: spawn.position[0], z: spawn.position[1] };
      const desired = movementWorld?.direction(enemy, home, dt) ?? { x: home.x - enemy.x, z: home.z - enemy.z };
      const length = Math.hypot(desired.x, desired.z), distance = Math.min(homeDistance, dt * enemy.speed);
      const x = length ? desired.x / length * distance : 0, z = length ? desired.z / length * distance : 0;
      if (movementWorld) movementWorld.move('enemy', enemy, x, z, dt);
      else { enemy.x += x; enemy.z += z; }
      if (length) enemy.yaw = Math.atan2(desired.x, desired.z);
      animate('enemy', length ? 'run' : 'idle');
    }
    return events;
  }
  if (!state.engaged) { movementWorld?.move('enemy', enemy, 0, 0, dt); return events; }
  if (state.enemyKind === 'caster') { stepCaster(state, dt, timing, events, movementWorld); return events; }
  // Keep the pre-movement distance: the original encounter uses it to start an enemy strike.
  const distance = Math.hypot(dx, dz);
  if (enemy.lock <= 0 && (distance > 1.45 || movementWorld && !movementWorld.lineOfSight(enemy, player)) && enemy.attackTime < 0) {
    const desired = movementWorld?.direction(enemy, player, dt) ?? { x: dx, z: dz };
    const length = Math.hypot(desired.x, desired.z);
    if (movementWorld) movementWorld.move('enemy', enemy, length ? desired.x / length * dt * enemy.speed : 0, length ? desired.z / length * dt * enemy.speed : 0, dt);
    else { enemy.x += dx / distance * dt * enemy.speed; enemy.z += dz / distance * dt * enemy.speed; }
    [enemy.x, enemy.z] = constrain(state.layout.boundary, [enemy.x, enemy.z]);
    if (length) enemy.yaw = Math.atan2(desired.x, desired.z);
    animate('enemy', 'run');
  } else { movementWorld?.move('enemy', enemy, 0, 0, dt); if (enemy.lock <= 0 && enemy.attackTime < 0) animate('enemy', 'idle'); }
  if (enemy.lock <= 0 && enemy.attackTime < 0 && state.enemyCooldown <= 0 && distance <= 1.6 && (!movementWorld || movementWorld.lineOfSight(enemy, player)) && Math.abs(player.y - enemy.y) < .8) {
    enemy.attackTime = 0; enemy.contactIndex = 0;
    state.enemyCooldown = timing.enemy.attack + 0.5;
    enemy.yaw = Math.atan2(dx, dz);
    events.push({ type: 'label', value: 'RAIDER ATTACKING' });
    animate('enemy', 'attack');
  }
  if (enemy.attackTime >= 0) {
    enemy.attackTime += dt;
    while (enemy.contactIndex < timing.enemy.contacts.length && enemy.attackTime >= timing.enemy.contacts[enemy.contactIndex]) {
      enemy.contactIndex++;
      if (Math.hypot(player.x - enemy.x, player.z - enemy.z) <= 1.8 && (!movementWorld || movementWorld.lineOfSight(enemy, player)) && Math.abs(player.y - enemy.y) < .8) hit(state, 'player', timing, events);
      if (state.phase !== 'playing') return events;
    }
    if (enemy.attackTime >= timing.enemy.attack) {
      enemy.attackTime = -1;
      events.push({ type: 'label', value: 'DEFEAT THE RAIDER' });
    }
  }
  return events;
}

/** Caster aim commits at windup; damage interrupts it through the same hit owner as melee. */
function stepCaster(state: Encounter, dt: number, timing: Timings, events: EncounterEvent[], movementWorld?: Movement): void {
  const { enemy, player } = state;
  const dx = player.x - enemy.x, dz = player.z - enemy.z, distance = Math.hypot(dx, dz);
  const visible = !movementWorld || movementWorld.lineOfSight(enemy, player);
  if (enemy.attackTime < 0 && enemy.lock <= 0 && (distance > casterAttackRange || !visible)) {
    const desired = movementWorld?.direction(enemy, player, dt) ?? { x: dx, z: dz };
    const length = Math.hypot(desired.x, desired.z);
    const x = length ? desired.x / length * dt * enemy.speed : 0, z = length ? desired.z / length * dt * enemy.speed : 0;
    if (movementWorld) movementWorld.move('enemy', enemy, x, z, dt);
    else { enemy.x += x; enemy.z += z; }
    [enemy.x, enemy.z] = constrain(state.layout.boundary, [enemy.x, enemy.z]);
    if (length) enemy.yaw = Math.atan2(desired.x, desired.z);
    events.push({ type: 'animation', actor: 'enemy', motion: length ? 'run' : 'idle' });
  } else {
    movementWorld?.move('enemy', enemy, 0, 0, dt);
    if (enemy.attackTime < 0 && enemy.lock <= 0) events.push({ type: 'animation', actor: 'enemy', motion: 'idle' });
  }
  if (enemy.attackTime < 0 && enemy.lock <= 0 && state.enemyCooldown <= 0 && distance <= casterAttackRange && visible && Math.abs(player.y - enemy.y) < .8) {
    enemy.yaw = Math.atan2(dx, dz); enemy.attackTime = 0; enemy.contactIndex = 0;
    state.enemyCooldown = timing.enemy.attack + .5;
    events.push({ type: 'label', value: 'CASTER ATTACKING' }, { type: 'animation', actor: 'enemy', motion: 'attack' });
  }
  if (enemy.attackTime < 0) return;
  enemy.attackTime += dt;
  const release = timing.enemy.contacts[0];
  if (enemy.contactIndex === 0 && enemy.attackTime >= release) {
    enemy.contactIndex = 1;
    const dx = Math.sin(enemy.yaw), dz = Math.cos(enemy.yaw);
    const projectile: Projectile = { id: ++state.nextProjectile, owner: 'enemy', kind: 'bolt', x: enemy.x + dx * .35, y: enemy.y + 1.08, z: enemy.z + dz * .35, dx, dz, remaining: 12, firstStep: Math.min(dt, enemy.attackTime - release) };
    if (advanceProjectile(state, projectile, dt, timing, events, movementWorld)) state.projectiles.push(projectile);
  }
  if (enemy.attackTime >= timing.enemy.attack) {
    enemy.attackTime = -1;
    events.push({ type: 'label', value: 'DEFEAT THE CASTER' }, { type: 'animation', actor: 'enemy', motion: 'idle' });
  }
}
