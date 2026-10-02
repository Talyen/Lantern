import { expect, test, vi } from 'vitest';
import { characterBackupKey, decodeCharacter } from '../src/gameplay/character-save';
import { Adventure, characterSaveKey } from '../src/gameplay/adventure';
import { createEncounter } from '../src/gameplay/encounter';
import homestead from '../src/levels/areas/homestead.json';
import clearing from '../src/levels/areas/clearing.json';
import type { AreaDefinition } from '../src/levels/types';
import { equipInstance, itemLoadout, receive, removeQuantity, sortedItems, validItems, transferItem, type InventoryItem } from '../src/gameplay/inventory';
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
  storage.setItem(characterSaveKey, '{broken');
  const recovered = new Adventure(storage); expect(recovered.character.scrolls).toBeGreaterThan(0);
  expect(JSON.parse(storage.getItem(`${characterSaveKey}.unreadable`)!)).toContain('{broken');
  const failed = new Adventure({ getItem: () => null, setItem: () => { throw Error('full'); } }); failed.save(); expect(failed.saveDiagnostics().pending).toBe(true); failed.closeSave();
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
  expect(state.session().drops).toHaveLength(6); expect(state.openChest(encounter, field, chest)).toBe(false);
  const sword = state.session().drops.find(d => d.item === 'sword')!; sword.age = .6;
  expect(state.pickup(sword.id, chest.position, true)).toBe(true);
  state.enter(encounter, home); state.enter(encounter, field);
  expect(state.session().drops).toHaveLength(5);
  const restored = new Adventure(storage); restored.enter(encounter, field, { position: chest.position, yaw: 0 }); encounter.enemies.enemy.hp = 0;
  restored.openChest(encounter, field, chest);
  expect(restored.session().drops.map(d => d.item)).toEqual(['scroll', 'potion', 'shield', 'bow', 'staff']);
});

test('legacy characters migrate equipped copies, resources and claimed rewards without loss', () => {
  const storage = memory(); storage.setItem(characterSaveKey, JSON.stringify({ version: 2, scrolls: 7, campfires: ['clearing/camp'], equipment: ['axe', 'sword', 'shield', 'bow', 'staff'], loadout: { main: 'bow', off: null }, wood: 12000, xp: { woodcutting: 20, axeCombat: 30 }, campEquipmentClaimed: true }));
  const state = new Adventure(storage, () => 1), encounter = createEncounter('playing');
  expect([state.character.version, state.character.scrolls, state.character.loadout.main]).toEqual([5, 7, 'bow']);
  expect(state.character.equipment).toEqual(['bow', 'axe', 'sword', 'shield', 'staff']);
  expect(state.character.wood).toBe(12000); expect(state.character.items.some(i => i.slot === 'overflow')).toBe(true);
  expect(validItems(state.character.items)).toBe(true);
  const restored = new Adventure(storage); expect(restored.character).toEqual(state.character);
  restored.enter(encounter, field, { position: field.chests![0].position, yaw: 0 }); encounter.enemies.enemy.hp = 0; restored.openChest(encounter, field, field.chests![0]);
  expect(restored.session().drops.map(d => d.item)).toEqual(['scroll','potion']);
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
  expect([encounter.enemies.caster.hp,encounter.enemies.enemy.hp]).toEqual([50,100]);
  const chest=field.chests![0]; encounter.player.x=chest.position[0]; encounter.player.z=chest.position[1];
  expect(state.openChest(encounter,field,chest)).toBe(false);
  encounter.enemies.caster.hp=0; state.step(encounter,field,.01);
  expect(state.openChest(encounter,field,chest)).toBe(false);
  encounter.enemies.enemy.hp=0; state.step(encounter,field,.01);
  expect(state.openChest(encounter,field,chest)).toBe(true);
  state.enter(encounter,home,undefined,true); state.enter(encounter,field);
  expect([encounter.enemies.caster.hp,encounter.enemies.enemy.hp,encounter.phase]).toEqual([0,0,'won']);
  expect(state.session(field.id).drops).toHaveLength(8);
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
  expect(rewards.filter(e=>e.type==='lootDrop')).toHaveLength(6);
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
  state.grantHarvest('wood',3,'woodcutting',10,[0,0]);const drop=state.session().drops[0];drop.age=.6;
  expect(state.character.xp.woodcutting).toBe(0);expect(state.pickup(drop.id,[0,0])).toBe(true);
  expect([drop.quantity,state.character.xp.woodcutting]).toEqual([2,10]);
  state.character.items=state.character.items.filter(i=>i.id!=='filled-1-0');expect(state.pickup(drop.id,[0,0])).toBe(true);expect(state.character.xp.woodcutting).toBe(30);
  state.dropItem('wood-stack',1,[0,0]);const tossed=state.session().drops[0];tossed.age=.6;
  state.pickup(tossed.id,tossed.position,true);expect(state.character.xp.woodcutting).toBe(30);
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
  state.grantAxeCombatXp();expect(state.character.xp.axeCombat).toBe(11);
});

