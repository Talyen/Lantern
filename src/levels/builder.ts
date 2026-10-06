import { rainShelters, rainExposureNode } from './weather';
import { waterTerrain } from './water-terrain';
import { createMerchant } from '../rendering/merchant';

import { lightingOnly, includeCutawayShadows } from '../rendering/cutaway';
import { pendingCachedRequests } from '../data/cached-request';
import { disposeSceneInstances, isMesh } from '../assets/resource-ownership';
import { MeshStandardNodeMaterial, type Node } from 'three/webgpu';
import { createSurfaceMaterial } from '../rendering/surface-detail';
import { texture, mix, vec2, positionWorld, color, sin, smoothstep, uniform } from 'three/tsl';
import environmentManifest from '../../assets/textures/environment/manifest.json';
import * as THREE from 'three';
import type { RuntimeAssets } from '../assets/runtime-assets';
import { environmentOutlineEligible, environmentSurface, prepareEnvironmentMaterials, type SurfaceMode } from '../assets/environment-surfaces';
import { markOutline } from '../rendering/outlines';
import { type AssetInstance } from '../assets/asset-library';
import { updateAssetLods } from '../rendering/asset-lods';
import { stoneSurface, stoneSurfaceRecipe, stoneTextureInputs } from '../rendering/stone-surface';
import { createGrass } from '../rendering/grass';
import { isGrassPlacement } from './grass';
import { Vegetation } from '../rendering/vegetation';
import { TreeFelling } from '../rendering/tree-felling';
import { vegetationProfile } from './vegetation';
import { woodlandGroundRecipeFor, woodlandMaterial, woodlandTextureInputs } from '../rendering/woodland-ground';
import { Portal } from '../rendering/portal';
import { resolveLocalLight, resolveWorldFlame } from './local-lighting';
import type { CoreEffects } from '../rendering/effects';
import { generateDecoration } from './decoration';
import { createShelter } from '../rendering/shelter';
import { resourceDefinitions } from './resources';
import { gathering } from '../gameplay/skills';
import { treeDefinitions } from './trees';
import type { AreaDefinition, AssetRef, Placement, Primitive, GroundPatch } from './types';
export const pendingAreaAssets = (resources: RuntimeAssets): string[] => [...pendingCachedRequests(), ...resources.cache.pending()].slice(0, 16);
export function createWorld() {
  const scene = new THREE.Scene();
  const ambient = new THREE.HemisphereLight(); const sun = new THREE.DirectionalLight(); sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.camera.near = .5; sun.shadow.camera.far = 80; sun.shadow.normalBias = .025; sun.shadow.bias = -.00015; sun.shadow.radius = 3;
  includeCutawayShadows(sun);
  scene.add(ambient, sun, sun.target); return { scene, ambient, sun };
}
export async function buildArea(area: AreaDefinition, surfaceMode: SurfaceMode = 'projected', shelterRestored = false, assets: RuntimeAssets) {
  const assetLibrary = assets.library;
  const root = new THREE.Group(); root.name = area.id; root.userData.surfaceMode = surfaceMode; root.userData.shelterRestored = shelterRestored;
  const weatherShelters = rainShelters(area, shelterRestored), rainWetness = uniform(0);
  root.userData.rainWetness = rainWetness;
  const exposedWetness = area.effects.weather ? rainWetness.mul(.6).mul(rainExposureNode(weatherShelters)) : undefined;
  const lightingSources = new Set<string>();
  root.userData.lightingSources = [];
  const lightingProcedural: unknown[] = [];
  root.userData.lightingProcedural = lightingProcedural;
  const ownedTextures = new Set<THREE.Texture>();
  const ownedGeometry = new Set<THREE.BufferGeometry>(), ownedMaterial = new Set<THREE.Material>(), instances: AssetInstance[] = [];
  const sceneLeases: (() => void)[] = [];
  let disposed = false;
  let grass: Awaited<ReturnType<typeof createGrass>> | undefined;
  const vegetation = new Vegetation();
  const animated = new Set<THREE.Object3D>();
  const interactables = new Map<string,THREE.Object3D>();
  const chests = new Map<string, { hinge: THREE.Group; opened: boolean }>();
  let merchant: Awaited<ReturnType<typeof createMerchant>> | undefined;
  let shelter: ReturnType<typeof createShelter> | undefined;
  const resources = resourceDefinitions(area), mineralModels = new Map<string, THREE.Object3D>();
  const trees = treeDefinitions(area), treeIds = new Map(trees.map(t => [t.id, t]));
  const treeFelling = new TreeFelling(area, new Set(treeIds.keys()));
  const treeModels = new Map<string, { object: THREE.Object3D; stump: THREE.Mesh; rotation: [number, number]; hitAge: number; felled: boolean }>();
  const shakingTrees = new Set<string>();
  const portals: Portal[] = [];
  const missing: string[] = [], foliage: THREE.Object3D[] = [], fires: THREE.PointLight[] = []; let shadow: THREE.PointLight | null = null;
  try {
    grass = await createGrass(area, vegetation, assetLibrary); root.add(grass.root); missing.push(...grass.missing);
    for (const definition of area.effects.portals ?? []) {
      const portal = new Portal(definition, root); portals.push(portal); portal.root.userData.transient = true;
    }
    const showcase = import.meta.env.DEV && surfaceMode === 'showcase' && area.id === environmentManifest.showcase.area ? environmentManifest.showcase : undefined;
    const groundMaps = new Map<string, THREE.Texture>();
    const inputs = area.props.flatMap(prop => prop.primitive?.surface === 'stone' ? stoneTextureInputs(area.id === 'clearing') : prop.primitive?.surface === 'woodland' ? woodlandTextureInputs : []);
    await Promise.all([...new Map(inputs.map(input => [input[0], input])).values()].map(async ([url, data, source]) => {
      const lease = await assets.texture(url, !data, { flipY: true, source });
      groundMaps.set(url, lease.texture); sceneLeases.push(lease.release); lightingSources.add(lease.url);
    }));
    const groundMap = (url: string): THREE.Texture => {
      const map = groundMaps.get(url); if (!map) throw new Error(`Ground texture was not prepared: ${url}`); return map;
    };
    const groundPatches: GroundPatch[] = area.props.flatMap(p => {
      const id = p.asset && ('libraryId' in p.asset ? p.asset.libraryId : p.asset.url);
      const family = environmentManifest.assets.find(a => a.id === id)?.kind;
      if (!family || !['pine', 'bush', 'fern', 'rock', 'log'].includes(family)) return [];
      return [{ center: [p.position[0], p.position[2]], radius: family === 'pine' ? 2.7 : family === 'rock' ? 1.8 : 1.3,
        color: family === 'rock' ? '#777568' : '#71533c', strength: family === 'pine' ? .78 : .6, layer: family === 'rock' ? 'rocky-soil' : 'litter' }];
    });
    const coverageField = grass.coverage ? texture(grass.coverage.texture,
      positionWorld.xz.sub(vec2(...grass.coverage.min)).div(vec2(...grass.coverage.span))) : undefined;
    if (grass.coverage?.wetBanks) lightingProcedural.push({ waterBanks: area.effects.water });
    const bankWetness = grass.coverage?.wetBanks ? coverageField!.g : undefined;
    const material = (p: Primitive) => {
      lightingProcedural.push(p);
      const m = createSurfaceMaterial({ color: p.color, roughness: 1, side: p.doubleSided ? THREE.DoubleSide : THREE.FrontSide });
      ownedMaterial.add(m);
      if (p.surface === 'stone') {
        const study = area.id === 'clearing';
        const surface = stoneSurface(groundMap, study);
        lightingProcedural.push({ stoneSurface: stoneSurfaceRecipe, study });
        m.colorNode = study ? mix(color(p.color), surface.color, .7) : mix(color('#aaa797'), surface.color, .45).mul(color(p.color));
        m.normalNode = surface.normal; m.roughnessNode = surface.roughness; m.aoNode = surface.cavity;
      }
      if (p.surface === 'woodland') {
        const patches = [...groundPatches, ...(p.patches ?? []), ...(showcase?.ground.patches as GroundPatch[] ?? [])];
        const recipe = woodlandGroundRecipeFor(area.id);
        const paths = p.paths ?? [];
        lightingProcedural.push({ woodlandMaterial: recipe, patches, ...(paths.length ? { paths } : {}) });
        const boundary = area.layout.boundary;
        const points = boundary.kind === 'circle' ? [[boundary.center[0] - boundary.radius - 2, boundary.center[1] - boundary.radius - 2], [boundary.center[0] + boundary.radius + 2, boundary.center[1] + boundary.radius + 2]] : boundary.points;
        const min: [number, number] = [Math.min(...points.map(point => point[0])) - 2, Math.min(...points.map(point => point[1])) - 2];
        const span: [number, number] = [Math.max(...points.map(point => point[0])) - min[0] + 2, Math.max(...points.map(point => point[1])) - min[1] + 2];
        const surface = woodlandMaterial(groundMap, patches, recipe, paths, bankWetness, { min, span }, exposedWetness);
        ownedTextures.add(surface.coverageMap); Object.assign(m, { groundCoverageMap: surface.coverageMap });
        m.colorNode = surface.color; m.normalNode = surface.normal; m.roughnessNode = surface.roughness; m.aoNode = surface.cavity;
        // Grass receives actual baked/local contact lighting. Avoid a second
        // sampled soil tint that adds muddiness and another shader texture slot.
      }
      return m;
    };
    const geometry = (p: Primitive) => { const s = p.size; let g: THREE.BufferGeometry;
      if (p.kind === 'headstone') {
        const [w,h,d] = s, shape = new THREE.Shape();
        shape.moveTo(-w/2,-h/2); shape.lineTo(w/2,-h/2); shape.lineTo(w/2,h*.20);
        shape.quadraticCurveTo(w/2,h/2,0,h/2); shape.quadraticCurveTo(-w/2,h/2,-w/2,h*.20); shape.closePath();
        g = new THREE.ExtrudeGeometry(shape, { depth:d, bevelEnabled:true, bevelThickness:.035, bevelSize:.035, bevelSegments:1, steps:1, curveSegments:3 }); g.translate(0,0,-d/2);
      }
      else if (p.kind === 'box') {
        const terrain = area.props.find(prop => prop.terrain && prop.primitive === p);
        g = terrain && waterTerrain(terrain, area.effects.water) || new THREE.BoxGeometry(s[0], s[1], s[2]);
      }
      else if (p.kind === 'cylinder') g = new THREE.CylinderGeometry(s[0], s[1], s[2], s[3] ?? 32);
      else if (p.kind === 'tent') {
        const [w, h, d] = s, positions: number[] = [];
        const triangle = (a: number[], b: number[], c: number[]) => positions.push(...a, ...b, ...c);
        const front = d / 2, back = -d / 2;
        triangle([-w/2,0,front], [0,h,front], [0,h,back]); triangle([-w/2,0,front], [0,h,back], [-w/2,0,back]);
        triangle([0,h,front], [w/2,0,front], [w/2,0,back]); triangle([0,h,front], [w/2,0,back], [0,h,back]);
        triangle([-w/2,0,back], [0,h,back], [w/2,0,back]);
        triangle([-w/2,0,front], [0,h,front], [-w*.19,0,front]); triangle([0,h,front], [w/2,0,front], [w*.19,0,front]);
        g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.computeVertexNormals();
      }
      else g = new THREE.DodecahedronGeometry(s[0], 0);
      ownedGeometry.add(g); return g;
    };
    const outlined = (p: Placement) => !treeIds.has(p.id) && !p.terrain && !p.foliage && !p.decoration && (p.asset ? environmentOutlineEligible(p.asset) : p.primitive?.surface !== 'woodland');
    async function asset(ref: AssetRef, allowVariant = true, showcasePlacement = false): Promise<THREE.Group> {
      const variant = allowVariant && environmentSurface(ref, surfaceMode, showcasePlacement, area.id);
      if (variant) { try { return await asset({ url: variant }, false); } catch {
        missing.push(`surface:${variant}`);
        if (showcasePlacement) missing.push(`showcase:${'libraryId' in ref ? ref.libraryId : ref.url}`);
        // Optional showcase art retains the current prepared surface before falling back to its source.
        const current = showcasePlacement && environmentSurface(ref, 'projected', false, area.id);
        if (current) { try { return await asset({ url: current }, false); } catch { /* Keep the encounter runnable. */ } }
      } }
      if ('libraryId' in ref) {
        const instance = await assetLibrary.loadAsset(ref.libraryId); instances.push(instance);
        instance.object.traverse(object => { for (const issue of (object.userData.materialIssues as string[] | undefined) ?? []) if (!missing.includes(issue)) missing.push(issue); });
        const catalog = await assetLibrary.getCatalog(), visited = new Set<string>();
        const source = (id: string) => { if (visited.has(id)) return; visited.add(id); const entry = catalog.assets[id]; if (entry) { lightingSources.add(assets.resolveURL(entry.url)); if (entry.kind === 'texture') { lightingSources.add(assets.resolveURL(entry.url, true)); lightingSources.add(assets.resolveURL(entry.url, false)); } entry.dependencies.forEach(source); } };
        source(instance.asset.id); return instance.object;
      }
      const lease = assets.acquireScene(ref.url, async root => { if (ref.url.startsWith('/vendor/synty/environment/')) await prepareEnvironmentMaterials(root, ref.url, assets); });
      sceneLeases.push(lease.release);
      const object = (await lease.ready).clone(true); lightingSources.add(assets.resolveURL(ref.url));
      for (const url of (object.userData.surfaceSources as string[] | undefined) ?? []) lightingSources.add(url);
      for (const url of (object.userData.surfaceMissing as string[] | undefined) ?? []) if (!missing.includes(url)) missing.push(url);
      return object;
    }
    function transform(model: THREE.Object3D, p: Placement): void {
      // Center/bottom-normalize inside a placement root so yaw cannot move an off-center asset away from its collision proxy.
      if (p.height) {
        model.updateMatrixWorld(true); const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()); if (size.y <= 0) throw new Error(`${p.id}: model has no visible height`);
        model.scale.multiplyScalar(p.height / size.y); model.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(model), center = box.getCenter(new THREE.Vector3());
        model.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));
        const placement = new THREE.Group(); placement.add(model); model = placement;
      }
      model.position.fromArray(p.position);
      model.rotation.y += p.yaw; model.scale.multiply(new THREE.Vector3(...p.scale)); model.name = p.id;
      const resource = resources.find(n => n.id === p.id);
      if(resource?.kind==='iron')model.traverse(o=>{if(isMesh(o) && o.material instanceof MeshStandardNodeMaterial){const ore=o.material.clone();const vein=mix(color('#5e5b52'),color('#89654e'),smoothstep(.25,.65,sin(positionWorld.x.mul(13).add(positionWorld.z.mul(8))).mul(.5).add(.5)));ore.colorNode=area.id==='clearing' ? mix((o.material.colorNode as Node<'vec3'> | null) ?? color(o.material.color),vein,.3) : vein;ore.roughness=.85;ownedMaterial.add(ore);o.material=ore;}});
      if (resource && resource.kind !== 'tree') { model.userData.harvestResource=p.id; model.traverse(o=>animated.add(o)); model.userData.resourceScaleY=model.scale.y; mineralModels.set(p.id,model); interactables.set(`resource/${p.id}`,model); }
      if (area.smithing?.prop === p.id) { interactables.set('smithing',model); model.traverse(object=>animated.add(object)); }
      if (area.shop?.prop === p.id) { interactables.set(`shop/${area.shop.id}`, model); model.traverse(object => animated.add(object)); }
      const tree = treeIds.get(p.id);
      const chest=area.chests?.find(chest=>chest.prop===p.id);
      const fire=area.campfires?.find(fire=>Math.hypot(fire.position[0]-p.position[0],fire.position[1]-p.position[2])<.2);
      if(tree || chest || fire){interactables.set(tree ? `tree/${tree.id}` : chest ? `chest/${chest.id}` : `fire/${fire!.id}`,model);model.traverse(object=>animated.add(object));}
      if (tree) {
        // Keep tree roots intact through batching, independently of foliage/surface variants.
        model.userData.harvestTree = p.id; model.traverse(o => animated.add(o));
        const stumpGeometry = new THREE.CylinderGeometry(tree.radius * .91, tree.radius * 1.12, .25, 9);
        const bark = createSurfaceMaterial({ color: '#514031', roughness: .95 });
        const cut = createSurfaceMaterial({ color: '#94744d', roughness: 1 });
        ownedGeometry.add(stumpGeometry); ownedMaterial.add(bark); ownedMaterial.add(cut);
        const stump = new THREE.Mesh(stumpGeometry, [bark, cut, bark]);
        stump.name = `${p.id}:stump`; stump.position.set(p.position[0], p.position[1] + .125, p.position[2]); stump.rotation.y = p.yaw;
        stump.castShadow = p.castShadow; stump.receiveShadow = true; stump.visible = false; stump.userData.transient = true;
        animated.add(stump); root.add(stump); treeModels.set(p.id, { object: model, stump, rotation: [model.rotation.x, model.rotation.z], hitAge: Infinity, felled: false });
      }
      model.traverse(o => { if (isMesh(o)) { o.castShadow = p.castShadow; o.receiveShadow = p.receiveShadow; if (p.foliage) { animated.add(o); o.geometry = o.geometry.clone(); ownedGeometry.add(o.geometry); } } });
      if (outlined(p)) markOutline(model, 'prop');
      root.add(model); if (p.foliage) foliage.push(model);
      if (tree) treeFelling.register(tree.id, model, treeModels.get(tree.id)!.stump, tree.radius);
      const profile = tree ? undefined : vegetationProfile(p);
      if (profile) vegetation.describe(model, profile, !!p.foliage);
    }
    for (const surface of area.traversal?.surfaces ?? []) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(surface.positions, 3)); g.setIndex(surface.indices); g.computeVertexNormals(); ownedGeometry.add(g);
      const mesh = new THREE.Mesh(g, material({ kind: 'box', size: [], color: '#687273' })); mesh.receiveShadow = true; root.add(mesh);
    }
    const props = [...area.props.filter(p => !isGrassPlacement(area, p)), ...generateDecoration(area)];
    const batches = new Map<string, Placement[]>();
    for (const p of props.filter(p => p.primitive)) {
      if (resources.some(n=>n.id===p.id)) { transform(new THREE.Mesh(geometry(p.primitive!), material(p.primitive!)), p); continue; }
      const key = JSON.stringify([p.primitive, p.castShadow, p.receiveShadow, !!p.foliage, vegetationProfile(p), outlined(p), p.visibility]); const batch = batches.get(key) ?? []; batch.push(p); batches.set(key, batch);
    }
    for (const batch of batches.values()) {
      const p = batch[0], mesh = new THREE.InstancedMesh(geometry(p.primitive!), material(p.primitive!), batch.length), matrix = new THREE.Object3D();
      mesh.name = p.id; mesh.castShadow = p.castShadow; mesh.receiveShadow = p.receiveShadow; mesh.userData.ids = batch.map(p => p.id);
      if (p.visibility === 'lighting-only') lightingOnly(mesh);
      if (outlined(p)) markOutline(mesh, 'prop');
      batch.forEach((p, i) => { matrix.position.fromArray(p.position); matrix.rotation.set(0, p.yaw, 0); matrix.scale.fromArray(p.scale); matrix.updateMatrix(); mesh.setMatrixAt(i, matrix.matrix); }); mesh.computeBoundingSphere(); root.add(mesh); if (p.foliage) foliage.push(mesh);
      const profile = vegetationProfile(p); if (profile) vegetation.describeInstances(mesh, profile, !!p.foliage);
    }
      const results = await Promise.allSettled(props.filter(p => p.asset).map(async p => {
        let model: THREE.Group;
        try { model = await asset(p.asset!, true, !!showcase?.placements.includes(p.id)); } catch {
          missing.push(p.id);
          if (p.fallback) { try { model = await asset(p.fallback); } catch { return; } }
          else if(area.smithing?.prop===p.id){
            // Optional scenery cannot remove the workshop's interaction.
            model=new THREE.Group();
            for(const [size,position] of [[[1.05,.15,.5],[0,.575,0]],[[.35,.5,.4],[0,.25,0]],[[.65,.1,.55],[0,.05,0]]]){
              const definition:Primitive={kind:'box',size,color:'#5d5650',surface:'stone'};
              const part=new THREE.Mesh(geometry(definition),material(definition));part.position.fromArray(position);part.castShadow=part.receiveShadow=true;model.add(part);
            }
          } else return;
        }
        const chest = area.chests?.find(c => c.prop === p.id);
        if (chest) {
          // Both chest exports retain a separate lid in original Z-up mesh coordinates.
          const lid = model.getObjectByName('SM_Prop_Chest_01_Lid') ?? model.getObjectByName('SM_Prop_Chest_02_Lid_01');
          if (isMesh(lid) && lid.parent) {
            lid.geometry.computeBoundingBox();
            const box = lid.geometry.boundingBox!, hinge = new THREE.Group();
            hinge.position.set((box.min.x + box.max.x) / 2, box.min.y, box.max.z);
            lid.parent.add(hinge); hinge.add(lid); lid.position.sub(hinge.position);
            const lock = model.getObjectByName('SM_Prop_Chest_01_Lock') ?? model.getObjectByName('SM_Prop_Chest_02_Latch_01');
            if (lock) { hinge.add(lock); lock.position.sub(hinge.position); }
            chests.set(chest.id, { hinge, opened: false });
          }
          model.traverse(o => animated.add(o));
        }
        transform(model, p);
        if (p.visibility === 'lighting-only') lightingOnly(model);
      }));
      const failed = results.find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
      const fireResults = await Promise.allSettled(area.effects.fires.map(async fire => {
        try { const model = await asset(fire.asset); transform(model, { id: fire.id, asset: fire.asset, position: [fire.position[0], 0, fire.position[1]], height: fire.height, yaw: 0, scale: [1, 1, 1], castShadow: true, receiveShadow: true }); } catch { missing.push(fire.id); return; }
        const recipe = resolveLocalLight(fire), [x, z] = fire.position;
        const light = new THREE.PointLight(recipe.color, recipe.intensity, recipe.distance, 2);
        light.position.set(x, recipe.emitterHeight + .05, z); light.userData.baseIntensity = recipe.intensity; light.userData.flicker = recipe.flicker; light.userData.staticFlame = resolveWorldFlame(fire);
        includeCutawayShadows(light);
        light.castShadow = recipe.shadow; light.shadow.mapSize.set(1024, 1024); light.shadow.camera.near = .12; light.shadow.camera.far = recipe.distance + 1;
        light.shadow.radius = recipe.shadowRadius; light.shadow.intensity = recipe.shadowIntensity; light.shadow.normalBias = .012; light.shadow.bias = -.0001;
        root.add(light); fires.push(light); if (recipe.shadow) shadow = light;
      }));
      const fireFailure = fireResults.find(result => result.status === 'rejected');
      if (fireFailure?.status === 'rejected') throw fireFailure.reason;
      if(area.shelter) {
        let chest:THREE.Group;
        try {chest=await asset({libraryId:'generic:model:sm-gen-prop-chest-01'});}catch{missing.push('shelter-stash');chest=new THREE.Group();const body=new THREE.Mesh(geometry({kind:'box',size:[.85,.55,.55],color:'#68523d'}),material({kind:'box',size:[],color:'#68523d'}));body.position.y=.275;chest.add(body);}
        chest.scale.setScalar(.8); chest.traverse(o=>{if(isMesh(o))o.castShadow=o.receiveShadow=true;});
        shelter=createShelter(area.shelter,shelterRestored,chest); root.add(shelter.root); interactables.set('shelter',shelter.root); if(shelterRestored)interactables.set('stash',chest); shelter.root.traverse(object=>animated.add(object));
        lightingProcedural.push({shelter:area.shelter,restored:shelterRestored});
      }
    root.userData.lightingSources = [...lightingSources];
    // Batch opaque repeated asset primitives without flattening skins, wind or native LOD ownership.
    const staticBatches = new Map<string, THREE.Mesh[]>();
    if (area.shop) {
      try {
        merchant = await createMerchant(area.shop, assets); root.add(merchant.root);
        merchant.root.traverse(object => animated.add(object));
        interactables.set(`merchant/${area.shop.id}`, merchant.root);
      } catch (error) { missing.push(`Merchant: ${error instanceof Error ? error.message : String(error)}`); }
    }
    root.updateMatrixWorld(true);
    const lodRoots = new Set(instances.filter(i => (i.object.userData.lods as unknown[] | undefined)?.length).map(i => i.object));
    root.traverse(o => {
      if (!isMesh(o) || o instanceof THREE.InstancedMesh || o instanceof THREE.SkinnedMesh || animated.has(o) || Object.values(o.geometry.morphAttributes).some(a => Array.isArray(a) && a.length > 0)) return;
      for (let parent: THREE.Object3D | null = o; parent; parent = parent.parent) if (lodRoots.has(parent as THREE.Group) || !parent.visible) return;
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      if (materials.some(m => m.transparent) || !o.visible || o.matrixWorld.determinant() <= 0) return;
      const key = JSON.stringify([o.geometry.uuid, materials.map(m => m.uuid), o.castShadow, o.receiveShadow, o.userData.outlineStrength ?? 0, o.layers.mask, vegetation.batchKey(o)]);
      const batch = staticBatches.get(key) ?? []; batch.push(o); staticBatches.set(key, batch);
    });
    for (const meshes of staticBatches.values()) if (meshes.length > 1) {
      const first = meshes[0], batch = new THREE.InstancedMesh(first.geometry, first.material, meshes.length);
      batch.layers.mask = first.layers.mask; batch.userData.lightingOnly = first.userData.lightingOnly === true;
      batch.name = `instances:${first.name}`; batch.castShadow = first.castShadow; batch.receiveShadow = first.receiveShadow;
      batch.userData.outlineStrength = (first.userData.outlineStrength as number | undefined) ?? 0;
      meshes.forEach((mesh, i) => { batch.setMatrixAt(i, mesh.matrixWorld); mesh.removeFromParent(); }); batch.computeBoundingSphere(); root.add(batch);
      vegetation.batch(batch, meshes);
    }
    vegetation.prepare(root);
    function update(camera: THREE.Camera, dt = 0): void {
      treeFelling.update(dt);
      merchant?.update(dt);
      // Area instances keep their authored LOD membership for their lifetime.
      for (const lodRoot of lodRoots) updateAssetLods(lodRoot, camera);
      for (const { hinge, opened } of chests.values()) hinge.rotation.x = THREE.MathUtils.damp(hinge.rotation.x, opened ? -1.25 : 0, 8, dt);
      for (const id of shakingTrees) {
        const tree = treeModels.get(id)!;
        tree.hitAge += dt;
        const tilt = !tree.felled && tree.hitAge < .36 ? Math.sin(tree.hitAge * 38) * .013 * (1 - tree.hitAge / .36) : 0;
        tree.object.rotation.x = tree.rotation[0] + tilt; tree.object.rotation.z = tree.rotation[1] + tilt * .6;
        // Restore the authored pose on the final frame, then stop touching it.
        if (tree.hitAge >= .36) shakingTrees.delete(id);
      }
    }
    function setChestOpened(id: string, opened: boolean): void { const chest = chests.get(id); if (chest) chest.opened = opened; }
    function pickResource(ray: THREE.Raycaster): string | null {
      const hits=ray.intersectObjects([...treeModels.values()].filter(t=>!t.felled).map(t=>t.object).concat([...mineralModels.values()].filter(m=>!m.userData.depleted)),true);
      for(const hit of hits) for(let o:THREE.Object3D|null=hit.object;o;o=o.parent) if(o.userData.harvestTree || o.userData.harvestResource) { const id: unknown = o.userData.harvestTree ?? o.userData.harvestResource; if(typeof id==='string') return id; }
      return null;
    }
    function setResourceState(id: string, depleted: boolean): void {
      if(treeIds.has(id)){setTreeState(id,depleted);return;}
      const model=mineralModels.get(id);if(!model)return;
      model.userData.depleted=depleted; model.scale.y=model.userData.resourceScaleY*(depleted ? gathering.mineralDepletedScale : 1);
    }
    function setTreeState(id: string, felled: boolean): void {
      const tree = treeModels.get(id); if (!tree) return;
      shakingTrees.delete(id);
      treeFelling.restore(id, felled);
      tree.felled = felled; tree.object.visible = !felled; tree.stump.visible = felled; tree.hitAge = Infinity;
      [tree.object.rotation.x, tree.object.rotation.z] = tree.rotation;
    }
    function treeHit(id: string): void { const tree = treeModels.get(id); if (tree && !tree.felled) { tree.hitAge = 0; shakingTrees.add(id); } }
    function fellTree(id: string, from: [number, number]): void {
      const tree = treeModels.get(id); if (!tree || tree.felled) return;
      shakingTrees.delete(id); tree.felled = true; tree.hitAge = Infinity;
      treeFelling.fell(id, from);
    }
    function activate(effects: CoreEffects): void {
      effects.addVegetation(vegetation);
      treeFelling.activate(effects);
      effects.configureWeather(area, weatherShelters);
      for (const model of foliage) effects.addFoliage(model);
      for (const water of area.effects.water) effects.addWater(root, ...water.position, water);
      for (const fire of area.effects.fires) if (root.getObjectByName(fire.id)) {
        const recipe = resolveLocalLight(fire);
        effects.addEmitter('fire', new THREE.Vector3(fire.position[0], recipe.emitterHeight, fire.position[1]), root, 20);
        effects.addEmitter('smoke', new THREE.Vector3(fire.position[0], (recipe.emitterHeight) + .35, fire.position[1]), root, 5);
        effects.addEmitter('sparks', new THREE.Vector3(fire.position[0], (recipe.emitterHeight) + .15, fire.position[1]), root, 4);
      }
    }
    return { root, rainWetness, weatherShelters, area, missing, grass: grass.stats, fires, portals, trees, interactables, resources, pickResource, setResourceState, vegetation, treeFelling, fellTree, get shadow() { return shadow; }, update, setChestOpened, setTreeState, treeHit, activate, dispose };
  } catch (error) {
    // Texture callbacks can still be pending when another construction stage fails.
    dispose(); throw error;
  }
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    merchant?.dispose(); shelter?.dispose(); portals.forEach(p => p.dispose()); vegetation.dispose(); grass?.dispose(); treeFelling.dispose();
    root.removeFromParent();
    instances.forEach(i => i.release());
    disposeSceneInstances(root);
    root.traverse(o => { if (o instanceof THREE.Light) o.dispose(); });
    sceneLeases.forEach(release => release()); ownedGeometry.forEach(g => g.dispose());
    ownedMaterial.forEach(m => m.dispose()); ownedTextures.forEach(t => t.dispose());
  }
}
export type AreaInstance = Awaited<ReturnType<typeof buildArea>>;
