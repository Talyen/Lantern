import { ACESFilmicToneMapping, RedFormat, CustomBlending, OneFactor, OneMinusSrcAlphaFactor, DataUtils, RenderPipeline, BlendMode, NormalBlending, Color, Vector2, Vector3, type Node, type OrthographicCamera, type PerspectiveCamera, type Scene, type WebGPURenderer, type TextureNode, type QuadMesh, type Texture } from 'three/webgpu';
import { Fn, context, dot, float, mix, mrt, normalView, orthographicDepthToViewZ, perspectiveDepthToViewZ, output, pass, rtt, screenUV, smoothstep, toneMapping, uniform, uv, vec2, vec3, vec4, velocity } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import type { AreaLighting } from '../levels/types';
import { fsrComparison, comparisonPreset } from '../labs/fsr/settings';
import { fsrTemporal } from './fsr-temporal';
import { upscaleRatio, type GraphicsSettings } from './graphics-settings';
import { SettingsPreparation } from './settings-preparation';
import { outlinedColor, outlineStrength } from './outlines';

type FSRNode = ReturnType<typeof fsrTemporal>;
// Restrained focus profiles, applied to the stabilized output. Focus distance continues to track the camera target.
const depthOfFieldPresets = {
  soft: { focusRange: 24, bokeh: 0.8 },
  cinematic: { focusRange: 16, bokeh: 1.6 },
} as const;
/** Shared scene inputs; exactly one temporal resolve owns each pipeline's jitter. */
class PipelineGraph {
  private post: RenderPipeline;
  private graphKey = '';
  private depthJitter = uniform(new Vector2());
  private depthTexel = uniform(new Vector2());
  private outlineScale = uniform(1);
  private materialMipBias = uniform(0);
  private look?: AreaLighting;
  private shadowTint = uniform(new Color(1, 1, 1));
  private highlightTint = uniform(new Color(1, 1, 1));
  private gradeStrength = uniform(0);
  private resources: Node[] = [];
  private sceneResources: { setResolutionScale(scale: number): unknown }[] = [];
  private focus = uniform(22);
  private exposure = uniform(1.25);
  private saturation = uniform(0.72);
  private aoStrength = uniform(1);
  private bokeh = uniform(1.6);
  private focusRange = uniform(16);
  private bloomStrength = uniform(0.8);
  private fsr: FSRNode | null = null;
  private reactiveTexture: ReturnType<typeof rtt> | null = null;
  private scenePass: ReturnType<typeof pass> | null = null;
  private settings!: GraphicsSettings;
  private scale = 1;
  private outputSize = new Vector2();
  private focusPoint = new Vector3();
  private successfulFrames = 0;
  private prepared = false;
  private generation = 0;
  private preparation: Promise<void> = Promise.resolve();

  constructor(private renderer: WebGPURenderer, private scene: Scene, private camera: OrthographicCamera | PerspectiveCamera, private target: Vector3) {
    this.post = new RenderPipeline(renderer);
  }

