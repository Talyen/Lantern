import { expect, test, vi } from 'vitest';
import homestead from '../src/levels/areas/homestead.json';
import clearing from '../src/levels/areas/clearing.json';
import type { AreaDefinition } from '../src/levels/types';
import { generateGrass, grassCoverage, grassBudget, type GrassPatch } from '../src/levels/grass';
import { GateTravel } from '../src/gameplay/area';
import { inReserved, validateAreas } from '../src/levels/validation';
import { standingTreeAsset, treeDefinitions, traversalWithTrees } from '../src/levels/trees';
import { Harvesting } from '../src/gameplay/harvesting';
const areas = { homestead, clearing } as unknown as Record<string, AreaDefinition>;
// Exercise grass rules without repeatedly generating an authored area's full carpet.
const grassArea: AreaDefinition = {
  version: 1, id: 'fixture', name: 'Fixture', kind: 'safe', seed: 42,
  envelope: { width: 40, depth: 40, apron: 0, yaw: 0, reference: { width: 1920, height: 1080, zoom: 1 }, screen: [20, 20] },
  scatter: [], lighting: {}, effects: { water: [], fires: [] },
  views: ['entrance', 'center', 'exit', 'review-1', 'review-2'].map(id => ({ id, target: [0, 0, 0] })),
  layout: { boundary: { kind: 'circle', center: [0, 0], radius: 15 }, player: { position: [0, 0], yaw: 0 } },
  props: [], gates: [], traversal: { obstacles: [] },
  reserved: [{ id: 'route', center: [0, 0], radius: .5, role: 'route' }],
};
const grassPatch: GrassPatch = { id: 'grass', center: [0, 0], radii: [2, 2], yaw: 0, density: 8 };

test('grass is repeatable and leaves reserved routes clear', () => {
  const patches = [grassPatch], props = generateGrass(grassArea, patches);
  expect(props).toEqual(generateGrass(grassArea, patches));
  expect(props.length).toBeGreaterThan(0);
  expect(props.some(p => inReserved(grassArea, [p.x, p.z], .35) || grassCoverage(grassArea, patches, p.x, p.z) === 0)).toBe(false);
  expect(grassCoverage(grassArea, patches, 0, 0)).toBe(0);
});

test('grass keeps its hard budget when a bounded patch exceeds capacity', () => {
  expect(generateGrass(grassArea, [{ ...grassPatch, radii: [8, 8], density: 400 }]).length).toBe(grassBudget);
});

test('area validation rejects invalid grass, links, transforms and lighting', () => {
  const area = structuredClone(grassArea);
  area.grass = [structuredClone(grassPatch)];
  area.props = [{ id: 'marker', position: [4, 0, 4], yaw: 0, scale: [1, 1, 1], primitive: { kind: 'box', size: [1, 1, 1], color: '#514031' }, castShadow: false, receiveShadow: false }];
  area.gates = [{ id: 'gate', role: 'branch', position: [10, 0], yaw: 0, width: 2, depth: 2, arrival: { position: [7, 0], yaw: 0 }, destination: { area: area.id, gate: 'gate' } }];
  expect(validateAreas({ fixture: area })).toEqual([]);
  area.grass[0].density = NaN;
  area.gates[0].destination.gate = 'missing'; area.props[0].position[0] = NaN;
  area.lighting.overrides = { fogNear: NaN, probes: { size: [36, -1, 36] } };
  const errors = validateAreas({ fixture: area }).join('\n');
  for (const error of ['invalid grass patch', 'broken link', 'invalid transform', 'invalid lighting', 'invalid irradiance probes']) expect(errors).toContain(error);
  area.lighting = { background: '#000000' } as unknown as AreaDefinition['lighting'];
  expect(validateAreas({ fixture: area }).join('\n')).toContain('shared Golden preset');
});
test('arrival gate cannot immediately send the player back until its trigger is left', () => {
  const gate=areas.clearing.gates[0], travel=new GateTravel();
  travel.arrive(gate.id);
  expect(travel.check([gate],gate.position)).toBeUndefined();
  expect(travel.check([gate],gate.arrival.position)).toBeUndefined();
  expect(travel.check([gate],gate.position)?.id).toBe(gate.id);
});

