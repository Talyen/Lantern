import graveyardRuins from '../src/levels/areas/graveyard-ruins.json';
import graveyardCrypt from '../src/levels/areas/graveyard-crypt.json';
import type { WorldInteraction } from '../src/clearing/world-interactions';
import type { Object3D } from 'three';
import type { MovementWorld as MovementWorldType } from '../src/gameplay/movement';
import type { NavigationGeometry } from '../src/gameplay/navigation';
import type { NavMesh } from 'navcat';
import type { buildArea as BuildArea } from '../src/levels/builder';
import type { PreparedLighting } from '../src/rendering/area-lighting';
import { expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { AssetLibrary, type AssetCatalog, type LibraryAsset } from '../src/assets/asset-library';
import { isMesh } from '../src/assets/resource-ownership';
import homestead from '../src/levels/areas/homestead.json';
import clearing from '../src/levels/areas/clearing.json';
import type { AreaDefinition } from '../src/levels/types';
import { type GrassPatch } from '../src/levels/grass';
import { GateTravel } from '../src/gameplay/area';
import { validateAreas } from '../src/levels/validation';
import { treeDefinitions, traversalWithTrees } from '../src/levels/trees';
import { Harvesting } from '../src/gameplay/harvesting';
import type { GatheringTools } from '../src/rendering/gathering-tools';
import type { GameAudio } from '../src/audio/audio';
import type { MovementWorld } from '../src/gameplay/movement';
const areas = { homestead, clearing, 'graveyard-ruins':graveyardRuins, 'graveyard-crypt':graveyardCrypt } as unknown as Record<string, AreaDefinition>;
// Small area fixture for validation; no full authored scenery is needed.
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

test('click approach finishes the last step into interaction range before discarding its route', async () => {
  const { ClickApproach } = await import('../src/clearing/click-approach');
  const { Adventure } = await import('../src/gameplay/adventure');
  const { createEncounter } = await import('../src/gameplay/encounter');
  const encounter = createEncounter('playing', { ...grassArea.layout, player: { position: [0, -1.085], yaw: 0 } });
  const resource = { id: 'tree', kind: 'tree' as const, position: [0, 0, 0] as [number, number, number], radius: .225, level: 1, baseYield: 1, contacts: 3 };
  const target: WorldInteraction = {
    key: 'resource/tree', name: 'Chop', type: 'resource', resource, position: [0, 0],
    range: 1.075, height: 0, obstacleId: 'tree', object: {} as Object3D,
  };
  const navigation = {
    navigationReady: true, interactionPath: () => [[0, -.914]], interactionVisible: () => true,
  } as unknown as MovementWorldType;
  const approach = new ClickApproach(new Adventure(), encounter), interact = vi.fn();
  const frame = { movement: { x: 0, z: 0 }, block: false, navigation, targets: () => [target], error: () => '', interact };
  approach.selectWorld(target, navigation);
  expect(approach.update(.05, frame)?.movement.z).toBeGreaterThan(.1);
  expect(interact).not.toHaveBeenCalled();
  encounter.player.z = -1.06;
  approach.update(.05, frame);
  expect(interact).toHaveBeenCalledExactlyOnceWith(target);
  expect(approach.worldKey).toBeNull();
});

// Retain session depletion/reload/occupancy protection without tying it to a shipped pine's array index.
test('depleted resources survive registration and renew only when unoccupied', () => {
  const tree = { id: 'tree', position: [0, 0, 0] as [number, number, number], radius: .25 };
  const harvesting = new Harvesting(), point: [number, number] = [1.25, 0];
  harvesting.register('clearing', [tree]);
  harvesting.register('homestead', [tree]);
  expect(harvesting.contact('clearing', tree.id, [100, 100])).toBeUndefined();
  for (let hit = 0; hit < 3; hit++) harvesting.contact('clearing', tree.id, point);
  harvesting.register('clearing', [tree]);
  expect(harvesting.contact('clearing', tree.id, point)).toBeUndefined();
  expect(harvesting.advance(0)).toEqual([]);
  expect(harvesting.advance(2699)).toEqual([]);
  expect(harvesting.advance(1, [{ areaId: 'clearing', position: [0, 0] }])).toEqual([]);
  expect(harvesting.advance(.5, [{ areaId: 'homestead', position: [0, 0] }])).toEqual([{ areaId: 'clearing', id: tree.id, felled: false }]);
  expect(harvesting.contact('clearing', tree.id, point)?.felled).toBe(false);
  harvesting.contact('clearing', tree.id, point);
  harvesting.contact('clearing', tree.id, point);
  harvesting.reset();
  expect(harvesting.state('clearing', tree.id)).toEqual({ hits: 0, felled: false });
});

test('felling removes trunk collision and enemy detours, and regrowth restores both', async () => {
  const { MovementWorld } = await import('../src/gameplay/movement');
  const { createEncounter } = await import('../src/gameplay/encounter');
  const boundary = { kind: 'polygon' as const, points: [[-4,-4],[4,-4],[4,4],[-4,4]] as [number, number][] };
  const world = await MovementWorld.create(boundary, { obstacles: [{ id: 'tree', tree: true, position: [0,1,0], size: [1,2,1], yaw: 0 }] });
  const state = createEncounter('playing', { boundary, player: { position: [-2,0], yaw: 0 }, enemy: { position: [2,0], yaw: 0 } });
  try {
    expect(world.lineOfSight(state.player, state.enemies.enemy)).toBe(false);
    expect(world.resourceVisible(state.player, 'tree', { x: 0, y: 0, z: 0 })).toBe(true);
    expect(world.resourceVisible(state.player, 'other', { x: 0, y: 0, z: 0 })).toBe(false);
    expect(world.interactionVisible(state.player, [0, 0], 0, 'tree')).toBe(true);
    expect(world.interactionVisible(state.player, [0, 0], 0, 'other')).toBe(false);
    expect(world.pickupReachable(state.player, [-1, 0], 0, 1.65)).toBe(true);
    expect(world.pickupReachable(state.player, [2, 0], 0, 1.65)).toBe(false);
    const divider = await MovementWorld.create(boundary, { obstacles: [{ id: 'wall', position: [0,.8,0], size: [.1,1.6,8], yaw: 0 }] });
    try {
      const from = { ...state.player, x: -.5, z: 0 };
      expect(divider.pickupReachable(from, [-.6, 0], 0, 1.65)).toBe(true);
      expect(divider.pickupPath(from, [.1, 0], 0)).toBeNull();
      expect(divider.pickupReachable(from, [.1, 0], 0, 1.65)).toBe(false);
    } finally { divider.dispose(); }
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
    // Browser updates commit collision before the worker's coalesced route
    // snapshot; old replies cannot make pickup/pursuit use stale navigation.
    type Request = { revision: number; geometry: NavigationGeometry };
    class WorkerStub {
      static instance: WorkerStub;
      onmessage?: (event: { data: { revision: number; nav: NavMesh } }) => void;
      postMessage = vi.fn<(request: Request) => void>();
      terminate = vi.fn();
      constructor() { WorkerStub.instance = this; }
    }
    vi.stubGlobal('Worker', WorkerStub);
    world.setTreeFelled('tree', true);
    expect(world.lineOfSight(state.player,state.enemies.enemy)).toBe(true);
    world.setTreeFelled('tree', false);
    expect(world.lineOfSight(state.player,state.enemies.enemy)).toBe(false);
    const worker = WorkerStub.instance;
    expect(world.navigationReady).toBe(false);
    expect(world.pickupReachable(state.player, [-1, 0], 0, 1.65)).toBe(false);
    await Promise.resolve();
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    const request = worker.postMessage.mock.calls[0][0];
    const { buildNavigation } = await import('../src/gameplay/navigation');
    const nav = buildNavigation(request.geometry);
    worker.onmessage!({data:{revision:request.revision-1,nav}});
    expect(world.navigationReady).toBe(false);
    worker.onmessage!({data:{revision:request.revision,nav}});
    expect(world.navigationReady).toBe(true);
    expect(Math.abs(world.direction(state.player,state.enemies.enemy,.05).z)).toBeGreaterThan(.3);
    world.setTreeFelled('tree', true); world.dispose();
    await Promise.resolve();
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  } finally { world.dispose(); vi.unstubAllGlobals(); }
});


test('gathering retries after attack cooldown and cancels a newly pursuing threat before contact', async () => {
  const THREE = await import('three');
  const { GatheringController } = await import('../src/clearing/gathering');
  const { makeActor } = await import('../src/clearing/actors');
  const { createEncounter } = await import('../src/gameplay/encounter');
  const { Adventure } = await import('../src/gameplay/adventure');
  const state = createEncounter('playing', grassArea.layout), adventure = new Adventure();
  adventure.enter(state,grassArea);
  const node = {id:'tree',kind:'tree' as const,position:[0,0,1] as [number,number,number],radius:.2,level:1,baseYield:1,contacts:3};
  const harvesting = new Harvesting(); harvesting.register(grassArea.id,[node]);
  const actor = makeActor(new THREE.Scene(),state.player);
  actor.mixer = new THREE.AnimationMixer(actor.root);
  actor.actions.chop = actor.mixer.clipAction(new THREE.AnimationClip('chop',1,[]));
  const tools = {show:vi.fn()} as unknown as GatheringTools;
  const audio = {play:vi.fn()} as unknown as GameAudio;
  const navigation = {resourceVisible:()=>true} as unknown as MovementWorld;
  const gathering = new GatheringController(state,adventure,harvesting,actor,tools,audio,{area:()=>grassArea,instance:()=>undefined,navigation:()=>navigation,paused:()=>false});
  state.attackCooldown = .1;
  gathering.select(node); expect(gathering.choppingId).toBeNull();
  state.attackCooldown = 0;
  gathering.advance(.05); gathering.advance(.35);
  expect(gathering.choppingId).toBe('tree');
  expect(adventure.session().drops.map(drop=>[drop.item,drop.quantity])).toEqual([['wood',1]]);
  gathering.cancel();
  const unsafeArea = { ...grassArea, kind: 'encounter' as const };
  const threatened = new GatheringController(state,adventure,harvesting,actor,tools,audio,{area:()=>unsafeArea,instance:()=>undefined,navigation:()=>navigation,paused:()=>false});
  for (const enemy of Object.values(state.enemies)) { enemy.engaged = false; enemy.x = 30; enemy.z = 30; }
  threatened.select(node);
  Object.assign(state.enemies[state.enemyIds[0]], { hp: 200, home: { position: [30, 30], yaw: 0 }, engaged: true });
  const drops = adventure.session().drops.length;
  threatened.advance(.35);
  expect(adventure.session().drops).toHaveLength(drops);
  expect(threatened.target).toBeNull();
  actor.mixer.stopAllAction();
});


test('area candidates retain the active area and release failed, superseded and rejected preparations once', async () => {
  const { prepareAreaCandidate } = await import('../src/clearing/area-candidate');
  type Area = Awaited<ReturnType<typeof BuildArea>>;
  type World = MovementWorldType;
  type Lighting = PreparedLighting;
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
    try { expect(prepared.accept(eligibility,()=>{ active.dispose(); })).toBe(false); } catch (error) { expect(String(error)).toContain('eligibility failed'); }
    prepared.dispose(); expect(candidate.area.dispose).toHaveBeenCalledTimes(1); expect(candidate.movement.dispose).toHaveBeenCalledTimes(1); expect(candidate.lighting.release).toHaveBeenCalledTimes(1);
  }
  const candidate = resources(), prepared = await prepareAreaCandidate(async()=>candidate.area,async()=>candidate.movement,async()=>candidate.lighting);
  expect(()=>prepared.accept(()=>true,()=>{throw Error('repair failed');})).toThrow('repair failed');
  prepared.dispose(); expect(candidate.area.dispose).toHaveBeenCalledTimes(1); expect(candidate.movement.dispose).toHaveBeenCalledTimes(1); expect(candidate.lighting.release).toHaveBeenCalledTimes(1);
  expect(prepared.accept(() => true, () => active.dispose())).toBe(false);
  expect(active.dispose).not.toHaveBeenCalled();
  const accepted = resources(), committed = await prepareAreaCandidate(async()=>accepted.area,async()=>accepted.movement,async()=>accepted.lighting);
  expect(committed.accept(()=>true,()=>{})).toBe(true); committed.dispose();
  expect(committed.accept(() => true, () => active.dispose())).toBe(false);
  expect(active.dispose).not.toHaveBeenCalled();
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

test('released mesh instances free native bindings while retaining shared art', async () => {
  const THREE = await import('three');
  const { disposeSceneInstances } = await import('../src/assets/resource-ownership');
  const geometry = new THREE.BoxGeometry(), texture = new THREE.Texture();
  const material = new THREE.MeshBasicMaterial({ map: texture });
  const root = new THREE.Group(), mesh = new THREE.Mesh(geometry, material);
  const survivor = new THREE.Mesh(geometry, material);
  const skin = new THREE.SkinnedMesh(geometry, material); skin.skeleton = new THREE.Skeleton();
  const skeleton = vi.spyOn(skin.skeleton, 'dispose');
  const nativeBinding = vi.fn(), sharedArt = vi.fn();
  mesh.addEventListener('dispose', nativeBinding);
  geometry.addEventListener('dispose', sharedArt); material.addEventListener('dispose', sharedArt); texture.addEventListener('dispose', sharedArt);
  root.add(mesh, skin); disposeSceneInstances(root);
  expect(nativeBinding).toHaveBeenCalledTimes(1);
  expect(sharedArt).not.toHaveBeenCalled();
  expect(skeleton).not.toHaveBeenCalled();
  expect(survivor.geometry).toBe(geometry); expect(survivor.material.map).toBe(texture);
  disposeSceneInstances(skin, { skeletons: true }); expect(skeleton).toHaveBeenCalledTimes(1);
  geometry.dispose(); material.dispose(); texture.dispose();
});

// Admission: releasing a shared skeleton twice can invalidate native bindings during area cleanup.
test('scene cleanup releases each shared skeleton and art resource once', async () => {
  const { disposeSceneResources } = await import('../src/assets/resource-ownership');
  const root = new THREE.Group(), geometry = new THREE.BoxGeometry(), texture = new THREE.Texture();
  const material = new THREE.MeshBasicMaterial({ map: texture }), skeleton = new THREE.Skeleton();
  const first = new THREE.SkinnedMesh(geometry, material), second = new THREE.SkinnedMesh(geometry, [material, material]);
  first.skeleton = second.skeleton = skeleton;
  root.add(first, second);
  const released = [first, second, geometry, material, texture, skeleton].map(resource => vi.spyOn(resource, 'dispose'));
  disposeSceneResources(root);
  for (const release of released) expect(release).toHaveBeenCalledOnce();
});

test('temporary catalog and model failures can be retried without reopening the game', async () => {
  const { AssetLibrary } = await import('../src/assets/asset-library');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const library = new AssetLibrary('/catalog.json');
  const gltf = await new GLTFLoader().parseAsync(JSON.stringify({asset:{version:'2.0'},scenes:[{}],scene:0}), '');
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('',{status:503})).mockResolvedValue(new Response(JSON.stringify({version:1,complete:true,assets:{axe:{id:'axe',kind:'model',status:'converted',url:'/axe.glb'}}})));
  const load = vi.spyOn(GLTFLoader.prototype,'loadAsync').mockRejectedValueOnce(new Error('temporary model failure')).mockResolvedValue(gltf);
  vi.stubGlobal('fetch',fetcher);
  try {
    await expect(library.loadAsset('axe')).rejects.toThrow('503');
    await expect(library.loadAsset('axe')).rejects.toThrow('temporary model failure');
    const instance = await library.loadAsset('axe');
    expect(instance.asset.id).toBe('axe');
    expect(fetcher).toHaveBeenCalledTimes(2); expect(load).toHaveBeenCalledTimes(2);
    instance.release();
  } finally { await library.dispose(); load.mockRestore(); vi.unstubAllGlobals(); }
});

function mockAssetLibrary(kinds: Record<string, LibraryAsset['kind']>, files: Record<string, unknown> = {}): AssetLibrary {
  const assets: Record<string, LibraryAsset> = {};
  for (const [id, kind] of Object.entries(kinds)) {
    assets[id] = { id, kind, pack: 'fixture', name: id, url: `/${id}`, sourceHash: 'fixture', dependencies: [], status: 'converted', warnings: [] };
  }
  const catalog: AssetCatalog = { version: 1, complete: true, assets };
  const responses: Record<string, unknown> = { '/catalog': catalog, ...files };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(responses[url]), { status: url in responses ? 200 : 404 })));
  return new AssetLibrary('/catalog');
}
function modelFixture(scene: THREE.Group, bindposes?: number[]): GLTF {
  return { scene, parser: { json: { meshes: [{ extras: { bindposes } }] } } } as unknown as GLTF;
}
function assemblyNode(mesh: string, materials: (string | null)[] = [], bones?: number[]) {
  return { name: mesh, parent: -1, position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], enabled: true,
    mesh: { assetId: mesh, name: mesh }, materials, bones, rootBone: 0, colliders: [], lods: [], unsupported: [] };
}
function firstMaterial(root: THREE.Object3D): THREE.Material {
  let result: THREE.Material | undefined;
  root.traverse(node => { if (isMesh(node)) result ??= Array.isArray(node.material) ? node.material[0] : node.material; });
  if (!result) throw new Error('Fixture has no material.');
  return result;
}

