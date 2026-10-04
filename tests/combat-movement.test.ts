import { expect, test } from 'vitest';
import { MovementWorld } from '../src/gameplay/movement';
import { createEncounter, applyEquipment, dodge, stepEncounter, stepExploration, useAbility, type ActorState, type Timings } from '../src/gameplay/encounter';
import { syncMovement } from '../src/gameplay/encounter-movement';

const boundary = { kind: 'polygon' as const, points: [[-8,-8],[8,-8],[8,8],[-8,8]] as [number, number][] };
const idle = { x: 0, z: 0, paused: false };
const timing: Timings = { player: { attack: .7, hit: .3, contacts: [.3], abilities: { thrust: { attack: .85, contacts: [.4] } } }, enemy: { attack: 1, hit: .5, contacts: [.5] } };
const actor = (x: number, z: number, y = 0): ActorState => ({ x, y, z, yaw: 0, hp: 200, speed: 1.45, lock: 0, attackTime: -1, contactIndex: 0 });

// These protect trapping, wall penetration and invalid damage in new core movement;
// existing combat fixtures do not exercise live body filters or lunge contact ordering.
test('walking blocks on living bodies, slides around them and releases dead/absent bodies', async () => {
  const world = await MovementWorld.create(boundary);
  try {
    const player = actor(0, 0), enemy = actor(1, 0);
    world.syncActors([{ id: 'player', state: player }, { id: 'enemy', state: enemy }]);
    world.move('player', player, 2, 0, .1);
    expect(player.x).toBeGreaterThan(.3); expect(player.x).toBeLessThan(.41);
    expect(enemy.x).toBe(1);
    world.move('player', player, .6, .8, .1);
    expect(player.z).toBeGreaterThan(.4);
    player.x = 0; player.z = 0; enemy.hp = 0;
    world.syncActors([{ id: 'player', state: player }, { id: 'enemy', state: enemy }]);
    world.move('player', player, 2, 0, .1); expect(player.x).toBeCloseTo(2, 3);
    player.x = 0; enemy.hp = 200;
    world.syncActors([{ id: 'player', state: player }]);
    world.move('player', player, 2, 0, .1); expect(player.x).toBeCloseTo(2, 3);
    enemy.y = 3; player.x = 0;
    world.syncActors([{ id: 'player', state: player }, { id: 'enemy', state: enemy }]);
    world.move('player', player, 2, 0, .1); expect(player.x).toBeCloseTo(2, 3);
  } finally { world.dispose(); }
});

test('restored overlapping actors can leave without pushing an attacking enemy', async () => {
  const world = await MovementWorld.create(boundary);
  try {
    const player = actor(0, 0), enemy = actor(.3, 0); enemy.attackTime = .2;
    world.syncActors([{ id: 'player', state: player }, { id: 'enemy', state: enemy }]);
    world.move('player', player, -.8, 0, .1);
    expect(player.x).toBeCloseTo(-.8, 3); expect(enemy.x).toBe(.3);
    player.x = enemy.x; player.z = enemy.z;
    world.syncActors([{ id: 'player', state: player }, { id: 'enemy', state: enemy }]);
    world.move('player', player, -.8, 0, .1);
    expect(player.x).toBeCloseTo(-.5, 3); expect(enemy.x).toBe(.3);
  } finally { world.dispose(); }
});

