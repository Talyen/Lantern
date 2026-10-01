import { constrain, legacyLayout, type EncounterLayout } from './area';
/** Encounter simulation. Positions, clocks and animation timings use world units and seconds. */
export type ActorId = 'player' | 'enemy';
export type Motion = 'idle' | 'run' | 'attack' | 'hit' | 'death' | 'dodge';
export type Phase = 'loading' | 'playing' | 'won' | 'lost';
export type ActorState = {
  x: number; y: number; z: number; yaw: number; hp: number; speed: number;
  lock: number; attackTime: number; contactIndex: number;
};
export const playerMaxHealth = 100, enemyMaxHealth = 100, playerMaxMana = 100;
export const playerAttackDamage = 50, enemyAttackDamage = 20;
export const enemyNoticeRadius = 6, enemyLeashRadius = 10;
export const dodgeDuration = 0.45, dodgeDistance = 2.4, dodgeInvulnerability = 0.25, dodgeCooldown = 1;
export type Encounter = {
  phase: Phase; layout: EncounterLayout; engaged: boolean; returning: boolean; player: ActorState; enemy: ActorState;
  attackCooldown: number; invulnerability: number; enemyCooldown: number; playerMana: number;
  dodgeRemaining: number; dodgeCooldown: number; dodgeDirection: { x: number; z: number };
};
export type ActorTiming = { attack: number; hit: number; contacts: readonly number[] };
export type Timings = Record<ActorId, ActorTiming>;
export type Movement = { move(id: ActorId, actor: ActorState, dx: number, dz: number, dt: number): void; direction(from: ActorState, to: ActorState, dt: number): { x: number; z: number }; lineOfSight(from: ActorState, to: ActorState): boolean };
export type AimPoint = { x: number; z: number };
export type Input = { x: number; z: number; paused: boolean; aim?: AimPoint };
const aimDeadZone = .15;
function faceAim(player: ActorState, aim: AimPoint): void {
  const x = aim.x - player.x, z = aim.z - player.z;
  if (Math.hypot(x, z) > aimDeadZone) player.yaw = Math.atan2(x, z);
}
export type EncounterEvent =
  | { type: 'animation'; actor: ActorId; motion: Motion }
  | { type: 'hit'; actor: ActorId }
  | { type: 'label'; value: 'MOVE TO BEGIN' | 'DEFEAT THE RAIDER' | 'RAIDER ATTACKING' }
  | { type: 'outcome'; won: boolean };

