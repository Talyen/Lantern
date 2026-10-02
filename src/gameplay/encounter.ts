import type { Weapon } from './equipment';
import { constrain, legacyLayout, type EncounterLayout, type Spawn } from './area';
/** Encounter simulation. Positions, clocks and animation timings use world units and seconds. */
export const enemyIds = ['enemy', 'caster'] as const;
export type EnemyId = typeof enemyIds[number];
export type ActorId = 'player' | EnemyId;
export type EnemyKind = 'raider' | 'caster';
export type Motion = 'idle' | 'run' | 'attack' | 'hit' | 'death' | 'dodge' | 'block' | 'chop';
export type Phase = 'loading' | 'playing' | 'won' | 'lost';
export type ActorState = {
  x: number; y: number; z: number; yaw: number; hp: number; speed: number;
  lock: number; attackTime: number; contactIndex: number;
};
export type EnemyState = ActorState & { kind: EnemyKind; home?: Spawn; engaged: boolean; returning: boolean; cooldown: number };
export const playerMaxHealth = 100, enemyMaxHealth = 100, playerMaxMana = 100;
export const playerAttackDamage = 50, enemyAttackDamage = 20;
export const enemyNoticeRadius = 6, enemyLeashRadius = 10;
export const dodgeDuration = 0.45, dodgeDistance = 2.4, dodgeInvulnerability = 0.25, dodgeCooldown = 1;
export type Projectile = { id: number; owner: ActorId; kind: 'arrow' | 'bolt'; x: number; y: number; z: number; dx: number; dz: number; remaining: number; firstStep?: number };
export const casterAttackRange = 6, casterBoltSpeed = 8;
export type PendingInput = { kind: 'attack' | 'dodge'; remaining: number; aim?: AimPoint; direction?: {x:number;z:number} };
export type Encounter = {
  phase: Phase; layout: EncounterLayout; player: ActorState; enemies: Record<EnemyId, EnemyState>;
  weapon: Weapon | null; shield: boolean; blocking: boolean; pending: PendingInput | null; projectiles: Projectile[]; nextProjectile: number;
  attackCooldown: number; invulnerability: number; playerMana: number;
  dodgeRemaining: number; dodgeCooldown: number; dodgeDirection: { x: number; z: number };
};
export type ActorTiming = { attack: number; hit: number; contacts: readonly number[]; commitLead?: number };
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
  | { type: 'action'; actor: ActorId; action: 'attack' | 'contact' | 'dodge' | 'land'; weapon: Weapon | null }
  | { type: 'impact'; actor: ActorId; weapon: Weapon | null; blocked: boolean; lethal: boolean }
  | { type: 'projectileImpact'; kind: 'arrow' | 'bolt'; position: { x: number; z: number } }
  | { type: 'axeXp' }
  | { type: 'label'; value: 'MOVE TO BEGIN' | 'DEFEAT THE RAIDER' | 'RAIDER ATTACKING' | 'DEFEAT THE CASTER' | 'CASTER ATTACKING' }
  | { type: 'outcome'; won: boolean };

