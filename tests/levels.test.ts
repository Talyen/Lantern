import { expect, test } from 'vitest';
import homestead from '../src/levels/areas/homestead.json';
import clearing from '../src/levels/areas/clearing.json';
import movementTrial from '../src/levels/areas/movement-trial.json';
import blockout from '../src/levels/areas/blockout.json';
import type { LightingRecipe } from '../src/levels/lighting';
import type { AreaDefinition } from '../src/levels/types';
import { generateGrass, grassCoverage, grassBudget } from '../src/levels/grass';
import { GateTravel } from '../src/gameplay/area';
import { generateDecoration, inReserved, validateAreas } from '../src/levels/validation';
import { standingTreeAsset, treeDefinitions, traversalWithTrees } from '../src/levels/trees';
import { Harvesting } from '../src/gameplay/harvesting';
const areas = { homestead, clearing, blockout, 'movement-trial': movementTrial } as unknown as Record<string, AreaDefinition>;
test('connected areas validate, decoration is repeatable and reserved routes stay clear', () => {
  expect(validateAreas(areas)).toEqual([]);
  const props = generateGrass(areas.homestead, areas.homestead.grass!);
  expect(props).toEqual(generateGrass(areas.homestead, areas.homestead.grass!));
  expect(props.length).toBeGreaterThan(0);
  expect(props.length).toBeLessThanOrEqual(grassBudget);
  expect(props.some(p => inReserved(areas.homestead, [p.x, p.z], .35) || grassCoverage(areas.homestead, areas.homestead.grass!, p.x, p.z) === 0)).toBe(false);
  expect(Object.values(areas).flatMap(a => generateDecoration(a)).filter(p => ['grass', 'pebble'].includes(p.primitive!.kind))).toEqual([]);
  expect(grassCoverage(areas.homestead, areas.homestead.grass!, -2, 1)).toBe(0);
  const dense = areas.homestead.grass!.map(p => ({ ...p, density: 400 }));
  expect(generateGrass(areas.homestead, dense).length).toBe(grassBudget);
  const broken = structuredClone(areas);
  broken.homestead.grass![0].density = NaN;
  expect(validateAreas(broken).join('\n')).toMatch(/invalid grass patch/);
  broken.blockout.gates[0].destination.gate='missing'; broken.blockout.props[0].position[0]=NaN;
  expect(validateAreas(broken).join('\n')).toMatch(/broken link/);
  expect(validateAreas(broken).join('\n')).toMatch(/invalid transform/);
  (broken.homestead.lighting as LightingRecipe).overrides = { environment: { intensity: NaN }, probes: { size: [36, -1, 36] } };
  expect(validateAreas(broken).join('\n')).toMatch(/invalid environment lighting/);
  expect(validateAreas(broken).join('\n')).toMatch(/invalid irradiance probes/);
});
test('arrival gate cannot immediately send the player back until its trigger is left', () => {
  const gate=areas.clearing.gates[0], travel=new GateTravel();
  travel.arrive(gate.id);
  expect(travel.check([gate],gate.position)).toBeUndefined();
  expect(travel.check([gate],gate.arrival.position)).toBeUndefined();
  expect(travel.check([gate],gate.position)?.id).toBe(gate.id);
});

test('lighting commits only successful entries and retains mood for retry or hot reload', async () => {
  const { EnvironmentMood } = await import('../src/levels/environment-lighting');
  let roll = .1, selections = 0;
  const mood = new EnvironmentMood(() => { selections++; return roll; });
  mood.commit(mood.choose());
  expect(mood.mode).toBe('golden');
  roll = .9;
  const failedDestination = mood.choose();
  expect(failedDestination).toBe('silver');
  expect(mood.mode).toBe('golden');
  expect(mood.choose(true)).toBe('golden');
  expect(selections).toBe(2);
  mood.commit(mood.choose());
  expect(mood.mode).toBe('silver');
  expect(mood.choose(true)).toBe('silver');
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
  expect(harvesting.contact('clearing', tree.id, point)).toEqual({ wood: 1, xp: 10, felled: false });
  harvesting.contact('clearing', tree.id, point);
  expect(harvesting.contact('clearing', tree.id, point)).toEqual({ wood: 1, xp: 10, felled: true });
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
    expect(world.lineOfSight(state.player, state.enemy)).toBe(false);
    expect(world.segmentHit({ x: -2, y: .9, z: 0 }, { x: 2, y: .9, z: 0 })).toBeCloseTo(.375);
    expect(world.segmentHit({ x: -2, y: 3, z: 0 }, { x: 2, y: 3, z: 0 })).toBeNull();
    expect(Math.abs(world.direction(state.player,state.enemy,.05).z)).toBeGreaterThan(.3);
    for (let i = 0; i < 40; i++) world.move('player',state.player,.1,0,.05);
    expect(state.player.x).toBeLessThan(-.7);
    world.setTreeFelled('tree',true); state.player.x = -2;
    expect(world.lineOfSight(state.player,state.enemy)).toBe(true);
    expect(world.segmentHit({ x: -2, y: .9, z: 0 }, { x: 2, y: .9, z: 0 })).toBeNull();
    expect(Math.abs(world.direction(state.player,state.enemy,.05).z)).toBeLessThan(.05);
    for (let i = 0; i < 40; i++) world.move('player',state.player,.1,0,.05);
    expect(state.player.x).toBeGreaterThan(1.8);
    world.setTreeFelled('tree',false); state.player.x = -2;
    expect(world.lineOfSight(state.player,state.enemy)).toBe(false);
    expect(Math.abs(world.direction(state.player,state.enemy,.05).z)).toBeGreaterThan(.3);
  } finally { world.dispose(); }
});
