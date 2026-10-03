import { abilities, abilitySet, basicAbility, abilityUnlocked, cooldownForAbility, berserking, type AbilityId, type WeaponSet } from './abilities';
import { itemLoadout, type InventoryItem } from './inventory';
import { resolveCombatStats } from './combat-stats';
import { constrain } from './area';
import {
  dodgeDuration, dodgeDistance, dodgeInvulnerability, dodgeCooldown, type ActorState,
  type AimPoint, type ActorTiming, type Encounter, type EncounterEvent, type Input, type Movement,
  type Timings,
} from './encounter-model';
import { hit } from './encounter-damage';
import { projectileLaunchClear } from './encounter-projectiles';

const aimDeadZone = .15;
function faceAim(player: ActorState, aim: AimPoint): void {
  const x = aim.x - player.x, z = aim.z - player.z;
  if (Math.hypot(x, z) > aimDeadZone)
    player.yaw = Math.atan2(x, z);
}

/** Commit derived equipment state only after presentation preparation succeeds. */
export function applyEquipment(state: Encounter, items: readonly InventoryItem[], active: WeaponSet): void {
  state.weaponSets = [itemLoadout(items, 0), itemLoadout(items, 1)];
  state.setStats = [resolveCombatStats(items, 0), resolveCombatStats(items, 1)];
  state.activeSet = active;
  applyActiveStats(state);
}