test('asset library shares prepared node materials and disposes shared art once at shutdown', async () => {
  const { MeshStandardNodeMaterial } = await import('three/webgpu');
  const library = mockAssetLibrary({ assembly: 'assembly', mesh: 'mesh', material: 'material' }, {
    '/assembly': { nodes: [assemblyNode('mesh', ['material'])], warnings: [] },
    '/material': { name: 'surface', roughness: .6, metalness: .2, color: [.3, .4, .5, .75], alphaMode: 'BLEND', doubleSided: true, textures: {} },
  });
  const geometry = new THREE.BoxGeometry(), source = new THREE.Group().add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
  const loading = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue(modelFixture(source));
  const geometryDisposal = vi.spyOn(geometry, 'dispose');
  try {
    const first = await library.loadAsset('assembly'), second = await library.loadAsset('assembly');
    const material = firstMaterial(first.object);
    expect(material).toBeInstanceOf(MeshStandardNodeMaterial);
    expect(material).toBe(firstMaterial(second.object));
    const prepared = material as InstanceType<typeof MeshStandardNodeMaterial>;
    expect(prepared.color.toArray()).toEqual([.3, .4, .5]);
    expect([prepared.roughness, prepared.metalness, prepared.opacity, prepared.transparent, prepared.side]).toEqual([.6, .2, .75, true, THREE.DoubleSide]);
    const materialDisposal = vi.spyOn(material, 'dispose');
    first.release();
    expect(materialDisposal).not.toHaveBeenCalled(); expect(geometryDisposal).not.toHaveBeenCalled();
    await Promise.all([library.dispose(), library.dispose()]);
    expect(materialDisposal).toHaveBeenCalledTimes(1); expect(geometryDisposal).toHaveBeenCalledTimes(1);
  } finally { await library.dispose(); loading.mockRestore(); vi.unstubAllGlobals(); }
});

