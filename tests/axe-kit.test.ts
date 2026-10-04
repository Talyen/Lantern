import { expect, test } from 'vitest';
import { Adventure } from '../src/gameplay/adventure';
import { hit } from '../src/gameplay/encounter-damage';
import { attack, createEncounter, resetEncounter, stepEncounter, stepExploration, swapWeaponSet, useAbility, type EncounterEvent, type Timings } from '../src/gameplay/encounter';
import type { AreaDefinition } from '../src/levels/types';
import clearing from '../src/levels/areas/clearing.json';
import homestead from '../src/levels/areas/homestead.json';

const idle = { x: 0, z: 0, paused: false };
const timing: Timings = {
  player: { attack: .68, hit: .3, contacts: [.28], abilities: {
    'crushing-blow': { attack: .95, contacts: [.38] }, berserking: { attack: .5, contacts: [] },
  } }, enemy: { attack: 1.05, hit: .35, contacts: [.46], commitLead: .16 },
  caster: { attack: 1.6, hit: .35, contacts: [.8] },
};
function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
function ready() {
  const state = createEncounter('playing'); state.proficiency.axeCombat = 1000;
  state.player.x = state.player.z = 0; state.player.yaw = 0;
  state.enemies.enemy.x = 0; state.enemies.enemy.z = 1.4; state.enemies.enemy.yaw = Math.PI;
  state.enemies.enemy.cooldown = 999;
  return state;
}
const xp = (events: EncounterEvent[]) => events.reduce((sum, event) => sum + (event.type === 'proficiency' && event.family === 'axe' ? event.amount : 0), 0);

test('healing and overkill cannot replenish an enemy life proficiency budget, including travel and death recovery', () => {
  const adventure = new Adventure(storage()), state = createEncounter('playing');
  adventure.enter(state, clearing as unknown as AreaDefinition);
  const events: EncounterEvent[] = [];
  hit(state, 'enemy', timing, events, 'axe', undefined, 0, 100);
  expect(xp(events)).toBe(200);
  state.enemies.enemy.hp = 200; // Repeated damage above the prior low-water health earns nothing.
  const repeated: EncounterEvent[] = [];
  hit(state, 'enemy', timing, repeated, 'axe', undefined, 0, 50);
  expect(xp(repeated)).toBe(0);
  adventure.enter(state, homestead as unknown as AreaDefinition, undefined, true);
  adventure.enter(state, clearing as unknown as AreaDefinition);
  const next: EncounterEvent[] = [];
  hit(state, 'enemy', timing, next, 'axe', undefined, 0, 1000);
  expect(xp(next)).toBe(200);
  state.enemies.enemy.hp = 200;
  const healed: EncounterEvent[] = [];
  hit(state, 'enemy', timing, healed, 'axe', undefined, 0, 50);
  expect(xp(healed)).toBe(0);
  adventure.closeSave();
});

test('Crushing Blow selects the nearest reachable target and interrupts a committed windup', () => {
  const state = ready();
  state.enemies.caster.home = { position: [0, 1.8], yaw: Math.PI };
  state.enemies.caster.hp = 200; state.enemies.caster.x = 0; state.enemies.caster.z = 1.8;
  state.enemies.caster.cooldown = 999;
  state.enemies.enemy.attackTime = .32;
  useAbility(state, 'crushing-blow', timing.player, false);
  stepEncounter(state, .38, idle, timing);
  expect(state.enemies.enemy.hp).toBe(100);
  expect(state.enemies.caster.hp).toBe(200);
  expect(state.enemies.enemy.attackTime).toBe(-1);
  expect(state.player.hp).toBe(100);
});

test('protected attacks permit Crushing Blow interruption only in a designated heavy window', () => {
  for (const window of ['protected', 'heavy-window'] as const) {
    const state = ready(); state.enemies.enemy.attackTime = .32; state.enemies.enemy.interruption = window;
    useAbility(state, 'crushing-blow', timing.player, false);
    stepEncounter(state, .38, idle, timing);
    expect(state.enemies.enemy.hp).toBe(100);
    expect(state.player.hp).toBe(window === 'protected' ? 80 : 100);
  }
});

test('authored attack protection ends after contact, and death cancels protected attacks', () => {
  const area = clearing as unknown as AreaDefinition;
  const layout = { ...area.layout, enemy: { ...area.layout.enemy!, interruption: 'protected' as const } };
  const state = createEncounter('playing', layout);
  let enemy = state.enemies.enemy;
  expect(enemy.interruption).toBe('protected');
  resetEncounter(state);
  expect(state.enemies.enemy.interruption).toBe('protected');
  enemy = state.enemies.enemy;
  for (const clock of [.1, .46]) {
    enemy.attackTime = clock; enemy.contactIndex = 0;
    hit(state, 'enemy', timing, [], 'axe', undefined, 0, 1);
    expect(enemy.attackTime).toBe(clock);
  }
  enemy.attackTime = .46; enemy.contactIndex = 1;
  const recovery: EncounterEvent[] = [];
  hit(state, 'enemy', timing, recovery, 'axe', undefined, 0, 1);
  expect(enemy.attackTime).toBe(-1);
  expect(recovery).toContainEqual({type:'animation',actor:'enemy',motion:'hit'});
  enemy.attackTime = .1; enemy.contactIndex = 0; enemy.hp = 1;
  hit(state, 'enemy', timing, [], 'axe', undefined, 0, 1, undefined, true);
  expect(enemy.hp).toBe(0); expect(enemy.attackTime).toBe(-1);
});