test('revision 3 migration retains IDs, claims, discoveries and XP while initializing Homestead progress',()=>{
  const storage=memory(),state=new Adventure(storage);state.character.campClaims=['bow'];state.character.xp.woodcutting=327;
  const old={...state.character,items:state.character.items.filter(i=>i.item!=='potion'),version:3};storage.setItem(characterSaveKey,JSON.stringify(old));
  const restored=new Adventure(storage);expect(restored.character.items.filter(i=>i.item!=='potion')).toEqual(old.items);expect(restored.character.campClaims).toEqual(['bow']);expect(restored.character.xp.woodcutting).toBe(327);expect(restored.character.xp.mining).toBe(0);expect(restored.character.stash).toEqual([]);expect(restored.character.shelterRestored).toBe(false);
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
  const migrated=new Adventure(storage);expect(migrated.character.version).toBe(5);expect(migrated.character.items.filter(i=>i.item!=='potion')).toEqual(items);
  expect(migrated.character.items.find(i=>i.item==='potion')).toMatchObject({slot:'overflow',quantity:3});
  migrated.setActionBar(['sweep','piercing-shot',null,null,'axe-basic','shield-basic']);migrated.setWeaponSet(1);
  const restored=new Adventure(storage);expect(restored.character).toEqual(migrated.character);expect(restored.character.items.filter(i=>i.item==='potion')).toHaveLength(1);
});

test('potions heal during an action, never consume at full health, and keep their cooldown across travel', () => {
  const adventure=new Adventure(),encounter=createEncounter('playing');adventure.enter(encounter,field);
  expect(adventure.usePotion(encounter)).toBe(false);expect(adventure.character.potions).toBe(3);
  encounter.player.hp=20;encounter.player.lock=.5;encounter.player.attackTime=.1;
  expect(adventure.usePotion(encounter)).toBe(true);expect([encounter.player.hp,encounter.player.lock,encounter.player.attackTime,adventure.character.potions]).toEqual([60,.5,.1,2]);
  expect(adventure.usePotion(encounter)).toBe(false);encounter.playerMana=37;encounter.abilityCooldowns.sweep=3;encounter.weapon='sword';encounter.shield=true;
  adventure.enter(encounter,home);expect([encounter.potionCooldown,encounter.playerMana,encounter.abilityCooldowns.sweep,encounter.weapon,encounter.shield]).toEqual([8,37,3,'sword',true]);
  encounter.player.hp=0;expect(adventure.usePotion(encounter)).toBe(false);expect(adventure.character.potions).toBe(2);
});

test('revision 4 Homestead progress migrates with combat controls and starter potions without changing stash identities',()=>{
  const storage=memory();
  const items:InventoryItem[]=[{id:'item-42',item:'sword',quantity:1,slot:'main',x:0,y:0},{id:'item-43',item:'scroll',quantity:5,slot:'bag',x:0,y:0}];
  const stash:InventoryItem[]=[{id:'item-900',item:'iron',quantity:99,slot:'bag',x:0,y:0}];
  storage.setItem(characterSaveKey,JSON.stringify({version:4,items,stash,shelterRestored:true,restedSeconds:123,campfires:['homestead/camp'],xp:{woodcutting:327.5,mining:47.5,axeCombat:60},campClaims:['sword']}));
  const migrated=new Adventure(storage);expect(migrated.character.version).toBe(5);expect(migrated.character.stash).toEqual(stash);expect(migrated.character.shelterRestored).toBe(true);expect(migrated.character.restedSeconds).toBe(123);expect(migrated.character.xp.mining).toBe(47.5);expect(migrated.character.actionBar[4]).toBe('sword-basic');expect(migrated.character.potions).toBe(3);
  const restored=new Adventure(storage);expect(restored.character).toEqual(migrated.character);expect(restored.character.potions).toBe(3);expect(new Set([...restored.character.items,...restored.character.stash].map(i=>i.id)).size).toBe(restored.character.items.length+restored.character.stash.length);
});

test('unreadable saves restore the validated backup and preserve original bytes before replacement', () => {
  const storage = memory(), state = new Adventure(storage);
  state.save(); const original = storage.getItem(characterSaveKey)!;
  state.character.items.find(i => i.item === 'scroll')!.quantity = 7; state.save();
  expect(storage.getItem(characterBackupKey)).toBe(original);
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
  const invalid = {...JSON.parse(storage.getItem(characterSaveKey)!), restedSeconds:2000};
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