test('asset library releases an unpublished skinned instance when a material variant fails', async () => {
  const library = mockAssetLibrary({ model: 'model' });
  const bone = new THREE.Bone(), geometry = new THREE.BoxGeometry(), material = new THREE.MeshBasicMaterial();
  const skin = new THREE.SkinnedMesh(geometry, material);
  skin.bind(new THREE.Skeleton([bone], [new THREE.Matrix4()]), new THREE.Matrix4());
  const source = new THREE.Group().add(bone, skin);
  const loading = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue(modelFixture(source));
  const skeletonDisposal = vi.spyOn(THREE.Skeleton.prototype, 'dispose'), geometryDisposal = vi.spyOn(geometry, 'dispose');
  try {
    await expect(library.loadAsset('model', { materialVariant: ['missing'] })).rejects.toThrow('Asset not converted: missing');
    expect(skeletonDisposal).toHaveBeenCalledTimes(1);
    expect(geometryDisposal).not.toHaveBeenCalled();
  } finally { await library.dispose(); loading.mockRestore(); skeletonDisposal.mockRestore(); vi.unstubAllGlobals(); }
});

test('asset library waits for sibling assembly loads before releasing a failed partial rig', async () => {
  const library = mockAssetLibrary({ assembly: 'assembly', mesh: 'mesh' }, {
    '/assembly': { nodes: [assemblyNode('mesh', [], [0]), assemblyNode('missing')], warnings: [] },
  });
  const geometry = new THREE.BoxGeometry(), source = new THREE.Group().add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
  let finish!: (model: GLTF) => void;
  const ready = new Promise<GLTF>(resolve => { finish = resolve; });
  const loading = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockReturnValue(ready);
  const skeletonDisposal = vi.spyOn(THREE.Skeleton.prototype, 'dispose'), geometryDisposal = vi.spyOn(geometry, 'dispose');
  try {
    const request = library.loadAsset('assembly');
    const rejected = expect(request).rejects.toThrow('Asset not converted: missing');
    await vi.waitFor(() => expect(loading).toHaveBeenCalledTimes(1));
    finish(modelFixture(source, new THREE.Matrix4().elements));
    await rejected;
    expect(skeletonDisposal).toHaveBeenCalledTimes(1); expect(geometryDisposal).not.toHaveBeenCalled();
  } finally {
    finish(modelFixture(source, new THREE.Matrix4().elements));
    await library.dispose(); loading.mockRestore(); skeletonDisposal.mockRestore(); vi.unstubAllGlobals();
  }
});

