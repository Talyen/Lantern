import { MeshStandardNodeMaterial } from 'three/webgpu';
import { texture, positionWorld, mix, vec2, vec3, smoothstep, mx_noise_float } from 'three/tsl';
import soilUrl from '../../assets/textures/soil-painterly.png?url';
import environmentManifest from '../../assets/textures/environment/manifest.json';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { environmentOutlineEligible, environmentSurface, prepareEnvironmentMaterials, type SurfaceMode } from '../assets/environment-surfaces';
import { markOutline } from '../rendering/outlines';
import { assetLibrary, updateAssetLods, type AssetInstance } from '../assets/asset-library';
import { createGrass } from '../rendering/grass';
import { woodlandLayerUrls, woodlandGroundRecipe, woodlandLayer, woodlandPatchWeight, woodlandPatchColor } from '../rendering/woodland-ground';
import { Portal } from '../rendering/portal';
import { resolveLocalLight } from './local-lighting';
import type { CoreEffects } from '../rendering/effects';
import { generateDecoration } from './decoration';
import { treeDefinitions } from './trees';
import type { AreaDefinition, AssetRef, Placement, Primitive, GroundLayer, GroundPatch } from './types';
const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group>>();
const shared = new Set<THREE.Object3D>();
export async function disposeAreaCache(): Promise<void> {
  await Promise.allSettled(cache.values()); const geometry = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  shared.forEach(root => root.traverse(o => { if (o instanceof THREE.Mesh) { geometry.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : [o.material]) { materials.add(m); Object.values(m).forEach(v => { if (v instanceof THREE.Texture) textures.add(v); }); } } }));
  geometry.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose()); shared.clear(); cache.clear(); await assetLibrary.dispose();
}
export function createWorld() {
  const scene = new THREE.Scene();
  const ambient = new THREE.HemisphereLight(); const sun = new THREE.DirectionalLight(); sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.camera.near = .5; sun.shadow.camera.far = 80; sun.shadow.normalBias = .025; sun.shadow.bias = -.00015; sun.shadow.radius = 3;
  scene.add(ambient, sun, sun.target); return { scene, ambient, sun };
}
export async function buildArea(area: AreaDefinition, surfaceMode: SurfaceMode = 'projected') {
  const root = new THREE.Group(); root.name = area.id; root.userData.surfaceMode = surfaceMode;
  const lightingSources = new Set<string>(), textureReady: Promise<void>[] = [];
  root.userData.lightingSources = [];
  root.userData.lightingProcedural = [];
  const ownedTextures = new Set<THREE.Texture>();
  const ownedGeometry = new Set<THREE.BufferGeometry>(), ownedMaterial = new Set<THREE.Material>(), instances: AssetInstance[] = [];
  let disposed = false;
  const grass = createGrass(area, area.grass ?? []); root.add(grass.root);
  const animated = new Set<THREE.Object3D>();
  const chests = new Map<string, { hinge: THREE.Group; opened: boolean }>();
  const trees = treeDefinitions(area), treeIds = new Map(trees.map(t => [t.id, t]));
  const treeModels = new Map<string, { object: THREE.Object3D; stump: THREE.Mesh; rotation: [number, number]; hitAge: number; felled: boolean }>();
  const portals = (area.effects.portals ?? []).map(definition => { const portal = new Portal(definition, root); portal.root.userData.transient = true; return portal; });
  const missing: string[] = [], foliage: THREE.Object3D[] = [], fires: THREE.PointLight[] = []; let shadow: THREE.PointLight | null = null;
  const showcase = import.meta.env.DEV && surfaceMode === 'showcase' && area.id === environmentManifest.showcase.area ? environmentManifest.showcase : undefined;
  const groundMaps = new Map<GroundLayer, THREE.Texture>();
  const groundMap = (layer: GroundLayer): THREE.Texture => {
    const existing = groundMaps.get(layer);
    if (existing) return existing;
    const url = woodlandLayerUrls[layer];
    let resolveTexture!: () => void, rejectTexture!: (error: unknown) => void;
    const ready = new Promise<void>((resolve, reject) => { resolveTexture = resolve; rejectTexture = reject; });
    const map = new THREE.TextureLoader().load(url, resolveTexture, undefined, rejectTexture);
    ready.catch(() => {}); textureReady.push(ready); lightingSources.add(url);
    map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping;
    ownedTextures.add(map); groundMaps.set(layer, map); return map;
  };
  const material = (p: Primitive) => { root.userData.lightingProcedural.push(p); const m = new MeshStandardNodeMaterial({ color: p.color, roughness: 1, side: p.doubleSided ? THREE.DoubleSide : THREE.FrontSide });
    const samples = new Map<GroundLayer, ReturnType<typeof woodlandLayer>>();
    const sample = (layer: GroundLayer) => { let value = samples.get(layer); if (!value) { value = woodlandLayer(groundMap(layer), layer); samples.set(layer, value); } return value; };
    if (p.surface === 'woodland') {
      if (showcase || p.patches?.some(patch => patch.layer)) root.userData.lightingProcedural.push({ woodlandLayerSampling: woodlandGroundRecipe });
      let resolveTexture!: () => void, rejectTexture!: (error: unknown) => void;
      const ready = new Promise<void>((resolve, reject) => { resolveTexture = resolve; rejectTexture = reject; }); ready.catch(() => {}); textureReady.push(ready);
      const soil = new THREE.TextureLoader().load(soilUrl, resolveTexture, undefined, rejectTexture); lightingSources.add(soilUrl); soil.colorSpace = THREE.SRGBColorSpace; soil.wrapS = soil.wrapT = THREE.RepeatWrapping; ownedTextures.add(soil);
      // Stable world-space blends break recognizable tile motifs without animated noise or seams.
      const ground = positionWorld.xz;
      const broad = mx_noise_float(ground.mul(.075)).mul(.5).add(.5);
      const detail = mx_noise_float(ground.mul(.32).add(vec2(17, 43)));
      const uvB = vec2(ground.x.mul(.8).sub(ground.y.mul(.6)), ground.x.mul(.6).add(ground.y.mul(.8))).mul(.137).add(vec2(.37, .61));
      const uvC = vec2(ground.x.mul(.6).add(ground.y.mul(.8)), ground.x.mul(-.8).add(ground.y.mul(.6))).mul(.083).add(vec2(.73, .19));
      const soilBlend = mix(texture(soil, ground.mul(.11)).rgb, texture(soil, uvB).rgb, smoothstep(.25, .75, broad));
      // Palette inputs join the bake fingerprint; shader-only color changes must invalidate old irradiance.
      const palette = { earth: '#68523d', recolor: .78, tint: '#766047', tintBlend: .12 };
      root.userData.lightingProcedural.push({ woodlandPalette: palette });
      const sampled = mix(soilBlend, texture(soil, uvC).rgb, detail.mul(.18).add(.28).clamp(0, .5)).mul(1.45);
      const earth = new THREE.Color(palette.earth), weights = vec3(.2126, .7152, .0722);
      const earthLuminance = earth.r * .2126 + earth.g * .7152 + earth.b * .0722;
      const base = mix(sampled, vec3(...earth.toArray()).mul(sampled.dot(weights).div(earthLuminance)), palette.recolor);
      let color = mix(base, vec3(...new THREE.Color(p.color).toArray()), smoothstep(.3, .8, broad).mul(.42));
      for (const patch of p.patches ?? []) {
        // Perturb the feathered boundary, keeping the authored center and radius in metres.
        const distance = ground.sub(vec2(...patch.center)).length().div(patch.radius).add(detail.mul(.12));
        const weight = smoothstep(.25, 1, distance).oneMinus().mul(patch.strength);
        const worn = patch.layer ? woodlandPatchColor(sample(patch.layer), patch) : base.mul(.45).add(vec3(...new THREE.Color(patch.color).toArray()).mul(.75));
        color = mix(color, worn, weight);
      }
      m.colorNode = mix(color, vec3(...new THREE.Color(palette.tint).toArray()), palette.tintBlend);
      if (showcase) {
        const study = showcase.ground, patches = study.patches as GroundPatch[];
        const region = { center: study.center as [number, number], radius: study.radius, strength: 1 };
        let painted = sample('earth');
        for (const patch of patches) painted = mix(painted, woodlandPatchColor(sample(patch.layer!), patch), woodlandPatchWeight(patch));
        m.colorNode = mix(m.colorNode, painted, woodlandPatchWeight(region));
        root.userData.lightingProcedural.push({ woodlandShowcase: study });
      }
      if (grass.coverage) {
        // Explicit map reference includes the mask bytes in the existing bake fingerprint.
        m.map = grass.coverage.texture;
        const coverage = texture(m.map, ground.sub(vec2(...grass.coverage.min)).div(vec2(...grass.coverage.span))).r;
        const grassSoil = { color: '#4b4e32', strength: .42 };
        root.userData.lightingProcedural.push({ grassSoil });
        m.colorNode = mix(m.colorNode, vec3(...new THREE.Color(grassSoil.color).toArray()), coverage.mul(grassSoil.strength));
      }
    }
    ownedMaterial.add(m); return m; };
  const geometry = (p: Primitive) => { const s = p.size; let g: THREE.BufferGeometry;
    if (p.kind === 'box') g = new THREE.BoxGeometry(s[0], s[1], s[2]);
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
    const variant = allowVariant && environmentSurface(ref, surfaceMode, showcasePlacement);
    if (variant) { try { return await asset({ url: variant }, false); } catch {
      if (showcasePlacement) missing.push(`showcase:${'libraryId' in ref ? ref.libraryId : ref.url}`);
      // Optional showcase art retains the current prepared surface before falling back to its source.
      const current = showcasePlacement && environmentSurface(ref, 'projected');
      if (current) { try { return await asset({ url: current }, false); } catch { /* Keep the encounter runnable. */ } }
    } }
    if ('libraryId' in ref) {
      const instance = await assetLibrary.loadAsset(ref.libraryId); instances.push(instance);
      const catalog = await assetLibrary.getCatalog(), visited = new Set<string>();
      const source = (id: string) => { if (visited.has(id)) return; visited.add(id); const entry = catalog.assets[id]; if (entry) { lightingSources.add(entry.url); entry.dependencies.forEach(source); } };
      source(instance.asset.id); return instance.object;
    }
    let pending = cache.get(ref.url);
    if (!pending) { pending = loader.loadAsync(ref.url).then(gltf => { if (ref.url.startsWith('/vendor/synty/environment/')) prepareEnvironmentMaterials(gltf.scene); shared.add(gltf.scene); return gltf.scene; }); cache.set(ref.url, pending); pending.catch(() => cache.delete(ref.url)); }
    const object = (await pending).clone(true); lightingSources.add(ref.url); return object;
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
    const tree = treeIds.get(p.id);
    if (tree) {
      // Keep tree roots intact through batching, independently of foliage/surface variants.
      model.userData.harvestTree = p.id; model.traverse(o => animated.add(o));
      const stumpGeometry = new THREE.CylinderGeometry(tree.radius * .91, tree.radius * 1.12, .25, 9);
      const bark = new MeshStandardNodeMaterial({ color: '#514031', roughness: .95 });
      const cut = new MeshStandardNodeMaterial({ color: '#94744d', roughness: 1 });
      ownedGeometry.add(stumpGeometry); ownedMaterial.add(bark); ownedMaterial.add(cut);
      const stump = new THREE.Mesh(stumpGeometry, [bark, cut, bark]);
      stump.name = `${p.id}:stump`; stump.position.set(p.position[0], p.position[1] + .125, p.position[2]); stump.rotation.y = p.yaw;
      stump.castShadow = p.castShadow; stump.receiveShadow = true; stump.visible = false; stump.userData.transient = true;
      animated.add(stump); root.add(stump); treeModels.set(p.id, { object: model, stump, rotation: [model.rotation.x, model.rotation.z], hitAge: Infinity, felled: false });
    }
    model.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = p.castShadow; o.receiveShadow = p.receiveShadow; if (p.foliage) { animated.add(o); o.geometry = o.geometry.clone(); ownedGeometry.add(o.geometry); } } });
    if (outlined(p)) markOutline(model, 'prop');
    root.add(model); if (p.foliage) foliage.push(model);
  }
  for (const surface of area.traversal?.surfaces ?? []) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(surface.positions, 3)); g.setIndex(surface.indices); g.computeVertexNormals(); ownedGeometry.add(g);
    const mesh = new THREE.Mesh(g, material({ kind: 'box', size: [], color: '#687273' })); mesh.receiveShadow = true; root.add(mesh);
  }
  const props = [...area.props, ...generateDecoration(area)];
  const batches = new Map<string, Placement[]>();
  for (const p of props.filter(p => p.primitive)) {
    if (treeIds.has(p.id)) { transform(new THREE.Mesh(geometry(p.primitive!), material(p.primitive!)), p); continue; }
    const key = JSON.stringify([p.primitive, p.castShadow, p.receiveShadow, !!p.foliage, outlined(p)]); const batch = batches.get(key) ?? []; batch.push(p); batches.set(key, batch);
  }
  for (const batch of batches.values()) {
    const p = batch[0], mesh = new THREE.InstancedMesh(geometry(p.primitive!), material(p.primitive!), batch.length), matrix = new THREE.Object3D();
    mesh.name = p.id; mesh.castShadow = p.castShadow; mesh.receiveShadow = p.receiveShadow; mesh.userData.ids = batch.map(p => p.id);
    if (outlined(p)) markOutline(mesh, 'prop');
    batch.forEach((p, i) => { matrix.position.fromArray(p.position); matrix.rotation.set(0, p.yaw, 0); matrix.scale.fromArray(p.scale); matrix.updateMatrix(); mesh.setMatrixAt(i, matrix.matrix); }); mesh.computeBoundingSphere(); root.add(mesh); if (p.foliage) foliage.push(mesh);
  }
  try {
    const results = await Promise.allSettled(props.filter(p => p.asset).map(async p => {
      let model: THREE.Group;
      try { model = await asset(p.asset!, true, !!showcase?.placements.includes(p.id)); } catch {
        missing.push(p.id);
        if (p.fallback) { try { model = await asset(p.fallback); } catch { return; } } else return;
      }
      const chest = area.chests?.find(c => c.prop === p.id);
      if (chest) {
        // This exported chest has a separate lid in its original Z-up mesh coordinates.
        const lid = model.getObjectByName('SM_Prop_Chest_01_Lid');
        if (lid instanceof THREE.Mesh && lid.parent) {
          lid.geometry.computeBoundingBox();
          const box = lid.geometry.boundingBox!, hinge = new THREE.Group();
          hinge.position.set((box.min.x + box.max.x) / 2, box.min.y, box.max.z);
          lid.parent.add(hinge); hinge.add(lid); lid.position.sub(hinge.position);
          const lock = model.getObjectByName('SM_Prop_Chest_01_Lock');
          if (lock) { hinge.add(lock); lock.position.sub(hinge.position); }
          chests.set(chest.id, { hinge, opened: false });
        }
        model.traverse(o => animated.add(o));
      }
      transform(model, p);
    }));
    const failed = results.find(result => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    await Promise.all(area.effects.fires.map(async fire => {
      try { const model = await asset(fire.asset); transform(model, { id: fire.id, asset: fire.asset, position: [fire.position[0], 0, fire.position[1]], height: fire.height, yaw: 0, scale: [1, 1, 1], castShadow: true, receiveShadow: true }); } catch { missing.push(fire.id); return; }
      const recipe = resolveLocalLight(fire), [x, z] = fire.position;
      const light = new THREE.PointLight(recipe.color, recipe.intensity, recipe.distance, 2);
      light.position.set(x, recipe.emitterHeight + .05, z); light.userData.baseIntensity = recipe.intensity; light.userData.flicker = recipe.flicker;
      light.castShadow = recipe.shadow; light.shadow.mapSize.set(1024, 1024); light.shadow.camera.near = .12; light.shadow.camera.far = recipe.distance + 1;
      light.shadow.radius = recipe.shadowRadius; light.shadow.intensity = recipe.shadowIntensity; light.shadow.normalBias = .012; light.shadow.bias = -.0001;
      root.add(light); fires.push(light); if (recipe.shadow) shadow = light;
    }));
    await Promise.all(textureReady);
  } catch (error) { dispose(); throw error; }
  root.userData.lightingSources = [...lightingSources];
  // Batch opaque repeated asset primitives without flattening skins, wind or native LOD ownership.
  const staticBatches = new Map<string, THREE.Mesh[]>();
  root.updateMatrixWorld(true);
  const lodRoots = new Set(instances.filter(i => i.object.userData.lods?.length).map(i => i.object));
  root.traverse(o => {
    if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh || o instanceof THREE.SkinnedMesh || animated.has(o) || Object.values(o.geometry.morphAttributes).some(a => Array.isArray(a) && a.length > 0)) return;
    for (let parent: THREE.Object3D | null = o; parent; parent = parent.parent) if (lodRoots.has(parent as THREE.Group) || !parent.visible) return;
    const materials = Array.isArray(o.material) ? o.material : [o.material];
    if (materials.some(m => m.transparent) || !o.visible || o.matrixWorld.determinant() <= 0) return;
    const key = JSON.stringify([o.geometry.uuid, materials.map(m => m.uuid), o.castShadow, o.receiveShadow, o.userData.outlineStrength ?? 0]);
    const batch = staticBatches.get(key) ?? []; batch.push(o); staticBatches.set(key, batch);
  });
  for (const meshes of staticBatches.values()) if (meshes.length > 1) {
    const first = meshes[0], batch = new THREE.InstancedMesh(first.geometry, first.material, meshes.length);
    batch.name = `instances:${first.name}`; batch.castShadow = first.castShadow; batch.receiveShadow = first.receiveShadow;
    batch.userData.outlineStrength = first.userData.outlineStrength ?? 0;
    meshes.forEach((mesh, i) => { batch.setMatrixAt(i, mesh.matrixWorld); mesh.removeFromParent(); }); batch.computeBoundingSphere(); root.add(batch);
  }
  function update(camera: THREE.Camera, dt = 0): void {
    for (const instance of instances) updateAssetLods(instance.object, camera);
    for (const { hinge, opened } of chests.values()) hinge.rotation.x = THREE.MathUtils.damp(hinge.rotation.x, opened ? -1.25 : 0, 8, dt);
    for (const tree of treeModels.values()) {
      tree.hitAge += dt;
      const tilt = !tree.felled && tree.hitAge < .36 ? Math.sin(tree.hitAge * 38) * .013 * (1 - tree.hitAge / .36) : 0;
      tree.object.rotation.x = tree.rotation[0] + tilt; tree.object.rotation.z = tree.rotation[1] + tilt * .6;
    }
  }
  function setChestOpened(id: string, opened: boolean): void { const chest = chests.get(id); if (chest) chest.opened = opened; }
  function setTreeState(id: string, felled: boolean): void {
    const tree = treeModels.get(id); if (!tree) return;
    tree.felled = felled; tree.object.visible = !felled; tree.stump.visible = felled; tree.hitAge = Infinity;
    [tree.object.rotation.x, tree.object.rotation.z] = tree.rotation;
  }
  function treeHit(id: string): void { const tree = treeModels.get(id); if (tree && !tree.felled) tree.hitAge = 0; }
  function activate(effects: CoreEffects): void {
    effects.addGrass(grass);
    for (const model of foliage) effects.addFoliage(model);
    for (const water of area.effects.water) effects.addWater(root, ...water.position, water);
    for (const fire of area.effects.fires) if (root.getObjectByName(fire.id)) {
      const recipe = resolveLocalLight(fire);
      effects.addEmitter('fire', new THREE.Vector3(fire.position[0], recipe.emitterHeight, fire.position[1]), root, 20);
      effects.addEmitter('smoke', new THREE.Vector3(fire.position[0], (recipe.emitterHeight) + .35, fire.position[1]), root, 5);
      effects.addEmitter('sparks', new THREE.Vector3(fire.position[0], (recipe.emitterHeight) + .15, fire.position[1]), root, 4);
    }
  }
  function dispose(): void { portals.forEach(p => p.dispose()); if (disposed) return; disposed = true; grass.dispose(); root.removeFromParent(); root.traverse(o => { if (o instanceof THREE.InstancedMesh) o.dispose(); if (o instanceof THREE.Light) o.dispose(); }); instances.forEach(i => i.release()); ownedGeometry.forEach(g => g.dispose()); ownedMaterial.forEach(m => m.dispose()); ownedTextures.forEach(t => t.dispose()); }
  return { root, area, missing, fires, portals, trees, get shadow() { return shadow; }, update, setChestOpened, setTreeState, treeHit, activate, dispose };
}
export type AreaInstance = Awaited<ReturnType<typeof buildArea>>;
