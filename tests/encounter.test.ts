import type { EncounterLayout } from '../src/gameplay/area';
import type { Movement } from '../src/gameplay/encounter';
import { expect, test } from 'vitest';
import { applyEquipment, useAbility, swapWeaponSet, attack, dodge, dodgeDistance, stepExploration, createEncounter, resetEncounter, stepEncounter, type Timings } from '../src/gameplay/encounter';
const timing: Timings = { player: { attack: 1, hit: 0.5, contacts: [0.42] }, enemy: { attack: 1, hit: 0.5, contacts: [0.42] }, caster: {attack:1.6,hit:.35,contacts:[.8]} };
import type { Loadout, WeaponItem } from '../src/gameplay/equipment';
import type { Encounter } from '../src/gameplay/encounter';
function equip(state: Encounter, main: WeaponItem) { sets(state,[{main,off:null},{main:null,off:null}]); }
function sets(state: Encounter, loadouts: [Loadout,Loadout]) {
  applyEquipment(state,loadouts.flatMap((loadout,set)=>[loadout.main,loadout.off].flatMap((item,index)=>item ? [{id:`set-${set}-${index}`,item,quantity:1,slot:index===0 ? 'main' as const : 'off' as const,weaponSet:set as 0|1,x:0,y:0}] : [])),0);
}
const idle = { x: 0, z: 0, paused: false };
function closeEncounter() {
  const state = createEncounter('playing');
  state.player.x = state.enemies.enemy.x = 0;
  state.player.z = 0; state.enemies.enemy.z = 1.4; state.enemies.enemy.yaw = Math.PI;
  return state;
}
test('nearby guards engage, strikes land at contact, and an interrupted enemy strike causes no damage', () => {
  const state = closeEncounter();
  stepEncounter(state, 0.01, { ...idle, x: 1 }, timing);
  expect(state.enemies.enemy.engaged).toBe(true);
  state.player.yaw = 0;
  state.enemies.enemy.attackTime = 0;
  attack(state, timing.player, false);
  stepEncounter(state, 0.41, idle, timing);
  expect(state.enemies.enemy.hp).toBe(200);
  const health = state.player.hp;
  const events = stepEncounter(state, 0.01, idle, timing);
  expect(state.enemies.enemy.hp).toBe(150);
  expect(events).toContainEqual({ type: 'hit', actor: 'enemy' });
  expect(state.player.hp).toBe(health);
  stepEncounter(state, 0.05, { ...idle, paused: true }, timing);
  expect(state.enemies.enemy.hp).toBe(150);
});
test('four connected Axe strikes win, then retry restores an unengaged encounter', () => {
  const state = closeEncounter();
  const winningTiming = { ...timing, enemy: { ...timing.enemy, hit: 0.8 } };
  for (let strike = 0; strike < 4; strike++) {
    attack(state, timing.player, false);
    for (let frame = 0; frame < 22; frame++) stepEncounter(state, 0.05, idle, winningTiming);
  }
  expect(state.phase).toBe('won');
  expect(state.enemies.enemy.hp).toBe(0);
  resetEncounter(state);
  expect([state.phase, state.enemies.enemy.engaged, state.player.hp, state.enemies.enemy.hp]).toEqual(['playing', false, 100, 200]);
  expect(state.player.x).toBe(-2.3);
});
test('standing in reach loses after five enemy hits; terminal states stop updating', () => {
  const state = closeEncounter();
  attack(state, timing.player, false);
  // Face away so this opening strike engages without hurting the raider.
  state.player.yaw = Math.PI;
  for (let frame = 0; frame < 240 && state.phase === 'playing'; frame++) stepEncounter(state, 0.05, idle, timing);
  expect([state.phase, state.player.hp, state.enemies.enemy.hp]).toEqual(['lost', 0, 200]);
  const position = state.player.x;
  expect(stepEncounter(state, 1, { ...idle, x: 1 }, timing)).toEqual([]);
  expect(state.player.x).toBe(position);
});

test('authored spawns survive retry and movement respects a convex area boundary', () => {
  const layout: EncounterLayout = { boundary: { kind: 'polygon', points: [[-4,-4],[4,-4],[4,4],[-4,4]] }, player: { position: [3,0], yaw: 1 }, enemy: { position: [-3,-3], yaw: 2 } };
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
    attack(state, timing.player, false); state.enemies.enemy.attackTime = 0;
    stepEncounter(state,.43,idle,timing,world);
    expect([state.player.hp,state.enemies.enemy.hp]).toEqual([100,200]);
    resetEncounter(state); state.player.x=-2; state.enemies.enemy.x=2; state.enemies.enemy.engaged=true; state.enemies.enemy.cooldown=999;
    for(let i=0;i<220;i++) stepEncounter(state,.05,idle,timing,world);
    expect(state.enemies.enemy.x).toBeLessThan(-.7);
    expect(Math.hypot(state.enemies.enemy.x-state.player.x,state.enemies.enemy.z-state.player.z)).toBeLessThan(1.6);
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
  const state = closeEncounter(); state.enemies.enemy.engaged = true;
  state.enemies.enemy.attackTime = .35; state.enemies.enemy.cooldown = 999;
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
  expect(dodge(state, { x: 1, z: 0 }, false)).toContainEqual({type:'action',actor:'player',action:'dodge',weapon:'axe'});
  resetEncounter(state);
  expect([state.dodgeRemaining, state.dodgeCooldown, state.invulnerability, state.playerMana]).toEqual([0, 0, 0, 100]);
  expect(dodge(state, { x: 1, z: 0 }, true)).toEqual([]);
});

