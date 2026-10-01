import { expect, test } from 'vitest';
import { attack, dodge, dodgeDistance, stepExploration, createEncounter, resetEncounter, stepEncounter, type Timings } from '../src/gameplay/encounter';
const timing: Timings = { player: { attack: 1, hit: 0.5, contacts: [0.42] }, enemy: { attack: 1, hit: 0.5, contacts: [0.42] } };
const idle = { x: 0, z: 0, paused: false };
function closeEncounter() {
  const state = createEncounter('playing');
  state.player.x = state.enemy.x = 0;
  state.player.z = 0; state.enemy.z = 1.4;
  return state;
}
test('nearby guards engage, strikes land at contact, and an interrupted enemy strike causes no damage', () => {
  const state = closeEncounter();
  stepEncounter(state, 0.01, { ...idle, x: 1 }, timing);
  expect(state.engaged).toBe(true);
  state.player.yaw = 0;
  state.enemy.attackTime = 0;
  attack(state, timing.player, false);
  stepEncounter(state, 0.41, idle, timing);
  expect(state.enemy.hp).toBe(100);
  const health = state.player.hp;
  const events = stepEncounter(state, 0.01, idle, timing);
  expect(state.enemy.hp).toBe(50);
  expect(events).toContainEqual({ type: 'hit', actor: 'enemy' });
  expect(state.player.hp).toBe(health);
  stepEncounter(state, 0.05, { ...idle, paused: true }, timing);
  expect(state.enemy.hp).toBe(50);
});
test('two connected strikes win, then retry restores an unengaged encounter', () => {
  const state = closeEncounter();
  const winningTiming = { ...timing, enemy: { ...timing.enemy, hit: 0.8 } };
  for (let strike = 0; strike < 2; strike++) {
    attack(state, timing.player, false);
    for (let frame = 0; frame < 22; frame++) stepEncounter(state, 0.05, idle, winningTiming);
  }
  expect(state.phase).toBe('won');
  expect(state.enemy.hp).toBe(0);
  resetEncounter(state);
  expect([state.phase, state.engaged, state.player.hp, state.enemy.hp]).toEqual(['playing', false, 100, 100]);
  expect(state.player.x).toBe(-2.3);
});
test('standing in reach loses after five enemy hits; terminal states stop updating', () => {
  const state = closeEncounter();
  attack(state, timing.player, false);
  // Face away so this opening strike engages without hurting the raider.
  state.player.yaw = Math.PI;
  for (let frame = 0; frame < 240 && state.phase === 'playing'; frame++) stepEncounter(state, 0.05, idle, timing);
  expect([state.phase, state.player.hp, state.enemy.hp]).toEqual(['lost', 0, 100]);
  const position = state.player.x;
  expect(stepEncounter(state, 1, { ...idle, x: 1 }, timing)).toEqual([]);
  expect(state.player.x).toBe(position);
});

test('authored spawns survive retry and movement respects a convex area boundary', () => {
  const layout: import('../src/gameplay/area').EncounterLayout = { boundary: { kind: 'polygon', points: [[-4,-4],[4,-4],[4,4],[-4,4]] }, player: { position: [3,0], yaw: 1 }, enemy: { position: [-3,-3], yaw: 2 } };
  const state = createEncounter('playing', layout);
  for (let i=0;i<30;i++) stepEncounter(state,.05,{...idle,x:1},timing);
  expect(state.player.x).toBe(4);
  resetEncounter(state);
  expect([state.player.x,state.player.z,state.player.yaw]).toEqual([3,0,1]);
});

