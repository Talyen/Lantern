import { expect, test } from 'vitest';
import { Adventure, characterSaveKey } from '../src/gameplay/adventure';
import { createEncounter } from '../src/gameplay/encounter';
import homestead from '../src/levels/areas/homestead.json';
import clearing from '../src/levels/areas/clearing.json';
import type { AreaDefinition } from '../src/levels/types';
import { equipInstance, receive, removeQuantity, sortedItems, validItems, type InventoryItem } from '../src/gameplay/inventory';
const home = homestead as unknown as AreaDefinition, field = clearing as unknown as AreaDefinition;
const memory = () => { const data = new Map<string, string>(); return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } }; };

test('home recovery, campfire travel and defeat preserve the outing and collected scrolls', () => {
  const state = new Adventure(memory(), () => 0), encounter = createEncounter('playing');
  state.enter(encounter, home); expect(state.destinations({ homestead: home, clearing: field }).map(d => d.area.id)).toEqual([]);
  state.enter(encounter, field); encounter.player.hp = 2; encounter.enemies.enemy.hp = 1;
  state.enter(encounter, home); expect(encounter.player.hp).toBe(2);
  state.step(encounter, home, .05); expect(encounter.player.hp).toBeCloseTo(2.15);
  state.enter(encounter, field); expect(encounter.enemies.enemy.hp).toBe(1);
  encounter.enemies.enemy.hp = 0; encounter.phase = 'won'; state.step(encounter, field, .05);
  expect(state.session().drops).toHaveLength(1);
  state.enter(encounter, home); state.enter(encounter, field);
  expect([encounter.enemies.enemy.hp, encounter.phase, state.session().drops.length]).toEqual([0, 'playing', 1]);
  encounter.player.x = encounter.enemies.enemy.x; encounter.player.z = encounter.enemies.enemy.z;
  state.character.items.find(i => i.item === 'scroll')!.quantity = 4;
  state.step(encounter, field, .6); state.step(encounter, field, .05);
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
  restored.enter(encounter, field); expect(encounter.enemies.enemy.hp).toBe(100);
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
  encounter.enemies.enemy.x = fire.position[0] + 11; encounter.enemies.enemy.z = fire.position[1]; encounter.enemies.enemy.engaged = true;
  expect(state.fireSafe(field, fire, encounter)).toBe(false);
  encounter.enemies.enemy.engaged = false; encounter.enemies.enemy.returning = true;
  expect(state.fireSafe(field, fire, encounter)).toBe(false);
  encounter.enemies.enemy.returning = false;
  state.step(encounter, field, .5); expect(encounter.player.hp).toBe(51.5);
  encounter.enemies.enemy.hp = 0; state.step(encounter, field, 30); expect(encounter.player.hp).toBe(100);
  expect(state.canTravel(encounter, field, fire, home, homeFire)).toBe(true);
  state.enter(encounter, home, homeFire.arrival);
  expect(state.destinations({ clearing: field })[0].available).toBe(true);
  expect(state.canTravel(encounter, home, homeFire, field, fire)).toBe(true);
  state.session(field.id).encounter!.enemies.enemy.hp = 100;
  state.session(field.id).encounter!.enemies.enemy.returning = true;
  expect(state.destinations({ clearing: field })[0].available).toBe(false);
  expect(state.canTravel(encounter, home, homeFire, field, fire)).toBe(false);
});

test('the chest scatters rewards once per session and only collected gear is permanently claimed', () => {
  const storage = memory(), state = new Adventure(storage, () => 1), encounter = createEncounter('playing');
  const chest = field.chests![0]; state.enter(encounter, field, { position: chest.position, yaw: 0 });
  expect(state.openChest(encounter, field, chest)).toBe(false);
  encounter.enemies.enemy.hp = 0; encounter.phase = 'won';
  expect(state.openChest(encounter, field, chest)).toBe(true);
  expect(state.character.equipment).toEqual(['axe']); expect(state.character.scrolls).toBe(3);
  expect(state.session().drops).toHaveLength(5); expect(state.openChest(encounter, field, chest)).toBe(false);
  const sword = state.session().drops.find(d => d.item === 'sword')!; sword.age = .6;
  expect(state.pickup(sword.id, chest.position, true)).toBe(true);
  state.enter(encounter, home); state.enter(encounter, field);
  expect(state.session().drops).toHaveLength(4);
  const restored = new Adventure(storage); restored.enter(encounter, field, { position: chest.position, yaw: 0 }); encounter.enemies.enemy.hp = 0;
  restored.openChest(encounter, field, chest);
  expect(restored.session().drops.map(d => d.item)).toEqual(['scroll', 'shield', 'bow', 'staff']);
});