test('missing destination skeleton art retains the committed actors and reports the preparation action', async () => {
  const THREE=await import('three');
  const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');
  const {EnemyActors}=await import('../src/clearing/enemy-actors');
  const {makeActor}=await import('../src/clearing/actors');
  const {createEncounter}=await import('../src/gameplay/encounter');
  const state=createEncounter('playing',{...grassArea.layout,enemies:[{id:'guard',position:[1,1],yaw:0,kind:'raider',rig:'skeleton',loadout:{main:'sword',off:null}}]});
  const scene=new THREE.Scene(),player=makeActor(scene,state.player),actors={player};
  const loader=new GLTFLoader();vi.spyOn(loader,'loadAsync').mockRejectedValue(new Error('Missing skeleton model'));
  const roster=new EnemyActors(scene,loader,actors);
  await expect(roster.prepare(state)).rejects.toThrow('Prepare Skeleton 01 with npm run assets:export-character');
  expect(scene.children).toEqual([player.root]);expect(Object.keys(actors)).toEqual(['player']);
  roster.dispose();vi.restoreAllMocks();
});

test('depleted mineral collision retains the low core and restores on renewal', async () => {
  const { MovementWorld } = await import('../src/gameplay/movement');
  const area = clearing as unknown as AreaDefinition;
  const obstacle = traversalWithTrees(area).obstacles.find(entry => entry.id === 'stone-outcrop-1')!;
  const world = await MovementWorld.create(area.layout.boundary, { obstacles: [obstacle] });
  const [x, , z] = obstacle.position;
  const segment = (height: number) => world.segmentHit({ x: x - 2, y: height, z }, { x: x + 2, y: height, z });
  try {
    expect(segment(.5)).not.toBeNull();
    world.setTreeFelled(obstacle.id, true);
    expect(segment(.5)).toBeNull();
    expect(segment(.15)).not.toBeNull();
    world.setTreeFelled(obstacle.id, false);
    expect(segment(.5)).not.toBeNull();
  } finally { world.dispose(); }
});