test('authored collision blocks strikes, routes the raider around a wall, and grounds movement on steps and slopes', async () => {
  const { MovementWorld } = await import('../src/gameplay/movement');
  const boundary = { kind: 'polygon' as const, points: [[-6,-6],[6,-6],[6,6],[-6,6]] as [number, number][] };
  const world = await MovementWorld.create(boundary, { obstacles: [
    { id: 'wall', position: [0,.8,0], size: [.6,1.6,3], yaw: 0 },
    { id: 'step', position: [3,.1,3], size: [1.4,.2,1.4], yaw: 0 },
  ], surfaces: [{ positions: [-4,.01,-4,-2,.01,-4,-2,.6,-2,-4,.6,-2], indices: [0,2,1,0,3,2] }] });
  try {
    const state = createEncounter('playing', { boundary, player: { position: [-.7,0], yaw: Math.PI / 2 }, enemy: { position: [.7,0], yaw: -Math.PI / 2 } });
    attack(state, timing.player, false); state.enemy.attackTime = 0;
    stepEncounter(state,.43,idle,timing,world);
    expect([state.player.hp,state.enemy.hp]).toEqual([100,100]);
    resetEncounter(state); state.player.x=-2; state.enemy.x=2; state.engaged=true; state.enemyCooldown=999;
    for(let i=0;i<220;i++) stepEncounter(state,.05,idle,timing,world);
    expect(state.enemy.x).toBeLessThan(-.7);
    expect(Math.hypot(state.enemy.x-state.player.x,state.enemy.z-state.player.z)).toBeLessThan(1.6);
    state.player.x=-2;state.player.z=0;state.player.y=0;
    dodge(state, { x: 1, z: 0 }, false);
    for(let i=0;i<9;i++) stepExploration(state, .05, idle, world);
    expect(state.player.x).toBeGreaterThan(-2);
    expect(state.player.x).toBeLessThan(-.59);
    for(let i=0;i<20;i++) world.move('player',state.player,.06,.08,.05);
    expect(state.player.z).toBeGreaterThan(1.4);
    state.player.x=3;state.player.z=1.8;state.player.y=0;
    for(let i=0;i<18;i++) world.move('player',state.player,0,.06,.05);
    expect(state.player.y).toBeGreaterThan(.18);
    state.player.x=-3;state.player.z=-4.5;state.player.y=0;
    for(let i=0;i<38;i++) world.move('player',state.player,0,.06,.05);
    expect(state.player.y).toBeGreaterThan(.4);
    world.reset(); resetEncounter(state);
    expect(state.player.y).toBe(0);
  } finally { world.dispose(); }
});


test('dodge evades a contact, completes its distance, cools down and resets', () => {
  const state = closeEncounter(); state.engaged = true;
  state.enemy.attackTime = .35; state.enemyCooldown = 999;
  expect(dodge(state, { x: 0, z: 1 }, false)).toContainEqual({ type: 'animation', actor: 'player', motion: 'dodge' });
  expect(attack(state, timing.player, false)).toEqual([]);
  stepEncounter(state, .1, idle, timing);
  expect(state.player.hp).toBe(100);
  const start = state.player.z;
  for (let i = 0; i < 7; i++) stepEncounter(state, .05, idle, timing);
  expect(state.player.z - start).toBeCloseTo(dodgeDistance * .35 / .45);
  expect(dodge(state, { x: 1, z: 0 }, false)).toEqual([]);
  state.phase = 'won';
  for (let i = 0; i < 12; i++) stepExploration(state, .05, idle);
  expect(dodge(state, { x: 1, z: 0 }, false)).toHaveLength(1);
  resetEncounter(state);
  expect([state.dodgeRemaining, state.dodgeCooldown, state.invulnerability, state.playerMana]).toEqual([0, 0, 0, 100]);
  expect(dodge(state, { x: 1, z: 0 }, true)).toEqual([]);
});

