import { disposeSceneInstances, ownTexture, sceneTextures, isMesh, isTexture } from './resource-ownership';
import * as THREE from 'three';
import { prepareStandardMaterials, filterMaterialTexture } from '../rendering/surface-detail';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

export interface LibraryAsset {
  id: string; pack: string; name: string; kind: 'model' | 'mesh' | 'texture' | 'material' | 'assembly';
  url: string; sourceHash: string; dependencies: string[]; status: 'converted' | 'pending' | 'failed' | 'unsupported';
  warnings: string[]; bounds?: [number[], number[]]; rig?: { bones: string[] };
}
export interface AssetCatalog { version: 1; complete: boolean; assets: Record<string, LibraryAsset> }
export interface LoadAssetOptions { materialVariant?: string[]; shadows?: boolean }
export interface AssetInstance { object: THREE.Group; asset: LibraryAsset; release(): void }
interface MaterialSpec {
  name: string; color?: number[]; roughness?: number; metalness?: number; doubleSided?: boolean;
  alphaMode?: string; alphaCutoff?: number; emissive?: number[]; effectRole?: string;
  textures: Partial<Record<'baseColor' | 'normal' | 'emissive', { id: string; scale: number[]; offset: number[] }>>;
}
interface MeshRef { assetId: string; name: string }
interface AssemblyNode {
  name: string; parent: number; position: number[]; rotation: number[]; scale: number[]; enabled: boolean;
  mesh?: MeshRef; materials: (string | null)[]; bones?: number[]; rootBone: number;
  colliders: { center?: number[]; [key: string]: unknown }[]; lods: { screenHeight: number; nodes: number[] }[]; unsupported: string[];
}
interface AssemblySpec { nodes: AssemblyNode[]; warnings: string[] }