test('tree approach retries when navigation snaps the first endpoint outside working range', async () => {
  const { MovementWorld } = await import('../src/gameplay/movement');
  const { createEncounter } = await import('../src/gameplay/encounter');
  const area = clearing as unknown as AreaDefinition;
  const tree = treeDefinitions(area).find(entry => entry.id === 'pine-0')!;
  const world = await MovementWorld.create(area.layout.boundary, traversalWithTrees(area));
  const player = createEncounter('playing').player;
  player.x = -12.488691611356915; player.z = 9.107135005388542;
  const point: [number, number] = [tree.position[0], tree.position[2]], reach = tree.radius + .85;
  try {
    const path = world.interactionPath(player, point, tree.position[1], reach, tree.id);
    expect(path).not.toBeNull();
    const end = path!.at(-1)!;
    expect(Math.hypot(end[0] - point[0], end[1] - point[1])).toBeLessThanOrEqual(reach);
    expect(world.interactionVisible({ ...player, x: end[0], z: end[1] }, point, tree.position[1], tree.id)).toBe(true);
  } finally { world.dispose(); }
});

// Protect native bindings and shared bitmap lifetime; instance-only cleanup does not own textures.
test('scene cleanup closes a shared bitmap only after its last owned texture is released', async () => {
  const { disposeSceneResources, ownTexture } = await import('../src/assets/resource-ownership');
  const close = vi.fn(), texture = ownTexture(new THREE.Texture({ width: 1, height: 1, close }));
  const clone = ownTexture(texture.clone());
  const first = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ map: texture }));
  const second = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ map: clone }));
  const native = vi.fn(); first.addEventListener('dispose', native);
  disposeSceneResources(first);
  expect(native).toHaveBeenCalledOnce(); expect(close).not.toHaveBeenCalled();
  disposeSceneResources(second);
  expect(close).toHaveBeenCalledOnce();
});

