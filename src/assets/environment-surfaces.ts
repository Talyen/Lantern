import { ownTexture, sceneTextures, isMesh } from './resource-ownership';
import * as THREE from 'three';
import { type MeshStandardNodeMaterial, MeshPhysicalNodeMaterial } from 'three/webgpu';
import manifest from '../../assets/textures/environment/manifest.json';
import { prepareSurfaceMaterial, prepareSurfaceHighlights } from '../rendering/surface-detail';
import type { AssetRef } from '../levels/types';
import { validateMaterial } from './material-validation';
import { materialRecipes, type MaterialFamily } from '../rendering/material-recipes';

export type SurfaceMode = 'projected' | 'authored' | 'showcase';
const variants = new Map(manifest.assets.map(asset => [asset.id, asset]));
const showcaseVariants = new Map(manifest.showcase.assets.map(asset => [asset.id, asset.url]));
const areaVariants = new Map(Object.entries(manifest.areaAssets).map(([area, assets]) => [area, new Map(assets.map(asset => [asset.id, asset.url]))]));
export function environmentSurface(ref: AssetRef, mode: SurfaceMode = 'projected', showcasePlacement = false, area?: string): string | undefined {
  const id = 'libraryId' in ref ? ref.libraryId : ref.url, variant = variants.get(id);
  if (import.meta.env.DEV && mode === 'showcase' && showcasePlacement) return showcaseVariants.get(id) ?? variant?.url;
  return mode === 'authored' ? variant?.sourceUrl : (area && areaVariants.get(area)?.get(id)) || variant?.url;
}
export function environmentOutlineEligible(ref: AssetRef): boolean {
  const id = 'libraryId' in ref ? ref.libraryId : ref.url;
  const asset = variants.get(id) ?? manifest.assets.find(asset => asset.url === id || 'sourceUrl' in asset && asset.sourceUrl === id);
  return !!asset && ['backpack', 'barrel', 'bedroll', 'chest', 'crate', 'lantern', 'log', 'rock', 'tent'].includes(asset.kind);
}
export function copyStandardNodeMaterial(source: THREE.MeshStandardMaterial | MeshStandardNodeMaterial): MeshStandardNodeMaterial {
  const material = new MeshPhysicalNodeMaterial().copy(source);
  prepareSurfaceHighlights(material);
  return material;
}
/** The area cache owns material textures, including optional relief sidecars. */
export async function prepareEnvironmentMaterials(root: THREE.Object3D, sourceUrl?: string): Promise<void> {
  const materials = new Map<THREE.Material, MeshStandardNodeMaterial>();
  const sources: string[] = [], missing: string[] = [];
  const asset = [...manifest.assets, ...manifest.showcase.assets, ...Object.values(manifest.areaAssets).flat()].find(asset => asset.url === sourceUrl);
  const family: MaterialFamily | undefined = asset?.kind === 'rock' || asset?.kind === 'campfire' ? 'stone' : asset?.kind === 'pine' || asset?.kind === 'log' ? 'bark' : asset ? 'timber' : undefined;
  root.traverse(object => {
    if (!isMesh(object)) return;
    const convert = (source: THREE.Material) => {
      if (!(source instanceof THREE.MeshStandardMaterial)) return source;
      let material = materials.get(source);
      if (!material) { material = copyStandardNodeMaterial(source); materials.set(source, material); }
      return material;
    };
    object.material = Array.isArray(object.material) ? object.material.map(convert) : convert(object.material);
  });
  await Promise.all([...materials.values()].map(async material => {
    const descriptor = material.userData.lanternSurface as { url?: string; depth: number; version: number; family?: MaterialFamily } | undefined;
    if (descriptor && (!Number.isFinite(descriptor.depth) || descriptor.depth < 0 || ![1, 2, 3].includes(descriptor.version))) {
      missing.push(`material:${material.name}:invalid relief metadata`); delete material.userData.lanternSurface; prepareSurfaceMaterial(material); return;
    }
    if (descriptor?.family && !Object.hasOwn(materialRecipes.families, descriptor.family)) {
      missing.push(`material:${material.name}:unknown recipe family`); delete descriptor.family;
    }
    if (descriptor && !descriptor.family && family) descriptor.family = family;
    let data: THREE.Texture | undefined;
    if (descriptor?.version === 3) data = material.roughnessMap ?? undefined;
    else if (descriptor?.url && [1, 2].includes(descriptor.version) && descriptor.url.startsWith('/vendor/synty/environment/') && !descriptor.url.includes('..')) {
      try {
        const loader = new THREE.ImageBitmapLoader().setOptions({ premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
        const bitmap = await loader.loadAsync(descriptor.url); data = ownTexture(new THREE.Texture(bitmap)); data.needsUpdate = true; data.flipY = false;
        data.channel = material.map?.channel ?? 0; data.colorSpace = THREE.NoColorSpace; sources.push(descriptor.url);
      } catch { missing.push(descriptor.url); }
    }
    prepareSurfaceMaterial(material, data, descriptor?.depth ?? 0, descriptor?.version === 3 ? 3 : descriptor?.version === 1 ? 1 : 2);
  }));
  root.traverse(object => {
    if (!isMesh(object)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) if (material instanceof THREE.MeshStandardMaterial) {
      for (const issue of validateMaterial(material, object.geometry, !!material.userData.lanternSurface)) missing.push(`material:${object.name}:${issue.material}:${issue.message}`);
    }
  });
  root.userData.surfaceSources = sources; root.userData.surfaceMissing = missing;
  materials.forEach((_material, source) => source.dispose());
  sceneTextures(root);
}