test('all standing trees retain harvest identity and three chop contacts regrow across travel with safe occupancy', () => {
  const home = treeDefinitions(areas.homestead), clearingTrees = treeDefinitions(areas.clearing);
  expect(home.length).toBeGreaterThan(0); expect(clearingTrees.length).toBeGreaterThan(0);
  expect(traversalWithTrees(areas.clearing).obstacles.filter(o => o.tree).map(o => o.id).sort()).toEqual(clearingTrees.map(t => t.id).sort());
  for (const url of ['/vendor/synty/environment/pine.glb', '/vendor/synty/environment/sm-gen-env-tree-pine-01.glb']) expect(standingTreeAsset({ url })).toBe(true);
  for (const libraryId of ['woodland:model:sm-env-tree-stump-01', 'woodland:model:sm-generic-treestump-01', 'woodland:model:sm-env-tree-fallen-01', 'woodland:model:sm-env-bush-01', 'woodland:model:sm-prop-tree-bush-01']) expect(standingTreeAsset({ libraryId })).toBe(false);
  const generated = structuredClone(grassArea);
  generated.reserved = []; generated.gates = [];
  generated.scatter = [{ id: 'trees', count: 4, radius: [2,5], primitive: { kind: 'cylinder', size: [.3,.4,3], color: '#514031' }, harvest: { kind: 'tree', radius: .3 }, excludedIds: [] }];
  expect(treeDefinitions(generated).map(t => t.id)).toEqual(['trees-0','trees-1','trees-2','trees-3']);
  const harvesting = new Harvesting(), tree = clearingTrees[2], point: [number, number] = [tree.position[0] + tree.radius + 1, tree.position[2]];
  harvesting.register('clearing', clearingTrees); harvesting.register('homestead', home);
  expect(harvesting.nearest('clearing', point)?.id).toBe(tree.id);
  expect(harvesting.contact('clearing', tree.id, [100,100])).toBeUndefined();
  expect(harvesting.contact('clearing', tree.id, point)).toEqual({ item: 'wood', quantity: 1, skill: 'woodcutting', xpPerUnit: 10, felled: false });
  harvesting.contact('clearing', tree.id, point);
  expect(harvesting.contact('clearing', tree.id, point)).toEqual({ item: 'wood', quantity: 1, skill: 'woodcutting', xpPerUnit: 10, felled: true });
  expect(harvesting.contact('clearing', tree.id, point)).toBeUndefined();
  harvesting.register('clearing', clearingTrees); // Reloading geometry keeps session depletion.
  expect(harvesting.advance(0)).toEqual([]); // Menus submit no gameplay time.
  expect(harvesting.advance(119, [{ areaId: 'homestead', position: [0,0] }])).toEqual([]);
  expect(harvesting.advance(1, [{ areaId: 'clearing', position: [tree.position[0],tree.position[2]] }])).toEqual([]);
  expect(harvesting.advance(.05, [{ areaId: 'clearing', position: point }])).toEqual([{ areaId: 'clearing', id: tree.id, felled: false }]);
  expect(harvesting.state('clearing', tree.id)).toEqual({ hits: 0, felled: false });
  expect(new Harvesting().state('clearing', tree.id)).toBeUndefined();
});

test('felling removes trunk collision and enemy detours, and regrowth restores both', async () => {
  const { MovementWorld } = await import('../src/gameplay/movement');
  const { createEncounter } = await import('../src/gameplay/encounter');
  const boundary = { kind: 'polygon' as const, points: [[-4,-4],[4,-4],[4,4],[-4,4]] as [number, number][] };
  const world = await MovementWorld.create(boundary, { obstacles: [{ id: 'tree', tree: true, position: [0,1,0], size: [1,2,1], yaw: 0 }] });
  const state = createEncounter('playing', { boundary, player: { position: [-2,0], yaw: 0 }, enemy: { position: [2,0], yaw: 0 } });
  try {
    expect(world.lineOfSight(state.player, state.enemies.enemy)).toBe(false);
    expect(world.segmentHit({ x: -2, y: .9, z: 0 }, { x: 2, y: .9, z: 0 })).toBeCloseTo(.375);
    expect(world.segmentHit({ x: -2, y: 3, z: 0 }, { x: 2, y: 3, z: 0 })).toBeNull();
    expect(Math.abs(world.direction(state.player,state.enemies.enemy,.05).z)).toBeGreaterThan(.3);
    for (let i = 0; i < 40; i++) world.move('player',state.player,.1,0,.05);
    expect(state.player.x).toBeLessThan(-.7);
    world.setTreeFelled('tree',true); state.player.x = -2;
    expect(world.lineOfSight(state.player,state.enemies.enemy)).toBe(true);
    expect(world.segmentHit({ x: -2, y: .9, z: 0 }, { x: 2, y: .9, z: 0 })).toBeNull();
    expect(Math.abs(world.direction(state.player,state.enemies.enemy,.05).z)).toBeLessThan(.05);
    for (let i = 0; i < 40; i++) world.move('player',state.player,.1,0,.05);
    expect(state.player.x).toBeGreaterThan(1.8);
    world.setTreeFelled('tree',false); state.player.x = -2;
    expect(world.lineOfSight(state.player,state.enemies.enemy)).toBe(false);
    expect(Math.abs(world.direction(state.player,state.enemies.enemy,.05).z)).toBeGreaterThan(.3);
  } finally { world.dispose(); }
});


