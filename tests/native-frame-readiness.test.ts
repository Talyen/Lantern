import { afterEach, expect, test, vi } from 'vitest';
import { nativePreparation } from '../src/rendering/native-preparation';
import type * as NativeGpu from 'three/webgpu';

// Consequential regression: WebGPU can skip objects whose async pipelines are
// pending. Such a submission must not reveal an incomplete world or hide errors.
const fixture = vi.hoisted(() => {
  let resolve!: () => void;
  let promise: Promise<void>;
  const state = { error: false };
  const queue = { onSubmittedWorkDone: vi.fn(() => Promise.resolve()) };
  return { native: false, push: vi.fn(), pop: vi.fn(async () => null), state, queue, reset() { this.native = false; state.error = false; promise = new Promise<void>(done => { resolve = done; }); }, finish() { resolve(); }, pending() { return promise; } };
});
vi.mock('../src/assets/scenery-loader', () => ({ prepareSceneryLoader() {} }));
vi.mock('../src/diagnostics/report', () => ({ recordFailure() {} }));
vi.mock('three/webgpu', async importOriginal => ({ ...await importOriginal<typeof NativeGpu>(), WebGPURenderer: class {
  _getFallback = () => {};
  _initialized = true;
  _getShadowNodes() { return { colorNode: null, depthNode: null, positionNode: null }; }
  _renderObjectDirect() {}
  _handleObjectFunction = this._renderObjectDirect;
  _nodes = { nodeBuilderCache: new Map(), _createNodeBuilder: () => ({ context: {}, build() {}, async buildAsync() {} }) };
  _objects = {};
  library = { fromMaterial: (material: unknown) => material, lightNodes: new WeakMap() };
  backend = {
    isWebGPUBackend: true,
    device: { queue: fixture.queue, addEventListener() {}, pushErrorScope: fixture.push, popErrorScope: fixture.pop,
      createRenderPipelineAsync: (_descriptor: object) => fixture.pending().then(() => ({})) },
    createRenderPipeline(_object: unknown, promises: Promise<unknown>[] | null) {
      if (!fixture.native) { promises?.push(fixture.pending()); return; }
      const device = this.device;
      device.pushErrorScope('validation');
      promises?.push(device.createRenderPipelineAsync({ layout: 'auto', vertex: { module: {} } }).then(() => device.popErrorScope()));
    },
    get() { return fixture.state; },
  };
  domElement = { dataset: {}, addEventListener() {}, focus() {} };
  shadowMap = {};
  async init() {}
  setPixelRatio() {}
} }));
import { nativePreparationDiagnostics } from '../src/rendering/native-preparation';
import { createRenderer, renderNativeFrame, preparingNativeFrame, finishSubmittedFrame, resetNativeFrameCompilation, waitForPresentedFrames } from '../src/rendering/renderer';

async function renderer() {
  fixture.reset(); vi.stubGlobal('navigator', { gpu: {} });
  return createRenderer({ append() {} } as unknown as HTMLElement);
}
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

test('skipped async world shaders cannot count as ready destination frames', async () => {
  const gpu = await renderer(), draw = vi.fn(() => {
    const backend = gpu.backend as unknown as { createRenderPipeline(object: { pipeline: object }, promises: Promise<void>[] | null): void };
    backend.createRenderPipeline({ pipeline: {} }, null);
  });
  expect(renderNativeFrame(gpu, draw)).toBe(false);
  expect(preparingNativeFrame(gpu)).toBe(true);
  expect(renderNativeFrame(gpu, draw)).toBe(false);
  expect(draw).toHaveBeenCalledTimes(1);
  fixture.finish(); await new Promise(resolve => setTimeout(resolve, 0));
  expect(preparingNativeFrame(gpu)).toBe(false);
  expect(renderNativeFrame(gpu, () => {})).toBe(true);
});

test('a rejected native world shader stops readiness instead of revealing missing scenery', async () => {
  const gpu = await renderer();
  const backend = gpu.backend as unknown as { createRenderPipeline(object: { pipeline: object }, promises: Promise<void>[] | null): void };
  renderNativeFrame(gpu, () => backend.createRenderPipeline({ pipeline: {} }, null));
  fixture.state.error = true; fixture.finish(); await new Promise(resolve => setTimeout(resolve, 0));
  expect(() => renderNativeFrame(gpu, () => {})).toThrow('WebGPU shader compilation failed');
});

test('destination reveal waits for submitted GPU work and rejects a reported GPU failure', async () => {
  const gpu = await renderer();
  let complete!: () => void;
  fixture.queue.onSubmittedWorkDone.mockImplementationOnce(() => new Promise<void>(resolve => { complete = resolve; }));
  let revealed = false;
  const readiness = finishSubmittedFrame(gpu).then(() => { revealed = true; });
  await Promise.resolve(); expect(revealed).toBe(false);
  complete(); await readiness; expect(revealed).toBe(true);
  gpu.domElement.dataset.renderError = 'GPU validation failed';
  await expect(finishSubmittedFrame(gpu)).rejects.toThrow('GPU validation failed');
});

