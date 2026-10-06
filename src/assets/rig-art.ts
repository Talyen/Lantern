import type { RuntimeAssets, RigArt } from './runtime-assets';
import type { ArtLease } from './art-cache';

/** Every cloned actor keeps its immutable source art leased until disposal. */
export function loadRigArt(resources: RuntimeAssets, url: string, signal?: AbortSignal): ArtLease<RigArt> {
  return resources.acquireRig(url, true, signal);
}
