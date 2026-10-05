import { memory } from './helpers/storage';
import { isRecord, parseJson } from '../src/data/json';
import { expect, test, vi } from 'vitest';
import { skillIds, progression } from '../src/gameplay/skills';
import { characterBackupKey, decodeCharacter } from '../src/gameplay/character-save';
import { Adventure, characterSaveKey } from '../src/gameplay/adventure';
import { applyEquipment, createEncounter, enemyMaxHealth } from '../src/gameplay/encounter';
import homestead from '../src/levels/areas/homestead.json';
import clearing from '../src/levels/areas/clearing.json';
import type { AreaDefinition } from '../src/levels/types';
import { equipInstance, itemLoadout, moveItem, receive, removeQuantity, sortedItems, validItems, transferItem, type InventoryItem } from '../src/gameplay/inventory';
const home = homestead as unknown as AreaDefinition;
// Older reward fixtures isolate guaranteed equipment/scroll behavior from independent chance rewards.
const authoredField = clearing as unknown as AreaDefinition;
const field: AreaDefinition = { ...authoredField, layout: { ...authoredField.layout,
  enemy: { ...authoredField.layout.enemy!, gold: false, equipmentDrops: undefined }, caster: { ...authoredField.layout.caster!, gold: false, equipmentDrops: undefined } },
  chests: authoredField.chests?.map(chest => ({ ...chest, gold: false })) };


test('failed equipment preparation retains saved gear and releases the gate for a successful retry', async () => {
  const THREE = await import('three');
  const { makeActor } = await import('../src/session/actors');
  const { InventoryController } = await import('../src/session/inventory');
  const storage = memory(), adventure = new Adventure(storage), encounter = createEncounter('won');
  await adventure.prepareSave();
  const player = makeActor(new THREE.Scene(), encounter.player);
  player.mixer = new THREE.AnimationMixer(player.root);
  const prepare = vi.fn().mockRejectedValueOnce(new Error('Missing weapon art')).mockResolvedValue(undefined);
  const inventory = new InventoryController(adventure, encounter, player, { prepare, activate: () => {} }, { play: () => {} }, {
    clearInput: () => {}, equipmentBlocked: () => false,
    updateCharacter: () => {}, syncAdventure: () => {},
  });
  const original = structuredClone(adventure.character.items), saved = storage.data.get(characterSaveKey);
  const axe = original.find(item => item.slot === 'main')!;
  const next = moveItem(original, axe.id, 2, 0, 1, adventure.newId);

  await expect(inventory.change(next)).rejects.toThrow('Missing weapon art');
  expect(adventure.character.items).toEqual(original);
  expect(storage.data.get(characterSaveKey)).toBe(saved);
  expect(inventory.loading).toBe(false);

  await inventory.change(next);
  expect(itemLoadout(adventure.character.items).main).toBeNull();
  expect(encounter.weapon).toBeNull();
  expect(decodeCharacter(storage.data.get(characterSaveKey)!)?.items).toEqual(next);
  await inventory.change(moveItem(next, axe.id, 4, 0, 1, adventure.newId));
  expect(prepare).toHaveBeenCalledTimes(2);
  adventure.closeSave();
});

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
  state.step(encounter, field, 1); encounter.player.x = 2; encounter.player.z = 3; encounter.player.y = 1.2; encounter.player.hp = 1;
  state.step(encounter, field, 1);
  expect(state.character.scrolls).toBe(2); expect(state.portal?.departure.position).toEqual([2, 3]);
  const link = state.portal!; state.enter(encounter, home, home.portalArrival); state.step(encounter, home, .05);
  expect(state.portal).toBe(link); expect(state.beginCast(true)).toBe(false);
  state.enter(encounter, field, link.departure); state.portal = null;
  expect([encounter.player.x, encounter.player.y, encounter.player.z, state.character.scrolls]).toEqual([2, 1.2, 3, 2]);
  state.beginCast(true); state.step(encounter, field, 2); expect(state.character.scrolls).toBe(1);
  state.beginCast(true); encounter.player.hp = 0; state.step(encounter, field, 2);
  expect([state.castRemaining, state.character.scrolls, state.portal]).toEqual([0, 1, null]);
});

test('campfire interaction and healing require a safe source but destination enemies do not block travel', () => {
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
  state.takeEvents();
  state.step(encounter, field, .5); expect(encounter.player.hp).toBe(51.5);
  expect(state.takeEvents()).toContainEqual(expect.objectContaining({type:'healthRecovered',source:'campfire',amount:1.5,elapsed:.5,finished:false}));
  encounter.enemies.enemy.hp = 0; state.step(encounter, field, 30); expect(encounter.player.hp).toBe(100);
  expect(state.takeEvents()).toContainEqual(expect.objectContaining({type:'healthRecovered',source:'campfire',amount:48.5,finished:true}));
  encounter.player.hp = 99; state.step(encounter, field, .1); state.takeEvents();
  encounter.player.x += 10; state.step(encounter, field, .1);
  expect(state.takeEvents()).toContainEqual(expect.objectContaining({type:'healthRecovered',source:'campfire',amount:0,finished:true}));
  encounter.player.x -= 10;
  expect(state.canTravel(encounter, field, fire, home, homeFire)).toBe(true);
  state.enter(encounter, home, homeFire.arrival);
  expect(state.destinations({ clearing: field }).map(destination => destination.area.id)).toEqual(['clearing']);
  expect(state.canTravel(encounter, home, homeFire, field, fire)).toBe(true);
  state.session(field.id).encounter!.enemies.enemy.hp = 100;
  state.session(field.id).encounter!.enemies.enemy.returning = true;
  expect(state.destinations({ clearing: field }).map(destination => destination.area.id)).toEqual(['clearing']);
  expect(state.canTravel(encounter, home, homeFire, field, fire)).toBe(true);
});

test('the chest scatters rewards once per session and only collected gear is permanently claimed', () => {
  const storage = memory(), state = new Adventure(storage, () => 1), encounter = createEncounter('playing');
  const chest = field.chests![0]; state.enter(encounter, field, { position: chest.position, yaw: 0 });
  expect(state.openChest(encounter, field, chest)).toBe(true);
  encounter.enemies.enemy.hp = 0; encounter.phase = 'won';
  expect(state.openChest(encounter, field, chest)).toBe(false);
  expect(state.character.equipment).toEqual(['axe']); expect(state.character.scrolls).toBe(3);
  expect(state.session().drops).toHaveLength(7); expect(state.openChest(encounter, field, chest)).toBe(false);
  const sword = state.session().drops.find(d => d.item === 'sword')!; sword.age = .6;
  expect(state.pickup(sword.id, chest.position, true)).toBe(true);
  state.enter(encounter, home); state.enter(encounter, field);
  expect(state.session().drops).toHaveLength(6);
  const restored = new Adventure(storage); restored.enter(encounter, field, { position: chest.position, yaw: 0 }); encounter.enemies.enemy.hp = 0;
  restored.openChest(encounter, field, chest);
  expect(restored.session().drops.map(d => d.item)).toEqual(['scroll', 'potion', 'shield','guard-helm','weathered-mail','duelist-gloves']);
});

