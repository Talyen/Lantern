/** Encounter simulation. Positions, clocks and animation timings use world units and seconds. */
export type ActorId = 'player' | 'enemy';
export type Motion = 'idle' | 'run' | 'attack' | 'hit' | 'death';
export type Phase = 'loading' | 'playing' | 'won' | 'lost';
export type ActorState = {
  x: number; z: number; yaw: number; hp: number; speed: number;
  lock: number; attackTime: number; contactIndex: number;
};
export type Encounter = {
  phase: Phase; engaged: boolean; player: ActorState; enemy: ActorState;
  attackCooldown: number; invulnerability: number; enemyCooldown: number;
};
export type ActorTiming = { attack: number; hit: number; contacts: readonly number[] };
export type Timings = Record<ActorId, ActorTiming>;
export type Input = { x: number; z: number; paused: boolean };
export type EncounterEvent =
  | { type: 'animation'; actor: ActorId; motion: Motion }
  | { type: 'hit'; actor: ActorId }
  | { type: 'label'; value: 'MOVE TO BEGIN' | 'DEFEAT THE RAIDER' | 'RAIDER ATTACKING' }
  | { type: 'outcome'; won: boolean };

export function createEncounter(phase: Phase = 'loading'): Encounter {
  const actor = (x: number, z: number, hp: number, speed: number): ActorState =>
    ({ x, z, yaw: 0, hp, speed, lock: 0, attackTime: -1, contactIndex: 0 });
  return { phase, engaged: false, player: actor(-2.3, 1.7, phase === 'loading' ? 0 : 5, 3.2), enemy: actor(2.1, -1.5, phase === 'loading' ? 0 : 4, 1.45),
    attackCooldown: 0, invulnerability: 0, enemyCooldown: 0.8 };
}
export function resetEncounter(state: Encounter): EncounterEvent[] {
  Object.assign(state, createEncounter('playing'));
  return [{ type: 'label', value: 'MOVE TO BEGIN' },
    { type: 'animation', actor: 'player', motion: 'idle' }, { type: 'animation', actor: 'enemy', motion: 'idle' }];
}
export function attack(state: Encounter, timing: ActorTiming, paused: boolean): EncounterEvent[] {
  if (paused || state.phase !== 'playing' || state.attackCooldown > 0 || state.player.lock > 0) return [];
  state.engaged = true;
  state.player.lock = timing.attack;
  state.attackCooldown = timing.attack + 0.08;
  state.player.attackTime = 0;
  state.player.contactIndex = 0;
  return [{ type: 'label', value: 'DEFEAT THE RAIDER' }, { type: 'animation', actor: 'player', motion: 'attack' }];
}
export function stepEncounter(state: Encounter, dt: number, input: Input, timing: Timings): EncounterEvent[] {
  const events: EncounterEvent[] = [];
  if (input.paused || state.phase !== 'playing') return events;
  const { player, enemy } = state;
  state.attackCooldown = Math.max(0, state.attackCooldown - dt);
  state.invulnerability = Math.max(0, state.invulnerability - dt);
  player.lock = Math.max(0, player.lock - dt);
  enemy.lock = Math.max(0, enemy.lock - dt);
  state.enemyCooldown = Math.max(0, state.enemyCooldown - dt);
  const animate = (actor: ActorId, motion: Motion) => events.push({ type: 'animation', actor, motion });
  const hit = (actor: ActorId) => {
    if (actor === 'player' && state.invulnerability > 0) return;
    const target = state[actor];
    target.hp--;
    target.lock = timing[actor].hit;
    target.attackTime = -1;
    if (actor === 'player') state.invulnerability = 0.65;
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
      if (distance < 1.95 && facing > 0.1) hit('enemy');
      if (state.phase !== 'playing') return events;
    }
    if (player.attackTime >= timing.player.attack) player.attackTime = -1;
  }
  const movement = Math.hypot(input.x, input.z);
  if (player.lock <= 0 && movement > 0) {
    if (!state.engaged) { state.engaged = true; events.push({ type: 'label', value: 'DEFEAT THE RAIDER' }); }
    player.x += input.x / movement * dt * player.speed;
    player.z += input.z / movement * dt * player.speed;
    const radius = Math.hypot(player.x, player.z);
    if (radius > 6.55) { player.x *= 6.55 / radius; player.z *= 6.55 / radius; }
    player.yaw = Math.atan2(input.x, input.z);
    animate('player', 'run');
  } else if (player.lock <= 0) animate('player', 'idle');
  if (!state.engaged) return events;
  const dx = player.x - enemy.x, dz = player.z - enemy.z;
  // Keep the pre-movement distance: the original encounter uses it to start an enemy strike.
  const distance = Math.hypot(dx, dz);
  if (enemy.lock <= 0 && distance < 5.5 && distance > 1.45 && enemy.attackTime < 0) {
    enemy.x += dx / distance * dt * enemy.speed;
    enemy.z += dz / distance * dt * enemy.speed;
    enemy.yaw = Math.atan2(dx, dz);
    animate('enemy', 'run');
  } else if (enemy.lock <= 0 && enemy.attackTime < 0) animate('enemy', 'idle');
  if (enemy.lock <= 0 && enemy.attackTime < 0 && state.enemyCooldown <= 0 && distance <= 1.6) {
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
      if (Math.hypot(player.x - enemy.x, player.z - enemy.z) <= 1.8) hit('player');
      if (state.phase !== 'playing') return events;
    }
    if (enemy.attackTime >= timing.enemy.attack) {
      enemy.attackTime = -1;
      events.push({ type: 'label', value: 'DEFEAT THE RAIDER' });
    }
  }
  return events;
}
