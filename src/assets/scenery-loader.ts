import type { WebGPURenderer } from 'three/webgpu';
import { cancelNativePreparation } from '../rendering/native-preparation';
import { runtimeAssets } from './runtime-assets';

/** Native capability detection and art lifetime belong to this renderer. */
export async function prepareSceneryLoader(renderer: WebGPURenderer): Promise<void> {
  const resources = runtimeAssets(renderer);
  await resources.initialize();
  const dispose = renderer.dispose.bind(renderer);
  let disposal: Promise<void> | undefined;
  renderer.dispose = () => disposal ??= (async () => {
    await cancelNativePreparation(renderer); await resources.dispose(); await dispose();
  })();
}