test('legacy characters migrate equipped copies, resources and claimed rewards without loss', () => {
  const storage = memory(); storage.setItem(characterSaveKey, JSON.stringify({ version: 2, scrolls: 7, campfires: ['clearing/camp'], equipment: ['axe', 'sword', 'shield', 'bow', 'staff'], loadout: { main: 'bow', off: null }, wood: 12000, xp: { woodcutting: 20, axeCombat: 30 }, campEquipmentClaimed: true }));
  const state = new Adventure(storage, () => 1), encounter = createEncounter('playing');
  expect([state.character.version, state.character.scrolls, state.character.loadout.main]).toEqual([3, 7, 'bow']);
  expect(state.character.equipment).toEqual(['bow', 'axe', 'sword', 'shield', 'staff']);
  expect(state.character.wood).toBe(12000); expect(state.character.items.some(i => i.slot === 'overflow')).toBe(true);
  expect(validItems(state.character.items)).toBe(true);
  const restored = new Adventure(storage); expect(restored.character).toEqual(state.character);
  restored.enter(encounter, field, { position: field.chests![0].position, yaw: 0 }); encounter.enemies.enemy.hp = 0; restored.openChest(encounter, field, field.chests![0]);
  expect(restored.session().drops.map(d => d.item)).toEqual(['scroll']);
  const overflow = restored.character.items.find(i => i.slot === 'overflow')!;
  const woodStack = restored.character.items.find(i => i.slot === 'bag' && i.item === 'wood')!;
  restored.replaceItems(removeQuantity(restored.character.items, woodStack.id, woodStack.quantity));
  restored.recoverItem(overflow.id); expect(restored.character.wood).toBe(12000 - woodStack.quantity);
});

test('partial collection preserves ground quantities and player-dropped supplies wait for departure', () => {
  const state = new Adventure(memory(), () => 1), encounter = createEncounter('playing'); state.enter(encounter, home);
  state.character.items = Array.from({ length: 96 }, (_, n): InventoryItem => ({ id: `full-${n}`, item: 'wood', quantity: n ? 99 : 97, slot: 'bag', x: n % 12, y: Math.floor(n / 12) }));
  const point: [number, number] = [encounter.player.x, encounter.player.z], drop = state.spawnDrop('wood', 5, point); drop.age = .6;
  expect(state.pickup(drop.id, point)).toBe(true); expect(drop.quantity).toBe(3);
  expect(state.pickup(drop.id, point, true)).toBe(false); expect(state.notice).toBe('Inventory full');
  state.dropItem('full-0', 20, point); const tossed = state.session().drops.at(-1)!;
  state.step(encounter, home, 1); expect(tossed.quantity).toBe(20);
  encounter.player.x += 3; state.step(encounter, home, .01); encounter.player.x -= 3; state.step(encounter, home, .01);
  expect(tossed.quantity).toBe(3); // Earlier excess fills three of the freed stack cells first.
});

test('a full bag rejects displacement atomically and packing retains every item', () => {
  const state = new Adventure();
  state.character.items = Array.from({ length: 96 }, (_, n): InventoryItem => ({ id: `full-${n}`, item: 'wood', quantity: 99, slot: 'bag', x: n % 12, y: Math.floor(n / 12) }));
  state.character.items.push({ id: 'axe', item: 'axe', quantity: 1, slot: 'main', x: 0, y: 0 }, { id: 'shield', item: 'shield', quantity: 1, slot: 'off', x: 0, y: 0 }, { id: 'bow', item: 'bow', quantity: 1, slot: 'overflow', x: 0, y: 0 });
  const before = structuredClone(state.character.items);
  expect(() => equipInstance(state.character.items, 'bow', 'main')).toThrow('Inventory full');
  expect(state.character.items).toEqual(before);
  state.character.items = state.character.items.filter(i => i.slot !== 'bag');
  receive(state.character.items, 'wood', 105, state.newId);
  state.replaceItems(equipInstance(state.character.items, 'bow', 'main'));
  expect(state.character.loadout).toEqual({ main: 'bow', off: null });
  expect(validItems(sortedItems(state.character.items))).toBe(true);
  expect(new Adventure({ getItem: () => JSON.stringify(state.character), setItem: () => {} }).character).toEqual(state.character);
});