test('ordinary commitment checks the impact offset and caster recovery retains released bolts', () => {
  for (const [offset, interrupted] of [[.099, true], [.1, false], [.27, false]] as const) {
    const state = ready(); const enemy = state.enemies.enemy;
    enemy.attackTime = .2;
    hit(state, 'enemy', timing, [], 'axe', undefined, offset, 1);
    expect(enemy.attackTime < 0).toBe(interrupted);
  }
  const state = ready(); const caster = state.enemies.caster;
  caster.hp = 200; caster.attackTime = .8; caster.contactIndex = 1;
  state.projectiles.push({id:1,owner:'caster',kind:'bolt',x:0,y:0,z:0,dx:0,dz:1,remaining:10});
  hit(state, 'caster', timing, [], 'axe', undefined, 0, 1);
  expect(caster.attackTime).toBe(-1);
  expect(state.projectiles).toHaveLength(1);
});

test('Berserking commits once after the cry and never consumes mana or cooldown when death wins', () => {
  const state = ready();
  state.enemies.enemy.attackTime = .1;
  useAbility(state, 'berserking', timing.player, false);
  expect(state.playerMana).toBe(100);
  const events = stepEncounter(state, .5, idle, timing);
  expect(state.player.hp).toBe(80);
  expect(state.playerMana).toBe(50);
  expect(state.berserkingRemaining).toBe(8);
  expect(events.filter(event => event.type === 'action' && event.action === 'berserking')).toHaveLength(1);
  stepExploration(state, .1, idle, undefined, timing);
  expect(state.playerMana).toBeCloseTo(50.8);
  expect(state.ultimateCooldown).toBeCloseTo(59.9);
  const dead = ready(); dead.player.hp = 20; dead.enemies.enemy.attackTime = .1;
  useAbility(dead, 'berserking', timing.player, false);
  stepEncounter(dead, .5, idle, timing);
  expect(dead.player.hp).toBe(0);
  expect(dead.playerMana).toBe(100);
  expect(dead.berserkingRemaining).toBe(0);
  expect(dead.ultimateCooldown).toBe(0);
});

test('Berserking preserves equipment and accepted attacks while swaps, pause and travel retain its timer', () => {
  const adventure = new Adventure(storage()), state = ready();
  adventure.character.xp.axeCombat = 1000;
  adventure.character.items.push({ id: 'bow-test', item: 'bow', quantity: 1, slot: 'main', weaponSet: 1, x: 0, y: 0 });
  adventure.enter(state, clearing as unknown as AreaDefinition);
  const original = structuredClone(state.setStats);
  useAbility(state, 'berserking', timing.player, false);
  stepExploration(state, .5, idle, undefined, timing);
  expect(state.stats.damage).toBeCloseTo(original[0].damage * 1.4);
  expect(state.stats.attackRate).toBeCloseTo(original[0].attackRate * 1.3);
  expect(state.player.speed).toBeCloseTo(original[0].moveSpeed * 1.2);
  stepExploration(state, 2, { ...idle, paused: true }, undefined, timing);
  expect(state.berserkingRemaining).toBe(8);
  swapWeaponSet(state, false); adventure.setWeaponSet(1);
  expect(state.stats).toEqual(original[1]);
  stepExploration(state, 1, idle, undefined, timing);
  swapWeaponSet(state, false); adventure.setWeaponSet(0);
  expect(state.stats.damage).toBeCloseTo(original[0].damage * 1.4);
  adventure.enter(state, homestead as unknown as AreaDefinition);
  expect(state.berserkingRemaining).toBe(7);
  expect(state.ultimateCooldown).toBe(59);
  attack(state, timing.player, false);
  const snapshot = state.playerAction!.damage;
  stepExploration(state, 8, idle, undefined, timing);
  expect(snapshot).toBeCloseTo(original[0].damage * 1.4);
  expect(state.playerAction!.damage).toBe(snapshot);
  expect(state.stats).toEqual(original[0]);
  expect(state.setStats).toEqual(original);
  adventure.closeSave();
});

test('earning Berserking fills an empty slot without replacing occupied slots and loading preserves deliberate assignments', async () => {
  const memory = storage(), adventure = new Adventure(memory);
  await adventure.prepareSave();
  adventure.character.xp.axeCombat = 990;
  adventure.grantProficiency('axe',10);
  expect(adventure.character.actionBar[1]).toBe('berserking');
  const bar = [...adventure.character.actionBar]; bar[1] = null; adventure.setActionBar(bar);
  adventure.closeSave();
  const loaded = new Adventure(memory); await loaded.prepareSave();
  expect(loaded.character.xp.axeCombat).toBe(1000);
  expect(loaded.character.actionBar[1]).toBeNull();
  loaded.closeSave();
  const occupied = new Adventure(storage()); occupied.character.xp.axeCombat = 990;
  occupied.character.actionBar[2] = 'axe-basic'; occupied.grantProficiency('axe',10);
  expect(occupied.character.actionBar[2]).toBe('axe-basic');
  occupied.closeSave();
});
