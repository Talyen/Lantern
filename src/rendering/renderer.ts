import { prepareSceneryLoader } from '../assets/scenery-loader';
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';

/** Native WebGPU is a requirement, including labs and authoring previews. */
export async function createRenderer(mount: HTMLElement): Promise<WebGPURenderer> {
  if (!Reflect.get(navigator, 'gpu')) throw new Error('Native WebGPU is unavailable.');
  const renderer = new WebGPURenderer({ antialias: false });
  // Pinned to three.js r186: its constructor installs an internal fallback.
  // Disable it before init so unsupported devices never create another backend.
  if (!Reflect.has(renderer, '_getFallback')) throw new Error('WebGPU renderer integration needs updating.');
  Reflect.set(renderer, '_getFallback', null);
  try {
    await renderer.init();
    if (!Reflect.get(renderer.backend, 'isWebGPUBackend')) throw new Error('Native WebGPU backend unavailable.');
  } catch (error) {
    if (Reflect.get(renderer, '_initialized')) await renderer.dispose().catch(cleanupError => console.error('Unable to release failed graphics.', cleanupError));
    throw error;
  }
  // r186 resolves asynchronous shader compilation even when backend creation
  // failed. Add a rejecting promise so the shared graph can stop startup.
  const backend = renderer.backend as unknown as {
    createRenderPipeline: (object: { pipeline: object }, promises?: Promise<unknown>[] | null) => void;
    get: (pipeline: object) => { error?: boolean };
  };
  const createPipeline = backend.createRenderPipeline.bind(backend);
  backend.createRenderPipeline = (object, promises) => {
    const first = promises?.length ?? 0;
    createPipeline(object, promises);
    if (promises) {
      const compilation = promises.slice(first);
      promises.push(Promise.all(compilation).then(() => {
        if (backend.get(object.pipeline).error) throw new Error('WebGPU shader compilation failed.');
      }));
    }
  };
  const device = Reflect.get(renderer.backend, 'device') as EventTarget | undefined;
  device?.addEventListener('uncapturederror', event => {
    const error = Reflect.get(event, 'error') as { message?: string } | undefined;
    const message = error?.message ?? 'Native WebGPU rendering failed.';
    mount.dataset.renderError = message; renderer.domElement.dataset.renderError = message;
    console.error(message);
  });
  prepareSceneryLoader(renderer);
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.domElement.tabIndex = 0;
  renderer.domElement.dataset.renderer = 'webgpu';
  renderer.domElement.addEventListener('pointerdown', () => renderer.domElement.focus());
  mount.append(renderer.domElement);
  return renderer;
}
