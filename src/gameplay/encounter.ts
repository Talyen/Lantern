import { baseStats, resolveCombatStats } from './combat-stats';
import { legacyLayout, type EncounterLayout } from './area';
import {
  playerMaxHealth, enemyMaxHealth, playerMaxMana, type ActorState, type EnemyId, type EnemyState,
  type EnemyKind, type Phase, type Encounter, type EncounterEvent, type ActorTiming, type Timings,
  type Input, type Movement,
} from './encounter-model';
import { preparePlayer, movePlayer, stepPlayerAttack } from './encounter-player';
import { stepProjectiles } from './encounter-projectiles';
import { stepEnemy, separateEnemies } from './encounter-enemies';
// Stable entry point for gameplay and presentation consumers.
export {
  playerMaxHealth, enemyMaxHealth, playerMaxMana, enemyAttackDamage, enemyNoticeRadius,
  enemyLeashRadius, dodgeDuration, dodgeDistance, dodgeInvulnerability, dodgeCooldown,
  casterAttackRange, casterBoltSpeed,
} from './encounter-model';
export type {
  EnemyId, ActorId, EnemyKind, Motion, Phase, ActorState, EnemyState, Projectile, PendingInput,
  PlayerAction, Encounter, ActorTiming, Timings, Movement, AimPoint, Input, EncounterEvent,
} from './encounter-model';
export { applyEquipment, attack, swapWeaponSet, useAbility, dodge } from './encounter-player';

// Prepared gameplay timings override these exploration defaults.
const explorationTiming: ActorTiming = { attack: .7, hit: .3, contacts: [.28] };
const enemyReadiness = new WeakMap<Encounter, {
  ids: EnemyId[];
  values: Record<EnemyId, number>;
}>();
const explorationTimings: Timings = { player: explorationTiming, enemy: explorationTiming, caster: explorationTiming };
export const inCombat = (state: Encounter): boolean => state.enemyIds.some(id => state.enemies[id].hp > 0 && (state.enemies[id].engaged || state.enemies[id].returning)) || state.projectiles.some(p => p.owner !== 'player');
export function createEncounter(phase: Phase = 'loading', layout: EncounterLayout = legacyLayout, enemyKind: EnemyKind = 'raider'): Encounter {
  const actor = (x: number, z: number, hp: number, speed: number): ActorState => ({ x, y: 0, z, yaw: 0, hp, speed, lock: 0, attackTime: -1, contactIndex: 0 });
  const player = actor(...layout.player.position, phase === 'loading' ? 0 : playerMaxHealth, baseStats.moveSpeed);
  player.yaw = layout.player.yaw;
  const definitions = layout.enemies ?? (['enemy', 'caster'] as const).map(id => ({
    id, kind: id === 'caster' ? 'caster' as const : enemyKind, rig: 'enemy' as const,
    loadout: { main: id === 'caster' || enemyKind === 'caster' ? 'staff' as const : 'axe' as const, off: null },
    ...layout[id],
  }));
  const enemyIds = definitions.map(enemy => enemy.id);
  const enemies = Object.fromEntries(definitions.map((definition, index): [EnemyId, EnemyState] => {
    const home = definition.position ? { position: definition.position, yaw: definition.yaw! } : undefined;
    const spawn = home ?? layout.player;
    return [definition.id, { ...actor(...spawn.position, home && phase !== 'loading' ? enemyMaxHealth : 0, 1.45),
        yaw: spawn.yaw, kind: definition.kind, rig: definition.rig, loadout: definition.loadout,
        home, engaged: false, returning: false, cooldown: .8 + (layout.enemies ? index * .18 : 0) }];
  }));
  const stats = resolveCombatStats([{ id: 'starter', item: 'axe', quantity: 1, slot: 'main', x: 0, y: 0 }]);
  return { stats, setStats: [stats, resolveCombatStats([])], weapon: 'axe', shield: false, blocking: false, pending: null, projectiles: [], nextProjectile: 0, phase, layout, player, enemyIds, enemies,
    attackCooldown: 0, invulnerability: 0, playerMana: playerMaxMana,
    weaponSets: [{ main: 'axe', off: null }, { main: null, off: null }], activeSet: 0, abilityCooldowns: {}, potionCooldown: 0, playerAction: null,
    dodgeRemaining: 0, dodgeCooldown: 0, dodgeFrameOffset: 0, invulnerabilityBeforeDodge: 0, dodgeDirection: { x: 0, z: 0 } };
}