test('the guard notices only nearby visible players, pursues, then returns and recovers', () => {
  const state = createEncounter('playing', { boundary: { kind: 'circle', center: [0,0], radius: 30 }, player: { position: [8,0], yaw: 0 }, enemy: { position: [0,0], yaw: 0 } });
  attack(state, timing.player, false); stepEncounter(state, .43, { ...idle, x: 1 }, timing);
  dodge(state, { x: 1, z: 0 }, false);
  expect(state.engaged).toBe(false);
  state.player.x = 5; state.player.attackTime = -1; state.player.lock = 0;
  const wall = { move: (_id: string, actor: { x: number; z: number }, x: number, z: number) => { actor.x += x; actor.z += z; }, direction: (a: { x: number; z: number }, b: { x: number; z: number }) => ({ x: b.x-a.x, z: b.z-a.z }), lineOfSight: () => false };
  stepEncounter(state, .05, idle, timing, wall); expect(state.engaged).toBe(false);
  stepEncounter(state, .05, idle, timing); expect(state.engaged).toBe(true);
  state.enemy.hp = 50; state.enemy.x = 4; state.player.x = 20;
  stepEncounter(state, .05, idle, timing); expect(state.returning).toBe(true); expect(state.engaged).toBe(false);
  for (let i = 0; i < 80; i++) stepEncounter(state, .05, idle, timing);
  expect([state.returning, state.enemy.hp, state.enemy.x, state.enemy.z]).toEqual([false, 100, 0, 0]);
});

test('pointer facing is independent of travel, preserves a committed swing, and resumes after locks', () => {
  const state = closeEncounter();
  const aim = { x: 0, z: 10 };
  stepExploration(state, .05, { ...idle, x: 1, aim });
  expect(state.player.x).toBeCloseTo(.16);
  expect(state.player.z).toBe(0);
  expect(state.player.yaw).toBeCloseTo(Math.atan2(-.16, 10));
  const nearbyAim = { x: state.player.x + .05, z: state.player.z };
  const facing = state.player.yaw;
  stepExploration(state, .01, { ...idle, aim: nearbyAim });
  expect(state.player.yaw).toBe(facing);
  stepExploration(state, .01, { ...idle, paused: true, aim: { x: -10, z: 0 } });
  expect(state.player.yaw).toBe(facing);

  state.player.x = 0;
  attack(state, timing.player, false, aim);
  const away = { ...idle, aim: { x: 0, z: -10 } };
  expect(attack(state, timing.player, false, away.aim)).toEqual([]);
  stepEncounter(state, .43, away, timing);
  expect(state.player.yaw).toBe(0);
  expect(state.enemy.hp).toBe(50);
  stepEncounter(state, .58, away, timing);
  expect(state.player.yaw).toBeCloseTo(Math.PI);
  state.player.lock = .2;
  stepExploration(state, .1, { ...idle, aim });
  expect(state.player.yaw).toBeCloseTo(Math.PI);
  stepExploration(state, .1, { ...idle, aim });
  expect(state.player.yaw).toBe(0);

  state.phase = 'won';
  stepExploration(state, .05, { ...idle, z: 1, aim: { x: -10, z: 0 } });
  expect(state.player.yaw).toBeCloseTo(Math.atan2(-10, -.16));
  stepExploration(state, .05, { ...idle, x: 1 });
  expect(state.player.yaw).toBe(Math.PI / 2);
});

test('WASD commits dodge travel and facing; a stationary dodge uses the latest pointer aim', () => {
  const state = createEncounter('playing', {
    boundary: { kind: 'circle', center: [0, 0], radius: 30 },
    player: { position: [0, 0], yaw: 0 }, enemy: { position: [20, 20], yaw: 0 },
  });
  const aim = { x: -10, z: 0 };
  dodge(state, { x: 1, z: 0 }, false, aim);
  for (let i = 0; i < 9; i++) stepExploration(state, .051, { ...idle, aim });
  expect(state.player.x).toBeCloseTo(dodgeDistance);
  expect(state.player.z).toBe(0);
  expect(state.player.yaw).toBe(Math.PI / 2);
  stepExploration(state, .05, { ...idle, aim });
  expect(state.player.yaw).toBe(-Math.PI / 2);

  resetEncounter(state);
  dodge(state, { x: 0, z: 0 }, false, aim);
  for (let i = 0; i < 9; i++) stepExploration(state, .051, { ...idle, aim: { x: 10, z: 0 } });
  expect(state.player.x).toBeCloseTo(-dodgeDistance);
  expect(state.player.z).toBeCloseTo(0);
  expect(state.player.yaw).toBe(-Math.PI / 2);
  stepExploration(state, .05, { ...idle, aim: { x: 10, z: 0 } });
  expect(state.player.yaw).toBeCloseTo(Math.PI / 2);
});
