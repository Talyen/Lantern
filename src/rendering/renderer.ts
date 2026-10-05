import { displayPixelRatio, watchDisplayResolution } from './display-resolution';
import { recordFailure } from '../diagnostics/report';
import { prepareSceneryLoader } from '../assets/scenery-loader';
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';

type FrameCompilation = { generation: number; asynchronous: boolean; pending: Set<Promise<void>>; failure?: Error };
// Vite can load different timestamped copies of this owner during a reload.
// Keep the state on the native renderer so every shared graph sees its lifetime.
const frameCompilationKey = Symbol.for('lantern.nativeFrameCompilation');
function frameCompilation(renderer: WebGPURenderer): FrameCompilation | undefined {
  return Reflect.get(renderer, frameCompilationKey) as FrameCompilation | undefined;
}

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
  // r186 resolves asynchronous shader compilation even when backend creation
  // failed. Add a rejecting promise so the shared graph can stop startup.
  const backend = renderer.backend as unknown as {
    createRenderPipeline: (object: { pipeline: object }, promises?: Promise<unknown>[] | null) => void;
    get: (pipeline: object) => { error?: boolean };
  };
  const createPipeline = backend.createRenderPipeline.bind(backend);
  const frames: FrameCompilation = { generation: 0, asynchronous: false, pending: new Set() };
  Reflect.set(renderer, frameCompilationKey, frames);
  backend.createRenderPipeline = (object, promises) => {
    // Live graph rendering must not synchronously block Safari on first-use
    // shaders. Explicit compileAsync and probe captures keep their own policy.
    const deferredFrame = promises === null && frames.asynchronous;
    const compilations = deferredFrame ? [] : promises;
    const first = compilations?.length ?? 0;
    createPipeline(object, compilations);
    if (compilations) {
      const pipeline = object.pipeline;
      const ready = Promise.all(compilations.slice(first)).then(() => {
        if (backend.get(pipeline).error) throw new Error('WebGPU shader compilation failed.');
      });
      if (deferredFrame) {
        const generation = frames.generation;
        frames.pending.add(ready);
        ready.then(() => frames.pending.delete(ready), (error: unknown) => {
          frames.pending.delete(ready);
          if (generation !== frames.generation) return;
          frames.failure = error instanceof Error ? error : new Error(String(error));
          recordFailure('gpu-compilation', frames.failure);
        });
      } else compilations.push(ready);
    }
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
  prepareSceneryLoader(renderer);
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
  return (frameCompilation(renderer)?.pending.size ?? 0) > 0;
}

/** Retry/another adventure owns a new frame lifetime on the retained renderer.
 * Late compilation errors from a disposed session cannot poison that lifetime. */
export function resetNativeFrameCompilation(renderer: WebGPURenderer): void {
  const frames = frameCompilation(renderer);
  if (!frames) throw new Error('Native WebGPU compilation tracking is unavailable.');
  frames.generation++;
  frames.pending.clear();
  frames.failure = undefined;
}