  configure(settings: GraphicsSettings, saturation: number, look = this.look): void {
    this.look = look;
    const key = graphSignature(settings);
    if (this.scenePass && key === this.graphKey) {
      this.update(settings, saturation); return;
    }
    this.release(); this.graphKey = key;
    this.settings = settings;
    this.scale = 1 / upscaleRatio(settings.upscaleQuality);
    const scenePass = pass(this.scene, this.camera, { samples: 0 });
    scenePass.setResolutionScale(this.scale);
    const surfaceContext = { materialMipBias: this.materialMipBias, textureDepth: settings.textureDepth };
    scenePass.contextNode = context(surfaceContext);
    const sceneMRT = settings.outlines ? mrt({ output, velocity, outline: vec4(outlineStrength(), 0, 0, output.a) }) : mrt({ output, velocity });
    if (settings.outlines) {
      sceneMRT.setClearColor('outline', 0, 0);
      // Transparent effects soften the mask by their actual opacity instead of erasing whole quads.
      sceneMRT.setBlendMode('outline', new BlendMode(NormalBlending));
    }
    if (fsrComparison?.reactiveCoverage) {
      // Premultiplied source-over alpha coverage; opaque surfaces write zero.
      // Per-fragment output alpha retains maps, cutouts and point-sprite falloff.
      const coverage = Fn(builder => builder.material.transparent ? vec4(output.a, 0, 0, output.a) : vec4(0))();
      sceneMRT.outputNodes.coverage = coverage;
      sceneMRT.setClearColor('coverage', 0, 0);
      const blend = new BlendMode(CustomBlending); blend.blendSrc = OneFactor; blend.blendDst = OneMinusSrcAlphaFactor;
      sceneMRT.setBlendMode('coverage', blend);
    }
    scenePass.setMRT(sceneMRT);
    this.scenePass = scenePass;
    this.resources.push(scenePass); this.sceneResources.push(scenePass);
    const color = scenePass.getTextureNode('output');
    const depth = scenePass.getTextureNode('depth');
    // Materialize composite color at scene resolution, never implicitly at output size.
    const sceneTexture = (node: Node, scalar = false): TextureNode => {
      const texture = rtt(node, null, null, { resolutionScale: this.scale, depthBuffer: false, ...(scalar ? { format: RedFormat } : {}) });
      this.resources.push(texture); this.sceneResources.push(texture);
      return texture;
    };
    let beauty: Node<'vec4'> = vec4(color);
    if (settings.outlines) {
      const distance = (value: Node<'float'>) => ('isOrthographicCamera' in this.camera ? orthographicDepthToViewZ : perspectiveDepthToViewZ)(value, uniform(this.camera.near), uniform(this.camera.far)).negate();
      beauty = outlinedColor(color, scenePass.getTextureNode('outline'), depth, distance, this.outlineScale, this.depthTexel);
    }
    if (settings.ao > 0) {
      // Independent geometry inputs avoid a cycle: AO is consumed while shading
      // the beauty pass, through the material's native indirect-light occlusion.
      const geometry = pass(this.scene, this.camera, { samples: 0 });
      geometry.transparent = false; geometry.setResolutionScale(this.scale);
      geometry.setMRT(mrt({ output: normalView }));
      geometry.contextNode = context({ materialMipBias: this.materialMipBias, textureDepth: false });
      const contact = ao(geometry.getTextureNode('depth'), geometry.getTextureNode('output'), this.camera);
      contact.resolutionScale = 0.5; contact.samples.value = 8;
      contact.radius.value = 0.18; contact.thickness.value = 0.3;
      this.resources.push(geometry, contact); this.sceneResources.push(geometry);
      scenePass.contextNode = context({ ...surfaceContext, getAO: (materialAO: Node<'float'> | null) =>
        mix(float(1), contact.getTextureNode().sample(screenUV).r, this.aoStrength).mul(materialAO ?? float(1)) });
    }
    // PassNode's opaque filter avoids touching scene visibility or materials.
    const opaque = pass(this.scene, this.camera, { samples: 0 });
    opaque.transparent = false; opaque.setResolutionScale(this.scale);
    opaque.contextNode = scenePass.contextNode;
    this.resources.push(opaque); this.sceneResources.push(opaque);
    // Compare raw, matched-domain colors, not AO/DOF-treated final color.
    const difference = color.rgb.sub(opaque.getTextureNode('output').rgb).abs();
    const rawReactive = dot(difference, vec3(1 / 3)).mul(2).clamp(0, 1);
    const reactive = sceneTexture(vec4(fsrComparison?.reactiveCoverage ? rawReactive.max(scenePass.getTextureNode('coverage').r).clamp(0, .9) : rawReactive), true);
    this.reactiveTexture = reactive as ReturnType<typeof rtt>;
    const temporal = fsrTemporal(sceneTexture(beauty), depth, scenePass.getTextureNode('velocity'), this.camera, reactive, 1 / this.scale, (x, y, width, height) => {
      this.depthJitter.value.set(x, y); this.depthTexel.value.set(1 / width, 1 / height);
    });
    this.fsr = temporal;
    this.resources.push(temporal); beauty = vec4(temporal as unknown as Node<'vec4'>);
    if (settings.dof !== 'off') {
      // FSR resolves into unjittered output coordinates. Match its sourcePosition
      // convention (output UV minus render-pixel jitter) for the depth guide.
      // Bilateral four-tap reconstruction avoids interpolated depths between
      // foreground blades and distant ground, without another geometry pass.
      const linear = (value: Node<'float'>) => ('isOrthographicCamera' in this.camera ? orthographicDepthToViewZ : perspectiveDepthToViewZ)(value, uniform(this.camera.near), uniform(this.camera.far));
      const viewZ = Fn(() => {
        const sampleUV = screenUV.sub(this.depthJitter.mul(this.depthTexel));
        const pixel = sampleUV.div(this.depthTexel).sub(.5);
        const base = pixel.floor(), fraction = pixel.fract();
        const center = linear(depth.sample(sampleUV).r).toVar();
        const total = float(0).toVar(), result = float(0).toVar();
        for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
          const coord = base.add(vec2(x + .5, y + .5)).mul(this.depthTexel);
          const z = linear(depth.sample(coord).r);
          const spatial = (x ? fraction.x : fraction.x.oneMinus()).mul(y ? fraction.y : fraction.y.oneMinus());
          const weight = spatial.mul(z.sub(center).abs().mul(-8).exp());
          total.addAssign(weight); result.addAssign(z.mul(weight));
        }
        return result.div(total.max(.00001));
      })();
      // DOF reads scene depth through viewZ; this full-screen copy owns color only.
      const resolved = rtt(beauty, null, null, { depthBuffer: false }); this.resources.push(resolved);
      const soft = dof(resolved, viewZ, this.focus, this.focusRange, this.bokeh);
      this.resources.push(soft); beauty = vec4(soft as unknown as Node<'vec4'>);
    }
    if (settings.bloom > 0) {
      const glow = bloom(beauty, 1, 0.85, 1.1); glow.smoothWidth.value = 0.2;
      this.resources.push(glow); beauty = vec4(beauty.rgb.add(glow.rgb.mul(this.bloomStrength)), beauty.a);
    }
    const luma = dot(beauty.rgb, vec3(0.2126, 0.7152, 0.0722));
    const edge = smoothstep(0.25, 0.8, uv().sub(0.5).length());
    const tint = mix(this.shadowTint.rgb, this.highlightTint.rgb, smoothstep(.08, 1.2, luma));
    const graded = mix(vec3(luma), beauty.rgb, this.saturation).mul(mix(vec3(1), tint, this.gradeStrength)).mul(this.exposure).mul(float(1).sub(edge.mul(0.1)));
    // ACES once here, then RenderPipeline performs the sole sRGB conversion.
    this.post.outputNode = toneMapping(ACESFilmicToneMapping, float(1), vec4(graded, beauty.a));
    this.post.needsUpdate = true;
    this.update(settings, saturation);
    this.preparation = this.prepare(this.post, ++this.generation);
  }

  matches(settings: GraphicsSettings): boolean { return this.graphKey === graphSignature(settings); }

  async ready(): Promise<void> { await this.preparation; }

  private async prepare(post: RenderPipeline, generation: number): Promise<void> {
    await Promise.resolve();
    if (generation !== this.generation) return;
    try {
      // r186 has no public RenderPipeline.compileAsync. Compile its fullscreen
      // graph through Renderer.compileAsync so asynchronous setup errors reach
      // startup, rather than leaving a nominally active blank pipeline.
      const update = Reflect.get(RenderPipeline.prototype, '_update') as () => void;
      update.call(post);
      const quad = Reflect.get(post, '_quadMesh') as QuadMesh;
      await this.renderer.compileAsync(quad, quad.camera);
      if (generation === this.generation) {
        await this.fsr?.historyReady();
        if (generation !== this.generation) return;
        const error = this.fsr?.startupError;
        if (error) throw error;
        this.update(this.settings, this.saturation.value); this.prepared = true;
      }
    } finally {
      this.camera.clearViewOffset(); velocity.setProjectionMatrix(null);
    }
  }

  update(settings: GraphicsSettings, saturation: number, look = this.look, resizeScene = false): void {
    if (resizeScene) {
      const scale = 1 / upscaleRatio(settings.upscaleQuality);
      if (scale !== this.scale) {
        this.scale = scale; this.sceneResources.forEach(resource => resource.setResolutionScale(scale));
        this.resetHistory();
      }
    }
    this.look = look; this.settings = { ...settings };
    this.outlineScale.value = this.scale;
    this.materialMipBias.value = Math.max(-1, Math.min(0, Math.log2(this.scale))) + (fsrComparison?.mipOffset ?? 0);
    if (this.fsr?.upscaler) this.fsr.upscaler.settings.sharpness = settings.sharpness;
    this.exposure.value = settings.exposure; this.saturation.value = saturation;
    this.aoStrength.value = settings.ao;
    if (settings.dof !== 'off') {
      const preset = depthOfFieldPresets[settings.dof];
      this.focusRange.value = preset.focusRange; this.bokeh.value = preset.bokeh;
    }
    this.bloomStrength.value = settings.bloom;
    this.shadowTint.value.set(this.look?.grade?.shadows ?? '#ffffff');
    this.highlightTint.value.set(this.look?.grade?.highlights ?? '#ffffff');
    this.gradeStrength.value = this.look?.grade?.strength ?? 0;
  }

  resetHistory(): void {
    if (this.fsr?.upscaler) this.fsr.upscaler.resetHistory();
  }

  resize(): void {
    this.renderer.getDrawingBufferSize(this.outputSize);
    const key = `${this.outputSize.x}x${this.outputSize.y}`;
    if (this.renderer.domElement.dataset.pipelineSize !== key) {
      this.renderer.domElement.dataset.pipelineSize = key;
      if (this.scenePass) this.resetHistory();
    }
  }

  diagnostics() {
    const rt = this.scenePass?.renderTarget;
    return { comparisonPreset, textureDepth: this.settings.textureDepth, materialMipBias: this.materialMipBias.value, materialAnisotropy: 16, ready: this.prepared, method: 'fsr-temporal', outlines: this.settings.outlines, outlineStage: this.settings.outlines ? 'pre-fsr' : 'off', sceneAttachments: rt?.textures.length ?? 0, dof: this.settings.dof, dofStage: 'resolved-output',
      sceneWidth: rt?.width ?? 0, sceneHeight: rt?.height ?? 0,
      outputWidth: this.renderer.domElement.width, outputHeight: this.renderer.domElement.height,
      reconstructionScale: this.scale, renderedFrames: this.successfulFrames,
      sampleOffset: this.fsr?.lastSampleOffset ?? null, cameraOffsetCleared: !this.camera.view?.enabled,
      unjitteredMotionProjection: !!this.fsr?.upscaler && velocity.projectionMatrix === this.fsr.upscaler.unjitteredProjectionMatrix,
      gpuTimings: this.fsr?.upscaler ? Object.fromEntries(this.fsr.upscaler.gpuTimings) : null,
      gpuTimingScope: this.fsr ? 'FSR compute only; excludes scene, opaque pass and post effects' : null };
  }

  async comparisonInputs() {
    if (!fsrComparison || !this.scenePass || !this.reactiveTexture) throw new Error('FSR inputs require an authoring comparison.');
    const targets = [this.scenePass.renderTarget, this.reactiveTexture.renderTarget];
    const images: Record<string, { png: string; maximum: number; mean: number }> = {};
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i]; if (!target) throw new Error('Comparison target is unavailable.');
      const attachment = i === 0 ? target.textures.findIndex(texture => texture.name === 'velocity') : 0;
      if (attachment < 0) throw new Error('Velocity attachment is unavailable.');
      const bytes = await this.renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height, attachment);
      const channels = bytes.length / (target.width * target.height);
      const canvas = document.createElement('canvas'); canvas.width = target.width; canvas.height = target.height;
      const ctx = canvas.getContext('2d')!, pixels = ctx.createImageData(canvas.width, canvas.height);
      let maximum = 0, sum = 0;
      for (let p = 0; p < target.width * target.height; p++) {
        const read = (channel: number) => bytes instanceof Uint16Array ? DataUtils.fromHalfFloat(bytes[p * channels + channel]) : Number(bytes[p * channels + channel]);
        const x = read(0), y = i === 0 ? read(1) : 0, magnitude = Math.hypot(x, y);
        maximum = Math.max(maximum, magnitude); sum += magnitude;
        pixels.data.set(i === 0 ? [128 + x * 10000, 128 + y * 10000, 128, 255] : [x * 255, x * 255, x * 255, 255], p * 4);
      }
      ctx.putImageData(pixels, 0, 0); images[i === 0 ? 'velocity' : 'reactive'] = { png: canvas.toDataURL(), maximum, mean: sum / (target.width * target.height) };
    }
    return images;
  }

  render(): void {
    if (!this.prepared) return;
    this.camera.updateMatrixWorld();
    this.focusPoint.copy(this.target).applyMatrix4(this.camera.matrixWorldInverse);
    this.focus.value = -this.focusPoint.z;
    const toneMappingMode = this.renderer.toneMapping;
    const outputColorSpace = this.renderer.outputColorSpace;
    try {
      this.post.render(); this.successfulFrames++;
      const canvas = this.renderer.domElement, scene = this.scenePass!.renderTarget;
      const resolution = `${scene.width}×${scene.height} → ${canvas.width}×${canvas.height}`;
      if (canvas.dataset.resolution !== resolution) {
        canvas.dataset.resolution = resolution;
        canvas.dispatchEvent(new Event('graphicsresolutionchange'));
      }
    } finally {
      // Includes failed setup/render paths, whose after-hook may not have run.
      this.camera.clearViewOffset();
      this.renderer.toneMapping = toneMappingMode; this.renderer.outputColorSpace = outputColorSpace;
    }
  }

  private release(): void {
    this.prepared = false; this.generation++;
    this.camera.clearViewOffset(); velocity.setProjectionMatrix(null);
    // r186 PassNode.dispose releases targets but leaves scene render objects
    // keyed by those target contexts. Release just this graph's native bindings.
    const attachments = new Set<Texture>();
    for (const resource of this.resources) {
      const target = Reflect.get(resource, 'renderTarget') as { textures?: Texture[] } | undefined;
      target?.textures?.forEach(texture => attachments.add(texture));
    }
    const objects = Reflect.get(this.renderer, '_objects') as { _renderObjects: Set<{ context: { textures: Texture[] | null }; dispose(): void }> } | undefined;
    if (objects) for (const object of [...objects._renderObjects]) {
      if (object.context.textures?.some(texture => attachments.has(texture))) object.dispose();
    }
    this.resources.forEach((node) => node.dispose()); this.resources = []; this.sceneResources = [];
    this.fsr = null; this.reactiveTexture = null; this.scenePass = null; this.successfulFrames = 0;
    this.post.dispose(); this.post = new RenderPipeline(this.renderer);
  }
  dispose(): void { this.release(); this.post.dispose(); }
}