test('the guard notices only nearby visible players, pursues, then returns and recovers', () => {
  const state = createEncounter('playing', { boundary: { kind: 'circle', center: [0,0], radius: 30 }, player: { position: [8,0], yaw: 0 }, enemy: { position: [0,0], yaw: 0 } });
  attack(state, timing.player, false); stepEncounter(state, .43, { ...idle, x: 1 }, timing);
  dodge(state, { x: 1, z: 0 }, false);
  expect(state.enemies.enemy.engaged).toBe(false);
  state.player.x = 5; state.player.attackTime = -1; state.player.lock = 0;
  const wall = { move: (_id: string, actor: { x: number; z: number }, x: number, z: number) => { actor.x += x; actor.z += z; }, direction: (a: { x: number; z: number }, b: { x: number; z: number }) => ({ x: b.x-a.x, z: b.z-a.z }), lineOfSight: () => false };
  stepEncounter(state, .05, idle, timing, wall); expect(state.enemies.enemy.engaged).toBe(false);
  stepEncounter(state, .05, idle, timing); expect(state.enemies.enemy.engaged).toBe(true);
  state.enemies.enemy.hp = 50; state.enemies.enemy.x = 4; state.player.x = 20;
  stepEncounter(state, .05, idle, timing); expect(state.enemies.enemy.returning).toBe(true); expect(state.enemies.enemy.engaged).toBe(false);
  for (let i = 0; i < 80; i++) stepEncounter(state, .05, idle, timing);
  expect([state.enemies.enemy.returning, state.enemies.enemy.hp, state.enemies.enemy.x, state.enemies.enemy.z]).toEqual([false, 200, 0, 0]);
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
  expect(state.enemies.enemy.hp).toBe(150);
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

test('safe and cleared attacks accept buffered input within recovery, keep committed aim and disable empty hands', () => {
  const safe = { boundary: { kind: 'circle' as const, center: [0,0] as [number,number], radius: 20 }, player: { position: [0,0] as [number,number], yaw: 0 } };
  const state = createEncounter('playing',safe);
  state.player.lock = state.attackCooldown = .14;
  expect(attack(state,timing.player,false,{x:10,z:0})).toEqual([]);
  for (let i=0;i<3;i++) stepExploration(state,.04,{...idle,aim:{x:0,z:10}},undefined,timing);
  const accepted = stepExploration(state,.04,{...idle,aim:{x:0,z:10}},undefined,timing);
  expect(accepted).toContainEqual({type:'animation',actor:'player',motion:'attack'});
  expect(state.player.attackTime).toBeCloseTo(.02);
  expect(state.player.lock).toBeCloseTo(.98);
  expect(state.player.yaw).toBe(Math.PI/2);
  for (let i=0;i<17;i++) stepExploration(state,.05,idle,undefined,timing);
  expect(dodge(state,{x:0,z:1},false)).toEqual([]);
  for (let i=0;i<3;i++) stepExploration(state,.05,idle,undefined,timing);
  expect(state.dodgeRemaining).toBeGreaterThan(0);
  resetEncounter(state);
  expect(state.pending).toBeNull();
  state.phase='won';
  expect(attack(state,timing.player,false)).toContainEqual({type:'animation',actor:'player',motion:'attack'});
  stepExploration(state,1,idle,undefined,timing);
  state.weapon=null;
  expect(attack(state,timing.player,false)).toEqual([]);
  expect(state.projectiles).toEqual([]);
});

test('a buffered ranged skill releases only after its own windup and retains the matching cooldown', () => {
  const state = createEncounter('won');
  state.weapon = 'bow'; state.weaponSets[0] = {main:'bow',off:null};
  state.player.lock = state.attackCooldown = .04;
  const clocks = {...timing,player:{...timing.player,abilities:{'piercing-shot':{attack:.2,contacts:[.03]}}}};
  useAbility(state,'piercing-shot',clocks.player,false);
  stepExploration(state,.05,idle,undefined,clocks);
  expect(state.projectiles).toHaveLength(0);
  expect(state.player.attackTime).toBeCloseTo(.01);
  expect(state.abilityCooldowns['piercing-shot']).toBeCloseTo(5.99);
  expect(state.playerMana).toBeCloseTo(70.08);
  stepExploration(state,.025,idle,undefined,clocks);
  expect(state.projectiles).toHaveLength(1);
  expect(state.projectiles[0].z).toBeCloseTo(state.player.z + .35 + .005 * 24);
});

test('a held shield halves frontal damage and walking speed, while rear hits interrupt and dodge releases it', () => {
  const front = closeEncounter(); front.shield=true; front.enemies.enemy.attackTime=.4; front.enemies.enemy.cooldown=999;
  stepEncounter(front,.03,{...idle,block:true},timing);
  expect(front.player.hp).toBe(90); expect(front.blocking).toBe(true);
  expect(attack(front,timing.player,false)).toEqual([]);
  stepEncounter(front,.1,{...idle,x:1,block:true,aim:{x:0,z:10}},timing);
  expect(front.player.x).toBeCloseTo(.16);
  expect(dodge(front,{x:1,z:0},false)).toContainEqual({type:'animation',actor:'player',motion:'dodge'});
  expect(front.blocking).toBe(false);
  const rear = closeEncounter(); rear.shield=true; rear.player.yaw=Math.PI; rear.enemies.enemy.attackTime=.4; rear.enemies.enemy.cooldown=999;
  const hit = stepEncounter(rear,.03,{...idle,block:true},timing);
  expect(rear.player.hp).toBe(80); expect(rear.blocking).toBe(false);
  expect(hit).toContainEqual({type:'animation',actor:'player',motion:'hit'});
});

test('ranged releases are timed, swept walls stop damage, and released arrows hit once without becoming Axe combat', () => {
  const world: Movement = {
    move: (_id,actor,x,z) => { actor.x+=x; actor.z+=z; },
    direction: (from,to) => ({x:to.x-from.x,z:to.z-from.z}), lineOfSight: () => true,
    segmentHit: (from,to) => from.z<=2 && to.z>=2 ? (2-from.z)/(to.z-from.z) : null,
  };
  const ranged: Timings = {...timing,player:{attack:.8,hit:.3,contacts:[.28]}};
  const blocked = closeEncounter(); equip(blocked,'staff'); blocked.enemies.enemy.z=4; blocked.enemies.enemy.cooldown=999;
  attack(blocked,ranged.player,false,{x:0,z:10});
  stepEncounter(blocked,.27,idle,ranged,world);
  expect(blocked.projectiles).toHaveLength(0);
  stepEncounter(blocked,.02,idle,ranged,world);
  expect(blocked.projectiles).toHaveLength(1);
  stepEncounter(blocked,.25,idle,ranged,world);
  expect(blocked.projectiles).toHaveLength(0); expect(blocked.enemies.enemy.hp).toBe(200);
  const clear = closeEncounter(); equip(clear,'bow'); clear.enemies.enemy.z=4; clear.enemies.enemy.cooldown=999;
  attack(clear,ranged.player,false,{x:0,z:10});
  stepEncounter(clear,.27,idle,ranged); stepEncounter(clear,.02,idle,ranged);
  // Changing equipped weapons while an arrow travels cannot change its damage source.
  equip(clear,'axe');
  const hit = stepEncounter(clear,.15,idle,ranged);
  expect(clear.enemies.enemy.hp).toBe(155); expect(clear.projectiles).toHaveLength(0);
  expect(hit.filter(event=>event.type==='hit' && event.actor==='enemy')).toHaveLength(1);
  expect(hit).not.toContainEqual({type:'axeXp'});
  stepEncounter(clear,.1,idle,ranged);
  expect(clear.enemies.enemy.hp).toBe(155);
  const behind=closeEncounter(); equip(behind,'bow'); behind.enemies.enemy.x=.4; behind.enemies.enemy.z=-.05; behind.enemies.enemy.lock=999;
  attack(behind,ranged.player,false,{x:0,z:10}); stepEncounter(behind,.3,idle,ranged);
  expect(behind.enemies.enemy.hp).toBe(200);
});

test('a contact pose fully replaces a manually phased locomotion pose', async () => {
  const THREE=await import('three'), {makeActor,attachCharacter,play,updateActor}=await import('../src/clearing/actors');
  const state=createEncounter('playing').player, actor=makeActor(new THREE.Scene(),state), model=new THREE.Group(), body=new THREE.Group(); body.name='body';
  const geometry=new THREE.BoxGeometry(1,1,1), material=new THREE.MeshBasicMaterial(); model.add(body,new THREE.Mesh(geometry,material));
  const clip=(name:string,x:number)=>new THREE.AnimationClip(name,1,[new THREE.VectorKeyframeTrack('body.position',[0,1],[x,0,0,x,0,0])]);
  attachCharacter(actor,model,[clip('idle',0),clip('run',1),clip('attack',3),clip('hit',0),clip('death',0)],1);
  updateActor(actor,state,.01,false); play(actor,'run'); state.z+=.1; updateActor(actor,state,.05,false);
  state.z+=.3; updateActor(actor,state,.15,false);
  const presented=actor.root.getObjectByName('body')!; expect(presented.position.x).toBeCloseTo(1);
  play(actor,'attack',.8);expect(actor.actions.attack!.getEffectiveTimeScale()).toBe(.8); updateActor(actor,state,.15,false); expect(presented.position.x).toBeCloseTo(3);
  actor.mixer!.stopAllAction(); geometry.dispose(); material.dispose();
});

test('a caster plants its feet, commits aim, releases one bolt and exposes its recovery', () => {
  const state = createEncounter('playing', { boundary: {kind:'circle',center:[0,0],radius:30}, player:{position:[0,4],yaw:0}, enemy:{position:[0,0],yaw:0} }, 'caster');
  const castTiming: Timings = {...timing,enemy:{attack:1.6,hit:.35,contacts:[.8]}};
  state.enemies.enemy.cooldown=0;
  stepEncounter(state,.05,idle,castTiming);
  expect(state.enemies.enemy.attackTime).toBe(.05);
  expect(state.enemies.enemy.yaw).toBe(0);
  state.player.x=2;
  for(let i=0;i<14;i++) stepEncounter(state,.05,idle,castTiming);
  expect(state.projectiles).toHaveLength(0);
  stepEncounter(state,.05,idle,castTiming);
  expect(state.projectiles).toHaveLength(1);
  expect(state.projectiles[0]).toMatchObject({owner:'enemy',kind:'bolt',dx:0,dz:1});
  expect([state.enemies.enemy.x,state.enemies.enemy.z,state.enemies.enemy.yaw]).toEqual([0,0,0]);
  for(let i=0;i<16;i++) stepEncounter(state,.05,idle,castTiming);
  expect(state.enemies.enemy.attackTime).toBe(-1);
  expect(state.enemies.enemy.cooldown).toBeGreaterThan(0);
  expect(state.player.hp).toBe(100);
  for(let i=0;i<32;i++) stepEncounter(state,.05,idle,castTiming);
  expect(state.player.hp).toBe(100);
  resetEncounter(state);
  expect(state.enemies.enemy.kind).toBe('caster');
});

test('damaging a caster during windup prevents the release, and a defeated caster clears its bolts', () => {
  const state=closeEncounter(); state.enemies.enemy.kind='caster'; state.enemies.enemy.attackTime=.4; state.enemies.enemy.cooldown=999;
  const clocks={...timing,enemy:{attack:1.6,hit:.35,contacts:[.8]}};
  attack(state,timing.player,false);
  stepEncounter(state,.43,idle,clocks);
  expect(state.enemies.enemy.hp).toBe(150);
  expect(state.enemies.enemy.attackTime).toBe(-1);
  for(let i=0;i<12;i++) stepEncounter(state,.05,idle,clocks);
  expect(state.projectiles).toEqual([]);
  state.projectiles.push({id:1,owner:'enemy',kind:'bolt',x:8,y:1.08,z:8,dx:1,dz:0,remaining:12});
  attack(state,timing.player,false);
  stepEncounter(state,.43,idle,clocks);
  expect(state.phase).toBe('playing');
  state.enemies.enemy.hp=50;state.player.lock=state.attackCooldown=0;attack(state,timing.player,false);stepEncounter(state,.43,idle,clocks);
  expect(state.phase).toBe('won');expect(state.projectiles).toEqual([]);
});

test('enemy bolts sweep into the player once, stop at terrain, and respect dodge and incoming shield direction', () => {
  const shot = () => {
    const state=closeEncounter(); state.enemies.enemy.kind='caster'; state.enemies.enemy.cooldown=999; state.enemies.enemy.x=4;
    state.projectiles.push({id:1,owner:'enemy',kind:'bolt',x:0,y:1.08,z:2,dx:0,dz:-1,remaining:12});
    return state;
  };
  const clear=shot();
  const events=stepEncounter(clear,.3,idle,timing);
  expect(clear.player.hp).toBe(80); expect(clear.projectiles).toEqual([]);
  expect(events.filter(event=>event.type==='hit' && event.actor==='player')).toHaveLength(1);
  stepEncounter(clear,.3,idle,timing); expect(clear.player.hp).toBe(80);
  const wall=shot();
  const movement: Movement={move:()=>{},direction:()=>({x:0,z:0}),lineOfSight:()=>true,segmentHit:()=>.2};
  stepEncounter(wall,.3,idle,timing,movement);
  expect(wall.player.hp).toBe(100); expect(wall.projectiles).toEqual([]);
  const evaded=shot(); evaded.projectiles[0].z=.6;
  dodge(evaded,{x:0,z:1},false);
  stepEncounter(evaded,.05,idle,timing);
  expect(evaded.player.hp).toBe(100); expect(evaded.projectiles).toEqual([]);
  const front=shot(); front.shield=true;
  stepEncounter(front,.3,{...idle,block:true},timing);
  expect(front.player.hp).toBe(90); expect(front.blocking).toBe(true);
  const rear=shot(); rear.shield=true; rear.player.yaw=Math.PI;
  stepEncounter(rear,.3,{...idle,block:true},timing);
  expect(rear.player.hp).toBe(80); expect(rear.blocking).toBe(false);
});

test('two fights stay independent, with player clocks advancing once', () => {
  const state = createEncounter('playing', {
    boundary: { kind: 'circle', center: [0, 0], radius: 20 },
    player: { position: [0, 0], yaw: 0 },
    enemy: { position: [10, 0], yaw: 0 },
    caster: { position: [-10, 0], yaw: 0 },
  });
  stepEncounter(state, .05, idle, timing);
  expect([state.enemies.enemy.engaged, state.enemies.caster.engaged]).toEqual([false, false]);
  state.player.x = -9;
  stepEncounter(state, .05, idle, timing);
  expect([state.enemies.enemy.engaged, state.enemies.caster.engaged]).toEqual([false, true]);
  state.player.lock = state.attackCooldown = 1;
  stepEncounter(state, .05, idle, timing);
  expect([state.player.lock, state.attackCooldown]).toEqual([.95, .95]);
  resetEncounter(state);
  state.player.x = 9;
  stepEncounter(state, .05, idle, timing);
  expect([state.enemies.enemy.engaged, state.enemies.caster.engaged]).toEqual([true, false]);
  resetEncounter(state);
  state.player.x = -9; state.player.yaw = -Math.PI / 2;
  attack(state, timing.player, false); stepEncounter(state, .43, idle, timing);
  expect([state.enemies.caster.hp, state.enemies.enemy.hp]).toEqual([150, 200]);
  stepEncounter(state, .58, idle, timing);
  attack(state, timing.player, false); stepEncounter(state, .43, idle, timing);
  expect([state.enemies.caster.hp, state.enemies.enemy.hp, state.phase]).toEqual([100, 200, 'playing']);
});

test('raider commitment preserves a late nonlethal swing, allows early/recovery stagger, and never prevents death', () => {
  const clocks: Timings = {...timing,player:{attack:.62,hit:.3,contacts:[.26]},enemy:{attack:1.05,hit:.35,contacts:[.46],commitLead:.16}};
  for (const [clock, committed] of [[.2,false],[.295,true],[.32,true],[.6,false]] as const) {
    const state = closeEncounter(); state.enemies.enemy.yaw=Math.PI;
    state.enemies.enemy.engaged=true; state.enemies.enemy.cooldown=999;
    state.enemies.enemy.attackTime=clock;
    state.player.attackTime=.25; state.player.lock=.4; state.player.yaw=0;
    const events=stepEncounter(state,.02,idle,clocks);
    expect(state.enemies.enemy.hp).toBe(150);
    expect(state.enemies.enemy.attackTime>=0).toBe(committed);
    expect(events.some(e=>e.type==='animation' && e.actor==='enemy' && e.motion==='hit')).toBe(!committed);
    expect(events.filter(e=>e.type==='impact' && e.actor==='enemy')).toHaveLength(1);
    if (committed) {
      stepEncounter(state,.15,idle,clocks);
      expect(state.player.hp).toBe(80);
    }
  }
  const lethal=closeEncounter(); lethal.enemies.enemy.hp=50; lethal.enemies.enemy.attackTime=.32; lethal.enemies.enemy.cooldown=999;
  lethal.player.attackTime=.25; lethal.player.yaw=0;
  const events=stepEncounter(lethal,.02,idle,clocks);
  expect(lethal.enemies.enemy.attackTime).toBe(-1);
  expect(events).toContainEqual({type:'impact',actor:'enemy',weapon:'axe',blocked:false,lethal:true});
  expect(lethal.player.hp).toBe(100);
});

test('a raider swing uses its committed forward arc and stays planted through recovery', () => {
  const clocks: Timings = {...timing,enemy:{attack:1.05,hit:.35,contacts:[.46],commitLead:.16}};
  for (const [angle, expected] of [[0,80],[Math.PI/3-.01,80],[Math.PI/3+.01,100],[Math.PI,100]] as const) {
    const state=closeEncounter(), enemy=state.enemies.enemy;
    enemy.engaged=true; enemy.yaw=0; enemy.attackTime=.44; enemy.cooldown=999;
    state.player.x=enemy.x+Math.sin(angle)*1.5; state.player.z=enemy.z+Math.cos(angle)*1.5;
    const events=stepEncounter(state,.03,idle,clocks);
    expect(state.player.hp).toBe(expected);
    expect(events.filter(e=>e.type==='action' && e.actor==='enemy' && e.action==='contact')).toHaveLength(1);
    expect(stepEncounter(state,.05,idle,clocks).filter(e=>e.type==='action' && e.action==='contact')).toHaveLength(0);
    state.player.x=enemy.x+3;
    const position=[enemy.x,enemy.z,enemy.yaw];
    stepEncounter(state,.3,idle,clocks);
    expect([enemy.x,enemy.z,enemy.yaw]).toEqual(position);
  }
});

test('accepted actions emit sound facts once; rejected attacks and replayed animation states do not', () => {
  const state=closeEncounter(); state.enemies.enemy.cooldown=999; equip(state,'bow');
  const accepted=attack(state,timing.player,false,{x:0,z:10});
  expect(accepted.filter(e=>e.type==='action' && e.action==='attack')).toHaveLength(1);
  expect(attack(state,timing.player,false)).toEqual([]);
  const contact=stepEncounter(state,.43,idle,timing);
  expect(contact.filter(e=>e.type==='action' && e.actor==='player' && e.action==='contact')).toHaveLength(1);
  expect(stepEncounter(state,.1,idle,timing).filter(e=>e.type==='action' && e.action==='contact')).toHaveLength(0);
  expect(resetEncounter(state).filter(e=>e.type==='action' || e.type==='impact')).toHaveLength(0);
});

test('Sword Basic is focused while Sweep covers the forward half-circle with one contact per enemy', () => {
  const layout={boundary:{kind:'circle' as const,center:[0,0] as [number,number],radius:20},player:{position:[0,0] as [number,number],yaw:0},enemy:{position:[1.4,.3] as [number,number],yaw:0},caster:{position:[-1.4,.3] as [number,number],yaw:0}};
  const make=()=>{const state=createEncounter('playing',layout);sets(state,[{main:'sword',off:null},{main:'bow',off:null}]);return state;};
  const clocks={...timing,player:{...timing.player,abilities:{sweep:{attack:.8,contacts:[.38]}}}};
  const basic=make();attack(basic,timing.player,false);stepExploration(basic,.43,idle,undefined,timing);expect([basic.enemies.enemy.hp,basic.enemies.caster.hp]).toEqual([200,200]);
  const sweep=make();useAbility(sweep,'sweep',clocks.player,false);stepExploration(sweep,.4,idle,undefined,clocks);stepExploration(sweep,.05,idle,undefined,clocks);
  expect([sweep.enemies.enemy.hp,sweep.enemies.caster.hp]).toEqual([140,140]);expect(sweep.invulnerability).toBe(0);
});

test('Piercing Shot automatically equips Bow, crosses each enemy once, and stops at terrain', () => {
  const layout={boundary:{kind:'circle' as const,center:[0,0] as [number,number],radius:20},player:{position:[0,0] as [number,number],yaw:0},enemy:{position:[0,2] as [number,number],yaw:0},caster:{position:[0,4] as [number,number],yaw:0}};
  const clocks={...timing,player:{...timing.player,abilities:{'piercing-shot':{attack:1,contacts:[.7]}}}};
  const make=()=>{const state=createEncounter('playing',layout);sets(state,[{main:'sword',off:null},{main:'bow',off:null}]);return state;};
  const state=make();expect(useAbility(state,'piercing-shot',clocks.player,false)).toContainEqual({type:'weaponSet',set:1});
  stepExploration(state,.7,idle,undefined,clocks);for(let i=0;i<10;i++)stepExploration(state,.025,idle,undefined,clocks);
  expect([state.enemies.enemy.hp,state.enemies.caster.hp]).toEqual([146,146]);expect(state.playerMana).toBeCloseTo(77.6);
  const blocked=make();useAbility(blocked,'piercing-shot',clocks.player,false);
  const world={move:()=>{},direction:()=>({x:0,z:0}),lineOfSight:()=>true,segmentHit:(from:{z:number},to:{z:number})=>from.z<3 && to.z>=3 ? (3-from.z)/(to.z-from.z) : null};
  stepExploration(blocked,.7,idle,world,clocks);for(let i=0;i<10;i++)stepExploration(blocked,.025,idle,world,clocks);
  expect([blocked.enemies.enemy.hp,blocked.enemies.caster.hp,blocked.projectiles.length]).toEqual([146,200,0]);
});

test('automatic swaps and repeated slot assignments preserve skill cooldowns and action locks', () => {
  const state=createEncounter('won');sets(state,[{main:'sword',off:'shield'},{main:'bow',off:null}]);
  const clocks={...timing,player:{...timing.player,abilities:{sweep:{attack:.8,contacts:[.38]},'piercing-shot':{attack:1,contacts:[.7]}}}};
  useAbility(state,'sweep',clocks.player,false);const mana=state.playerMana;
  expect(useAbility(state,'piercing-shot',clocks.player,false)).toEqual([]);expect(state.activeSet).toBe(0);expect(state.playerMana).toBe(mana);
  stepExploration(state,.8,idle,undefined,clocks);expect(state.activeSet).toBe(0); // The early request expired.
  useAbility(state,'piercing-shot',clocks.player,false);expect(state.activeSet).toBe(1);expect(state.abilityCooldowns.sweep).toBeCloseTo(4.2);
  stepExploration(state,1,idle,undefined,clocks);swapWeaponSet(state,false);expect(state.activeSet).toBe(0);
  const before=state.playerMana;expect(useAbility(state,'sweep',clocks.player,false)).toEqual([]);expect(state.playerMana).toBe(before);
  const cooldown=state.abilityCooldowns.sweep;stepExploration(state,1,{...idle,paused:true},undefined,clocks);expect(state.abilityCooldowns.sweep).toBe(cooldown);
  state.pending=null;useAbility(state,'shield-basic',clocks.player,false);expect(state.blocking).toBe(true);stepExploration(state,.05,{...idle,block:false},undefined,clocks);expect(state.blocking).toBe(false);
});

test('melee contact reaches an enemy overlapping the player', () => {
  const state = closeEncounter();
  state.enemies.enemy.z = state.player.z;
  state.enemies.enemy.cooldown = 999;
  attack(state,timing.player,false);
  stepEncounter(state,.43,idle,timing);
  expect(state.enemies.enemy.hp).toBe(150);
});

test('dodge immunity is evaluated at contact time within the frame', () => {
  const state = closeEncounter();
  state.enemies.enemy.attackTime = .4;
  state.enemies.enemy.cooldown = 999;
  state.invulnerability = .03;
  stepEncounter(state,.05,idle,timing);
  expect(state.player.hp).toBe(100); // Contact at .02 precedes immunity expiry at .03.
  expect(state.invulnerability).toBe(0);
  state.enemies.enemy.attackTime = .4;
  state.enemies.enemy.contactIndex = 0;
  stepEncounter(state,.05,idle,timing);
  expect(state.player.hp).toBe(80);
  for (const [distance,health] of [[.5,100],[.74,80]] as const) {
    const shot = closeEncounter(); shot.invulnerability = .03; shot.enemies.enemy.lock = 999;
    shot.projectiles.push({id:1,owner:'enemy',kind:'bolt',x:0,y:1.08,z:distance,dx:0,dz:-1,remaining:12});
    stepEncounter(shot,.05,idle,timing);
    expect(shot.player.hp).toBe(health); expect(shot.projectiles).toEqual([]);
  }
});

test('authored weapon choices clear a 200-health enemy in three to five Basic hits', () => {
  for(const [item,hits] of [['axe',4],['sword',4],['iron-broadsword',3],['bow',5],['yew-longbow',4]] as const) {
    const state=closeEncounter();equip(state,item);state.enemies.enemy.cooldown=999;
    for(let strike=0;strike<hits;strike++) {
      attack(state,timing.player,false,{x:0,z:10});
      for(let frame=0;frame<Math.ceil(1/state.stats.attackRate/.05)+3;frame++)stepExploration(state,.05,idle,undefined,timing);
      if(strike<hits-1)expect(state.enemies.enemy.hp).toBeGreaterThan(0);
    }
    expect(state.enemies.enemy.hp).toBe(0);
  }
});

test('armor reduces melee, arrows and magic without turning rear hits into shield blocks', () => {
  for(const kind of ['melee','arrow','bolt'] as const) {
    const state=closeEncounter();
    applyEquipment(state,[{id:'sword',item:'sword',quantity:1,slot:'main',x:0,y:0},{id:'shield',item:'shield',quantity:1,slot:'off',x:0,y:0},{id:'helm',item:'guard-helm',quantity:1,slot:'helmet',x:0,y:0},{id:'mail',item:'weathered-mail',quantity:1,slot:'body',x:0,y:0}],0);
    state.player.yaw=Math.PI;state.enemies.enemy.cooldown=999;
    if(kind==='melee')state.enemies.enemy.attackTime=.4;
    else {state.enemies.enemy.z=9;state.projectiles.push({id:1,owner:'enemy',kind,x:0,y:1.08,z:1,dx:0,dz:-1,remaining:12,damage:20});}
    const events=stepEncounter(state,kind==='melee' ? .03 : .2,{...idle,block:true},timing);
    expect(state.player.hp).toBeCloseTo(100-20*100/120);expect(state.blocking).toBe(false);
    expect(events).toContainEqual({type:'impact',actor:'player',weapon:kind==='melee' ? 'axe' : kind==='arrow' ? 'bow' : 'staff',blocked:false,lethal:false});
    expect(events).toContainEqual({type:'animation',actor:'player',motion:'hit'});
  }
  const front=closeEncounter();applyEquipment(front,[{id:'sword',item:'sword',quantity:1,slot:'main',x:0,y:0},{id:'shield',item:'shield',quantity:1,slot:'off',x:0,y:0},{id:'mail',item:'weathered-mail',quantity:1,slot:'body',x:0,y:0}],0);
  front.enemies.enemy.attackTime=.4;front.enemies.enemy.cooldown=999;stepEncounter(front,.03,{...idle,block:true},timing);expect(front.player.hp).toBeCloseTo(100-20*100/112*.5);expect(front.blocking).toBe(true);
});

test('weapon rate scales contacts and recovery, and a launched arrow keeps its properties across a swap', () => {
  const state=closeEncounter();equip(state,'iron-broadsword');attack(state,timing.player,false);
  expect(state.playerAction!.duration).toBe(1/.8);expect(state.playerAction!.contacts).toEqual([.42/.8]);
  stepExploration(state,.5,idle,undefined,timing);expect(state.enemies.enemy.hp).toBe(200);
  stepExploration(state,.03,idle,undefined,timing);expect(state.enemies.enemy.hp).toBe(130);
  const shot=closeEncounter();sets(shot,[{main:'yew-longbow',off:null},{main:'axe',off:null}]);shot.enemies.enemy.z=12;
  const clocks={...timing,player:{attack:.3,hit:.3,contacts:[.1]}};
  attack(shot,clocks.player,false,{x:0,z:20});stepExploration(shot,.12,idle,undefined,clocks);
  expect(shot.projectiles[0].damage).toBe(60);expect(shot.projectiles[0].remaining).toBeCloseTo(16-(.12-.1/.85)*24);
  stepExploration(shot,.24,idle,undefined,clocks);expect(swapWeaponSet(shot,false)).toContainEqual({type:'weaponSet',set:1});expect(shot.stats.damage).toBe(50);
  stepExploration(shot,.3,idle,undefined,clocks);expect(shot.enemies.enemy.hp).toBe(140);
});

test('buffered skills retain equipped mana capacity and recovery', () => {
  const state = createEncounter('won');
  applyEquipment(state, [
    { id: 'sword', item: 'sword', quantity: 1, slot: 'main', x: 0, y: 0 },
    { id: 'coat', item: 'quilted-coat', quantity: 1, slot: 'body', x: 0, y: 0 },
    { id: 'amulet', item: 'amber-amulet', quantity: 1, slot: 'amulet', x: 0, y: 0 },
  ], 0);
  state.playerMana = 130;
  state.player.lock = state.attackCooldown = .04;
  const clocks = { ...timing, player: { ...timing.player, abilities: { sweep: { attack: .2, contacts: [.1] } } } };
  useAbility(state, 'sweep', clocks.player, false);
  stepExploration(state, .05, idle, undefined, clocks);
  expect(state.playerMana).toBeCloseTo(105.5);
});

test('buffered dodges begin movement and immunity at recovery unlock', () => {
  const state = createEncounter('won');
  state.player.x = state.player.z = 0;
  state.player.lock = .04;
  dodge(state, { x: 1, z: 0 }, false);
  // This bolt reaches the player before recovery unlocks, so the queued dodge cannot evade it.
  state.enemies.caster.hp = 200;
  state.projectiles.push(
    { id: 1, owner: 'caster', kind: 'bolt', x: 0, y: 1, z: .5, dx: 0, dz: -1, remaining: 12 },
    { id: 2, owner: 'caster', kind: 'bolt', x: 0, y: 1, z: .58, dx: 0, dz: -1, remaining: 12 },
  );
  stepExploration(state, .05, idle, undefined, timing);
  expect(state.player.hp).toBe(80);
  expect(state.dodgeRemaining).toBe(0);

  const clear = createEncounter('won');
  clear.player.x = clear.player.z = 0;
  clear.player.lock = .04;
  dodge(clear, { x: 1, z: 0 }, false);
  stepExploration(clear, .05, idle, undefined, timing);
  expect(clear.player.x).toBeCloseTo(dodgeDistance * .01 / .45);
  expect(clear.dodgeRemaining).toBeCloseTo(.44);
  expect(clear.dodgeCooldown).toBeCloseTo(.99);
  expect(clear.invulnerability).toBeCloseTo(.24);

  const later = createEncounter('won');
  later.player.x = later.player.z = 0;
  later.player.lock = .04;
  later.enemies.caster.hp = 200;
  later.projectiles.push({ id: 1, owner: 'caster', kind: 'bolt', x: 0, y: 1, z: .78, dx: 0, dz: -1, remaining: 12 });
  dodge(later, { x: 1, z: 0 }, false);
  stepExploration(later, .05, idle, undefined, timing);
  expect(later.player.hp).toBe(100);
});

test('raider windup begins after its cooldown unlocks within a frame', () => {
  const state = closeEncounter();
  state.enemies.enemy.cooldown = .04;
  const clocks = { ...timing, enemy: { ...timing.enemy, contacts: [.03] } };
  stepEncounter(state, .05, idle, clocks);
  expect(state.player.hp).toBe(100);
  expect(state.enemies.enemy.attackTime).toBeCloseTo(.01);
  stepEncounter(state, .021, idle, clocks);
  expect(state.player.hp).toBe(80);
});

test('caster windup begins after its cooldown unlocks within a frame', () => {
  const state = createEncounter('playing', {
    boundary: { kind: 'circle', center: [0, 0], radius: 20 },
    player: { position: [0, 0], yaw: 0 }, caster: { position: [0, 4], yaw: Math.PI },
  });
  state.enemies.caster.cooldown = .04;
  const clocks = { ...timing, caster: { ...timing.caster, contacts: [.03] } };
  stepEncounter(state, .05, idle, clocks);
  expect(state.projectiles).toHaveLength(0);
  expect(state.enemies.caster.attackTime).toBeCloseTo(.01);
  stepEncounter(state, .021, idle, clocks);
  expect(state.projectiles).toHaveLength(1);
});