/** A library owns shared art. Instances release native bindings and skeletons independently. */
export class AssetLibrary {
  private catalog?: Promise<AssetCatalog>;
  private gltfs = new Map<string, Promise<{ scene: THREE.Group; bindposes?: number[] }>>();
  private json = new Map<string, Promise<unknown>>();
  private textures = new Map<string, Promise<THREE.Texture>>();
  private materials = new Map<string, Promise<THREE.MeshStandardMaterial>>();
  private ownedTextures = new Set<THREE.Texture>();
  private ownedMaterials = new Set<THREE.Material>();
  private instances = new Set<() => void>();
  private loader = new GLTFLoader();
  private disposed = false;
  private pending = new Set<Promise<unknown>>();
  constructor(private catalogUrl = '/vendor/synty/library/catalog.json') {}
  private track<T>(promise: Promise<T>): Promise<T> {
    this.pending.add(promise); promise.then(() => this.pending.delete(promise), () => this.pending.delete(promise)); return promise;
  }
  private cached<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
    let promise = cache.get(key);
    if (!promise) {
      promise = this.track(Promise.resolve().then(load)).catch(error => {
        cache.delete(key);
        throw error;
      });
      cache.set(key, promise);
    }
    return promise;
  }
  private async fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url); if (!response.ok) throw new Error(`Asset unavailable (${response.status}): ${url}`); return response.json() as Promise<T>;
  }
  getCatalog(): Promise<AssetCatalog> {
    if (this.disposed) throw new Error('Asset library disposed');
    return this.catalog ??= this.fetchJson<AssetCatalog>(this.catalogUrl).then((catalog) => { if (catalog.version !== 1) throw new Error('Unsupported asset catalog version'); return catalog; }).catch(error => { this.catalog = undefined; throw error; });
  }
  private async entry(id: string): Promise<LibraryAsset> {
    const asset = (await this.getCatalog()).assets[id];
    if (!asset || asset.status !== 'converted') throw new Error(`Asset not converted: ${id}`);
    return asset;
  }
  private async data<T>(id: string): Promise<T> {
    const asset = await this.entry(id);
    return this.cached(this.json, id, () => this.fetchJson(asset.url)) as Promise<T>;
  }
  private async gltf(id: string): Promise<{ scene: THREE.Group; bindposes?: number[] }> {
    const asset = await this.entry(id);
    return this.cached(this.gltfs, id, () => this.loader.loadAsync(asset.url).then(gltf => { prepareStandardMaterials(gltf.scene); sceneTextures(gltf.scene); return { scene: gltf.scene, bindposes: (gltf.parser.json as { meshes?: { extras?: { bindposes?: number[] } }[] }).meshes?.[0]?.extras?.bindposes }; }));
  }
  private async texture(id: string, color: boolean): Promise<THREE.Texture> {
    const key = `${id}:${color}`;
    return this.cached(this.textures, key, () => this.entry(id).then((asset) => new THREE.TextureLoader().loadAsync(asset.url)).then((texture) => {
      texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace; texture.flipY = false;
      filterMaterialTexture(texture); texture.wrapS = texture.wrapT = THREE.RepeatWrapping; ownTexture(texture); this.ownedTextures.add(texture); return texture;
    }));
  }
  private async material(id: string): Promise<THREE.MeshStandardMaterial> {
    return this.cached(this.materials, id, () => this.data<MaterialSpec>(id).then(async (spec) => {
      const material = new THREE.MeshStandardMaterial({ name: spec.name, roughness: spec.roughness ?? 0.9, metalness: spec.metalness ?? 0,
        side: spec.doubleSided || spec.effectRole === 'foliage' ? THREE.DoubleSide : THREE.FrontSide, transparent: spec.alphaMode === 'BLEND',
        depthWrite: spec.alphaMode !== 'BLEND', alphaTest: spec.alphaMode === 'MASK' || spec.effectRole === 'foliage' && !!spec.textures.baseColor ? spec.alphaCutoff ?? 0.5 : 0 });
      if (spec.color) { material.color.fromArray(spec.color); material.opacity = spec.color[3] ?? 1; }
      if (spec.emissive && spec.textures.emissive) material.emissive.fromArray(spec.emissive);
      for (const channel of ['baseColor', 'normal', 'emissive'] as const) {
        const mapping = spec.textures[channel]; if (!mapping) continue;
        // UV transforms belong to this material; do not mutate the cached texture.
        const texture = ownTexture((await this.texture(mapping.id, channel !== 'normal')).clone()); this.ownedTextures.add(texture);
        texture.repeat.fromArray(mapping.scale); texture.offset.set(mapping.offset[0], 1 - mapping.scale[1] - mapping.offset[1]);
        if (channel === 'baseColor') material.map = texture; else if (channel === 'normal') material.normalMap = texture; else material.emissiveMap = texture;
      }
      material.userData.effectRole = spec.effectRole; this.ownedMaterials.add(material); return material;
    }));
  }
  private async assembly(id: string): Promise<THREE.Group> {
    const spec = await this.data<AssemblySpec>(id); const root = new THREE.Group();
    const nodes = spec.nodes.map((node) => { const group = new THREE.Bone(); group.name = node.name;
      group.position.set(node.position[0], node.position[1], -node.position[2]);
      group.quaternion.set(-node.rotation[0], -node.rotation[1], node.rotation[2], node.rotation[3]);
      group.scale.fromArray(node.scale); group.visible = node.enabled; group.userData.colliders = node.colliders.map((collider) => ({ ...collider, center: collider.center ? [collider.center[0], collider.center[1], -collider.center[2]] : undefined })); group.userData.unsupported = node.unsupported; return group; });
    nodes.forEach((node, i) => (spec.nodes[i].parent >= 0 ? nodes[spec.nodes[i].parent] : root).add(node));
    await Promise.all(spec.nodes.map(async (node, index) => {
      if (!node.mesh) return;
      const gltf = await this.gltf(node.mesh.assetId); const primitives: THREE.Mesh[] = [];
      gltf.scene.traverse((o) => { if (isMesh(o)) primitives.push(o); });
      const materials = await Promise.all(node.materials.map((id) => id ? this.material(id) : Promise.resolve(null)));
      const bindposes = gltf.bindposes;
      for (let i = 0; i < primitives.length; i++) {
        const source = primitives[i]; let mesh: THREE.Mesh;
        const material = materials[i] ?? source.material;
        if (node.bones?.length && bindposes?.length) {
          const skin = new THREE.SkinnedMesh(source.geometry, material);
          const bones = node.bones.map((i) => { if (i < 0) throw new Error(`Unresolved bone in ${id}`); return nodes[i]; });
          const inverses = bones.map((_, i) => new THREE.Matrix4().fromArray(bindposes, i * 16));
          root.updateMatrixWorld(true); skin.bind(new THREE.Skeleton(bones, inverses), new THREE.Matrix4()); mesh = skin;
        } else mesh = new THREE.Mesh(source.geometry, material);
        mesh.name = node.mesh.name; nodes[index].add(mesh);
      }
    }));
    // Preserve native LOD thresholds. Runtime uses screen-height metadata rather than guessing distance thresholds.
    root.userData.lods = spec.nodes.flatMap((node) => node.lods.length ? [{ levels: node.lods.map((level) => ({ height: level.screenHeight, nodes: level.nodes.map((i) => nodes[i]) })) }] : []);
    root.userData.warnings = spec.warnings;
    return root;
  }
  loadAsset(id: string, options: LoadAssetOptions = {}): Promise<AssetInstance> {
    return this.track(this.instantiate(id, options));
  }
  private async instantiate(id: string, options: LoadAssetOptions): Promise<AssetInstance> {
    const asset = await this.entry(id);
    if (!['model', 'assembly', 'mesh'].includes(asset.kind)) throw new Error(`Not a placeable asset: ${id}`);
    const object = asset.kind === 'assembly' ? await this.assembly(id) : new THREE.Group().add(cloneSkeleton((await this.gltf(id)).scene));
    if (this.disposed) { disposeSceneInstances(object, { skeletons: true }); throw new Error('Asset library disposed during load'); }
    const variants = options.materialVariant ? await Promise.all(options.materialVariant.map((id) => this.material(id))) : undefined;
    if (this.disposed) { disposeSceneInstances(object, { skeletons: true }); throw new Error('Asset library disposed during load'); }
    object.traverse((o) => { if (isMesh(o)) { o.castShadow = o.receiveShadow = options.shadows ?? true; if (variants) o.material = variants.length === 1 ? variants[0] : variants; } });
    prepareStandardMaterials(object);
    object.traverse(node => { if (node instanceof THREE.SkinnedMesh) object.userData.lodSkinned = true; });
    let released = false;
    const release = () => { if (released) return; released = true; object.removeFromParent(); disposeSceneInstances(object, { skeletons: true }); this.instances.delete(release); };
    this.instances.add(release); return { object, asset, release };
  }
  async dispose(): Promise<void> {
    this.disposed = true; await Promise.allSettled([...this.pending]); this.instances.forEach((release) => release());
    const geometries = new Set<THREE.BufferGeometry>();
    for (const pending of this.gltfs.values()) { const result = await pending.catch(() => null); result?.scene.traverse((o) => {
      if (isMesh(o)) { geometries.add(o.geometry); const materials = Array.isArray(o.material) ? o.material : [o.material];
        materials.forEach((m) => { this.ownedMaterials.add(m); Object.values(m).forEach((v) => { if (isTexture(v)) this.ownedTextures.add(v); }); }); }
    }); }
    geometries.forEach((g) => g.dispose()); this.ownedMaterials.forEach((m) => m.dispose()); this.ownedTextures.forEach((t) => t.dispose());
    this.gltfs.clear(); this.json.clear(); this.textures.clear(); this.materials.clear();
    this.ownedMaterials.clear(); this.ownedTextures.clear(); this.catalog = undefined;
  }
}
export const assetLibrary = new AssetLibrary();
export const loadAsset = (id: string, options?: LoadAssetOptions): Promise<AssetInstance> => assetLibrary.loadAsset(id, options);