// Protect in-flight shader compilation when cleanup is repeated; no existing test covers review-pool leases.
test('review cleanup waits for each distinct holder even if one releases twice', async () => {
  const { PreparedAssets } = await import('../src/labs/assets/prepared-assets');
  const { sceneryLoader } = await import('../src/assets/scenery-loader');
  const gltf = await new GLTFLoader().parseAsync(JSON.stringify({asset:{version:'2.0'},scenes:[{}],scene:0}), '');
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); gltf.scene.add(mesh);
  const load = vi.spyOn(sceneryLoader, 'loadAsync').mockResolvedValue(gltf), disposed = vi.spyOn(mesh.geometry, 'dispose');
  const pool = new PreparedAssets();
  try {
    const asset = await pool.get({ id: 'fixture', familyId: 'fixture', name: 'Fixture', appearance: '', pack: '', category: 'Other', kind: 'model', url: '/fixture.glb', available: true, warnings: [], uses: [], selected: false, dependencies: [], dependents: [], fingerprint: 'fixture' });
    const first = pool.keep(asset), second = pool.keep(asset);
    pool.dispose(); first(); first(); expect(disposed).not.toHaveBeenCalled();
    second(); second(); expect(disposed).toHaveBeenCalledOnce();
  } finally { pool.dispose(); load.mockRestore(); }
});
