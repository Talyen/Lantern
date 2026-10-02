import { expect, test } from 'vitest';
import homestead from '../src/levels/areas/homestead.json';
import clearing from '../src/levels/areas/clearing.json';
import movementTrial from '../src/levels/areas/movement-trial.json';
import blockout from '../src/levels/areas/blockout.json';
import type { AreaDefinition } from '../src/levels/types';
import { generateGrass, grassCoverage, grassBudget, type GrassPatch } from '../src/levels/grass';
import { GateTravel } from '../src/gameplay/area';
import { inReserved, validateAreas } from '../src/levels/validation';
import { standingTreeAsset, treeDefinitions, traversalWithTrees } from '../src/levels/trees';
import { Harvesting } from '../src/gameplay/harvesting';
const areas = { homestead, clearing, blockout, 'movement-trial': movementTrial } as unknown as Record<string, AreaDefinition>;
// Exercise grass rules without repeatedly generating an authored area's full carpet.
const grassArea: AreaDefinition = {
  ...areas.homestead, seed: 42,
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
  const broken = structuredClone(areas);
  broken.homestead.grass![0].density = NaN;
  expect(validateAreas(broken).join('\n')).toMatch(/invalid grass patch/);
  broken.blockout.gates[0].destination.gate='missing'; broken.blockout.props[0].position[0]=NaN;
  expect(validateAreas(broken).join('\n')).toMatch(/broken link/);
  expect(validateAreas(broken).join('\n')).toMatch(/invalid transform/);
  broken.homestead.lighting.overrides = { fogNear: NaN, probes: { size: [36, -1, 36] } };
  expect(validateAreas(broken).join('\n')).toMatch(/invalid lighting/);
  expect(validateAreas(broken).join('\n')).toMatch(/invalid irradiance probes/);
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
  expect(home.length).toBeGreaterThan(0); expect(clearingTrees.some(t => t.id === 'pine-0')).toBe(true); expect(clearingTrees.some(t => t.id === 'pine-16')).toBe(true);
  expect(traversalWithTrees(areas.clearing).obstacles.filter(o => o.tree).map(o => o.id).sort()).toEqual(clearingTrees.map(t => t.id).sort());
  for (const url of ['/vendor/synty/environment/pine.glb', '/vendor/synty/environment/sm-gen-env-tree-pine-01.glb']) expect(standingTreeAsset({ url })).toBe(true);
  for (const libraryId of ['woodland:model:sm-env-tree-stump-01', 'woodland:model:sm-generic-treestump-01', 'woodland:model:sm-env-tree-fallen-01', 'woodland:model:sm-env-bush-01', 'woodland:model:sm-prop-tree-bush-01']) expect(standingTreeAsset({ libraryId })).toBe(false);
  const generated = structuredClone(areas.blockout);
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