test('dodge crosses a body but shortens to a clear reserved landing without gaining distance', async () => {
  const world = await MovementWorld.create(boundary);
  try {
    const state = createEncounter('playing', { boundary, player: { position: [0,0], yaw: 0 }, enemy: { position: [0,2.4], yaw: 0 } });
    syncMovement(state, world); dodge(state, { x: 0, z: 1 }, false);
    stepExploration(state, .05, idle, world, timing);
    const walker = actor(0, 3.5);
    world.syncActors([{ id: 'player', state: state.player, dodging: true }, { id: 'enemy', state: state.enemies.enemy }, { id: 'walker', state: walker }]);
    world.move('walker', walker, 0, -2, .1);
    expect(walker.z).toBeGreaterThan(2.3);
    for (let i = 0; i < 9; i++) stepExploration(state, .05, idle, world, timing);
    expect(state.dodgeRemaining).toBe(0);
    expect(state.player.z).toBeGreaterThan(1.6); expect(state.player.z).toBeLessThan(1.8);
    expect(Math.hypot(state.player.x - state.enemies.enemy.x, state.player.z - state.enemies.enemy.z)).toBeGreaterThan(.6);
    expect(state.player.z).toBeLessThanOrEqual(2.4);
    state.enemies.enemy.z = 1; state.player.z = 0; state.dodgeCooldown = 0;
    syncMovement(state, world); dodge(state, { x: 0, z: 1 }, false);
    for (let i = 0; i < 10; i++) stepExploration(state, .05, idle, world, timing);
    expect(state.player.z).toBeCloseTo(2.4, 2);
    // Landing reservations must not survive a reset and block later walking.
    world.resetActors(); const next = actor(0, 3.5);
    world.syncActors([{ id: 'next', state: next }]);
    world.move('next', next, 0, -2, .1); expect(next.z).toBeCloseTo(1.5, 3);
  } finally { world.dispose(); }
});

function thrustState() {
  const state = createEncounter('playing', { boundary, player: { position: [0,0], yaw: 0 }, enemy: { position: [0,3], yaw: Math.PI } });
  applyEquipment(state, [{ id: 'sword', item: 'sword', quantity: 1, slot: 'main', weaponSet: 0, x: 0, y: 0 }], 0);
  state.proficiency.sword = 250; state.enemies.enemy.engaged = false;
  return state;
}

test('Thrust closes a gap before contact consistently across frame partitions and does not push its victim', async () => {
  const simulate = async (steps: number[], reverse = false) => {
    const world = await MovementWorld.create(boundary);
    try {
      const state = thrustState();
      if (reverse) { state.player.x = state.enemies.enemy.x = -.5; state.player.z = 3.1; state.enemies.enemy.z = 0; }
      const start = state.player.z; syncMovement(state, world);
      useAbility(state, 'thrust', timing.player, false, { x: state.enemies.enemy.x, z: state.enemies.enemy.z }, world);
      for (const dt of steps) stepExploration(state, dt, idle, world, timing);
      return { player: Math.abs(state.player.z - start), enemy: state.enemies.enemy.z, health: state.enemies.enemy.hp };
    } finally { world.dispose(); }
  };
  const coarse = await simulate([.4]), fine = await simulate([.1,.1,.1,.1]);
  expect(coarse.player).toBeGreaterThan(.5); expect(coarse.player).toBeLessThanOrEqual(.75);
  expect(coarse.health).toBe(135); expect(coarse.enemy).toBe(3);
  expect(fine.player).toBeCloseTo(coarse.player, 3); expect(fine.health).toBe(coarse.health);
  const smallFrames = await simulate(Array.from({ length: 30 }, () => 1 / 60), true);
  expect(smallFrames.player).toBeCloseTo(.72, 2); expect(smallFrames.health).toBe(135);
});


test('Thrust stays planted when a nearer in-cone enemy is already within reach', () => {
  const state = thrustState();
  state.enemies.near = { ...state.enemies.enemy, x: 0, z: 1.5 };
  state.enemyIds.push('near');
  useAbility(state, 'thrust', timing.player, false, { x: 0, z: 3 });
  stepExploration(state, .4, idle, undefined, { ...timing, near: timing.enemy });
  expect(state.player.z).toBe(0); expect(state.enemies.near.hp).toBe(135); expect(state.enemies.enemy.hp).toBe(200);
});

