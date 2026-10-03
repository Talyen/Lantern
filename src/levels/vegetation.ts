import manifest from '../../assets/textures/environment/manifest.json';
import type { Placement, VegetationProfile } from './types';

/** Classify the canonical reference before prepared surface substitution. */
export function vegetationProfile(placement: Placement): VegetationProfile | undefined {
  if (placement.vegetation !== undefined) return placement.vegetation || undefined;
  const ref = placement.asset;
  if (!ref) return;
  const id = 'libraryId' in ref ? ref.libraryId : ref.url;
  const asset = manifest.assets.find(asset => asset.id === id || asset.url === id || asset.sourceUrl === id);
  return asset?.kind === 'bush' ? 'shrub' : asset?.kind === 'fern' ? 'soft' : undefined;
}