test('legacy characters migrate equipped copies, resources and claimed rewards without loss', () => {
  const storage = memory(); storage.setItem(characterSaveKey, JSON.stringify({ version: 2, scrolls: 7, campfires: ['clearing/camp'], equipment: ['axe', 'sword', 'shield', 'bow', 'staff'], loadout: { main: 'bow', off: null }, wood: 12000, xp: { woodcutting: 20, axeCombat: 30 }, campEquipmentClaimed: true }));
  const state = new Adventure(storage, () => 1), encounter = createEncounter('playing');
  expect([state.character.version, state.character.scrolls, state.character.loadout.main]).toEqual([10, 7, 'bow']);
  expect(state.character.equipment).toEqual(['bow', 'axe', 'sword', 'shield', 'staff']);
  expect(state.character.wood).toBe(12000); expect(state.character.items.some(i => i.slot === 'overflow')).toBe(true);
  expect(validItems(state.character.items)).toBe(true);
  const restored = new Adventure(storage); expect(restored.character).toEqual(state.character);
  restored.enter(encounter, field, { position: field.chests![0].position, yaw: 0 }); encounter.enemies.enemy.hp = 0; restored.openChest(encounter, field, field.chests![0]);
  expect(restored.session().drops.map(d => d.item)).toEqual(['scroll','potion','guard-helm','weathered-mail','duelist-gloves']);
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
  const tight: InventoryItem[] = [
    { id: 'sword', item: 'sword', quantity: 1, slot: 'main', x: 0, y: 0 },
    { id: 'shield', item: 'shield', quantity: 1, slot: 'off', x: 0, y: 0 },
    { id: 'bow', item: 'bow', quantity: 1, slot: 'bag', x: 0, y: 0 },
  ];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 12; x++)
    if (!(x < 2 && y < 4) && !(x === 3 && y < 3))
      tight.push({ id: `wood-${x}-${y}`, item: 'wood', quantity: 99, slot: 'bag', x, y });
  const switched = equipInstance(tight, 'bow', 'main');
  expect(validItems(switched)).toBe(true);
  expect(itemLoadout(switched)).toEqual({ main: 'bow', off: null });
  expect(switched).toHaveLength(tight.length);
  expect(tight.find(item => item.id === 'sword')?.slot).toBe('main');
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

test('inventory validation rejects malformed entries and conflicting placement', () => {
  const item: InventoryItem = { id: 'wood', item: 'wood', quantity: 1, slot: 'bag', x: 0, y: 0 };
  expect(validItems([item])).toBe(true);
  for (const invalid of [null, 'wood', { ...item, item: 'unknown' }, { ...item, quantity: 0 }, { ...item, x: .5 }]) {
    expect(validItems([invalid])).toBe(false);
  }
  expect(validItems(new Array(1))).toBe(false);
  expect(validItems([item, { ...item, x: 1 }])).toBe(false);
  expect(validItems([item, { ...item, id: 'overlap' }])).toBe(false);
  const weapon: InventoryItem = { id: 'axe', item: 'axe', quantity: 1, slot: 'main', x: 0, y: 0 };
  expect(validItems([weapon, { ...weapon, id: 'other' }])).toBe(false);
  expect(validItems([weapon, { ...weapon, id: 'other', weaponSet: 1 }])).toBe(true);
  expect(validItems([{ ...weapon, item: 'shield', slot: 'off' }])).toBe(false);
});

test('the separate caster and camp guard retain independent defeat and reward state through travel', () => {
  const state=new Adventure(memory(),()=>0), encounter=createEncounter('playing');
  state.enter(encounter,field);
  expect(encounter.enemies.caster.kind).toBe('caster');
  encounter.enemies.caster.hp=50; encounter.enemies.caster.engaged=true;
  state.enter(encounter,home,undefined,true); state.enter(encounter,field);
  expect([encounter.enemies.caster.hp,encounter.enemies.enemy.hp]).toEqual([50,200]);
  const chest=field.chests![0]; encounter.player.x=chest.position[0]; encounter.player.z=chest.position[1];
  expect(state.openChest(encounter,field,chest)).toBe(true);
  encounter.enemies.caster.hp=0; state.step(encounter,field,.01);
  expect(state.openChest(encounter,field,chest)).toBe(false);
  encounter.enemies.enemy.hp=0; state.step(encounter,field,.01);
  expect(state.openChest(encounter,field,chest)).toBe(false);
  state.enter(encounter,home,undefined,true); state.enter(encounter,field);
  expect([encounter.enemies.caster.hp,encounter.enemies.enemy.hp,encounter.phase]).toEqual([0,0,'won']);
  expect(state.session(field.id).drops).toHaveLength(12);
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
  expect(rewards.filter(e=>e.type==='lootDrop')).toHaveLength(7);
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

test('harvest XP is collected once, including partial stacks; transfers and re-drops cannot award it', () => {
  const state=new Adventure(memory()); const encounter=createEncounter('playing',field.layout);state.enter(encounter,field);
  state.character.items=[{id:'wood-stack',item:'wood',quantity:98,slot:'bag',x:0,y:0}];
  for(let y=0;y<8;y++)for(let x=0;x<12;x++)if(x || y)state.character.items.push({id:`filled-${x}-${y}`,item:'scroll',quantity:99,slot:'bag',x,y});
  state.character.restedSeconds=100;
  state.grantHarvest('wood',3,'woodcutting',progression.gatheringXp,[0,0]);const drop=state.session().drops[0];drop.age=.6;
  expect(state.character.xp.woodcutting).toBe(0);expect(state.pickup(drop.id,[0,0])).toBe(true);
  expect([drop.quantity,state.character.xp.woodcutting]).toEqual([2,88]);
  state.character.items=state.character.items.filter(i=>i.id!=='filled-1-0');expect(state.pickup(drop.id,[0,0])).toBe(true);expect(state.character.xp.woodcutting).toBe(264);
  state.dropItem('wood-stack',1,[0,0]);const tossed=state.session().drops[0];tossed.age=.6;
  state.pickup(tossed.id,tossed.position,true);expect(state.character.xp.woodcutting).toBe(264);
});

// Admission: shared XP rejection must not consume harvested loot or corrupt a saved character;
// existing pickup tests exercise capacity, but not an XP failure between preparation and publication.
test('invalid or overflowing XP retains character progress and harvested loot', () => {
  const state=new Adventure(memory()),encounter=createEncounter('playing',field.layout);state.enter(encounter,field);
  const before=JSON.stringify(state.character);
  for(const amount of [NaN,Infinity,-1])expect(()=>state.awardXp('mining',amount)).toThrow();
  expect(()=>state.awardXp('healing',10)).toThrow('This skill does not earn XP yet.');
  expect(JSON.stringify(state.character)).toBe(before);
  state.character.xp.woodcutting=Number.MAX_SAFE_INTEGER-1;
  state.grantHarvest('wood',3,'woodcutting',progression.gatheringXp,[0,0]);
  const drop=state.session().drops[0];drop.age=.6;
  const full=JSON.stringify(state.character);
  expect(state.pickup(drop.id,[0,0],true)).toBe(false);
  expect(drop.quantity).toBe(3);expect(JSON.stringify(state.character)).toBe(full);
  expect(decodeCharacter(full).xp).toEqual(state.character.xp);
  state.closeSave();
});

test('shelter repair consumes its exact recipe once and stash transfers retain overflow without changing equipment',()=>{
  const storage=memory(),state=new Adventure(storage),encounter=createEncounter('playing',home.layout);state.enter(encounter,home);
  for(const [item,quantity,x] of [['wood',15,2],['stone',8,3],['iron',4,4]] as const)state.character.items.push({id:item,item,quantity,slot:'bag',x,y:0});
  expect(state.canRepair()).toBe(true);state.repairShelter();expect(state.character.items.filter(i=>['wood','stone','iron'].includes(i.item)).map(i=>i.quantity)).toEqual([3,2,1]);
  expect(()=>state.repairShelter()).toThrow();state.transferStash('wood',3,true);
  expect(state.character.stash[0].quantity).toBe(3);expect(state.character.loadout.main).toBe('axe');
  state.transferStash(state.character.stash[0].id,3,false);expect(state.character.stash).toHaveLength(0);
  const restored=new Adventure(storage);expect(restored.character).toEqual(state.character);expect(restored.character.restedSeconds).toBe(1800);
});

test('Rested uses active time, refreshes on shelter entry, saves fractional XP and survives restart',()=>{
  const storage=memory(),state=new Adventure(storage),encounter=createEncounter('playing',home.layout);state.enter(encounter,home);
  state.character.shelterRestored=true;state.character.restedSeconds=120;
  encounter.player.x=10;encounter.player.z=0;state.step(encounter,home,5);
  expect(state.character.restedSeconds).toBe(115);state.awardXp('mining',.5);state.save();
  const restored=new Adventure(storage);expect(restored.character.restedSeconds).toBe(115);expect(restored.character.xp.mining).toBeCloseTo(.55);
  const withShelter={...home,shelter:{position:[0,0] as [number,number],yaw:0,stash:[0,0] as [number,number]}};
  encounter.player.x=0;state.step(encounter,withShelter,1);expect(state.character.restedSeconds).toBe(1800);
  state.step(encounter,withShelter,1);expect(state.character.restedSeconds).toBe(1799);
  state.grantWeaponXp('axe',10);expect(state.character.xp.axeCombat).toBe(11);
});

test('stash stack transfers retain partial quantities and rejected equipped transfers change neither container',()=>{
  const source:InventoryItem[]=[{id:'s',item:'iron',quantity:3,slot:'bag',x:0,y:0}],destination:InventoryItem[]=[{id:'d',item:'iron',quantity:98,slot:'bag',x:0,y:0}];
  const result=transferItem(source,destination,'s',3,()=> 'split',{x:0,y:0});
  expect(result.source[0].quantity).toBe(2);expect(result.destination[0].quantity).toBe(99);expect(source[0].quantity).toBe(3);expect(destination[0].quantity).toBe(98);
  const equipped:InventoryItem[]=[{id:'axe',item:'axe',quantity:1,slot:'main',x:0,y:0}];expect(()=>transferItem(equipped,destination,'axe',1,()=> 'next')).toThrow('bag first');expect(equipped[0].slot).toBe('main');
});

test('two equipped sets retain individual copies and returning a main hand only displaces its own shield', () => {
  const state=new Adventure(),items=state.character.items;
  receive(items,'sword',1,state.newId);receive(items,'shield',1,state.newId);receive(items,'bow',1,state.newId);
  let next=equipInstance(items,items.find(i=>i.item==='sword')!.id,'main',0);
  next=equipInstance(next,next.find(i=>i.item==='shield')!.id,'off',0);
  next=equipInstance(next,next.find(i=>i.item==='bow')!.id,'main',1);
  expect([itemLoadout(next,0),itemLoadout(next,1)]).toEqual([{main:'sword',off:'shield'},{main:'bow',off:null}]);
  expect(validItems(next)).toBe(true);expect(new Set(next.map(i=>i.id)).size).toBe(next.length);
  next=removeQuantity(next,next.find(i=>i.item==='bow')!.id,1);
  expect(itemLoadout(next,0).off).toBe('shield');expect(validItems(next)).toBe(true);
});

test('revision 3 migration preserves a full bag and grants starter potions only once', () => {
  const storage=memory(),items:InventoryItem[]=Array.from({length:96},(_,i)=>({id:`full-${i}`,item:'wood',quantity:99,slot:'bag',x:i%12,y:Math.floor(i/12)}));
  items.push({id:'item-20',item:'axe',quantity:1,slot:'main',x:0,y:0});
  storage.setItem(characterSaveKey,JSON.stringify({version:3,items,campfires:['homestead/camp'],xp:{woodcutting:30,axeCombat:40},campClaims:['sword']}));
  const migrated=new Adventure(storage);expect(migrated.character.version).toBe(10);expect(migrated.character.items.filter(i=>i.item!=='potion')).toEqual(items);
  expect(migrated.character.items.find(i=>i.item==='potion')).toMatchObject({slot:'overflow',quantity:3});
  expect(migrated.character).toMatchObject({campClaims:['sword'],campfires:['homestead/camp'],xp:{woodcutting:30,axeCombat:40,mining:0},stash:[],shelterRestored:false});
  migrated.character.xp.bow=5000;
  migrated.setActionBar(['sweep','piercing-shot',null,null,'axe-basic','shield-basic']);migrated.setWeaponSet(1);
  const restored=new Adventure(storage);expect(restored.character).toEqual(migrated.character);expect(restored.character.items.filter(i=>i.item==='potion')).toHaveLength(1);
});

test('potions heal during an action, never consume at full health, and keep their cooldown across travel', () => {
  const adventure=new Adventure(),encounter=createEncounter('playing');adventure.enter(encounter,field);
  expect(adventure.usePotion(encounter)).toBe(false);expect(adventure.character.potions).toBe(3);
  encounter.player.hp=20;encounter.player.lock=.5;encounter.player.attackTime=.1;
  expect(adventure.usePotion(encounter)).toBe(true);expect([encounter.player.hp,encounter.player.lock,encounter.player.attackTime,adventure.character.potions]).toEqual([60,.5,.1,2]);
  expect(adventure.usePotion(encounter)).toBe(false);encounter.playerMana=37;encounter.abilityCooldowns.sweep=3;adventure.character.items=[...adventure.character.items.filter(item=>item.slot!=='main'),{id:'sword-equipped',item:'sword',quantity:1,slot:'main',x:0,y:0},{id:'shield-equipped',item:'shield',quantity:1,slot:'off',x:0,y:0}];applyEquipment(encounter,adventure.character.items,0);
  adventure.enter(encounter,home);expect([encounter.potionCooldown,encounter.playerMana,encounter.abilityCooldowns.sweep,encounter.weapon,encounter.shield]).toEqual([8,37,3,'sword',true]);
  encounter.player.hp=0;expect(adventure.usePotion(encounter)).toBe(false);expect(adventure.character.potions).toBe(2);
  adventure.takeEvents(); encounter.player.hp = 88; encounter.potionCooldown = 0;
  expect(adventure.usePotion(encounter)).toBe(true);
  expect(adventure.takeEvents()).toContainEqual(expect.objectContaining({type:'healthRecovered',source:'potion',amount:12,finished:true}));
  expect(adventure.usePotion(encounter)).toBe(false);
  expect(adventure.takeEvents()).toEqual([]);
});

test('inventory consumable actions use the requested stack without consuming its neighbours', () => {
  const adventure = new Adventure(), encounter = createEncounter('playing'); adventure.enter(encounter, field);
  adventure.character.items.push({ id: 'second-potion', item: 'potion', quantity: 2, slot: 'bag', x: 3, y: 0 },
    { id: 'second-scroll', item: 'scroll', quantity: 2, slot: 'bag', x: 4, y: 0 });
  encounter.player.hp = 20;
  expect(adventure.usePotion(encounter, 'second-potion')).toBe(true);
  expect(adventure.character.items.find(i => i.id === 'item-3')?.quantity).toBe(3);
  expect(adventure.character.items.find(i => i.id === 'second-potion')?.quantity).toBe(1);
  expect(adventure.beginCast(true, 'second-scroll')).toBe(true); adventure.step(encounter, field, 2);
  expect(adventure.character.items.find(i => i.id === 'item-2')?.quantity).toBe(3);
  expect(adventure.character.items.find(i => i.id === 'second-scroll')?.quantity).toBe(1);
});

test('equipment swaps return displaced gear to vacated cells and retain both items when it cannot fit', () => {
  const items: InventoryItem[] = [
    { id: 'old', item: 'axe', quantity: 1, slot: 'main', x: 0, y: 0 },
    { id: 'new', item: 'sword', quantity: 1, slot: 'bag', x: 7, y: 4 },
  ];
  const next = equipInstance(items, 'new', 'main');
  expect(next.find(i => i.id === 'old')).toMatchObject({ slot: 'bag', x: 7, y: 4 });
  expect(validItems(next)).toBe(true);
  const full = [...items, ...Array.from({ length: 96 }, (_, i) => ({ id: `filler-${i}`, item: 'wood' as const, quantity: 1, slot: 'bag' as const, x: i % 12, y: Math.floor(i / 12) }))
    .filter(i => i.x !== 7 || i.y < 4 || i.y > 6)];
  const before = structuredClone(full);
  expect(() => equipInstance(full, 'new', 'main')).toThrow('Inventory full.');
  expect(full).toEqual(before);
});

test('revision 4 Homestead progress migrates with combat controls and starter potions without changing stash identities',()=>{
  const storage=memory();
  const items:InventoryItem[]=[{id:'item-42',item:'sword',quantity:1,slot:'main',x:0,y:0},{id:'item-43',item:'scroll',quantity:5,slot:'bag',x:0,y:0}];
  const stash:InventoryItem[]=[{id:'item-900',item:'iron',quantity:99,slot:'bag',x:0,y:0}];
  storage.setItem(characterSaveKey,JSON.stringify({version:4,items,stash,shelterRestored:true,restedSeconds:123,campfires:['homestead/camp'],xp:{woodcutting:327.5,mining:47.5,axeCombat:60},campClaims:['sword']}));
  const migrated=new Adventure(storage);expect(migrated.character.version).toBe(10);expect(migrated.character.stash).toEqual(stash);expect(migrated.character.shelterRestored).toBe(true);expect(migrated.character.restedSeconds).toBe(123);expect(migrated.character.xp.mining).toBe(47.5);expect(migrated.character.actionBar[4]).toBe('sword-basic');expect(migrated.character.potions).toBe(3);
  const restored=new Adventure(storage);expect(restored.character).toEqual(migrated.character);expect(restored.character.potions).toBe(3);expect(new Set([...restored.character.items,...restored.character.stash].map(i=>i.id)).size).toBe(restored.character.items.length+restored.character.stash.length);
});

test('unreadable saves restore the validated backup and preserve original bytes before replacement', () => {
  const storage = memory(), state = new Adventure(storage);
  state.save(); const original = storage.getItem(characterSaveKey)!;
  state.character.items.find(i => i.item === 'scroll')!.quantity = 7; state.save();
  expect(storage.getItem(characterBackupKey)).toBe(original);
  storage.setItem(characterBackupKey, '{damaged-backup');
  state.character.xp.mining = 1; state.save();
  expect(JSON.parse(storage.getItem(`${characterBackupKey}.unreadable`)!)).toEqual(['{damaged-backup']);
  // Restore the expected recovery snapshot for the primary-corruption case below.
  storage.setItem(characterBackupKey, original);
  storage.setItem(characterSaveKey, '{broken');
  const recovered = new Adventure(storage);
  expect(recovered.character.scrolls).toBe(3);
  expect(decodeCharacter(storage.getItem(characterSaveKey)!).scrolls).toBe(3);
  expect(JSON.parse(storage.getItem(`${characterSaveKey}.unreadable`)!)).toEqual(['{broken']);
  // A failed preservation write must not replace either unreadable copy.
  const broken = memory(); broken.setItem(characterSaveKey, '{primary'); broken.setItem(characterBackupKey, '{backup');
  const unavailable = new Adventure({ getItem: broken.getItem, setItem: () => { throw Error('full'); } });
  unavailable.save(); unavailable.closeSave();
  expect(broken.getItem(characterSaveKey)).toBe('{primary'); expect(broken.getItem(characterBackupKey)).toBe('{backup');
  const fresh = new Adventure(broken); fresh.save();
  expect(decodeCharacter(broken.getItem(characterSaveKey)!).scrolls).toBe(3);
  expect(JSON.parse(broken.getItem(`${characterSaveKey}.unreadable`)!)).toEqual(['{primary']);
  expect(JSON.parse(broken.getItem(`${characterBackupKey}.unreadable`)!)).toEqual(['{backup']);
});

test('failed writes back off, coalesce the latest progress, retain a backup and flush on exit', async () => {
  vi.useFakeTimers();
  try {
    const storage = memory(), initial = new Adventure(storage); initial.save();
    const original = storage.getItem(characterSaveKey)!;
    let failing = true, attempts = 0;
    const state = new Adventure({ getItem: storage.getItem, setItem: (key, value) => {
      attempts++; if (failing) throw Error('full'); storage.setItem(key, value);
    } });
    state.character.xp.mining = 1; state.save(); expect(attempts).toBe(1);
    for (const delay of [1000, 2000, 5000, 15000, 30000, 30000]) {
      state.character.xp.mining++; state.save();
      const before = attempts;
      await vi.advanceTimersByTimeAsync(delay - 1); expect(attempts).toBe(before);
      await vi.advanceTimersByTimeAsync(1); expect(attempts).toBe(before + 1);
    }
    expect(storage.getItem(characterSaveKey)).toBe(original);
    failing = false; state.character.xp.mining = 20; state.save();
    await vi.advanceTimersByTimeAsync(30000);
    expect(decodeCharacter(storage.getItem(characterSaveKey)!).xp.mining).toBe(20);
    expect(storage.getItem(characterBackupKey)).toBe(original); expect(state.saveDiagnostics().pending).toBe(false);
    failing = true; state.character.xp.mining = 21; state.save();
    failing = false; state.character.xp.mining = 22; state.closeSave();
    expect(decodeCharacter(storage.getItem(characterSaveKey)!).xp.mining).toBe(22);
    expect(decodeCharacter(storage.getItem(characterBackupKey)!).xp.mining).toBe(20);
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

test('startup retries restore before play, but late reads never swap or overwrite an active character', async () => {
  vi.useFakeTimers();
  try {
    const storage = memory(); storage.setItem(characterSaveKey, JSON.stringify({version:1,scrolls:7,campfires:[]}));
    let readable = false;
    const source = { getItem: (key: string) => { if (!readable) throw Error('denied'); return storage.getItem(key); }, setItem: storage.setItem };
    const startup = new Adventure(source), preparation = startup.prepareSave();
    readable = true; await vi.advanceTimersByTimeAsync(1000); await preparation;
    expect(startup.character.scrolls).toBe(7);
    readable = false;
    const session = new Adventure(source), pending = session.prepareSave();
    await vi.advanceTimersByTimeAsync(3000); await pending;
    const existing = storage.getItem(characterSaveKey);
    session.character.xp.mining = 20; session.save();
    readable = true; await vi.advanceTimersByTimeAsync(1000);
    expect(session.character.scrolls).toBe(3); expect(session.character.xp.mining).toBe(20);
    expect(storage.getItem(characterSaveKey)).toBe(existing); expect(session.saveDiagnostics().blockedByExisting).toBe(true);
    session.closeSave(); expect(storage.getItem(characterSaveKey)).toBe(existing);
    // If storage proves empty, the latest in-memory progress can be persisted safely.
    const empty = memory(); readable = false;
    const temporary = new Adventure({getItem: key => {if(!readable)throw Error('denied');return empty.getItem(key);},setItem:empty.setItem});
    temporary.character.xp.mining = 30; temporary.save(); readable = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(decodeCharacter(empty.getItem(characterSaveKey)!).xp.mining).toBe(30); temporary.closeSave();
  } finally { vi.useRealTimers(); }
});

test('a rejected save publishes no partially decoded character', () => {
  const storage = memory(); storage.setItem(characterSaveKey, JSON.stringify({version:2,scrolls:5,campfires:[],equipment:['bow'],loadout:{main:'bow',off:null},wood:0,xp:{woodcutting:30,axeCombat:0},campEquipmentClaimed:false}));
  const state = new Adventure(storage); expect(state.character.loadout.main).toBe('bow');
  const saved = parseJson(storage.getItem(characterSaveKey)!);
  if (!isRecord(saved)) throw new Error('Invalid saved fixture');
  const invalid = {...saved, restedSeconds:2000};
  storage.setItem(characterSaveKey, JSON.stringify(invalid)); storage.data.delete(characterBackupKey);
  const fresh = new Adventure(storage); expect(fresh.character.loadout.main).toBe('axe'); expect(fresh.character.xp.woodcutting).toBe(0);
});

test('overflow transfers into empty stash cells cap stacks and retain quantity and identity', () => {
  const source: InventoryItem[] = [{id:'legacy',item:'wood',quantity:200,slot:'overflow',x:0,y:0}];
  const first = transferItem(source, [], 'legacy', 200, () => 'part-1', {x:0,y:0});
  expect(first.source[0]).toMatchObject({id:'legacy',quantity:101}); expect(first.destination[0]).toMatchObject({id:'part-1',quantity:99});
  expect(validItems(first.source)).toBe(true); expect(validItems(first.destination)).toBe(true);
  const second = transferItem(first.source, first.destination, 'legacy', 101, () => 'part-2', {x:1,y:0});
  const last = transferItem(second.source, second.destination, 'legacy', 2, () => 'unused', {x:2,y:0});
  expect(last.source).toEqual([]); expect(last.destination.map(i => [i.id,i.quantity])).toEqual([['part-1',99],['part-2',99],['legacy',2]]);
  expect(source[0].quantity).toBe(200);
});

test('unpacking an oversized recovery stack into the bag retains the remainder', () => {
  const items: InventoryItem[] = [{id:'legacy',item:'wood',quantity:200,slot:'overflow',x:0,y:0}];
  const next = moveItem(items,'legacy',0,0,200,()=> 'unpacked');
  expect(next.find(i=>i.slot==='bag')).toMatchObject({id:'unpacked',quantity:99});
  expect(next.find(i=>i.slot==='overflow')).toMatchObject({id:'legacy',quantity:101});
  expect(validItems(next)).toBe(true);
  expect(items[0].quantity).toBe(200);
});

test('Restart refreshes chest rewards, drops and portals while retaining collected progress', () => {
  const state = new Adventure(memory(),()=>1), encounter = createEncounter('playing');
  const chest = field.chests![0];
  state.enter(encounter,field,{position:chest.position,yaw:0});
  encounter.enemies.enemy.hp = 0;
  state.openChest(encounter,field,chest);
  const sword = state.session().drops.find(d=>d.item==='sword')!; sword.age = .6;
  state.pickup(sword.id,chest.position,true);
  state.beginCast(true); state.step(encounter,field,2);
  const character = JSON.stringify(state.character);
  state.restart();
  expect(JSON.stringify(state.character)).toBe(character);
  expect(state.session().drops).toEqual([]);
  expect(state.portal).toBeNull(); expect(state.castRemaining).toBe(0);
  expect(state.openChest(encounter,field,chest)).toBe(true);
  expect(state.session().drops.map(d=>d.item)).toEqual(['scroll','potion','shield','guard-helm','weathered-mail','duelist-gloves']);
});

test('shared equipment stays across swaps, accepts only its slots, and full-bag removal is atomic', () => {
  const items:InventoryItem[]=[{id:'sword',item:'sword',quantity:1,slot:'main',weaponSet:0,x:0,y:0},{id:'bow',item:'bow',quantity:1,slot:'main',weaponSet:1,x:0,y:0},{id:'helm',item:'guard-helm',quantity:1,slot:'bag',x:0,y:0},{id:'ring',item:'hearth-ring',quantity:1,slot:'bag',x:2,y:0}];
  const worn=equipInstance(equipInstance(items,'helm','helmet',1),'ring','ring-right',1);
  expect(validItems(worn)).toBe(true);expect(worn.find(item=>item.id==='helm')!.weaponSet).toBeUndefined();
  expect(()=>equipInstance(worn,'ring','helmet')).toThrow('different slot');
  expect(validItems([...worn,{...worn.find(item=>item.id==='helm')!,id:'duplicate'}])).toBe(false);
  const encounter=createEncounter('playing');applyEquipment(encounter,worn,0);expect([encounter.stats.armor,encounter.stats.maxHealth,encounter.stats.damage]).toEqual([8,115,50]);
  applyEquipment(encounter,worn,1);expect([encounter.stats.armor,encounter.stats.maxHealth,encounter.stats.damage]).toEqual([8,115,45]);
  const full:InventoryItem[]=[...worn.filter(item=>item.slot!=='bag'),...Array.from({length:96},(_,i)=>({id:`supply-${i}`,item:'wood' as const,quantity:1,slot:'bag' as const,x:i%12,y:Math.floor(i/12)}))];
  const before=structuredClone(full);expect(()=>removeQuantity(full,'sword',1)).not.toThrow();
  expect(()=>equipInstance(full,'ring','ring-left')).not.toThrow();
  expect(()=>moveItem(full,'helm',0,0,1,()=> 'new')).toThrow();expect(full).toEqual(before);
});

test('revision 5 migrates losslessly and current saves retain shared slots, stash and all discovery claims', () => {
  const storage=memory(),adventure=new Adventure(storage);
  const old={...adventure.character,version:5,campClaims:['sword','shield'],shelterRestored:true,restedSeconds:123,stash:[{id:'stored',item:'iron',quantity:7,slot:'bag',x:0,y:0}],xp:{woodcutting:31,mining:22,axeCombat:17}};
  const migrated=decodeCharacter(JSON.stringify(old));expect(migrated.version).toBe(10);expect(migrated.items).toEqual(old.items);expect(migrated.stash).toEqual(old.stash);expect(migrated.campClaims).toEqual(old.campClaims);
  expect(migrated.items.some(item=>item.slot==='helmet')).toBe(false);
  migrated.items.push({id:'helm',item:'guard-helm',quantity:1,slot:'helmet',x:0,y:0});migrated.campClaims.push('guard-helm','yew-longbow');
  expect(decodeCharacter(JSON.stringify(migrated))).toEqual(migrated);
});

test('equipment never refills resources; potion, fire, travel and restart use effective maxima', () => {
  const storage=memory(),adventure=new Adventure(storage),encounter=createEncounter('playing');adventure.enter(encounter,home);
  encounter.player.hp=50;encounter.playerMana=30;
  adventure.character.items.push({id:'ring',item:'hearth-ring',quantity:1,slot:'ring-left',x:0,y:0},{id:'belt',item:'leather-belt',quantity:1,slot:'belt',x:0,y:0},{id:'coat',item:'quilted-coat',quantity:1,slot:'body',x:0,y:0},{id:'amulet',item:'amber-amulet',quantity:1,slot:'amulet',x:0,y:0});
  applyEquipment(encounter,adventure.character.items,0);expect([encounter.player.hp,encounter.playerMana,encounter.stats.maxHealth,encounter.stats.maxMana]).toEqual([50,30,125,140]);
  expect(adventure.usePotion(encounter)).toBe(true);expect(encounter.player.hp).toBe(90);
  adventure.enter(encounter,home,home.campfires![0].arrival);adventure.step(encounter,home,1);expect(encounter.player.hp).toBe(93.75);
  adventure.enter(encounter,field);expect([encounter.player.hp,encounter.playerMana]).toEqual([93.75,30]);
  adventure.save();const restored=new Adventure(storage);restored.enter(encounter,field);expect([encounter.player.hp,encounter.playerMana]).toEqual([125,140]);
  restored.character.items=restored.character.items.filter(item=>item.slot==='main' || item.slot==='bag');applyEquipment(encounter,restored.character.items,0);expect([encounter.player.hp,encounter.playerMana]).toEqual([100,100]);
});

test('unguarded caches and caster gear are claimed only on collection and reoffer unclaimed rewards after restart', () => {
  const storage=memory(),adventure=new Adventure(storage,()=>1),encounter=createEncounter('playing'),cache=field.chests![1];
  adventure.enter(encounter,field,{position:cache.position,yaw:0});expect(adventure.openChest(encounter,field,cache)).toBe(true);
  const coat=adventure.session().drops.find(drop=>drop.item==='quilted-coat')!;coat.age=.6;expect(adventure.pickup(coat.id,coat.position,true)).toBe(true);
  encounter.enemies.caster.hp=0;adventure.step(encounter,field,.01);expect(adventure.session().drops.filter(drop=>drop.claim).map(drop=>drop.item)).toEqual(['bow','trail-boots','leather-belt','iron-broadsword','yew-longbow','amber-amulet']);
  adventure.enter(encounter,home,undefined,true);adventure.enter(encounter,field);expect(adventure.session().drops.filter(drop=>drop.claim)).toHaveLength(6);
  const restored=new Adventure(storage,()=>1);restored.enter(encounter,field,{position:cache.position,yaw:0});restored.openChest(encounter,field,cache);encounter.enemies.caster.hp=0;restored.step(encounter,field,.01);
  expect(restored.session().drops.filter(drop=>drop.claim).map(drop=>drop.item)).toEqual(['bow','trail-boots','leather-belt','iron-broadsword','yew-longbow','amber-amulet']);
});

test('gold auto-collects only after landing without bag space, and unreachable gold remains intact', () => {
  const state = new Adventure(memory()), encounter = createEncounter('playing'); state.enter(encounter, field);
  state.character.items = Array.from({length:96}, (_,i) => ({id:`full-${i}`,item:'wood',quantity:99,slot:'bag',x:i%12,y:Math.floor(i/12)}));
  const before = structuredClone(state.character.items), point: [number,number] = [encounter.player.x,encounter.player.z];
  const drop = state.spawnDrop('gold', 5, point);
  state.step(encounter,field,.54); expect(state.character.gold).toBe(0);
  state.canCollectGround = () => false;
  state.step(encounter,field,.02); expect(state.session().drops).toContain(drop); expect(state.character.gold).toBe(0);
  state.canCollectGround = () => true;
  state.step(encounter,field,.01); expect(state.character.gold).toBe(5);
  expect(state.character.items).toEqual(before); expect(state.session().drops).not.toContain(drop);
});

test('successful and failed gold rolls cannot repeat through travel, death or chest reopening', () => {
  for (const draw of [0,.8]) {
    const random = vi.fn(() => draw), state = new Adventure(memory(),random), encounter = createEncounter('playing');
    state.enter(encounter, authoredField); encounter.enemies.enemy.hp = 0; state.step(encounter,authoredField,.01);
    const calls = random.mock.calls.length, drops = structuredClone(state.session().drops);
    state.enter(encounter,home,home.layout.player,true); state.enter(encounter,authoredField); state.step(encounter,authoredField,.01);
    expect(random).toHaveBeenCalledTimes(calls); expect(state.session().drops.map(drop=>drop.id)).toEqual(drops.map(drop=>drop.id));
    const chest = authoredField.chests![0]; encounter.player.x = chest.position[0]; encounter.player.z = chest.position[1];
    expect(state.openChest(encounter,authoredField,chest)).toBe(true);
    const openedCalls = random.mock.calls.length;
    expect(state.openChest(encounter,authoredField,chest)).toBe(false); expect(random).toHaveBeenCalledTimes(openedCalls);
    expect(state.session().drops.filter(drop=>drop.item==='gold')).toHaveLength(draw === 0 ? 2 : 0);
    state.closeSave();
  }
});

test.each([0, .8])('chance equipment rolls survive relaunch without duplicating rewards or consuming discovery claims (%s)', draw => {
  const area = structuredClone(field);
  area.layout.enemy!.equipmentDrops = { chance: .15, items: ['sword'] };
  const storage = memory(), state = new Adventure(storage, () => draw), encounter = createEncounter('playing');
  state.character.campClaims = ['sword'];
  state.enter(encounter, area); encounter.enemies.enemy.hp = 0; state.step(encounter, area, .01);
  const rewards = state.session().drops.filter(drop => drop.item === 'sword');
  expect(rewards).toHaveLength(draw === 0 ? 1 : 0);
  if (rewards.length) {
    const drop = rewards[0];
    expect(drop.claim).toBeUndefined();
    drop.age = .6;
    expect(state.pickup(drop.id, drop.position, true)).toBe(true);
  }
  state.save(); state.closeSave();
  const random = vi.fn(() => 0), restored = new Adventure(storage, random);
  restored.enter(encounter, area); restored.step(encounter, area, .01);
  expect(random).not.toHaveBeenCalled();
  expect(restored.session().drops.filter(drop => drop.item === 'sword')).toHaveLength(0);
  expect(restored.character.items.filter(item => item.item === 'sword')).toHaveLength(draw === 0 ? 1 : 0);
  expect(restored.character.campClaims).toEqual(['sword']);
  restored.closeSave();
});

function trading() {
  const storage = memory(), state = new Adventure(storage), encounter = createEncounter('playing');
  state.enter(encounter,home,{position:home.shop!.position,yaw:0}); state.character.gold=100;
  return {storage,state,encounter};
}

test('buy, sell and buyback commit coherent saves and restore the same equipment identity', () => {
  const {storage,state,encounter} = trading();
  state.buy(encounter,home,'sword'); const sword = state.character.items.find(entry=>entry.item==='sword')!;
  expect([state.character.gold,sword.slot]).toEqual([40,'bag']);
  state.sell(encounter,home,sword.id); expect(state.character.gold).toBe(55);
  expect(state.character.buyback).toEqual([{id:sword.id,item:'sword',price:15}]);
  state.buyBack(encounter,home,sword.id); expect(state.character.items.find(entry=>entry.id===sword.id)?.item).toBe('sword');
  expect(state.character.gold).toBe(40); expect(state.character.buyback).toEqual([]);
  state.buy(encounter,home,'potion'); expect([state.character.gold,state.character.potions]).toEqual([35,4]);
  state.sell(encounter,home,sword.id);
  const restored = new Adventure(storage); expect(restored.character.gold).toBe(50); expect(restored.character.buyback).toEqual(state.character.buyback);
  expect(state.character.campClaims).toEqual([]); state.closeSave(); restored.closeSave();
});

test('invalid, unaffordable and full-bag trades leave wallet, items and buyback unchanged', () => {
  const {state,encounter} = trading();
  const unchanged = (operation: () => void) => { const before = JSON.stringify(state.character); expect(operation).toThrow(); expect(JSON.stringify(state.character)).toBe(before); };
  unchanged(()=>state.sell(encounter,home,state.character.items.find(item=>item.slot==='main')!.id));
  unchanged(()=>state.sell(encounter,home,state.character.items.find(item=>item.item==='potion')!.id));
  unchanged(()=>state.buy(encounter,home,'iron')); unchanged(()=>state.buyBack(encounter,home,'missing'));
  state.character.gold=0; unchanged(()=>state.buy(encounter,home,'potion'));
  state.character.gold=100; encounter.player.x=50; unchanged(()=>state.buy(encounter,home,'potion')); encounter.player.x=home.shop!.position[0];
  state.character.items = Array.from({length:96}, (_,i) => ({id:`full-${i}`,item:'wood',quantity:99,slot:'bag',x:i%12,y:Math.floor(i/12)}));
  state.character.buyback=[{id:'item-8000',item:'sword',price:15}];
  unchanged(()=>state.buy(encounter,home,'potion')); unchanged(()=>state.buyBack(encounter,home,'item-8000')); state.closeSave();
});

test('buyback retains only the last ten, migrates revision 6 without gifts and reserves saved identities', () => {
  const {state,encounter,storage} = trading(); state.character.items=[];
  const ids: string[]=[];
  for(let i=0;i<11;i++){const id=`item-${9000+i}`;receive(state.character.items,'sword',1,state.newId,id);ids.push(id);}
  for(const id of ids)state.sell(encounter,home,id);
  expect(state.character.buyback.map(entry=>entry.id)).toEqual(ids.slice(1).reverse());
  const restored=new Adventure(storage); expect(Number(restored.newId().slice(5))).toBeGreaterThan(9010);
  const duplicate={...state.character,items:[{id:ids[10],item:'sword',quantity:1,slot:'bag',x:0,y:0}]};
  expect(()=>decodeCharacter(JSON.stringify(duplicate))).toThrow('Duplicate buyback identity');
  const legacy={...state.character,version:6,gold:undefined,buyback:undefined};
  const migrated=decodeCharacter(JSON.stringify(legacy));expect(migrated.version).toBe(10);expect(migrated.gold).toBe(0);expect(migrated.buyback).toEqual([]);
  expect(migrated.items).toEqual(legacy.items); expect(migrated.campClaims).toEqual(legacy.campClaims);
  state.closeSave();restored.closeSave();
});

test('area travel preserves the dodge cooldown without carrying the roll', () => {
  const adventure = new Adventure(memory()), encounter = createEncounter('playing');
  adventure.enter(encounter, home);
  encounter.dodgeCooldown = .7;
  encounter.dodgeRemaining = .2;
  adventure.enter(encounter, field);
  expect(encounter.dodgeCooldown).toBeCloseTo(.7);
  expect(encounter.dodgeRemaining).toBe(0);
});

test('authored enemy IDs and independent chest supplies survive travel and death recovery without repeated rewards', () => {
  const state=new Adventure(memory(),()=>0), encounter=createEncounter('playing');
  const crypt:AreaDefinition={...field,id:'fixture-crypt',layout:{...field.layout,enemy:undefined,caster:undefined,enemies:['first','second','bone-caster'].map((id,index)=>({id,position:[index,0],yaw:0,kind:index===2?'caster':'raider',rig:'skeleton',humanoid:true,loadout:{main:index===2?'staff':'sword',off:null}}))}};
  const chest={...field.chests![0],id:'supplies',position:[0,0] as [number,number],potions:2};
  state.enter(encounter,crypt,{position:[0,0],yaw:0});encounter.enemies.first.hp=0;encounter.enemies.second.hp=40;
  expect(state.openChest(encounter,crypt,chest)).toBe(true);
  state.step(encounter,crypt,.01);
  const drops=state.session().drops;
  expect(drops.filter(drop=>drop.item==='gold')).toHaveLength(1);
  state.enter(encounter,home,undefined,true);
  state.enter(encounter,crypt,{position:[0,0],yaw:0});
  expect([encounter.enemies.first.hp,encounter.enemies.second.hp,encounter.enemies['bone-caster'].hp]).toEqual([0,40,enemyMaxHealth]);
  expect(state.session().drops).toBe(drops);
  encounter.enemies.second.hp=0;encounter.enemies['bone-caster'].hp=0;
  expect(state.openChest(encounter,crypt,chest)).toBe(false);
  expect(state.session().drops.filter(drop=>drop.item==='potion').map(drop=>drop.quantity)).toEqual([2]);
  expect(state.openChest(encounter,crypt,chest)).toBe(false);
  state.enter(encounter,home);state.enter(encounter,crypt,{position:[0,0],yaw:0});
  state.step(encounter,crypt,.01);
  expect(state.session().drops.filter(drop=>drop.item==='gold')).toHaveLength(3);
  expect(encounter.phase).toBe('won');expect(state.chest(crypt,chest).opened).toBe(true);
  state.closeSave();
});

test('revision 7 skill migration preserves the full character and seeds new tracks at zero', () => {
  const adventure = new Adventure(memory());
  const old = {...adventure.character, version:7, gold:45, shelterRestored:true, restedSeconds:123,
    stash:[{id:'stored-iron',item:'iron',quantity:7,slot:'bag',x:0,y:0}],
    buyback:[{id:'sold-shield',item:'shield',price:3}], campClaims:['sword'],
    xp:{woodcutting:327.5,mining:47.5,axeCombat:60}};
  const migrated = decodeCharacter(JSON.stringify(old));
  expect({...migrated, version:7, xp:old.xp, outing:{...migrated.outing,weather:old.outing.weather}}).toEqual(old);
  expect(migrated.outing.weather).toMatchObject({ phase: 'dry', elapsed: 0, wetness: 0 });
  expect(migrated.xp).toMatchObject(old.xp);
  expect(skillIds.filter(id => !['woodcutting','mining','axeCombat'].includes(id)).every(id => migrated.xp[id] === 0)).toBe(true);
  expect(decodeCharacter(JSON.stringify(migrated))).toEqual(migrated);
  adventure.closeSave();
});

test('all saved skill tracks round-trip and invalid planned progress cannot replace a character', () => {
  const adventure = new Adventure(memory()), value = adventure.character;
  skillIds.forEach((id,index) => { value.xp[id] = index * 10.5; });
  const raw = JSON.stringify(value);
  expect(decodeCharacter(raw).xp).toEqual(value.xp);
  expect(()=>decodeCharacter(JSON.stringify({...value,xp:{...value.xp,healing:-1}}))).toThrow('Invalid skill progress');
  expect(()=>decodeCharacter(JSON.stringify({...value,xp:{...value.xp,herbalism:undefined}}))).toThrow('Invalid skill progress');
  expect(JSON.stringify(value)).toBe(raw);
  adventure.closeSave();
});

// Admission: earned abilities mutate a saved action bar; existing all-track round trips do not protect automatic placement or occupied slots.
test('weapon unlocks fill empty slots without replacement and survive saving',()=>{
  const adventure=new Adventure();
  adventure.setActionBar(['sweep','multishot',null,null,'axe-basic',null]);
  const occupied=[...adventure.character.actionBar];
  adventure.grantWeaponXp('sword',1000);
  expect(adventure.character.actionBar[0]).toBe(occupied[0]); expect(adventure.character.actionBar[1]).toBe(occupied[1]); expect(adventure.character.actionBar[4]).toBe(occupied[4]);
  expect(adventure.character.actionBar[2]).toBe('thrust'); expect(adventure.character.actionBar[3]).toBe('executioner');
  const decoded=decodeCharacter(JSON.stringify(adventure.character));
  expect(decoded.xp.sword).toBe(adventure.character.xp.sword); expect(decoded.actionBar).toEqual(adventure.character.actionBar);
  const full=['sword-basic','sweep','thrust','executioner','bow-basic','multishot'] as const;
  adventure.setActionBar([...full]); adventure.takeEvents();
  adventure.grantWeaponXp('sword',22999.999999);
  expect(()=>adventure.setActionBar(['onslaught',...full.slice(1)])).toThrow();
  adventure.takeEvents(); adventure.grantWeaponXp('sword',.000001);
  expect(adventure.character.actionBar).toEqual(full);
  expect(adventure.takeEvents()).toEqual([{type:'abilityLearned',ability:'onslaught',slot:null}]);
  adventure.grantWeaponXp('sword',1); expect(adventure.takeEvents()).toEqual([]);
  adventure.closeSave();
});

// Admission: a transient stance left by Object.assign area replacement could prevent damage and spend an old attack's costs after travel.
test('travel clears an uncommitted Riposte stance without spending its costs',()=>{
  const adventure=new Adventure(),encounter=createEncounter('playing');
  adventure.enter(encounter,field);
  encounter.riposte={remaining:.5,action:{duration:.62,contacts:[.26],damage:100,rate:1,reach:2,arc:Math.PI/4,weapon:'sword',ability:'riposte',mana:20,cooldown:6}};
  adventure.enter(encounter,home);
  expect(encounter.riposte).toBeUndefined(); expect(encounter.playerAction).toBeNull(); expect(encounter.playerMana).toBe(100); expect(encounter.abilityCooldowns.riposte ?? 0).toBe(0);
});

// Moving sources must preserve old rewards without minting another guaranteed copy.
test('saved camp discoveries reserve their identities at the new caches until collected', () => {
  const storage = memory();
  const oldField: AreaDefinition = { ...field, chests: field.chests!.map((chest, index) => index === 0
    ? { ...chest, equipment: [...chest.equipment!, 'bow', 'staff'] } : chest) };
  const old = new Adventure(storage, () => 1), encounter = createEncounter('playing');
  old.enter(encounter, oldField, {position:oldField.chests![0].position,yaw:0});
  old.openChest(encounter, oldField, oldField.chests![0]);
  old.closeSave();
  const restored = new Adventure(storage, () => 1);
  for (const chest of field.chests!.slice(1)) {
    restored.enter(encounter, field, {position:chest.position,yaw:0});
    expect(restored.openChest(encounter, field, chest)).toBe(true);
  }
  for (const item of ['bow', 'staff'] as const) {
    const drops = restored.session().drops.filter(drop => drop.claim === item);
    expect(drops).toHaveLength(1);
    expect(drops[0].source).toEqual({kind:'chest',id:'camp-chest'});
    expect(restored.character.campClaims).not.toContain(item);
    drops[0].age = .6;
    expect(restored.pickup(drops[0].id, drops[0].position, true)).toBe(true);
    expect(restored.character.campClaims).toContain(item);
  }
  restored.closeSave();
});