test('a newly obstructed Thrust stops at scenery without damage, and dodge cancels remaining lunge', async () => {
  const world = await MovementWorld.create(boundary, { obstacles: [{ id: 'wall', position: [0,.8,.9], size: [2,1.6,.1], yaw: 0 }] });
  try {
    const state = thrustState(); syncMovement(state, world);
    // Accept in clear space, then bring the snapshotted lunge beside a wall.
    state.player.x = state.enemies.enemy.x = 3; syncMovement(state, world);
    useAbility(state, 'thrust', timing.player, false, { x: 3, z: 3 }, world);
    state.player.x = state.enemies.enemy.x = 0; syncMovement(state, world);
    stepExploration(state, .4, idle, world, timing);
    expect(state.player.z).toBeLessThan(.55); expect(state.enemies.enemy.hp).toBe(200);
    state.player.x = state.enemies.enemy.x = 3; state.player.z = 0; state.attackCooldown = state.player.lock = 0;
    syncMovement(state, world); useAbility(state, 'thrust', timing.player, false, { x: 3, z: 3 }, world);
    stepExploration(state, .25, idle, world, timing);
    dodge(state, { x: -1, z: 0 }, false);
    const z = state.player.z; stepExploration(state, .2, idle, world, timing);
    expect(state.playerAction).toBeNull(); expect(state.player.z).toBeCloseTo(z, 3); expect(state.enemies.enemy.hp).toBe(200);
  } finally { world.dispose(); }
});

test('locked windups remain planted while an approaching pack finds separate attack positions', async () => {
  const world = await MovementWorld.create(boundary);
  try {
    const state = createEncounter('playing', { boundary, player: { position: [0,0], yaw: 0 }, enemies: Array.from({ length: 10 }, (_, i) => ({
      id: `enemy-${i}`, kind: 'raider', rig: 'skeleton', loadout: { main: 'axe', off: null }, position: [2 + (i % 5) * .7,3 + Math.floor(i / 5) * .7] as [number, number], yaw: 0,
    })) });
    const timings = Object.fromEntries(['player', ...state.enemyIds].map(id => [id, timing.player]));
    state.player.hp = 10000;
    for (const id of state.enemyIds) state.enemies[id].engaged = true;
    const planted = state.enemies['enemy-0']; planted.attackTime = .1; planted.lock = 1;
    stepEncounter(state, .05, idle, timings, world);
    expect(planted.x).toBeCloseTo(2, 6); expect(planted.z).toBeCloseTo(3, 6);
    // Bounded active time allows far-side approaches around the planted front
    // rank; this asserts eventual attack access, not a wall-clock performance target.
    for (let i = 0; i < 400 && state.enemyIds.some(id => Math.hypot(state.enemies[id].x, state.enemies[id].z) >= 1.7); i++)
      stepEncounter(state, .05, idle, timings, world);
    for (const id of state.enemyIds) expect(Math.hypot(state.enemies[id].x, state.enemies[id].z)).toBeLessThan(1.7);
    for (let i = 0; i < state.enemyIds.length; i++) for (let j = i + 1; j < state.enemyIds.length; j++) {
      const a = state.enemies[state.enemyIds[i]], b = state.enemies[state.enemyIds[j]];
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(.59);
    }
  } finally { world.dispose(); }
});

// A voxel navmesh height is not the actor's real standing height. A false
// firing goal behind low cover can otherwise leave a caster permanently idle.
test('ranged goals use real floor height when evaluating visibility over cover', async () => {
  const world = await MovementWorld.create(boundary, { obstacles: [{ id: 'cover', position: [0,.48,-2.5], size: [16,.96,.2], yaw: 0 }] });
  try {
    const player = actor(0, 0), caster = actor(0, -5.5);
    world.syncActors([{ id: 'player', state: player }, { id: 'caster', state: caster }]);
    const goal = world.approach('caster', caster, player, 'caster', .05);
    expect(goal === caster || world.lineOfSight({ ...goal, y: 0 }, player)).toBe(true);
  } finally { world.dispose(); }
});
