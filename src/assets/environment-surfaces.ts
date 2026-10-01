import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import manifest from '../../assets/textures/environment/manifest.json';
import type { AssetRef } from '../levels/types';

export type SurfaceMode = 'projected' | 'authored';
const variants = new Map(manifest.assets.map(asset => [asset.id, asset]));
export function environmentSurface(ref: AssetRef, mode: SurfaceMode = 'projected'): string | undefined {
  const variant = variants.get('libraryId' in ref ? ref.libraryId : ref.url);
  return mode === 'projected' ? variant?.url : variant?.sourceUrl;
}

/** Authored solid families only; plants and campfire effects remain quiet in outline mode. */
export function environmentOutlineEligible(ref: AssetRef): boolean {
  const id = 'libraryId' in ref ? ref.libraryId : ref.url;
  const asset = variants.get(id) ?? manifest.assets.find(asset => asset.url === id || 'sourceUrl' in asset && asset.sourceUrl === id);
  return !!asset && ['backpack', 'barrel', 'bedroll', 'chest', 'crate', 'lantern', 'log', 'rock', 'tent'].includes(asset.kind);
}

/** Native node copy preserves authored maps, intensities and render state, sharing cached textures. */
export function copyStandardNodeMaterial(source: THREE.MeshStandardMaterial | MeshStandardNodeMaterial): MeshStandardNodeMaterial {
  return new MeshStandardNodeMaterial().copy(source);
}

/** Baked surfaces use node materials; the existing area cache owns shared maps and disposal. */
export function prepareEnvironmentMaterials(root: THREE.Object3D): void {
  const materials = new Map<THREE.Material, MeshStandardNodeMaterial>();
  function convert(source: THREE.Material): THREE.Material {
    if (!(source instanceof THREE.MeshStandardMaterial)) return source;
    let material = materials.get(source);
    if (!material) {
      material = copyStandardNodeMaterial(source);
      materials.set(source, material);
    }
    return material;
  }
  root.traverse(object => { if (object instanceof THREE.Mesh) object.material = Array.isArray(object.material) ? object.material.map(convert) : convert(object.material); });
  materials.forEach((_material, original) => original.dispose());
}
