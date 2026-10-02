import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import manifest from '../../assets/textures/environment/manifest.json';
import { prepareSurfaceMaterial } from '../rendering/surface-detail';
import type { AssetRef } from '../levels/types';

export type SurfaceMode = 'projected' | 'authored' | 'showcase';
const variants = new Map(manifest.assets.map(asset => [asset.id, asset]));
const showcaseVariants = new Map(manifest.showcase.assets.map(asset => [asset.id, asset.url]));
export function environmentSurface(ref: AssetRef, mode: SurfaceMode = 'projected', showcasePlacement = false): string | undefined {
  const id = 'libraryId' in ref ? ref.libraryId : ref.url, variant = variants.get(id);
  if (import.meta.env.DEV && mode === 'showcase' && showcasePlacement) return showcaseVariants.get(id) ?? variant?.url;
  return mode === 'authored' ? variant?.sourceUrl : variant?.url;
}
export function environmentOutlineEligible(ref: AssetRef): boolean {
  const id = 'libraryId' in ref ? ref.libraryId : ref.url;
  const asset = variants.get(id) ?? manifest.assets.find(asset => asset.url === id || 'sourceUrl' in asset && asset.sourceUrl === id);
  return !!asset && ['backpack', 'barrel', 'bedroll', 'chest', 'crate', 'lantern', 'log', 'rock', 'tent'].includes(asset.kind);
}
export function copyStandardNodeMaterial(source: THREE.MeshStandardMaterial | MeshStandardNodeMaterial): MeshStandardNodeMaterial {
  return new MeshStandardNodeMaterial().copy(source);
}
/** The area cache owns material textures, including optional relief sidecars. */
export async function prepareEnvironmentMaterials(root: THREE.Object3D): Promise<void> {
  const materials = new Map<THREE.Material, MeshStandardNodeMaterial>();
  const sources: string[] = [], missing: string[] = [];
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const convert = (source: THREE.Material) => {
      if (!(source instanceof THREE.MeshStandardMaterial)) return source;
      let material = materials.get(source);
      if (!material) { material = copyStandardNodeMaterial(source); materials.set(source, material); }
      return material;
    };
    object.material = Array.isArray(object.material) ? object.material.map(convert) : convert(object.material);
  });
  await Promise.all([...materials.values()].map(async material => {
    const descriptor = material.userData.lanternSurface as { url: string; depth: number; version: number } | undefined;
    let data: THREE.Texture | undefined;
    if (descriptor && [1, 2].includes(descriptor.version) && descriptor.url.startsWith('/vendor/synty/environment/') && !descriptor.url.includes('..')) {
      try {
        const loader = new THREE.ImageBitmapLoader().setOptions({ premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
        const bitmap = await loader.loadAsync(descriptor.url); data = new THREE.Texture(bitmap); data.needsUpdate = true; data.flipY = false;
        data.addEventListener('dispose', () => bitmap.close());
        data.channel = material.map?.channel ?? 0; data.colorSpace = THREE.NoColorSpace; sources.push(descriptor.url);
      } catch { missing.push(descriptor.url); }
    }
    prepareSurfaceMaterial(material, data, descriptor?.depth ?? 0, descriptor?.version === 1 ? 1 : 2);
  }));
  root.userData.surfaceSources = sources; root.userData.surfaceMissing = missing;
  materials.forEach((_material, source) => source.dispose());
}