test('resource level and skill XP drive contact yields without changing depletion or facing selection',async()=>{
  const {resourceDefinitions}=await import('../src/levels/resources');const {levelXp,skillLevel}=await import('../src/gameplay/skills');
  const resources=resourceDefinitions(areas.clearing),node=resources.find(n=>n.kind==='stone')!,harvest=new Harvesting();harvest.register('clearing',resources);
  const point:[number,number]=[node.position[0],node.position[2]+node.radius+1];
  expect(harvest.facing('clearing',point,Math.PI)?.id).toBe(node.id);expect(harvest.facing('clearing',point,0)?.id).not.toBe(node.id);
  expect(skillLevel(levelXp(5))).toBe(5);expect(harvest.contact('clearing',node.id,point,levelXp(5))?.quantity).toBe(2);
  expect(harvest.contact('clearing',node.id,point,levelXp(9))?.quantity).toBe(3);harvest.contact('clearing',node.id,point);expect(harvest.contact('clearing',node.id,point)).toBeUndefined();
});


test('area candidates retain the active area and release failed, superseded and rejected preparations once', async () => {
  const { prepareAreaCandidate } = await import('../src/clearing/area-candidate');
  type Area = Awaited<ReturnType<typeof import('../src/levels/builder').buildArea>>;
  type World = import('../src/gameplay/movement').MovementWorld;
  type Lighting = import('../src/rendering/area-lighting').PreparedLighting;
  const active = { dispose: vi.fn() };
  const resources = () => ({area:{dispose:vi.fn()} as unknown as Area,movement:{dispose:vi.fn()} as unknown as World,lighting:{release:vi.fn()} as unknown as Lighting});
  const failed = resources();
  await expect(prepareAreaCandidate(async()=>failed.area,async()=>failed.movement,async()=>{throw Error('lighting failed');})).rejects.toThrow('lighting failed');
  expect(failed.area.dispose).toHaveBeenCalledTimes(1); expect(failed.movement.dispose).toHaveBeenCalledTimes(1);
  const navigationFailure = resources();
  await expect(prepareAreaCandidate(async()=>navigationFailure.area,async()=>{throw Error('navigation failed');},async()=>navigationFailure.lighting)).rejects.toThrow('navigation failed');
  expect(navigationFailure.area.dispose).toHaveBeenCalledTimes(1);
  for (const eligibility of [()=>false,()=>{throw Error('eligibility failed');}]) {
    const candidate = resources(), prepared = await prepareAreaCandidate(async()=>candidate.area,async()=>candidate.movement,async()=>candidate.lighting);
    try { expect(prepared.accept(eligibility,()=>active.dispose())).toBe(false); } catch (error) { expect(String(error)).toContain('eligibility failed'); }
    prepared.dispose(); expect(candidate.area.dispose).toHaveBeenCalledTimes(1); expect(candidate.movement.dispose).toHaveBeenCalledTimes(1); expect(candidate.lighting.release).toHaveBeenCalledTimes(1);
  }
  const candidate = resources(), prepared = await prepareAreaCandidate(async()=>candidate.area,async()=>candidate.movement,async()=>candidate.lighting);
  expect(()=>prepared.accept(()=>true,()=>{throw Error('repair failed');})).toThrow('repair failed');
  prepared.dispose(); expect(candidate.area.dispose).toHaveBeenCalledTimes(1); expect(candidate.movement.dispose).toHaveBeenCalledTimes(1); expect(candidate.lighting.release).toHaveBeenCalledTimes(1);
  expect(active.dispose).not.toHaveBeenCalled();
  const accepted = resources(), committed = await prepareAreaCandidate(async()=>accepted.area,async()=>accepted.movement,async()=>accepted.lighting);
  expect(committed.accept(()=>true,()=>{})).toBe(true); committed.dispose();
  expect(accepted.area.dispose).not.toHaveBeenCalled(); expect(accepted.movement.dispose).not.toHaveBeenCalled(); expect(accepted.lighting.release).not.toHaveBeenCalled();
});

test('early area construction failure releases allocated geometry and material', async () => {
  const THREE = await import('three');
  const { buildArea } = await import('../src/levels/builder');
  const geometry = vi.spyOn(THREE.BufferGeometry.prototype,'dispose'), material = vi.spyOn(THREE.Material.prototype,'dispose');
  try {
    const area = structuredClone(grassArea); area.grass=[]; area.effects={...area.effects,fires:[],portals:[]}; area.scatter=[];
    area.props=[{id:'broken-tree',primitive:{kind:'box',size:[0,0,0],color:'#514031'},harvest:{kind:'tree',radius:.3},position:[0,0,0],yaw:0,height:1,scale:[1,1,1],castShadow:true,receiveShadow:true}];
    await expect(buildArea(area)).rejects.toThrow('model has no visible height');
    expect(geometry).toHaveBeenCalled(); expect(material).toHaveBeenCalled();
  } finally { geometry.mockRestore(); material.mockRestore(); }
});
