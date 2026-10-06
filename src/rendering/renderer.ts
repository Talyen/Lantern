import { installSurfaceShadowTemplates } from './surface-detail';
import { installIndirectLighting } from './indirect-lighting';
import { displayPixelRatio, watchDisplayResolution } from './display-resolution';
import { recordFailure } from '../diagnostics/report';
import { installNativePreparation, nativePreparation, trackNative, snapshotNativeDescriptor, cancelNativePreparation, type NativePipelineDescriptor, type NativePipelineDevice } from './native-preparation';
import { prepareSceneryLoader } from '../assets/scenery-loader';
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';

const frameCompilation = nativePreparation;

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
    if (Reflect.get(renderer, '_initialized')) await renderer.dispose().catch((cleanupError: unknown) => console.error('Unable to release failed graphics.', cleanupError));
    throw error;
  }
  // Snapshot native descriptors synchronously while r186's current pass is
  // valid. Each queued submission owns a device validation scope, popped before
  // awaiting compilation, so out-of-order completion cannot steal another error.
  const backend = renderer.backend as unknown as {
    device: NativePipelineDevice;
    createRenderPipeline: (object: { pipeline: object }, promises?: Promise<unknown>[] | null) => void;
    get: (pipeline: object) => { error?: boolean };
  };
  const createPipeline = backend.createRenderPipeline.bind(backend);
  const frames = installNativePreparation(renderer);
  backend.createRenderPipeline = (object, promises) => {
    if (promises === null && !frames.asynchronous) { createPipeline(object, promises); return; }
    const nativeDevice = backend.device, pipeline = object.pipeline, compilations: Promise<unknown>[] = [];
    let filter: 'validation' = 'validation', validation = Promise.resolve<{ message?: string } | null>(null);
    const scoped = new Proxy(nativeDevice, { get(target, property) {
      if (property === 'pushErrorScope') return (value: 'validation') => { filter = value; };
      if (property === 'popErrorScope') return () => validation;
      if (property === 'createRenderPipelineAsync') return (descriptor: NativePipelineDescriptor) => {
        const snapshot = snapshotNativeDescriptor(descriptor);
        let finishValidation!: (error: { message?: string } | null) => void;
        validation = new Promise(resolve => { finishValidation = resolve; });
        return frames.pipelines.run(async () => {
          nativeDevice.pushErrorScope(filter);
          let pipeline: Promise<object>;
          try { pipeline = nativeDevice.createRenderPipelineAsync(snapshot); }
          catch (error) { pipeline = Promise.reject(error); }
          const scope = nativeDevice.popErrorScope();
          // Pop now; waiting would nest scopes across concurrent compilations.
          const results = await Promise.allSettled([pipeline, scope]);
          const checked = results[1]; finishValidation(checked.status === 'fulfilled' ? checked.value : null);
          if (checked.status === 'rejected') throw checked.reason;
          const result = results[0]; if (result.status === 'rejected') throw result.reason;
          return result.value;
        }, 0, frames.abort.signal).catch((error: unknown) => { finishValidation(null); throw error; });
      };
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) as unknown : value;
    } });
    backend.device = scoped;
    try { createPipeline(object, compilations); } finally { backend.device = nativeDevice; }
    const ready = Promise.all(compilations).then(() => {
      if (backend.get(pipeline).error) throw new Error('WebGPU shader compilation failed.');
    });
    void trackNative(renderer, ready).catch(() => {});
    if (promises) promises.push(ready);
  };
  const device = Reflect.get(renderer.backend, 'device') as (EventTarget & { lost?: Promise<{ reason: string; message: string }> }) | undefined;
  device?.addEventListener('uncapturederror', event => {
    const error = Reflect.get(event, 'error') as { message?: string } | undefined;
    const message = error?.message ?? 'Native WebGPU rendering failed.';
    mount.dataset.renderError = message; renderer.domElement.dataset.renderError = message;
    recordFailure('gpu', message);
    console.error(message);
  });
  device?.lost?.then(info => {
    if (info.reason === 'destroyed') return;
    const message = `Graphics device lost. ${info.message}`;
    mount.dataset.renderError = message;
    recordFailure('gpu-device-lost', message);
  }).catch((error: unknown) => recordFailure('gpu-device-lost', error));
  installIndirectLighting(renderer); installSurfaceShadowTemplates(renderer);
  await prepareSceneryLoader(renderer);
  watchDisplayResolution(); renderer.setPixelRatio(displayPixelRatio());
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

/** Submission is not presentation: keep startup/travel covered until the native
 * queue has finished drawing the destination, including first-use pipelines. */
export async function finishSubmittedFrame(renderer: WebGPURenderer): Promise<void> {
  const device = Reflect.get(renderer.backend, 'device') as { queue?: { onSubmittedWorkDone(): Promise<void> } } | undefined;
  if (!device?.queue) throw new Error('Native WebGPU frame readiness is unavailable. Reload Lantern.');
  await device.queue.onSubmittedWorkDone();
  const error = renderer.domElement.dataset.renderError;
  if (error) throw new Error(error);
}

/** Observe an owner's ongoing loop without submitting extra temporal frames.
 * Only completed draws advance its counter; cancellation cannot reveal another selection. */
export async function waitForPresentedFrames(renderer: WebGPURenderer, completedFrames: () => number, count: number, current: () => boolean): Promise<boolean> {
  const target = completedFrames() + count;
  while (current()) {
    const failure = frameCompilation(renderer)?.failure;
    if (failure) throw failure;
    const error = renderer.domElement.dataset.renderError;
    if (error) throw new Error(error);
    if (completedFrames() >= target) {
      await finishSubmittedFrame(renderer);
      return current();
    }
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
  return false;
}

/** A frame with skipped, still-compiling objects cannot satisfy world readiness. */
export function renderNativeFrame(renderer: WebGPURenderer, render: () => void): boolean {
  const frames = frameCompilation(renderer);
  if (!frames) throw new Error('Native WebGPU compilation tracking is unavailable.');
  if (frames.failure) throw frames.failure;
  if (frames.pending.size) return false;
  frames.asynchronous = true;
  try { render(); } finally { frames.asynchronous = false; }
  return frames.pending.size === 0;
}

export function preparingNativeFrame(renderer: WebGPURenderer): boolean {
  return pendingNativeCompilations(renderer) > 0;
}

export function pendingNativeCompilations(renderer: WebGPURenderer): number {
  return frameCompilation(renderer)?.pending.size ?? 0;
}

/** Retry/another adventure owns a new frame lifetime on the retained renderer.
 * Late compilation errors from a disposed session cannot poison that lifetime. */
export function resetNativeFrameCompilation(renderer: WebGPURenderer): void {
  const frames = frameCompilation(renderer);
  if (!frames) throw new Error('Native WebGPU compilation tracking is unavailable.');
  frames.generation++; frames.abort.abort(); frames.abort = new AbortController();
  frames.pending.clear(); frames.building.clear(); frames.failure = undefined;
}

export { cancelNativePreparation };
