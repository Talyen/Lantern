import { disposeSceneInstances, disposeSceneResources, ownTexture, sceneTextures, artResources, textureResources, isMesh, isTexture } from './resource-ownership';
import * as THREE from 'three';
import { parseJson } from '../data/json';
import { ArtCache, type ArtLease, type ArtResource } from './art-cache';
import type { RuntimeAssets } from './runtime-assets';
import { type MeshStandardNodeMaterial } from 'three/webgpu';
import { createSurfaceMaterial, prepareStandardMaterials, prepareSurfaceMaterial, filterMaterialTexture } from '../rendering/surface-detail';
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
type CachedModel = LibraryModel & { skinned: boolean };
type CachedMaterial = { material: MeshStandardNodeMaterial; release(): void };
/** Instances lease immutable source art; a renderer-wide cache owns warm resources. */
export class AssetLibrary {
  private instances = new Set<() => void>();
  private loader: GLTFLoader;
  private cache: ArtCache;
  private disposed = false;
  private disposal?: Promise<void>;
  private pending = new Set<Promise<unknown>>();
  constructor(private catalogUrl = '/vendor/synty/library/catalog.json', private scope?: RuntimeAssets) {
    this.loader = scope?.loader ?? new GLTFLoader(); this.cache = scope?.cache ?? new ArtCache();
  }
  private track<T>(promise: Promise<T>): Promise<T> {
    this.pending.add(promise); promise.then(() => this.pending.delete(promise), () => this.pending.delete(promise)); return promise;
  }
  private async json<T>(url: string): Promise<T> {
    let bytes = 0;
    const lease = this.cache.acquire(`json:${url}`, async () => {
      const read = async () => { const response = await fetch(url); if (!response.ok) throw new Error(`Asset unavailable (${response.status}): ${url}`); return response.text(); };
      const text = this.scope ? await this.scope.transfers.run(read) : await read(); bytes = text.length * 2; return parseJson(text) as T;
    }, value => [{ identity: value as object, kind: 'metadata', bytes }], () => {});
    try { return await lease.ready; } finally { lease.release(); }
  }
  getCatalog(): Promise<AssetCatalog> {
    if (this.disposed) throw new Error('Asset library disposed');
    return this.track(this.json<AssetCatalog>(this.catalogUrl).then(catalog => { if (catalog.version !== 1) throw new Error('Unsupported asset catalog version'); return catalog; }));
  }
  private async entry(id: string): Promise<LibraryAsset> {
    const asset = (await this.getCatalog()).assets[id]; if (!asset || asset.status !== 'converted') throw new Error(`Asset not converted: ${id}`); return asset;
  }
  private model(asset: LibraryAsset): ArtLease<CachedModel> {
    return this.cache.acquire(`model:${this.catalogUrl}:${asset.id}:${asset.sourceHash}`, async () => {
      const gltf = await this.loader.loadAsync(asset.url);
      try {
        prepareStandardMaterials(gltf.scene, this.scope?.surfaceTemplates); sceneTextures(gltf.scene);
        let skinned = false; gltf.scene.traverse(object => { if (object instanceof THREE.SkinnedMesh) skinned = true; });
        const metadata = gltf.parser.json as { meshes?: { extras?: { bindposes?: number[] } }[] };
        return { scene: gltf.scene, bindposes: metadata.meshes?.[0]?.extras?.bindposes, skinned };
      } catch (error) { disposeSceneResources(gltf.scene); throw error; }
    }, model => artResources(model.scene), model => disposeSceneResources(model.scene));
  }
  private material(id: string): ArtLease<CachedMaterial> {
    return this.cache.acquire(`material:${this.catalogUrl}:${id}`, async () => {
      const asset = await this.entry(id), spec = await this.json<MaterialSpec>(asset.url), releases: (() => void)[] = [];
      const material = createSurfaceMaterial({ name: spec.name, roughness: spec.roughness ?? .9, metalness: spec.metalness ?? 0,
        side: spec.doubleSided || spec.effectRole === 'foliage' ? THREE.DoubleSide : THREE.FrontSide, transparent: spec.alphaMode === 'BLEND',
        depthWrite: spec.alphaMode !== 'BLEND', alphaTest: spec.alphaMode === 'MASK' || spec.effectRole === 'foliage' && !!spec.textures.baseColor ? spec.alphaCutoff ?? .5 : 0 });
      try {
        if (spec.color) { material.color.fromArray(spec.color); material.opacity = spec.color[3] ?? 1; }
        if (spec.emissive && spec.textures.emissive) material.emissive.fromArray(spec.emissive);
        for (const channel of ['baseColor', 'normal', 'emissive'] as const) {
          const mapping = spec.textures[channel]; if (!mapping) continue;
          const input = await this.entry(mapping.id);
          const base = this.scope ? await this.scope.texture(input.url, channel !== 'normal') : undefined;
          let texture = base ? base.texture.clone() : ownTexture(await new THREE.TextureLoader().loadAsync(input.url));
          texture.colorSpace = channel === 'normal' ? THREE.NoColorSpace : THREE.SRGBColorSpace; texture.flipY = false;
          texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.fromArray(mapping.scale); texture.offset.set(mapping.offset[0], 1 - mapping.scale[1] - mapping.offset[1]); filterMaterialTexture(texture);
          if (this.scope) { const view = this.scope.textureView(texture); texture = view.texture; releases.push(view.release); base?.release(); }
          else releases.push(() => texture.dispose());
          if (channel === 'baseColor') material.map = texture; else if (channel === 'normal') material.normalMap = texture; else material.emissiveMap = texture;
        }
        material.userData.effectRole = spec.effectRole; prepareSurfaceMaterial(material, undefined, 0, 2, this.scope?.surfaceTemplates);
        return { material, release: () => { material.dispose(); releases.forEach(release => release()); } };
      } catch (error) { material.dispose(); releases.forEach(release => release()); throw error; }
    }, value => Object.values(value.material).flatMap((map: unknown): ArtResource[] => isTexture(map) ? textureResources(map) : []), value => value.release());
  }
  loadAsset(id: string, options: LoadAssetOptions = {}): Promise<AssetInstance> {
    if (this.disposed) return Promise.reject(new Error('Asset library disposed')); return this.track(this.instantiate(id, options));
  }
  private async instantiate(id: string, options: LoadAssetOptions): Promise<AssetInstance> {
    const asset = await this.entry(id), leases: { release(): void }[] = [];
    if (!['model', 'assembly', 'mesh'].includes(asset.kind)) throw new Error(`Not a placeable asset: ${id}`);
    let object: THREE.Group | undefined;
    try {
      if (asset.kind === 'assembly') object = await assembleAsset(id, await this.json<AssemblySpec>(asset.url), {
        model: async id => { const lease = this.model(await this.entry(id)); leases.push(lease); return lease.ready; },
        material: async id => { const lease = this.material(id); leases.push(lease); return (await lease.ready).material; },
      });
      else { const lease = this.model(asset); leases.push(lease); const model = await lease.ready; object = new THREE.Group().add(model.skinned ? cloneSkeleton(model.scene) : model.scene.clone(true)); }
      if (this.disposed) throw new Error('Asset library disposed during load');
      const variants = options.materialVariant ? await Promise.all(options.materialVariant.map(async id => { const lease = this.material(id); leases.push(lease); return (await lease.ready).material; })) : undefined;
      const root = object;
      root.traverse(node => { if (!isMesh(node)) return; node.castShadow = node.receiveShadow = options.shadows ?? true; if (variants) node.material = variants.length === 1 ? variants[0] : variants; });
      prepareStandardMaterials(root); root.traverse(node => { if (node instanceof THREE.SkinnedMesh) root.userData.lodSkinned = true; });
      let released = false;
      const release = () => { if (released) return; released = true; root.removeFromParent(); disposeSceneInstances(root, { skeletons: true }); leases.forEach(lease => lease.release()); this.instances.delete(release); };
      this.instances.add(release); return { object: root, asset, release };
    } catch (error) { if (object) disposeSceneInstances(object, { skeletons: true }); leases.forEach(lease => lease.release()); throw error; }
  }
  dispose(): Promise<void> { this.disposed = true; return this.disposal ??= this.releaseResources(); }
  private async releaseResources(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]); this.instances.forEach(release => release());
    if (!this.scope) await this.cache.dispose();
  }
}
