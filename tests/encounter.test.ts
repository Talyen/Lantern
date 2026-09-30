import { expect, test } from 'vitest';
import { attack, createEncounter, resetEncounter, stepEncounter, type Timings } from '../src/encounter';
const timing: Timings = { player: { attack: 1, hit: 0.5, contacts: [0.42] }, enemy: { attack: 1, hit: 0.5, contacts: [0.42] } };
const idle = { x: 0, z: 0, paused: false };
function closeEncounter() {
  const state = createEncounter('playing');
  state.player.x = state.enemy.x = 0;
  state.player.z = 0; state.enemy.z = 1.4;
  return state;
}
test('movement engages, strikes land at contact, and an interrupted enemy strike causes no damage', () => {
  const state = closeEncounter();
  stepEncounter(state, 0.01, { ...idle, x: 1 }, timing);
  expect(state.engaged).toBe(true);
  state.player.yaw = 0;
  state.enemy.attackTime = 0;
  attack(state, timing.player, false);
  stepEncounter(state, 0.41, idle, timing);
  expect(state.enemy.hp).toBe(4);
  const health = state.player.hp;
  const events = stepEncounter(state, 0.01, idle, timing);
  expect(state.enemy.hp).toBe(3);
  expect(events).toContainEqual({ type: 'hit', actor: 'enemy' });
  expect(state.player.hp).toBe(health);
  stepEncounter(state, 0.05, { ...idle, paused: true }, timing);
  expect(state.enemy.hp).toBe(3);
});
test('four connected strikes win, then retry restores an unengaged encounter', () => {
  const state = closeEncounter();
  const winningTiming = { ...timing, enemy: { ...timing.enemy, hit: 0.8 } };
  for (let strike = 0; strike < 4; strike++) {
    attack(state, timing.player, false);
    for (let frame = 0; frame < 22; frame++) stepEncounter(state, 0.05, idle, winningTiming);
  }
  expect(state.phase).toBe('won');
  expect(state.enemy.hp).toBe(0);
  resetEncounter(state);
  expect([state.phase, state.engaged, state.player.hp, state.enemy.hp]).toEqual(['playing', false, 5, 4]);
  expect(state.player.x).toBe(-2.3);
});
test('standing in reach loses after five enemy hits; terminal states stop updating', () => {
  const state = closeEncounter();
  attack(state, timing.player, false);
  // Face away so this opening strike engages without hurting the raider.
  state.player.yaw = Math.PI;
  for (let frame = 0; frame < 240 && state.phase === 'playing'; frame++) stepEncounter(state, 0.05, idle, timing);
  expect([state.phase, state.player.hp, state.enemy.hp]).toEqual(['lost', 0, 4]);
  const position = state.player.x;
  expect(stepEncounter(state, 1, { ...idle, x: 1 }, timing)).toEqual([]);
  expect(state.player.x).toBe(position);
});
