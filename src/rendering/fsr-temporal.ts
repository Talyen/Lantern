import { UpscalerNode, type Upscaler } from '@pmndrs/upscaler';
import type { NodeBuilder, OrthographicCamera, PerspectiveCamera, TextureNode } from 'three/webgpu';
import { OnAfterRenderPipeline, OnBeforeRenderPipeline, nodeObject } from 'three/tsl';
import accumulationShader from './fsr-accumulate.wgsl?raw';

// Pinned to @pmndrs/upscaler 0.2: reuse its pass bindings, dispatch, textures
// and history lifecycle, replacing only the accumulation policy. Fail startup
// if that private boundary changes; the shared pipeline reports startup failure.
// three's r186 declarations omit native device methods. Describe only the
// compiler boundary this adapter consumes without adding a runtime dependency.
type FSRShaderModule = { getCompilationInfo(): Promise<{ messages: { type: string; message: string }[] }> };
type FSRDevice = {
  createShaderModule(options: { label: string; code: string }): FSRShaderModule;
  createComputePipelineAsync(options: { label: string; layout: 'auto'; compute: { module: FSRShaderModule; entryPoint: string } }): Promise<unknown>;
};
const historyPreparations = new WeakMap<Upscaler, Promise<void>>();
function prepareStableHistory(upscaler: Upscaler, device: FSRDevice): Promise<void> {
  const existing = historyPreparations.get(upscaler);
  if (existing) return existing;
  const preparation = (async () => {
    const pass = Reflect.get(upscaler, '_accumulatePass');
    if (pass?.metadata?.shaderKey !== 'baseline:accumulate' || !pass.pipeline) {
      throw new Error('FSR history integration needs updating.');
    }
    const module = device.createShaderModule({ label: 'Lantern.FSR.accumulate', code: accumulationShader });
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter(message => message.type === 'error');
    if (errors.length) throw new Error(errors.map(message => message.message).join('\n'));
    const pipeline = await device.createComputePipelineAsync({
      label: 'Lantern.FSR.accumulate', layout: 'auto', compute: { module, entryPoint: 'main' },
    });
    Reflect.set(pass, 'pipeline', pipeline);
  })();
  historyPreparations.set(upscaler, preparation);
  return preparation;
}

/** Bridges the package's pre-r186 callbacks and prepares stable FSR history. */
class FSRTemporalNode extends UpscalerNode {
  startupError: unknown = null;
  private historyPreparation: Promise<void> = Promise.resolve();
  historyReady(): Promise<void> { return this.historyPreparation; }
  lastSampleOffset: [number, number] = [0, 0];
  constructor(color: TextureNode, depth: TextureNode, motion: TextureNode, private camera: OrthographicCamera | PerspectiveCamera, reactive: TextureNode, ratio: number, private sampled?: (x: number, y: number, width: number, height: number) => void) {
    super(color, depth, motion, camera, { reactive, ratio, jitter: true, path: 'temporal' });
  }

  override setup(builder: NodeBuilder) {
    // Suppress the package's obsolete `renderPipeline.context` assignments.
    // Input registration and resource ownership remain with the package.
    const context = builder.context as { renderPipeline?: unknown; renderPipelineState?: { viewOffsetOwner: unknown } };
    const pipeline = context.renderPipeline;
    let result: ReturnType<UpscalerNode['setup']>;
    try {
      delete context.renderPipeline;
      result = super.setup(builder);
      if (this.upscaler) {
        const device = Reflect.get(builder.renderer.backend, 'device') as FSRDevice;
        this.historyPreparation = prepareStableHistory(this.upscaler, device).catch(error => { this.startupError = error; });
      }
    } catch (error) {
      this.startupError = error;
      throw error;
    } finally {
      context.renderPipeline = pipeline;
    }
    // Setup can visit this node more than once in a graph. Match r186's
    // temporal nodes: claim jitter once, or a second beginFrame snapshots
    // an already-jittered projection and invents motion in a still scene.
    if (pipeline && context.renderPipelineState && !context.renderPipelineState.viewOffsetOwner) {
      context.renderPipelineState.viewOffsetOwner = this;
      OnBeforeRenderPipeline(() => {
        this.upscaler?.beginFrame(this.camera);
        this.lastSampleOffset = [this.camera.view?.offsetX ?? 0, this.camera.view?.offsetY ?? 0];
        this.sampled?.(...this.lastSampleOffset, this.camera.view?.fullWidth ?? 1, this.camera.view?.fullHeight ?? 1);
      });
      OnAfterRenderPipeline(() => this.upscaler?.endFrame(this.camera));
    }
    return result;
  }
}

export const fsrTemporal = (color: TextureNode, depth: TextureNode, motion: TextureNode, camera: OrthographicCamera | PerspectiveCamera, reactive: TextureNode, ratio: number, sampled?: (x: number, y: number, width: number, height: number) => void) =>
  nodeObject(new FSRTemporalNode(color, depth, motion, camera, reactive, ratio, sampled));