export function createEncounter(phase: Phase = 'loading', layout: EncounterLayout = legacyLayout): Encounter {
  const actor = (x: number, z: number, hp: number, speed: number): ActorState =>
    ({ x, y: 0, z, yaw: 0, hp, speed, lock: 0, attackTime: -1, contactIndex: 0 });
  const enemySpawn = layout.enemy ?? layout.player;
  const player = actor(...layout.player.position, phase === 'loading' ? 0 : playerMaxHealth, 3.2), enemy = actor(...enemySpawn.position, phase === 'loading' ? 0 : enemyMaxHealth, 1.45);
  player.yaw = layout.player.yaw; enemy.yaw = enemySpawn.yaw;
  return { phase, layout, engaged: false, returning: false, player, enemy,
    attackCooldown: 0, invulnerability: 0, enemyCooldown: 0.8, playerMana: playerMaxMana,
    dodgeRemaining: 0, dodgeCooldown: 0, dodgeDirection: { x: 0, z: 0 } };
}
export function resetEncounter(state: Encounter): EncounterEvent[] {
  Object.assign(state, createEncounter('playing', state.layout));
  return [{ type: 'label', value: 'MOVE TO BEGIN' },
    { type: 'animation', actor: 'player', motion: 'idle' }, { type: 'animation', actor: 'enemy', motion: 'idle' }];
}
export function attack(state: Encounter, timing: ActorTiming, paused: boolean, aim?: AimPoint): EncounterEvent[] {
  if (paused || state.phase !== 'playing' || state.attackCooldown > 0 || state.player.lock > 0 || state.dodgeRemaining > 0) return [];
  // An accepted swing commits its direction; pointer updates cannot steer its contacts.
  if (aim) faceAim(state.player, aim);
  state.player.lock = timing.attack;
  state.attackCooldown = timing.attack + 0.08;
  state.player.attackTime = 0;
  state.player.contactIndex = 0;
  return [{ type: 'label', value: 'DEFEAT THE RAIDER' }, { type: 'animation', actor: 'player', motion: 'attack' }];
}
/** Dodge is numeric simulation state; the animation never decides displacement or immunity. */
export function dodge(state: Encounter, direction: { x: number; z: number }, paused: boolean, aim?: AimPoint): EncounterEvent[] {
  if (paused || !['playing', 'won'].includes(state.phase) || state.player.hp <= 0 || state.player.lock > 0 || state.dodgeCooldown > 0 || state.dodgeRemaining > 0) return [];
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
  if (player.lock <= 0 && length > 0) {
    move(input.x / length * dt * player.speed, input.z / length * dt * player.speed);
    if (!input.aim) player.yaw = Math.atan2(input.x, input.z);
    events.push({ type: 'animation', actor: 'player', motion: 'run' });
  } else {
    move(0, 0);
    if (player.lock <= 0) events.push({ type: 'animation', actor: 'player', motion: 'idle' });
  }
  // Resolve from the post-movement position, preserving facing during action/hit locks.
  if (player.lock <= 0 && input.aim) faceAim(player, input.aim);
  return events;
}
/** Safe areas and cleared encounters use the same grounded movement and dodge clocks. */
export function stepExploration(state: Encounter, dt: number, input: Input, movementWorld?: Movement): EncounterEvent[] {
  if (input.paused || state.player.hp <= 0 || !['playing', 'won'].includes(state.phase)) return [];
  advancePlayerClocks(state, dt);
  return movePlayer(state, dt, input, movementWorld);
}
export function stepEncounter(state: Encounter, dt: number, input: Input, timing: Timings, movementWorld?: Movement): EncounterEvent[] {
  const events: EncounterEvent[] = [];
  if (input.paused || state.phase !== 'playing') return events;
  const { player, enemy } = state;
  advancePlayerClocks(state, dt);
  enemy.lock = Math.max(0, enemy.lock - dt);
  state.enemyCooldown = Math.max(0, state.enemyCooldown - dt);
  const animate = (actor: ActorId, motion: Motion) => events.push({ type: 'animation', actor, motion });
  const hit = (actor: ActorId) => {
    if (actor === 'player' && state.invulnerability > 0) return;
    const target = state[actor];
    target.hp = Math.max(0, target.hp - (actor === 'enemy' ? playerAttackDamage : enemyAttackDamage));
    if (actor === 'enemy' && !state.returning) state.engaged = true;
    target.lock = timing[actor].hit;
    target.attackTime = -1;
    if (actor === 'player') { state.invulnerability = 0.65; state.dodgeRemaining = 0; }
    else target.contactIndex = 0;
    events.push({ type: 'hit', actor });
    animate(actor, 'hit');
    if (target.hp <= 0) {
      const won = actor === 'enemy';
      state.phase = won ? 'won' : 'lost';
      events.push({ type: 'outcome', won });
      animate(actor, 'death');
    }
  };
  if (player.attackTime >= 0) {
    player.attackTime += dt;
    while (player.contactIndex < timing.player.contacts.length && player.attackTime >= timing.player.contacts[player.contactIndex]) {
      player.contactIndex++;
      const dx = enemy.x - player.x, dz = enemy.z - player.z;
      const distance = Math.hypot(dx, dz);
      const facing = distance > 0 ? (Math.sin(player.yaw) * dx + Math.cos(player.yaw) * dz) / distance : 0;
      if (distance < 1.95 && facing > 0.1 && (!movementWorld || movementWorld.lineOfSight(player, enemy)) && Math.abs(player.y - enemy.y) < .8) hit('enemy');
      if (state.phase !== 'playing') return events;
    }
    if (player.attackTime >= timing.player.attack) player.attackTime = -1;
  }
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
      if (Math.hypot(player.x - enemy.x, player.z - enemy.z) <= 1.8 && (!movementWorld || movementWorld.lineOfSight(enemy, player)) && Math.abs(player.y - enemy.y) < .8) hit('player');
      if (state.phase !== 'playing') return events;
    }
    if (enemy.attackTime >= timing.enemy.attack) {
      enemy.attackTime = -1;
      events.push({ type: 'label', value: 'DEFEAT THE RAIDER' });
    }
  }
  return events;
}