export function resetEncounter(state: Encounter): EncounterEvent[] {
  const { weapon, shield, weaponSets, activeSet, stats, setStats } = state;
  Object.assign(state, createEncounter('playing', state.layout, state.enemies.enemy?.kind ?? 'raider'), { weapon, shield, weaponSets, activeSet, stats, setStats });
  state.player.hp = stats.maxHealth;
  state.playerMana = stats.maxMana;
  state.player.speed = stats.moveSpeed;
  return [{ type: 'label', value: 'MOVE TO BEGIN' }, { type: 'animation', actor: 'player', motion: 'idle' },
    ...state.enemyIds.map(actor => ({ type: 'animation' as const, actor, motion: 'idle' as const }))];
}

/** Contacts compare immunity against their offset before the frame consumes its clock. */
function finishPlayerFrame(state: Encounter, dt: number, events: EncounterEvent[]): EncounterEvent[] {
  state.invulnerability = Math.max(0, state.invulnerability - dt);
  state.dodgeFrameOffset = state.invulnerabilityBeforeDodge = 0;
  return events;
}

/** Safe and cleared areas retain attacks and projectile presentation without enemy AI. */
export function stepExploration(state: Encounter, dt: number, input: Input, movementWorld?: Movement, timing?: Timings): EncounterEvent[] {
  if (input.paused || state.player.hp <= 0 || !['playing', 'won'].includes(state.phase))
    return [];
  const clocks = timing ?? (state.layout.enemies ? Object.fromEntries(['player', ...state.enemyIds].map(id => [id, explorationTimings.player])) : explorationTimings);
  const { events, attackElapsed, attackOffset, movementElapsed } = preparePlayer(state, dt, input, clocks.player, movementWorld);
  stepPlayerAttack(state, attackElapsed, clocks, events, movementWorld, attackOffset);
  stepProjectiles(state, dt, clocks, events, movementWorld);
  events.push(...movePlayer(state, movementElapsed, input, movementWorld));
  return finishPlayerFrame(state, dt, events);
}

export function stepEncounter(state: Encounter, dt: number, input: Input, timing: Timings, movementWorld?: Movement): EncounterEvent[] {
  if (input.paused || state.phase !== 'playing')
    return [];
  const { events, attackElapsed, attackOffset, movementElapsed } = preparePlayer(state, dt, input, timing.player, movementWorld);
  // New windups consume only the part of the frame after recovery/cooldown.
  let readiness = enemyReadiness.get(state);
  if (!readiness || readiness.ids !== state.enemyIds) {
    readiness = { ids: state.enemyIds, values: {} };
    enemyReadiness.set(state, readiness);
  }
  for (const id of state.enemyIds) {
    const enemy = state.enemies[id];
    readiness.values[id] = Math.max(enemy.lock, enemy.cooldown);
    enemy.lock = Math.max(0, enemy.lock - dt);
    enemy.cooldown = Math.max(0, enemy.cooldown - dt);
  }
  stepPlayerAttack(state, attackElapsed, timing, events, movementWorld, attackOffset);
  stepProjectiles(state, dt, timing, events, movementWorld);
  if (state.phase !== 'playing')
    return finishPlayerFrame(state, dt, events);
  events.push(...movePlayer(state, movementElapsed, input, movementWorld));
  for (const id of state.enemyIds) {
    if (state.phase !== 'playing')
      break;
    if (state.enemies[id].home && state.enemies[id].hp > 0)
      stepEnemy(state, id, dt, timing, events, movementWorld, readiness.values[id]);
  }
  separateEnemies(state, dt, movementWorld);
  return finishPlayerFrame(state, dt, events);
}
