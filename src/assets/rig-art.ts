import type { GLTFLoader, GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { cachedRequest } from '../data/cached-request';
import { disposeSceneResources, sceneTextures } from './resource-ownership';
import { prepareStandardMaterials } from '../rendering/surface-detail';

const rigs = new Map<string, Promise<GLTF>>();
/** Immutable rig art survives outings; each actor owns its cloned skeleton/mixer. */
export function loadRigArt(loader: GLTFLoader, url: string): Promise<GLTF> {
  return cachedRequest(rigs, url, async () => {
    const gltf = await loader.loadAsync(url);
    try { sceneTextures(gltf.scene); prepareStandardMaterials(gltf.scene); return gltf; }
    catch (error) { disposeSceneResources(gltf.scene); throw error; }
  });
}
export async function disposeRigArt(): Promise<void> {
  const loaded = await Promise.allSettled(rigs.values());
  rigs.clear();
  for (const result of loaded) if (result.status === 'fulfilled') disposeSceneResources(result.value.scene);
}