test('the separate caster and camp guard retain independent defeat and reward state through travel', () => {
  const state=new Adventure(memory(),()=>0), encounter=createEncounter('playing');
  state.enter(encounter,field);
  expect(encounter.enemies.caster.kind).toBe('caster');
  encounter.enemies.caster.hp=50; encounter.enemies.caster.engaged=true;
  state.enter(encounter,home,undefined,true); state.enter(encounter,field);
  expect([encounter.enemies.caster.hp,encounter.enemies.enemy.hp]).toEqual([50,100]);
  const chest=field.chests![0]; encounter.player.x=chest.position[0]; encounter.player.z=chest.position[1];
  expect(state.openChest(encounter,field,chest)).toBe(false);
  encounter.enemies.caster.hp=0; state.step(encounter,field,.01);
  expect(state.openChest(encounter,field,chest)).toBe(false);
  encounter.enemies.enemy.hp=0; state.step(encounter,field,.01);
  expect(state.openChest(encounter,field,chest)).toBe(true);
  state.enter(encounter,home,undefined,true); state.enter(encounter,field);
  expect([encounter.enemies.caster.hp,encounter.enemies.enemy.hp,encounter.phase]).toEqual([0,0,'won']);
  expect(state.session(field.id).drops).toHaveLength(7);
});

test('landing and physical access gate pickups, and a casting scroll cannot be dropped', () => {
  const state = new Adventure(memory(), () => 1), encounter = createEncounter('playing'); state.enter(encounter, field);
  const point: [number, number] = [encounter.player.x, encounter.player.z], drop = state.spawnDrop('sword', 1, point);
  expect(state.pickup(drop.id, point, true)).toBe(false); drop.age = .55;
  state.canCollectGround = () => false; expect(state.pickup(drop.id, point, true)).toBe(false);
  state.canCollectGround = () => true; expect(state.pickup(drop.id, point, true)).toBe(true);
  const scroll = state.character.items.find(i => i.item === 'scroll')!; state.beginCast(true);
  expect(() => state.dropItem(scroll.id, scroll.quantity, point)).toThrow('Scroll is in use');
  state.step(encounter, field, 2); expect(state.portal).not.toBeNull(); expect(state.character.scrolls).toBe(2);
});

test('adventure sound facts describe successful changes once and do not replay across area restoration', () => {
  const adventure=new Adventure(memory(),()=>0), encounter=createEncounter('playing',field.layout);
  adventure.enter(encounter,field);
  const chest=field.chests![0]; encounter.enemies.enemy.hp=0;
  encounter.player.x=chest.position[0];encounter.player.z=chest.position[1];
  expect(adventure.openChest(encounter,field,chest)).toBe(true);
  const rewards=adventure.takeEvents();
  expect(rewards.filter(e=>e.type==='chestOpen')).toHaveLength(1);
  expect(rewards.filter(e=>e.type==='lootDrop')).toHaveLength(5);
  const sword=adventure.session().drops.find(drop=>drop.item==='sword')!;
  sword.age=.6; expect(adventure.pickup(sword.id,sword.position,true)).toBe(true);
  expect(adventure.takeEvents().filter(e=>e.type==='lootPickup')).toHaveLength(1);
  expect(adventure.pickup(sword.id,sword.position,true)).toBe(false);
  expect(adventure.takeEvents()).toEqual([]);
  expect(adventure.openChest(encounter,field,chest)).toBe(false);
  expect(adventure.takeEvents()).toEqual([]);
  expect(adventure.beginCast(true)).toBe(true); expect(adventure.beginCast(true)).toBe(false);
  expect(adventure.takeEvents()).toEqual([{type:'returnCast'}]);
  adventure.step(encounter,field,2);
  expect(adventure.takeEvents().filter(e=>e.type==='portalOpen')).toHaveLength(1);
  adventure.step(encounter,field,.05);
  expect(adventure.takeEvents().filter(e=>e.type==='portalOpen')).toHaveLength(0);
  adventure.enter(encounter,home);
  expect(adventure.takeEvents()).toEqual([]);
});
