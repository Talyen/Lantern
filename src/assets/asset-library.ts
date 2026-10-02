import { disposeSceneInstances, ownTexture, sceneTextures, isMesh, isTexture } from './resource-ownership';
import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { prepareStandardMaterials, prepareSurfaceMaterial, filterMaterialTexture } from '../rendering/surface-detail';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { assembleAsset, type AssemblySpec, type LibraryModel } from './asset-assembly';

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
/** A library owns shared art. Instances release native bindings and skeletons independently. */
export class AssetLibrary {
  private catalog?: Promise<AssetCatalog>;
  private gltfs = new Map<string, Promise<LibraryModel>>();
  private json = new Map<string, Promise<unknown>>();
  private textures = new Map<string, Promise<THREE.Texture>>();
  private materials = new Map<string, Promise<MeshStandardNodeMaterial>>();
  private ownedTextures = new Set<THREE.Texture>();
  private ownedMaterials = new Set<THREE.Material>();
  private instances = new Set<() => void>();
  private loader = new GLTFLoader();
  private disposed = false;
  private disposal?: Promise<void>;
  private pending = new Set<Promise<unknown>>();
  constructor(private catalogUrl = '/vendor/synty/library/catalog.json') {}
  private track<T>(promise: Promise<T>): Promise<T> {
    this.pending.add(promise); promise.then(() => this.pending.delete(promise), () => this.pending.delete(promise)); return promise;
  }
  /** Share successful requests; failed preparation remains eligible for a fresh retry. */
  private cached<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
    const existing = cache.get(key);
    if (existing) return existing;
    const request = this.track(Promise.resolve().then(load));
    cache.set(key, request);
    request.catch(() => { if (cache.get(key) === request) cache.delete(key); });
    return request;
  }
  private async fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url); if (!response.ok) throw new Error(`Asset unavailable (${response.status}): ${url}`); return response.json() as Promise<T>;
  }
  getCatalog(): Promise<AssetCatalog> {
    if (this.disposed) throw new Error('Asset library disposed');
    if (this.catalog) return this.catalog;
    const request = this.fetchJson<AssetCatalog>(this.catalogUrl).then(catalog => {
      if (catalog.version !== 1) throw new Error('Unsupported asset catalog version');
      return catalog;
    });
    this.catalog = request;
    request.catch(() => { if (this.catalog === request) this.catalog = undefined; });
    return request;
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
  private async gltf(id: string): Promise<LibraryModel> {
    const asset = await this.entry(id);
    return this.cached(this.gltfs, id, async () => {
      const gltf = await this.loader.loadAsync(asset.url);
      prepareStandardMaterials(gltf.scene);
      sceneTextures(gltf.scene);
      const metadata = gltf.parser.json as { meshes?: { extras?: { bindposes?: number[] } }[] };
      return { scene: gltf.scene, bindposes: metadata.meshes?.[0]?.extras?.bindposes };
    });
  }
  private async texture(id: string, color: boolean): Promise<THREE.Texture> {
    const key = `${id}:${color}`;
    return this.cached(this.textures, key, async () => {
      const asset = await this.entry(id), texture = await new THREE.TextureLoader().loadAsync(asset.url);
      texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace; texture.flipY = false;
      filterMaterialTexture(texture); texture.wrapS = texture.wrapT = THREE.RepeatWrapping; ownTexture(texture); this.ownedTextures.add(texture); return texture;
    });
  }
  private async material(id: string): Promise<MeshStandardNodeMaterial> {
    return this.cached(this.materials, id, async () => {
      const spec = await this.data<MaterialSpec>(id);
      const material = new MeshStandardNodeMaterial({ name: spec.name, roughness: spec.roughness ?? 0.9, metalness: spec.metalness ?? 0,
        side: spec.doubleSided || spec.effectRole === 'foliage' ? THREE.DoubleSide : THREE.FrontSide, transparent: spec.alphaMode === 'BLEND',
        depthWrite: spec.alphaMode !== 'BLEND', alphaTest: spec.alphaMode === 'MASK' || spec.effectRole === 'foliage' && !!spec.textures.baseColor ? spec.alphaCutoff ?? 0.5 : 0 });
      this.ownedMaterials.add(material);
      if (spec.color) { material.color.fromArray(spec.color); material.opacity = spec.color[3] ?? 1; }
      if (spec.emissive && spec.textures.emissive) material.emissive.fromArray(spec.emissive);
      for (const channel of ['baseColor', 'normal', 'emissive'] as const) {
        const mapping = spec.textures[channel]; if (!mapping) continue;
        // UV transforms belong to this material; do not mutate the cached texture.
        const texture = ownTexture((await this.texture(mapping.id, channel !== 'normal')).clone()); this.ownedTextures.add(texture);
        texture.repeat.fromArray(mapping.scale); texture.offset.set(mapping.offset[0], 1 - mapping.scale[1] - mapping.offset[1]);
        if (channel === 'baseColor') material.map = texture; else if (channel === 'normal') material.normalMap = texture; else material.emissiveMap = texture;
      }
      material.userData.effectRole = spec.effectRole;
      prepareSurfaceMaterial(material);
      return material;
    });
  }
  private async assembly(id: string): Promise<THREE.Group> {
    return assembleAsset(id, await this.data<AssemblySpec>(id), {
      model: id => this.gltf(id), material: id => this.material(id),
    });
  }
  loadAsset(id: string, options: LoadAssetOptions = {}): Promise<AssetInstance> {
    if (this.disposed) return Promise.reject(new Error('Asset library disposed'));
    return this.track(this.instantiate(id, options));
  }
  private async instantiate(id: string, options: LoadAssetOptions): Promise<AssetInstance> {
    const asset = await this.entry(id);
    if (!['model', 'assembly', 'mesh'].includes(asset.kind)) throw new Error(`Not a placeable asset: ${id}`);
    const object = asset.kind === 'assembly' ? await this.assembly(id) : new THREE.Group().add(cloneSkeleton((await this.gltf(id)).scene));
    try {
      if (this.disposed) throw new Error('Asset library disposed during load');
      const variants = options.materialVariant ? await Promise.all(options.materialVariant.map(id => this.material(id))) : undefined;
      if (this.disposed) throw new Error('Asset library disposed during load');
      object.traverse(node => {
        if (!isMesh(node)) return;
        node.castShadow = node.receiveShadow = options.shadows ?? true;
        if (variants) node.material = variants.length === 1 ? variants[0] : variants;
      });
      prepareStandardMaterials(object);
      object.traverse(node => { if (node instanceof THREE.SkinnedMesh) object.userData.lodSkinned = true; });
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        object.removeFromParent();
        disposeSceneInstances(object, { skeletons: true });
        this.instances.delete(release);
      };
      this.instances.add(release);
      return { object, asset, release };
    } catch (error) {
      disposeSceneInstances(object, { skeletons: true });
      throw error;
    }
  }
  dispose(): Promise<void> {
    this.disposed = true;
    return this.disposal ??= this.releaseResources();
  }
  private async releaseResources(): Promise<void> {
    // Accepted loads can start nested material/texture requests while settling.
    while (this.pending.size) await Promise.allSettled([...this.pending]);
    this.instances.forEach(release => release());
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