export function createEncounter(phase: Phase = 'loading', layout: EncounterLayout = legacyLayout, enemyKind: EnemyKind = 'raider'): Encounter {
  const actor = (x: number, z: number, hp: number, speed: number): ActorState =>
    ({ x, y: 0, z, yaw: 0, hp, speed, lock: 0, attackTime: -1, contactIndex: 0 });
  const player = actor(...layout.player.position, phase === 'loading' ? 0 : playerMaxHealth, 3.2);
  player.yaw = layout.player.yaw;
  const enemies = Object.fromEntries(enemyIds.map(id => {
    const home = layout[id], spawn = home ?? layout.player;
    return [id, { ...actor(...spawn.position, home && phase !== 'loading' ? enemyMaxHealth : 0, 1.45), yaw: spawn.yaw, kind: id === 'caster' ? 'caster' : enemyKind, home, engaged: false, returning: false, cooldown: .8 }];
  })) as Record<EnemyId, EnemyState>;
  return { weapon: 'axe', shield: false, blocking: false, pending: null, projectiles: [], nextProjectile: 0, phase, layout, player, enemies,
    attackCooldown: 0, invulnerability: 0, playerMana: playerMaxMana,
    dodgeRemaining: 0, dodgeCooldown: 0, dodgeDirection: { x: 0, z: 0 } };
}
export function resetEncounter(state: Encounter): EncounterEvent[] {
  const { weapon, shield } = state;
  Object.assign(state, createEncounter('playing', state.layout, state.enemies.enemy.kind), { weapon, shield });
  return [{ type: 'label', value: 'MOVE TO BEGIN' }, { type: 'animation', actor: 'player', motion: 'idle' },
    ...enemyIds.map(actor => ({ type: 'animation' as const, actor, motion: 'idle' as const }))];
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
  return [{ type: 'label', value: 'DEFEAT THE RAIDER' }, { type: 'animation', actor: 'player', motion: 'attack' }, { type: 'action', actor: 'player', action: 'attack', weapon: state.weapon }];
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
  return [{ type: 'animation', actor: 'player', motion: 'dodge' }, { type: 'action', actor: 'player', action: 'dodge', weapon: state.weapon }];
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
    if (state.dodgeRemaining === 0) events.push({ type: 'animation', actor: 'player', motion: 'idle' }, { type: 'action', actor: 'player', action: 'land', weapon: state.weapon });
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
function hit(state: Encounter, actor: ActorId, timing: Timings, events: EncounterEvent[], source?: Weapon, incoming?: { x: number; z: number }, impactOffset = 0): void {
  if ((actor === 'player' ? state.player : state.enemies[actor]).hp <= 0 || actor === 'player' && state.invulnerability > 0) return;
  const target = actor === 'player' ? state.player : state.enemies[actor];
  let damage = actor !== 'player' ? playerAttackDamage : enemyAttackDamage;
  if (actor === 'player' && state.blocking) {
    // Projectiles are blocked by their incoming direction, even if the caster has moved.
    const dx = incoming?.x ?? 0, dz = incoming?.z ?? 0, distance = Math.hypot(dx,dz);
    if (distance && (Math.sin(target.yaw)*dx + Math.cos(target.yaw)*dz) / distance >= .5) damage *= .5;
  }
  target.hp = Math.max(0, target.hp - damage);
  if (actor !== 'player' && source === 'axe') events.push({type:'axeXp'});
  if (actor !== 'player' && !state.enemies[actor].returning) state.enemies[actor].engaged = true;
  // A successful shield block retains the stance; rear hits interrupt normally.
  const blocked = actor === 'player' && damage < enemyAttackDamage;
  const enemy = actor !== 'player' ? state.enemies[actor] : null;
  const contact = timing[actor].contacts[0];
  const committed = enemy?.kind === 'raider' && (timing[actor].commitLead ?? 0) > 0 && target.attackTime >= 0 && target.attackTime + impactOffset >= Math.max(0, contact - (timing[actor].commitLead ?? 0)) && target.attackTime < contact && target.hp > 0;
  if (!blocked && !committed) { target.lock = timing[actor].hit; target.attackTime = -1; }
  if (actor === 'player') { state.invulnerability = .65; state.dodgeRemaining = 0; state.pending = null; if (!blocked) state.blocking = false; }
  else if (!committed) target.contactIndex = 0;
  events.push({type:'hit',actor}, {type:'impact',actor,weapon:source ?? null,blocked,lethal:target.hp<=0});
  if (!blocked && !committed) events.push({type:'animation',actor,motion:'hit'});
  if (target.hp <= 0) {
    const won = actor !== 'player';
    state.projectiles = won ? state.projectiles.filter(projectile => projectile.owner !== actor) : [];
    events.push({type:'animation',actor,motion:'death'});
    if (!won || enemyIds.every(id => state.enemies[id].hp <= 0)) {
      state.phase = won ? 'won' : 'lost'; state.pending = null; state.blocking = false;
    }
    if (!won || enemyIds.every(id => state.enemies[id].hp <= 0 || !state.enemies[id].engaged)) events.push({type:'outcome',won});
  }
}
function stepPlayerAttack(state: Encounter, dt: number, timing: Timings, events: EncounterEvent[], movementWorld?: Movement): void {
  const {player} = state;
  if (player.attackTime < 0) return;
  player.attackTime += dt;
  while (player.contactIndex < timing.player.contacts.length && player.attackTime >= timing.player.contacts[player.contactIndex]) {
    player.contactIndex++;
    events.push({type:'action',actor:'player',action:'contact',weapon:state.weapon});
    if (state.weapon === 'bow' || state.weapon === 'staff') {
      const dx = Math.sin(player.yaw), dz = Math.cos(player.yaw);
      state.projectiles.push({id: ++state.nextProjectile, owner: 'player', kind: state.weapon === 'bow' ? 'arrow' : 'bolt', x:player.x + dx * .35, y:player.y + 1.22, z:player.z + dz * .35, dx, dz, remaining:12, firstStep: Math.min(dt,player.attackTime-timing.player.contacts[player.contactIndex-1])});
    } else for (const id of enemyIds) {
      const enemy = state.enemies[id];
      if (!enemy.home || enemy.hp <= 0) continue;
      const dx = enemy.x-player.x, dz = enemy.z-player.z, distance = Math.hypot(dx,dz);
      const facing = distance > 0 ? (Math.sin(player.yaw)*dx + Math.cos(player.yaw)*dz)/distance : 0;
      if (distance < 1.95 && facing > .1 && (!movementWorld || movementWorld.lineOfSight(player,enemy)) && Math.abs(player.y-enemy.y)<.8) hit(state,id,timing,events,state.weapon ?? undefined,undefined,Math.max(0,timing.player.contacts[player.contactIndex-1]-(player.attackTime-dt)));
    }
  }
  if (player.attackTime >= timing.player.attack) player.attackTime = -1;
}
/** Numeric swept projectiles share terrain collision with movement, never apply damage twice. */
function advanceProjectile(state: Encounter, projectile: Projectile, dt: number, timing: Timings, events: EncounterEvent[], movementWorld?: Movement): boolean {
  if (state.phase === 'lost' || projectile.owner !== 'player' && state.enemies[projectile.owner].hp <= 0) return false;
  const speed = projectile.owner !== 'player' ? casterBoltSpeed : projectile.kind === 'arrow' ? 24 : 16;
  const distance = Math.min(projectile.remaining, (projectile.firstStep ?? dt) * speed);
  projectile.firstStep = undefined;
  const to = { x: projectile.x + projectile.dx * distance, y: projectile.y, z: projectile.z + projectile.dz * distance };
  const wall = movementWorld?.segmentHit?.(projectile, to) ?? null;
  let first: { id: ActorId; fraction: number } | undefined;
  for (const id of projectile.owner === 'player' ? enemyIds : ['player'] as const) {
    const target = id === 'player' ? state.player : state.enemies[id];
    if (target.hp <= 0 || id !== 'player' && !state.enemies[id].home) continue;
    const x = target.x - projectile.x, z = target.z - projectile.z;
    const along = x * projectile.dx + z * projectile.dz, perpendicular = Math.abs(x * projectile.dz - z * projectile.dx);
    const radiusAlong = Math.sqrt(Math.max(0, .42 * .42 - perpendicular * perpendicular));
    const entry = along - radiusAlong, exit = along + radiusAlong;
    const fraction = Math.max(0, entry) / Math.max(.0001, distance);
    if (perpendicular <= .42 && exit >= 0 && entry <= distance && projectile.y >= target.y + .15 && projectile.y <= target.y + 1.6 && (wall === null || fraction < wall) && (!first || fraction < first.fraction)) first = { id, fraction };
  }
  if (first) { hit(state, first.id, timing, events, projectile.kind==='arrow' ? 'bow' : 'staff', { x: -projectile.dx, z: -projectile.dz },dt-distance/speed+first.fraction*distance/speed); return false; }
  if (wall !== null) { events.push({type:'projectileImpact',kind:projectile.kind,position:{x:projectile.x+(to.x-projectile.x)*wall,z:projectile.z+(to.z-projectile.z)*wall}}); return false; }
  projectile.x = to.x; projectile.z = to.z; projectile.remaining -= distance;
  return projectile.remaining > 0;
}
function stepProjectiles(state: Encounter, dt: number, timing: Timings, events: EncounterEvent[], movementWorld?: Movement): void {
  state.projectiles = state.projectiles.filter(projectile => advanceProjectile(state, projectile, dt, timing, events, movementWorld));
  state.projectiles = state.projectiles.filter(projectile => projectile.owner === 'player' || state.enemies[projectile.owner].hp > 0);
  if (state.player.hp <= 0) state.projectiles = [];
}
/** Safe and cleared areas retain attacks and projectile presentation without enemy AI. */
export function stepExploration(state: Encounter, dt: number, input: Input, movementWorld?: Movement, timing?: Timings): EncounterEvent[] {
  if (input.paused || state.player.hp <= 0 || !['playing','won'].includes(state.phase)) return [];
  const fallback: ActorTiming = {attack:.7,hit:.3,contacts:[.28]};
  const clocks = timing ?? {player:fallback,enemy:fallback,caster:fallback};
  const events = preparePlayer(state,dt,input,clocks.player);
  stepPlayerAttack(state,dt,clocks,events,movementWorld); stepProjectiles(state,dt,clocks,events,movementWorld);
  events.push(...movePlayer(state,dt,input,movementWorld)); return events;
}
export function stepEncounter(state: Encounter, dt: number, input: Input, timing: Timings, movementWorld?: Movement): EncounterEvent[] {
  if (input.paused || state.phase !== 'playing') return [];
  const events = preparePlayer(state,dt,input,timing.player);
  for (const id of enemyIds) {
    const enemy = state.enemies[id];
    enemy.lock = Math.max(0, enemy.lock - dt); enemy.cooldown = Math.max(0, enemy.cooldown - dt);
  }
  stepPlayerAttack(state,dt,timing,events,movementWorld); stepProjectiles(state,dt,timing,events,movementWorld);
  if (state.phase !== 'playing') return events;
  events.push(...movePlayer(state, dt, input, movementWorld));
  for (const id of enemyIds) {
    if (state.phase !== 'playing') break;
    if (state.enemies[id].home && state.enemies[id].hp > 0) stepEnemy(state,id,dt,timing,events,movementWorld);
  }
  return events;
}
function stepEnemy(state: Encounter, id: EnemyId, dt: number, timing: Timings, events: EncounterEvent[], movementWorld?: Movement): void {
  const player = state.player, enemy = state.enemies[id];
  const animate = (motion:Motion) => events.push({type:'animation',actor:id,motion});
  const spawn = enemy.home!;
  const dx = player.x - enemy.x, dz = player.z - enemy.z;
  const homeDistance = Math.hypot(enemy.x - spawn.position[0], enemy.z - spawn.position[1]);
  if (!enemy.engaged && !enemy.returning && Math.hypot(dx, dz) <= enemyNoticeRadius && (!movementWorld || movementWorld.lineOfSight(enemy, player))) enemy.engaged = true;
  if (enemy.engaged && (homeDistance > enemyLeashRadius || Math.hypot(dx, dz) > enemyLeashRadius)) {
    enemy.engaged = false; enemy.returning = true; enemy.attackTime = -1; enemy.contactIndex = 0;
  }
  if (enemy.returning) {
    if (homeDistance <= .2) {
      enemy.x = spawn.position[0]; enemy.z = spawn.position[1]; enemy.yaw = spawn.yaw;
      enemy.hp = enemyMaxHealth; enemy.lock = 0; enemy.cooldown = .8; enemy.returning = false;
      movementWorld?.move(id, enemy, 0, 0, dt); animate('idle');
    } else if (enemy.lock <= 0) {
      const home = { ...enemy, x: spawn.position[0], z: spawn.position[1] };
      const desired = movementWorld?.direction(enemy, home, dt) ?? { x: home.x - enemy.x, z: home.z - enemy.z };
      const length = Math.hypot(desired.x, desired.z), distance = Math.min(homeDistance, dt * enemy.speed);
      const x = length ? desired.x / length * distance : 0, z = length ? desired.z / length * distance : 0;
      if (movementWorld) movementWorld.move(id, enemy, x, z, dt);
      else { enemy.x += x; enemy.z += z; }
      if (length) enemy.yaw = Math.atan2(desired.x, desired.z);
      animate(length ? 'run' : 'idle');
    }
    return;
  }
  if (!enemy.engaged) { movementWorld?.move(id, enemy, 0, 0, dt); return; }
  if (enemy.kind === 'caster') { stepCaster(state, id, dt, timing, events, movementWorld); return; }
  // Keep the pre-movement distance: the original encounter uses it to start an enemy strike.
  const distance = Math.hypot(dx, dz);
  if (enemy.lock <= 0 && (distance > 1.45 || movementWorld && !movementWorld.lineOfSight(enemy, player)) && enemy.attackTime < 0) {
    const desired = movementWorld?.direction(enemy, player, dt) ?? { x: dx, z: dz };
    const length = Math.hypot(desired.x, desired.z);
    if (movementWorld) movementWorld.move(id, enemy, length ? desired.x / length * dt * enemy.speed : 0, length ? desired.z / length * dt * enemy.speed : 0, dt);
    else { enemy.x += dx / distance * dt * enemy.speed; enemy.z += dz / distance * dt * enemy.speed; }
    [enemy.x, enemy.z] = constrain(state.layout.boundary, [enemy.x, enemy.z]);
    if (length) enemy.yaw = Math.atan2(desired.x, desired.z);
    animate('run');
  } else { movementWorld?.move(id, enemy, 0, 0, dt); if (enemy.lock <= 0 && enemy.attackTime < 0) animate('idle'); }
  if (enemy.lock <= 0 && enemy.attackTime < 0 && enemy.cooldown <= 0 && distance <= 1.6 && (!movementWorld || movementWorld.lineOfSight(enemy, player)) && Math.abs(player.y - enemy.y) < .8) {
    enemy.attackTime = 0; enemy.contactIndex = 0;
    enemy.cooldown = timing[id].attack + 0.5;
    enemy.yaw = Math.atan2(dx, dz);
    events.push({ type: 'label', value: 'RAIDER ATTACKING' });
    animate('attack');
    events.push({type:'action',actor:id,action:'attack',weapon:'axe'});
  }
  if (enemy.attackTime >= 0) {
    enemy.attackTime += dt;
    while (enemy.contactIndex < timing[id].contacts.length && enemy.attackTime >= timing[id].contacts[enemy.contactIndex]) {
      enemy.contactIndex++;
      events.push({type:'action',actor:id,action:'contact',weapon:'axe'});
      const contactDx = player.x-enemy.x, contactDz = player.z-enemy.z, reach = Math.hypot(contactDx,contactDz);
      const facing = reach > 0 ? (Math.sin(enemy.yaw)*contactDx+Math.cos(enemy.yaw)*contactDz)/reach : 1;
      if (facing >= .5 && Math.hypot(player.x - enemy.x, player.z - enemy.z) <= 1.8 && (!movementWorld || movementWorld.lineOfSight(enemy, player)) && Math.abs(player.y - enemy.y) < .8) hit(state, 'player', timing, events, 'axe', {x:enemy.x-player.x,z:enemy.z-player.z});
      if (state.phase !== 'playing') return;
    }
    if (enemy.attackTime >= timing[id].attack) {
      enemy.attackTime = -1;
      events.push({ type: 'label', value: 'DEFEAT THE RAIDER' });
    }
  }
  return;
}

/** Caster aim commits at windup; damage interrupts it through the same hit owner as melee. */
function stepCaster(state: Encounter, id: EnemyId, dt: number, timing: Timings, events: EncounterEvent[], movementWorld?: Movement): void {
  const player = state.player, enemy = state.enemies[id];
  const dx = player.x - enemy.x, dz = player.z - enemy.z, distance = Math.hypot(dx, dz);
  const visible = !movementWorld || movementWorld.lineOfSight(enemy, player);
  if (enemy.attackTime < 0 && enemy.lock <= 0 && (distance > casterAttackRange || !visible)) {
    const desired = movementWorld?.direction(enemy, player, dt) ?? { x: dx, z: dz };
    const length = Math.hypot(desired.x, desired.z);
    const x = length ? desired.x / length * dt * enemy.speed : 0, z = length ? desired.z / length * dt * enemy.speed : 0;
    if (movementWorld) movementWorld.move(id, enemy, x, z, dt);
    else { enemy.x += x; enemy.z += z; }
    [enemy.x, enemy.z] = constrain(state.layout.boundary, [enemy.x, enemy.z]);
    if (length) enemy.yaw = Math.atan2(desired.x, desired.z);
    events.push({ type: 'animation', actor: id, motion: length ? 'run' : 'idle' });
  } else {
    movementWorld?.move(id, enemy, 0, 0, dt);
    if (enemy.attackTime < 0 && enemy.lock <= 0) events.push({ type: 'animation', actor: id, motion: 'idle' });
  }
  if (enemy.attackTime < 0 && enemy.lock <= 0 && enemy.cooldown <= 0 && distance <= casterAttackRange && visible && Math.abs(player.y - enemy.y) < .8) {
    enemy.yaw = Math.atan2(dx, dz); enemy.attackTime = 0; enemy.contactIndex = 0;
    enemy.cooldown = timing[id].attack + .5;
    events.push({ type: 'label', value: 'CASTER ATTACKING' }, { type: 'animation', actor: id, motion: 'attack' }, {type:'action',actor:id,action:'attack',weapon:'staff'});
  }
  if (enemy.attackTime < 0) return;
  enemy.attackTime += dt;
  const release = timing[id].contacts[0];
  if (enemy.contactIndex === 0 && enemy.attackTime >= release) {
    enemy.contactIndex = 1;
    events.push({type:'action',actor:id,action:'contact',weapon:'staff'});
    const dx = Math.sin(enemy.yaw), dz = Math.cos(enemy.yaw);
    const projectile: Projectile = { id: ++state.nextProjectile, owner: id, kind: 'bolt', x: enemy.x + dx * .35, y: enemy.y + 1.08, z: enemy.z + dz * .35, dx, dz, remaining: 12, firstStep: Math.min(dt, enemy.attackTime - release) };
    if (advanceProjectile(state, projectile, dt, timing, events, movementWorld)) state.projectiles.push(projectile);
  }
  if (enemy.attackTime >= timing[id].attack) {
    enemy.attackTime = -1;
    events.push({ type: 'label', value: 'DEFEAT THE CASTER' }, { type: 'animation', actor: id, motion: 'idle' });
  }
}