// Review approval and private thumbnails must observe successful draws rather
// than RAF callbacks; the compiler-only fixtures above do not exercise that wait.
test('preview readiness survives skipped callbacks and waits for GPU completion without revealing a cancelled selection', async () => {
  const gpu = await renderer();
  let nextFrame!: FrameRequestCallback, frames = 0, current = true, complete!: () => void;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { nextFrame = callback; return 1; });
  fixture.queue.onSubmittedWorkDone.mockImplementationOnce(() => new Promise<void>(resolve => { complete = resolve; }));
  let ready: boolean | undefined;
  const wait = waitForPresentedFrames(gpu, () => frames, 2, () => current).then(value => { ready = value; });
  for (let i = 0; i < 100; i++) { nextFrame(i); await Promise.resolve(); }
  expect(ready).toBeUndefined(); expect(fixture.queue.onSubmittedWorkDone).not.toHaveBeenCalled();
  frames = 1; nextFrame(101); await Promise.resolve(); expect(ready).toBeUndefined();
  frames = 2; nextFrame(102); await Promise.resolve(); expect(ready).toBeUndefined();
  current = false; complete(); await wait;
  expect(ready).toBe(false);
  current = true;
  const presented = waitForPresentedFrames(gpu, () => frames, 1, () => current);
  frames++; nextFrame(103); await expect(presented).resolves.toBe(true);
});

test('retry and another adventure cannot inherit a disposed session compilation failure', async () => {
  const gpu = await renderer();
  const backend = gpu.backend as unknown as { createRenderPipeline(object: { pipeline: object }, promises: Promise<void>[] | null): void };
  renderNativeFrame(gpu, () => backend.createRenderPipeline({ pipeline: {} }, null));
  resetNativeFrameCompilation(gpu);
  fixture.state.error = true; fixture.finish(); await new Promise(resolve => setTimeout(resolve, 0));
  expect(renderNativeFrame(gpu, () => {})).toBe(true);
  fixture.reset();
  renderNativeFrame(gpu, () => backend.createRenderPipeline({ pipeline: {} }, null));
  fixture.state.error = true; fixture.finish(); await new Promise(resolve => setTimeout(resolve, 0));
  expect(() => renderNativeFrame(gpu, () => {})).toThrow('WebGPU shader compilation failed');
  resetNativeFrameCompilation(gpu);
  expect(renderNativeFrame(gpu, () => {})).toBe(true);
});

test('timestamped module copies retain the native renderer compilation lifetime', async () => {
  const gpu = await renderer();
  vi.resetModules();
  const refreshed = await import('../src/rendering/renderer');
  expect(refreshed.renderNativeFrame(gpu, () => {})).toBe(true);
  refreshed.resetNativeFrameCompilation(gpu);
  expect(renderNativeFrame(gpu, () => {})).toBe(true);
});

// Admission: the real r186 adapter must keep both native concurrency and validation
// scope ordering bounded when the GPU completes several pipelines together.
test('native pipeline admission stays at four and pops each validation scope before awaiting compilation', async () => {
  const gpu = await renderer(); fixture.native = true;
  const backend = gpu.backend as unknown as { createRenderPipeline(object: { pipeline: object }, promises: Promise<void>[] | null): void };
  renderNativeFrame(gpu, () => { for (let i = 0; i < 8; i++) backend.createRenderPipeline({ pipeline: {} }, null); });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(nativePreparationDiagnostics(gpu).pipelines).toMatchObject({ running: 4, queued: 4, peak: 4 });
  expect(fixture.push).toHaveBeenCalledTimes(4); expect(fixture.pop).toHaveBeenCalledTimes(4);
  fixture.finish(); await new Promise(resolve => setTimeout(resolve, 0));
  expect(nativePreparationDiagnostics(gpu).pipelines).toMatchObject({ running: 0, queued: 0, peak: 4 });
  expect(fixture.push).toHaveBeenCalledTimes(8); expect(fixture.pop).toHaveBeenCalledTimes(8);
  expect(renderNativeFrame(gpu, () => {})).toBe(true);
});

// Admission: the real Graveyard reflection target has multiple attachments.
// Deferring with the renderer's subsequently restored MRT produced a shader
// without the required outputs and stopped world preparation.
test('deferred node builds preserve the render object MRT rather than restored renderer state', async () => {
  const gpu = await renderer(), passMRT = {}, restoredMRT = {}, lights = { getLights: () => [], setLights() {} };
  let current: object | null = restoredMRT, observed: object | null = null;
  Object.assign(gpu, { contextNode: {}, getRenderTarget: () => null, setRenderTarget() {}, getMRT: () => current, setMRT: (value: object | null) => { current = value; },
    _objects: { get: () => ({ initialCacheKey: 123, context: { mrt: passMRT }, material: {}, pipeline: {} }) },
  });
  const nodes = Reflect.get(gpu, '_nodes') as { getForRender?: () => Promise<object> };
  nodes.getForRender = async () => { observed = current; return {}; };
  // The installed object manager belongs to the fixture; reinstall for this pass.
  const { installNativePreparation } = await import('../src/rendering/native-preparation');
  installNativePreparation(gpu);
  const direct = Reflect.get(gpu, '_renderObjectDirect') as (...args: unknown[]) => void;
  renderNativeFrame(gpu, () => direct({ geometry: { drawRange: {} } }, {}, {}, {}, lights, null, null, 'reflection'));
  await nativePreparation(gpu).builders.idle();
  expect(observed).toBe(passMRT); expect(current).toBe(restoredMRT);
});
