import { expect, test } from 'vitest';
import { Adventure, characterSaveKey, scrollLimit } from '../src/gameplay/adventure';
import { createEncounter } from '../src/gameplay/encounter';
import homestead from '../src/levels/areas/homestead.json';
import clearing from '../src/levels/areas/clearing.json';
import type { AreaDefinition } from '../src/levels/types';
const home = homestead as unknown as AreaDefinition, field = clearing as unknown as AreaDefinition;
const memory = () => { const data = new Map<string, string>(); return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } }; };

test('home recovery, campfire travel and defeat preserve the outing and collected scrolls', () => {
  const state = new Adventure(memory(), () => 0), encounter = createEncounter('playing');
  state.enter(encounter, home); expect(state.destinations({ homestead: home, clearing: field }).map(d => d.area.id)).toEqual([]);
  state.enter(encounter, field); encounter.player.hp = 2; encounter.enemy.hp = 1;
  state.enter(encounter, home); expect(encounter.player.hp).toBe(2);
  state.step(encounter, home, .05); expect(encounter.player.hp).toBeCloseTo(2.15);
  state.enter(encounter, field); expect(encounter.enemy.hp).toBe(1);
  encounter.enemy.hp = 0; encounter.phase = 'won'; state.step(encounter, field, .05);
  expect(state.session().drops).toHaveLength(1);
  state.enter(encounter, home); state.enter(encounter, field);
  expect([encounter.enemy.hp, encounter.phase, state.session().drops.length]).toEqual([0, 'won', 1]);
  encounter.player.x = encounter.enemy.x; encounter.player.z = encounter.enemy.z;
  state.character.scrolls = scrollLimit; state.step(encounter, field, .05); expect(state.session().drops).toHaveLength(1);
  state.character.scrolls = 4; state.step(encounter, field, .05); state.step(encounter, field, .05);
  expect([state.character.scrolls, state.session().drops.length]).toEqual([5, 0]);
  state.enter(encounter, home); state.enter(encounter, field); state.step(encounter, field, .05);
  expect(state.character.scrolls).toBe(5);
  encounter.player.hp = 0; state.enter(encounter, home, home.layout.player, true);
  expect([encounter.player.hp, state.character.scrolls]).toEqual([100, 5]);
});

test('a moving, damaged caster creates one round-trip portal; death wins over completion', () => {
  const state = new Adventure(memory()), encounter = createEncounter('playing'); state.enter(encounter, field);
  expect(state.beginCast(true)).toBe(true); expect(state.beginCast(true)).toBe(false);
  state.step(encounter, field, 1); encounter.player.x = 2; encounter.player.z = 3; encounter.player.hp = 1;
  state.step(encounter, field, 1);
  expect(state.character.scrolls).toBe(2); expect(state.portal?.departure.position).toEqual([2, 3]);
  const link = state.portal!; state.enter(encounter, home, home.portalArrival); state.step(encounter, home, .05);
  expect(state.portal).toBe(link); expect(state.beginCast(true)).toBe(false);
  state.enter(encounter, field, link.departure); state.portal = null;
  expect([encounter.player.x, encounter.player.z, state.character.scrolls]).toEqual([2, 3, 2]);
  state.beginCast(true); state.step(encounter, field, 2); expect(state.character.scrolls).toBe(1);
  state.beginCast(true); encounter.player.hp = 0; state.step(encounter, field, 2);
  expect([state.castRemaining, state.character.scrolls, state.portal]).toEqual([0, 1, null]);
});

test('character saves retain scrolls/discoveries while session encounters and portals refresh', () => {
  const storage = memory(), state = new Adventure(storage), encounter = createEncounter('playing');
  const discovered = structuredClone(field); discovered.id = 'new-area';
  state.enter(encounter, discovered, discovered.campfires![0].arrival); state.step(encounter, discovered, .05);
  state.beginCast(true); state.step(encounter, discovered, 2);
  const restored = new Adventure(storage);
  expect(restored.character).toEqual(state.character); expect(restored.portal).toBeNull();
  expect(restored.destinations({ 'new-area': discovered }).map(d => d.area.id)).toEqual(['new-area']);
  restored.enter(encounter, field); expect(encounter.enemy.hp).toBe(100);
  storage.setItem(characterSaveKey, JSON.stringify({ version: 1, scrolls: 7, campfires: ['removed/fire'] }));
  expect(new Adventure(storage).destinations({ homestead: home, clearing: field })).toHaveLength(1);
  storage.setItem(characterSaveKey, '{broken'); expect(new Adventure(storage).saveError).toMatch(/Unable to load/);
  const failed = new Adventure({ getItem: () => null, setItem: () => { throw Error('full'); } }); failed.save(); expect(failed.saveError).toMatch(/Unable to save/);
});

test('campfires heal over time only when safe and unsafe destinations cannot be used', () => {
  const state = new Adventure(memory(), () => 1), encounter = createEncounter('playing');
  state.enter(encounter, field, field.campfires![0].arrival);
  const fire = field.campfires![0], homeFire = home.campfires![0]; encounter.player.hp = 50;
  state.step(encounter, field, 1); expect(encounter.player.hp).toBe(50);
  expect(state.canTravel(encounter, field, fire, home, homeFire)).toBe(false);
  encounter.enemy.x = fire.position[0] + 11; encounter.enemy.z = fire.position[1]; encounter.engaged = true;
  expect(state.fireSafe(field, fire, encounter)).toBe(false);
  encounter.engaged = false; encounter.returning = true;
  expect(state.fireSafe(field, fire, encounter)).toBe(false);
  encounter.returning = false;
  state.step(encounter, field, .5); expect(encounter.player.hp).toBe(51.5);
  encounter.enemy.hp = 0; state.step(encounter, field, 30); expect(encounter.player.hp).toBe(100);
  expect(state.canTravel(encounter, field, fire, home, homeFire)).toBe(true);
  state.enter(encounter, home, homeFire.arrival);
  expect(state.destinations({ clearing: field })[0].available).toBe(true);
  expect(state.canTravel(encounter, home, homeFire, field, fire)).toBe(true);
  state.session(field.id).encounter!.enemy.hp = 100;
  state.session(field.id).encounter!.returning = true;
  expect(state.destinations({ clearing: field })[0].available).toBe(false);
  expect(state.canTravel(encounter, home, homeFire, field, fire)).toBe(false);
});

test('the guarded chest retains overflow and grants its reward once per outing', () => {
  const storage = memory(), state = new Adventure(storage, () => 1), encounter = createEncounter('playing');
  const chest = field.chests![0]; state.enter(encounter, field, { position: chest.position, yaw: 0 });
  expect(state.openChest(encounter, field, chest)).toBe(false);
  encounter.enemy.hp = 0; encounter.phase = 'won'; state.character.scrolls = 99;
  expect(state.openChest(encounter, field, chest)).toBe(true);
  expect(state.chest(field, chest)).toEqual({ opened: true, remaining: 2 });
  state.enter(encounter, home); state.enter(encounter, field, { position: chest.position, yaw: 0 });
  state.character.scrolls = 98; state.openChest(encounter, field, chest);
  expect([state.character.scrolls, state.chest(field, chest).remaining]).toEqual([99, 1]);
  state.character.scrolls = 95; state.openChest(encounter, field, chest); state.openChest(encounter, field, chest);
  expect([state.character.scrolls, state.chest(field, chest).remaining]).toEqual([96, 0]);
  expect(new Adventure(storage).chest(field, chest)).toEqual({ opened: false, remaining: 2 });
});