const lodBounds = new WeakMap<THREE.Object3D, { matrix: THREE.Matrix4; groups: { size: number; center: THREE.Vector3 }[] }>();
const lodEye = new THREE.Vector3();
/** Call once per frame for placed library assemblies; native screen-height thresholds remain intact. */
export function updateAssetLods(root: THREE.Object3D, camera: THREE.Camera): void {
  const groups = root.userData.lods as { levels: { height: number; nodes: THREE.Object3D[] }[] }[] | undefined;
  if (!groups?.length) return;
  root.updateWorldMatrix(true, false);
  let cached = lodBounds.get(root);
  if (!cached || root.userData.lodSkinned || !cached.matrix.equals(root.matrixWorld)) {
    root.updateMatrixWorld(true);
    const box = new THREE.Box3(), size = new THREE.Vector3();
    cached = { matrix: root.matrixWorld.clone(), groups: groups.map(group => {
      box.makeEmpty(); for (const node of group.levels[0].nodes) box.expandByObject(node);
      return { size: box.getSize(size).length(), center: box.getCenter(new THREE.Vector3()) };
    }) };
    lodBounds.set(root, cached);
  }
  camera.getWorldPosition(lodEye);
  for (const [index, group] of groups.entries()) {
    const { size, center } = cached.groups[index];
    const fraction = camera instanceof THREE.OrthographicCamera ? size / ((camera.top - camera.bottom) / camera.zoom)
      : camera instanceof THREE.PerspectiveCamera ? size / (2 * Math.max(0.01, lodEye.distanceTo(center)) * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) : 1;
    const selected = group.levels.findIndex((level) => fraction >= level.height);
    for (let i = 0; i < group.levels.length; i++) for (const node of group.levels[i].nodes) node.visible = i === selected;
  }
}