function graphSignature(settings: GraphicsSettings): string {
  return JSON.stringify([settings.dof !== 'off', settings.ao > 0, settings.bloom > 0, settings.outlines, settings.textureDepth, fsrComparison?.reactiveCoverage ?? false]);
}
type PipelineRequest = { settings: GraphicsSettings; saturation: number; look?: AreaLighting };
/** One shared graph owner. Keep the committed graph until its replacement is ready. */
export class WebGPUPipeline {
  private active: PipelineGraph | null = null;
  private cache = new Map<string, PipelineGraph>();
  private look?: AreaLighting;
  private disposed = false;
  private preparationError: unknown;
  private queue: SettingsPreparation<PipelineRequest>;
  constructor(private renderer: WebGPURenderer, private scene: Scene, private camera: OrthographicCamera | PerspectiveCamera, private target: Vector3) {
    this.queue = new SettingsPreparation(async request => {
      const key = graphSignature(request.settings);
      const cached = this.cache.get(key);
      if (cached) return { commit: () => {
        if (cached !== this.active) cached.resetHistory();
        cached.update(request.settings, request.saturation, request.look, true);
        this.active = cached; this.cache.delete(key); this.cache.set(key, cached); this.clearSettingsError();
      }, dispose() {} };
      // Two graph appearances bound retained buffers; evict only an idle graph.
      if (this.cache.size >= 2) for (const [oldKey, graph] of this.cache) {
        if (graph !== this.active) { graph.dispose(); this.cache.delete(oldKey); break; }
      }
      const candidate = new PipelineGraph(this.renderer, this.scene, this.camera, this.target);
      try { candidate.configure(request.settings, request.saturation, request.look); await candidate.ready(); }
      catch (error) { candidate.dispose(); throw error; }
      return { commit: () => {
        this.active = candidate; this.cache.set(key, candidate); this.clearSettingsError();
      }, dispose: () => candidate.dispose() };
    }, error => {
      this.preparationError = error;
      const message = this.active ? 'Graphics change failed. Your previous settings are still rendering. Try another setting or reload.' : 'Rendering failed. Reload to try again; update your browser or graphics driver if it persists.';
      this.renderer.domElement.dataset[this.active ? 'settingsError' : 'renderError'] = message;
      if (!this.active && this.renderer.domElement.parentElement) this.renderer.domElement.parentElement.dataset.renderError = message;
      this.renderer.domElement.dispatchEvent(new Event('graphicssettingschange'));
      console.error(message, error);
    });
  }
  private clearSettingsError(): void {
    this.preparationError = undefined; delete this.renderer.domElement.dataset.settingsError;
    this.renderer.domElement.dispatchEvent(new Event('graphicssettingschange'));
  }
  configure(settings: GraphicsSettings, saturation: number, look = this.look, delay = 0): void {
    if (this.disposed) return;
    this.look = look;
    this.queue.request({ settings: { ...settings }, saturation, look }, delay);
  }
  update(settings: GraphicsSettings, saturation: number, look = this.look): void {
    // Structural requests must not mutate the still-committed graph's inputs.
    if (this.active?.matches(settings)) this.active.update(settings, saturation, look);
  }
  flush(): void { this.queue.flush(); }
  async ready(): Promise<void> { await this.queue.ready(); if (!this.active && this.preparationError) throw this.preparationError; }
  get preparing(): boolean { return this.queue.busy; }
  resetHistory(): void { this.active?.resetHistory(); }
  resize(): void { this.active?.resize(); }
  diagnostics() { return { ...(this.active?.diagnostics() ?? { ready: false, method: 'fsr-temporal', renderedFrames: 0 }), preparing: this.queue.busy, retainedGraphs: this.cache.size }; }
  async comparisonInputs() { if (!this.active) throw new Error('Pipeline is not ready.'); return this.active.comparisonInputs(); }
  render(): void { if (!this.queue.busy) this.active?.render(); }
  dispose(): void { this.disposed = true; this.queue.dispose(); this.cache.forEach(graph => graph.dispose()); this.cache.clear(); this.active = null; }
}