function applyActiveStats(state: Encounter): void {
  const base = state.setStats[state.activeSet];
  state.stats = state.berserkingRemaining > 0 && base.family === 'axe'
    ? { ...base, damage: base.damage * berserking.damage, attackRate: base.attackRate * berserking.attackRate, moveSpeed: base.moveSpeed * berserking.moveSpeed } : base;
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
  state.playerAction = { impactId: state.nextImpact = (state.nextImpact ?? 0) + 1, duration, contacts: timing.contacts.map(contact => contact / rate), damage: state.stats.damage, rate, reach: state.stats.reach, arc: state.weapon === 'sword' ? Math.PI / 4 : Math.acos(.1), weapon: state.weapon, ability: basicAbility(state.weapon) };
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
export function useAbility(state: Encounter, id: AbilityId, timing: ActorTiming, paused: boolean, aim?: AimPoint): EncounterEvent[] {
  const definition = abilities[id], set = abilitySet(state.weaponSets, state.activeSet, id);
  if (paused || state.player.hp <= 0 || !['playing', 'won'].includes(state.phase) || set === undefined || state.playerMana < definition.mana || !abilityUnlocked(id, state.proficiency))
    return [];
  if (state.player.lock > 0 || state.dodgeRemaining > 0 || state.attackCooldown > 0 || cooldownForAbility(state, id) > 0) {
    state.pending = { kind: 'ability', ability: id, remaining: .15, aim: aim ? { ...aim } : undefined };
    return [];
  }
  if (state.blocking && definition.activation !== 'hold')
    return [];
  const action = timing.abilities?.[id] ?? (definition.motion === 'attack' ? timing : undefined);
  if (definition.activation !== 'hold' && (!action || action.attack <= 0 || (!action.contacts.length && id !== 'berserking')))
    return [];
  const events = activateSet(state, set);
  state.pending = null;
  if (definition.activation === 'hold') {
    if (aim)
      faceAim(state.player, aim);
    state.blocking = true;
    return [...events, { type: 'animation', actor: 'player', motion: 'block' }];
  }
  if (id === 'berserking' && action) {
    if (aim) faceAim(state.player, aim);
    state.player.lock = state.attackCooldown = action.attack;
    state.player.attackTime = 0; state.player.contactIndex = 0;
    state.playerAction = { duration: action.attack, contacts: [], damage: 0, rate: 1, reach: 0, arc: 0, weapon: 'axe', ability: id };
    return [...events, { type: 'animation', actor: 'player', motion: 'battleCry' }, { type: 'action', actor: 'player', action: 'battleCry', weapon: 'axe' }];
  }
  const attackEvents = attack(state, { ...timing, ...action }, false, aim);
  if (!attackEvents.length || !state.playerAction)
    return events;
  state.playerMana -= definition.mana;
  if (definition.tier === 'ultimate') state.ultimateCooldown = definition.cooldown;
  else state.abilityCooldowns[id] = definition.cooldown;
  Object.assign(state.playerAction, { ability: id, damage: state.stats.damage * definition.damageScale, arc: id === 'sweep' ? Math.PI / 2 : id === 'crushing-blow' ? Math.PI / 6 : state.playerAction.arc });
  for (const event of attackEvents)
    if (event.type === 'animation' && event.actor === 'player')
      event.motion = definition.motion;
  return [...events, ...attackEvents];
}

/** Dodge is numeric simulation state; the animation never decides displacement or immunity. */
export function dodge(state: Encounter, direction: AimPoint, paused: boolean, aim?: AimPoint): EncounterEvent[] {
  if (paused || !['playing', 'won'].includes(state.phase) || state.player.hp <= 0)
    return [];
  if (state.player.lock > 0 || state.dodgeCooldown > 0 || state.dodgeRemaining > 0) {
    state.pending = { kind: 'dodge', remaining: .15, direction: { ...direction }, aim: aim ? { ...aim } : undefined };
    return [];
  }
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
  return [{ type: 'animation', actor: 'player', motion: 'dodge' }, { type: 'action', actor: 'player', action: 'dodge', weapon: state.weapon }];
}

function advancePlayerClocks(state: Encounter, dt: number): void {
  state.ultimateCooldown = Math.max(0, state.ultimateCooldown - dt);
  const previousBuff = state.berserkingRemaining;
  state.berserkingRemaining = Math.max(0, previousBuff - dt);
  if (previousBuff > 0 && state.berserkingRemaining === 0) applyActiveStats(state);
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
  const move = (x: number, z: number, elapsed = dt) => {
    if (movementWorld)
      movementWorld.move('player', player, x, z, elapsed);
    else {
      player.x += x;
      player.z += z;
    }
    [player.x, player.z] = constrain(state.layout.boundary, [player.x, player.z]);
  };
  if (state.dodgeRemaining > 0) {
    const elapsed = Math.min(dt, state.dodgeRemaining);
    move(state.dodgeDirection.x * elapsed * dodgeDistance / dodgeDuration, state.dodgeDirection.z * elapsed * dodgeDistance / dodgeDuration, elapsed);
    state.dodgeRemaining = Math.max(0, state.dodgeRemaining - dt);
    if (state.dodgeRemaining === 0) {
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
  const pending = state.pending;
  // A held shield cannot protect contacts that precede recovery in this frame.
  state.blockFrameOffset = state.blocking ? 0 : Math.min(dt, Math.max(state.player.lock, state.dodgeRemaining));
  const cooldown = () => pending?.kind === 'dodge' ? state.dodgeCooldown : Math.max(state.attackCooldown, pending?.kind === 'ability' ? cooldownForAbility(state, pending.ability) : 0);
  const availableAfter = pending ? Math.max(state.player.lock, state.dodgeRemaining, cooldown()) : 0;
  const manaAtUnlock = Math.min(state.stats.maxMana, state.playerMana + Math.min(dt, availableAfter) * state.stats.manaRegen);
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
  if (state.playerAction?.ability === 'berserking' && state.player.attackTime >= 0) {
    pending.remaining -= dt;
    if (pending.remaining < 0) state.pending = null;
    return prepared;
  }
  if (validAtUnlock && state.player.lock === 0 && state.dodgeRemaining === 0 && cooldown() === 0) {
    const previousImmunity = state.invulnerability;
    const alreadyBlocking = state.blocking;
    state.pending = null;
    if (pending.kind === 'swap')
      prepared.events.push(...swapWeaponSet(state, false));
    else if (pending.kind === 'ability')
      prepared.events.push(...useAbility(state, pending.ability, timing, false, pending.aim));
    else
      prepared.events.push(...(pending.kind === 'attack' ? attack(state, timing, false, pending.aim) : dodge(state, pending.direction, false, pending.aim)));
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
      if (pending.kind === 'ability' && pending.ability !== 'berserking') {
        const id = pending.ability;
        if (abilities[id].tier === 'ultimate') state.ultimateCooldown = Math.max(0, state.ultimateCooldown - prepared.attackElapsed);
        else state.abilityCooldowns[id] = Math.max(0, (state.abilityCooldowns[id] ?? 0) - prepared.attackElapsed);
        state.playerMana = Math.min(state.stats.maxMana, manaAtUnlock - abilities[id].mana + prepared.attackElapsed * state.stats.manaRegen);
      }
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
  if (player.attackTime < 0)
    return;
  const action = state.playerAction ?? { impactId: undefined, duration: timing.player.attack / state.stats.attackRate, contacts: timing.player.contacts.map(contact => contact / state.stats.attackRate), damage: state.stats.damage, rate: state.stats.attackRate, reach: state.stats.reach, arc: Math.acos(.1), weapon: state.weapon, ability: null };
  if (action.ability === 'berserking') { player.attackTime += dt; return; }
  const contacts = action.contacts;
  player.attackTime += dt;
  while (player.contactIndex < contacts.length && player.attackTime >= contacts[player.contactIndex]) {
    player.contactIndex++;
    events.push({ type: 'action', actor: 'player', action: 'contact', weapon: action.weapon });
    if (action.weapon === 'bow' || action.weapon === 'staff') {
      const dx = Math.sin(player.yaw), dz = Math.cos(player.yaw);
      const projectile = { id: ++state.nextProjectile, owner: 'player', kind: action.weapon === 'bow' ? 'arrow' as const : 'bolt' as const, x: player.x + dx * .35, y: player.y + 1.22, z: player.z + dz * .35, dx, dz, remaining: action.reach, damage: action.damage, impactId: action.impactId, ability: action.ability, pierced: action.ability === 'piercing-shot' ? [] : undefined, firstStep: Math.min(dt, player.attackTime - contacts[player.contactIndex - 1]) };
      if (projectileLaunchClear(projectile, player, events, movementWorld)) state.projectiles.push(projectile);
    }
    else {
      let nearest: string | undefined, nearestDistance = Infinity;
      for (const id of state.enemyIds) {
        const enemy = state.enemies[id];
        if (!enemy.home || enemy.hp <= 0)
          continue;
        const dx = enemy.x - player.x, dz = enemy.z - player.z, distance = Math.hypot(dx, dz);
        const facing = distance > 0 ? (Math.sin(player.yaw) * dx + Math.cos(player.yaw) * dz) / distance : 1;
        if (distance < action.reach && facing >= Math.cos(action.arc) - 1e-6 && (!movementWorld || movementWorld.lineOfSight(player, enemy)) && Math.abs(player.y - enemy.y) < .8)
          if (action.ability === 'crushing-blow') {
            if (distance < nearestDistance) { nearest = id; nearestDistance = distance; }
          } else hit(state, id, timing, events, action.weapon ?? undefined, undefined, frameOffset + Math.max(0, contacts[player.contactIndex - 1] - (player.attackTime - dt)), action.damage, action.impactId === undefined ? undefined : { actor: 'player', ability: action.ability, id: action.impactId });
      }
      if (nearest) hit(state, nearest, timing, events, action.weapon ?? undefined, undefined, frameOffset + Math.max(0, contacts[player.contactIndex - 1] - (player.attackTime - dt)), action.damage, { actor: 'player', ability: action.ability, id: action.impactId! });
    }
  }
  if (player.attackTime >= action.duration)
    player.attackTime = -1;
}

/** Commit only after this frame's enemy damage: death wins over cry completion. */
export function finishBattleCry(state: Encounter, dt: number, events: EncounterEvent[]): void {
  const action = state.playerAction;
  if (action?.ability !== 'berserking' || state.player.attackTime < action.duration) return;
  const remainder = Math.min(dt, Math.max(0, state.player.attackTime - action.duration));
  state.player.attackTime = -1;
  if (state.player.hp <= 0 || state.phase === 'lost') return;
  state.playerMana -= abilities.berserking.mana;
  state.ultimateCooldown = Math.max(0, abilities.berserking.cooldown - remainder);
  state.berserkingRemaining = Math.max(0, berserking.seconds - remainder);
  applyActiveStats(state);
  events.push({ type: 'action', actor: 'player', action: 'berserking', weapon: 'axe' });
}
