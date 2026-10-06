import type { WebGPURenderer } from 'three/webgpu';
import { LoadQueue } from '../assets/load-queue';
import { recordFailure } from '../diagnostics/report';

// The pinned three.js declarations omit native WebGPU descriptor types.
type Stage = { module: object; constants?: Record<string, number>; [key: string]: unknown };
type Blend = { color: Record<string, unknown>; alpha: Record<string, unknown> };
export type NativePipelineDescriptor = {
  layout: object | 'auto'; vertex: Stage & { buffers?: Iterable<{ attributes: Iterable<Record<string, unknown>>; [key: string]: unknown } | null> };
  fragment?: Stage & { targets: Iterable<{ blend?: Blend; [key: string]: unknown } | null> };
  primitive?: Record<string, unknown>; multisample?: Record<string, unknown>;
  depthStencil?: { stencilFront?: Record<string, unknown>; stencilBack?: Record<string, unknown>; [key: string]: unknown };
  [key: string]: unknown;
};
export type NativePipelineDevice = {
  pushErrorScope(filter: 'validation'): void; popErrorScope(): Promise<{ message?: string } | null>;
  createRenderPipelineAsync(descriptor: NativePipelineDescriptor): Promise<object>;
};
type RenderObject = { initialCacheKey: number; pipeline: object; context: object; material: object; getBindings(): unknown[] };
type Builder = { context: object; build(): unknown; buildAsync(): Promise<unknown> };
type Nodes = { nodeBuilderCache: Map<number, object>; getForRender(object: RenderObject, asynchronous?: boolean): object | Promise<object>; _createNodeBuilder(object: RenderObject, material: object): Builder };
type RenderDirect = (...args: unknown[]) => void;
export type NativePreparation = {
  generation: number; asynchronous: boolean; pending: Set<Promise<void>>; failure?: Error; abort: AbortController;
  builders: LoadQueue; pipelines: LoadQueue; building: Map<number, Promise<void>>; builds: number; buildersCreated: number; builderKinds: Map<string, number>;
  primedLights: WeakSet<object>; primingLights: WeakSet<object>; yieldedAt: number;
};
const preparationKey = Symbol.for('lantern.nativePreparation');
export function nativePreparation(renderer: WebGPURenderer): NativePreparation {
  const state = Reflect.get(renderer, preparationKey) as NativePreparation | undefined;
  if (!state) throw new Error('Native WebGPU preparation tracking is unavailable.'); return state;
}
export function installNativePreparation(renderer: WebGPURenderer): NativePreparation {
  const state: NativePreparation = { generation: 0, asynchronous: false, pending: new Set(), abort: new AbortController(), builders: new LoadQueue(1), pipelines: new LoadQueue(4), building: new Map(), builds: 0, buildersCreated: 0, builderKinds: new Map(), primedLights: new WeakSet(), primingLights: new WeakSet(), yieldedAt: performance.now() };
  Reflect.set(renderer, preparationKey, state);
  const direct = Reflect.get(renderer, '_renderObjectDirect') as RenderDirect | undefined;
  const nodes = Reflect.get(renderer, '_nodes') as Nodes | undefined;
  const objects = Reflect.get(renderer, '_objects') as { get(...args: unknown[]): RenderObject } | undefined;
  if (!direct || !nodes || !objects) throw new Error('Native WebGPU shader preparation integration needs updating.');
  const preparedMaterials = new WeakMap<RenderObject, object>();
  const createBuilder = nodes._createNodeBuilder?.bind(nodes);
  if (!createBuilder) throw new Error('Native WebGPU shader failure integration needs updating.');
  nodes._createNodeBuilder = (object, material) => {
    state.buildersCreated++;
    const mrt = Reflect.get(object.context, 'mrt') as { outputNodes?: object } | null;
    const kind = `${String(Reflect.get(material, 'type')).slice(0, 40)}:${mrt ? Object.keys(mrt.outputNodes ?? {}).sort().join(',') : 'single'}`;
    if (state.builderKinds.has(kind) || state.builderKinds.size < 16) state.builderKinds.set(kind, (state.builderKinds.get(kind) ?? 0) + 1);
    const builder = createBuilder(object, preparedMaterials.get(object) ?? material), generation = state.generation;
    let source: unknown = Reflect.get(object, '_sourceMaterial');
    const mesh = Reflect.get(object, 'object') as { material?: object | object[] } | undefined;
    const scene = Reflect.get(object, 'scene') as { overrideMaterial?: object | null } | undefined;
    if (!source && scene?.overrideMaterial === material && mesh?.material) {
      const group = Reflect.get(object, 'group') as { materialIndex?: number } | null;
      source = Array.isArray(mesh.material) ? mesh.material[group?.materialIndex ?? 0] : mesh.material;
    }
    Reflect.set(builder.context, 'lanternSurfaceMaterial', source ?? material);
    const failed = (error: unknown) => {
      if (generation !== state.generation) return;
      state.failure = error instanceof Error ? error : new Error(String(error)); recordFailure('shader-node', state.failure);
    };
    const build = builder.build.bind(builder);
    builder.build = () => { try { return build(); } catch (error) { failed(error); throw error; } };
    builder.buildAsync = async () => {
      // r186 yields nine times per tiny builder. The renderer's single admission
      // queue instead yields between builds after an 8ms batch, retaining its
      // main-thread responsiveness without thousands of nested timer pauses.
      if (performance.now() - state.yieldedAt >= 8) {
        await new Promise<void>(resolve => {
          const channel = new MessageChannel();
          channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); };
          channel.port2.postMessage(null);
        });
        state.yieldedAt = performance.now();
      }
      return builder.build();
    };
    return builder;
  };
  const render = direct.bind(renderer);
  const deferred: RenderDirect = (...args) => {
    if (!state.asynchronous) { render(...args); return; }
    const [object, material, scene, camera, lights, group, clipping, passId] = args;
    const context: unknown = Reflect.get(renderer, '_currentRenderContext');
    const renderObject = objects.get(object, material, scene, camera, lights, context, clipping, passId);
    Reflect.set(renderObject, 'group', group);
    const geometry = Reflect.get(object as object, 'geometry') as { drawRange: unknown };
    Reflect.set(renderObject, 'drawRange', geometry.drawRange);
    if (nodes.nodeBuilderCache.has(renderObject.initialCacheKey)) { render(...args); return; }
    const lit = Reflect.get(material as object, 'isMeshStandardMaterial') === true || Reflect.get(material as object, 'isMeshStandardNodeMaterial') === true || Reflect.get(material as object, 'lights') === true;
    const lightGroup = lit && lights && typeof lights === 'object' ? lights : undefined;
    // Initial shadow setup changes the lights' structural key. Prime one lit
    // representative before queueing the rest, avoiding a whole stale-key batch.
    if (lightGroup && !state.primedLights.has(lightGroup) && state.primingLights.has(lightGroup)) return;
    if (!state.building.has(renderObject.initialCacheKey)) {
      if (lightGroup) state.primingLights.add(lightGroup);
      const target = renderer.getRenderTarget(), mrt = Reflect.get(renderObject.context, 'mrt') as ReturnType<WebGPURenderer['getMRT']>, nodeContext = renderer.contextNode;
      // Shadow overrides temporarily borrow color/deformation/displacement nodes.
      // Renderer restores those fields as soon as this submission returns.
      if (Reflect.get(renderObject, '_sourceMaterial')) {
        preparedMaterials.set(renderObject, Object.assign(Object.create(Object.getPrototypeOf(material) as object | null) as object, material));
      }
      // r186 restores the scene's shared light array at the end of every pass.
      // Deferred builds must see the lights discovered in this actual pass.
      const lighting = lights as { getLights(): object[]; setLights(value: object[]): void };
      const passLights = [...lighting.getLights()];
      const job = prepareNative(renderer, async () => {
        const previousTarget = renderer.getRenderTarget(), previousMRT = renderer.getMRT(), previousContext = renderer.contextNode, previousLights = lighting.getLights();
        try {
          renderer.setRenderTarget(target); renderer.setMRT(mrt); renderer.contextNode = nodeContext; lighting.setLights(passLights);
          state.builds++; await nodes.getForRender(renderObject, true);
          if (lightGroup) state.primedLights.add(lightGroup);
        } finally { lighting.setLights(previousLights); renderer.setRenderTarget(previousTarget); renderer.setMRT(previousMRT); renderer.contextNode = previousContext; }
      });
      state.building.set(renderObject.initialCacheKey, job);
      job.finally(() => { preparedMaterials.delete(renderObject); if (lightGroup) state.primingLights.delete(lightGroup); if (state.building.get(renderObject.initialCacheKey) === job) state.building.delete(renderObject.initialCacheKey); }).catch(() => {});
    }
    // Drawing resumes on the next shared-pipeline frame, with the exact prepared key.
  };
  Reflect.set(renderer, '_renderObjectDirect', deferred);
  if (Reflect.get(renderer, '_handleObjectFunction') === direct) Reflect.set(renderer, '_handleObjectFunction', deferred);
  return state;
}
export function trackNative(renderer: WebGPURenderer, ready: Promise<void>): Promise<void> {
  const state = nativePreparation(renderer), generation = state.generation;
  state.pending.add(ready);
  ready.then(() => state.pending.delete(ready), (error: unknown) => {
    state.pending.delete(ready); if (generation !== state.generation) return;
    state.failure = error instanceof Error ? error : new Error(String(error));
  });
  return ready;
}
export function prepareNative(renderer: WebGPURenderer, operation: () => Promise<void>): Promise<void> {
  const state = nativePreparation(renderer);
  return trackNative(renderer, state.builders.run(async () => { await operation(); if (state.failure) throw state.failure; }, 0, state.abort.signal));
}
/** Copy only descriptor data; module/layout GPU handles retain their identity. */
export function snapshotNativeDescriptor(descriptor: NativePipelineDescriptor): NativePipelineDescriptor {
  return { ...descriptor,
    vertex: { ...descriptor.vertex, constants: descriptor.vertex.constants ? { ...descriptor.vertex.constants } : undefined,
      buffers: descriptor.vertex.buffers ? Array.from(descriptor.vertex.buffers, buffer => buffer ? { ...buffer, attributes: Array.from(buffer.attributes, attribute => ({ ...attribute })) } : null) : undefined },
    fragment: descriptor.fragment ? { ...descriptor.fragment, constants: descriptor.fragment.constants ? { ...descriptor.fragment.constants } : undefined,
      targets: Array.from(descriptor.fragment.targets, target => target ? { ...target, blend: target.blend ? { color: { ...target.blend.color }, alpha: { ...target.blend.alpha } } : undefined } : null) } : undefined,
    primitive: descriptor.primitive ? { ...descriptor.primitive } : undefined,
    depthStencil: descriptor.depthStencil ? { ...descriptor.depthStencil, stencilFront: descriptor.depthStencil.stencilFront ? { ...descriptor.depthStencil.stencilFront } : undefined, stencilBack: descriptor.depthStencil.stencilBack ? { ...descriptor.depthStencil.stencilBack } : undefined } : undefined,
    multisample: descriptor.multisample ? { ...descriptor.multisample } : undefined,
  };
}
export async function cancelNativePreparation(renderer: WebGPURenderer): Promise<void> {
  const state = nativePreparation(renderer); state.generation++; state.abort.abort(); state.abort = new AbortController(); state.failure = undefined;
  await state.builders.idle(); await state.pipelines.idle(); state.pending.clear(); state.building.clear();
}
export function nativePreparationDiagnostics(renderer: WebGPURenderer) {
  const state = nativePreparation(renderer); return { generation: state.generation, shaderPreparations: state.builds, shaderBuilds: state.buildersCreated, builderKinds: Object.fromEntries(state.builderKinds), builders: state.builders.diagnostics(), pipelines: state.pipelines.diagnostics(), pending: state.pending.size };
}
