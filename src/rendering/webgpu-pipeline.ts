import { syncDisplayResolution } from './display-resolution';
import { renderNativeFrame, preparingNativeFrame } from './renderer';
import { ACESFilmicToneMapping, RedFormat, CustomBlending, OneFactor, OneMinusSrcAlphaFactor, DataUtils, RenderPipeline, BlendMode, NormalBlending, Color, Vector2, Vector3, Vector4, Matrix4, Plane, type Node, type OrthographicCamera, type PerspectiveCamera, type Scene, type WebGPURenderer, type TextureNode, type QuadMesh, type Texture } from 'three/webgpu';
import { Fn, context, dot, float, mix, mrt, normalView, orthographicDepthToViewZ, perspectiveDepthToViewZ, output, pass, rtt, screenUV, smoothstep, toneMapping, uniform, uv, vec2, vec3, vec4, velocity, positionWorld, select } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';
import type { AreaLighting } from '../levels/types';
import { fsrComparison, comparisonPreset } from '../labs/fsr/settings';
import { fsrTemporal } from './fsr-temporal';
import { upscaleRatio, type GraphicsSettings } from './graphics-settings';
import { SettingsPreparation } from './settings-preparation';
import { waterPlanes } from './water-registry';
import { outlinedColor, outlineStrength } from './outlines';

type FSRNode = ReturnType<typeof fsrTemporal>;
// Restrained focus profiles, applied to the stabilized output. Focus distance continues to track the camera target.
const depthOfFieldPresets = {
  soft: { focusRange: 10, bokeh: 0.65 },
  cinematic: { focusRange: 6, bokeh: 1.15 },
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
  private cpuRenderMs = 0;
  private prepared = false;
  private generation = 0;
  private preparation: Promise<void> = Promise.resolve();
  private reflections = new Map<number, { camera: OrthographicCamera | PerspectiveCamera; pass: ReturnType<typeof pass>; projection: ReturnType<typeof uniform<'mat4'>> }>();
  private reflectionRevision = -1;
  private reflectionTarget = new Vector3();
  private reflectionUp = new Vector3();
  private reflectionPlane = new Plane();
  private reflectionCorner = new Vector4();
  private reflectionClip = new Vector4();
  private reflectionNormal = new Vector3(0, 1, 0);
  private reflectionInverse = new Matrix4();

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
    const surfaceContext = { materialMipBias: this.materialMipBias, textureDepth: settings.textureDepth,
      waterReflection: (height: number, distortion: Node<'vec2'>) => this.waterReflection(height, distortion) };
    scenePass.contextNode = context(surfaceContext);
    const coverage = Fn(builder => builder.material.transparent || builder.material.alphaHash ? vec4(output.a, 0, 0, output.a) : vec4(0))();
    const sceneMRT = mrt({ output, velocity, coverage,
      ...(settings.outlines ? { outline: vec4(outlineStrength(), 0, 0, output.a) } : {}) });
    sceneMRT.setClearColor('coverage', 0, 0);
    const coverageBlend = new BlendMode(CustomBlending);
    coverageBlend.blendSrc = OneFactor; coverageBlend.blendDst = OneMinusSrcAlphaFactor;
    sceneMRT.setBlendMode('coverage', coverageBlend);
    if (settings.outlines) {
      sceneMRT.setClearColor('outline', 0, 0);
      sceneMRT.setBlendMode('outline', new BlendMode(NormalBlending));
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
    // Source-over coverage is authored by the same visible fragments. It keeps
    // particles/transparency responsive without shading the opaque world again.
    const reactive = sceneTexture(vec4(scenePass.getTextureNode('coverage').r.clamp(0, .9)), true);
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
      const far = smoothstep(this.focus.add(4), this.focus.add(4).add(this.focusRange), viewZ.negate());
      const farColor = rtt(vec4(resolved.rgb.mul(far), far), null, null, { depthBuffer: false });
      const soft = gaussianBlur(farColor, vec2(this.bokeh), 2, { resolutionScale: .5 });
      // Normalize masked colour: foreground silhouettes never bleed into the
      // background blur, and interactive ground/actors retain the crisp resolve.
      this.resources.push(farColor, soft);
      beauty = vec4(mix(resolved.rgb, soft.rgb.div(soft.a.max(.0001)), far), resolved.a);
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

  /** One opaque scene reflection per water elevation, owned by this same graph. */
  private waterReflection(height: number, distortion: Node<'vec2'>): Node<'vec4'> {
    let reflection = this.reflections.get(height);
    if (!reflection) {
      const camera = this.camera.clone();
      const reflected = pass(this.scene, camera, { samples: 0 }); reflected.transparent = false; reflected.setResolutionScale(this.scale * .5);
      reflected.contextNode = context({ materialMipBias: this.materialMipBias, textureDepth: false });
      reflection = { camera, pass: reflected, projection: uniform(new Matrix4()) };
      this.reflections.set(height, reflection); this.resources.push(reflected);
      this.updateReflection(height, reflection);
    }
    const projected = reflection.projection.mul(vec4(positionWorld, 1));
    const coord = vec2(projected.x.div(projected.w).mul(.5).add(.5), projected.y.div(projected.w).mul(-.5).add(.5)).add(distortion);
    const inside = coord.x.greaterThan(0).and(coord.x.lessThan(1)).and(coord.y.greaterThan(0)).and(coord.y.lessThan(1));
    const occupied = reflection.pass.getTextureNode('depth').sample(coord).r.lessThan(.99999);
    return vec4(reflection.pass.getTextureNode('output').sample(coord).rgb, select(inside.and(occupied), float(1), float(0)));
  }
  private updateReflection(height: number, reflection: { camera: OrthographicCamera | PerspectiveCamera; pass: ReturnType<typeof pass>; projection: ReturnType<typeof uniform<'mat4'>> }): void {
    const camera = reflection.camera;
    this.camera.updateMatrixWorld(); this.camera.getWorldDirection(this.reflectionTarget); this.reflectionTarget.add(this.camera.position);
    this.reflectionTarget.y = 2 * height - this.reflectionTarget.y;
    camera.position.copy(this.camera.position); camera.position.y = 2 * height - camera.position.y;
    this.reflectionUp.set(0, 1, 0).applyQuaternion(this.camera.quaternion); this.reflectionUp.y *= -1;
    camera.up.copy(this.reflectionUp); camera.lookAt(this.reflectionTarget);
    camera.near = this.camera.near; camera.far = this.camera.far; camera.updateMatrixWorld();
    camera.projectionMatrix.copy(this.camera.projectionMatrix);
    this.reflectionPlane.set(this.reflectionNormal, -height).applyMatrix4(camera.matrixWorldInverse);
    const clip = this.reflectionClip.set(this.reflectionPlane.normal.x, this.reflectionPlane.normal.y, this.reflectionPlane.normal.z, this.reflectionPlane.constant);
    this.reflectionCorner.set(Math.sign(clip.x), Math.sign(clip.y), 1, 1).applyMatrix4(this.reflectionInverse.copy(camera.projectionMatrix).invert());
    clip.multiplyScalar(1 / clip.dot(this.reflectionCorner));
    const p = camera.projectionMatrix.elements; p[2] = clip.x; p[6] = clip.y; p[10] = clip.z; p[14] = clip.w;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    reflection.projection.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    reflection.pass.setResolutionScale(this.scale * .5);
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
    // One finer mip than resolution compensation, shared by all material passes.
    // Private comparison offsets remain relative to the original baseline.
    this.materialMipBias.value = Math.max(-1, Math.min(0, Math.log2(this.scale))) + (fsrComparison?.mipOffset ?? -1);
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
    syncDisplayResolution(this.renderer);
    this.renderer.getDrawingBufferSize(this.outputSize);
    const key = `${this.outputSize.x}x${this.outputSize.y}`;
    if (this.renderer.domElement.dataset.pipelineSize !== key) {
      this.renderer.domElement.dataset.pipelineSize = key;
      if (this.scenePass) this.resetHistory();
    }
  }

  diagnostics() {
    const rt = this.scenePass?.renderTarget;
    return { comparisonPreset, textureDepth: this.settings.textureDepth, materialMipBias: this.materialMipBias.value, materialAnisotropy: 16, ready: this.prepared, method: 'fsr-temporal', outlines: this.settings.outlines, outlineStage: this.settings.outlines ? 'pre-fsr' : 'off', sceneAttachments: rt?.textures.length ?? 0, reactiveSource: 'fragment-coverage', worldPasses: 1 + (this.settings.ao > 0 ? 1 : 0) + this.reflections.size, reflectionPasses: this.reflections.size, outputPixelRatio: this.renderer.getPixelRatio(), dof: this.settings.dof, dofStage: this.settings.dof === 'off' ? 'off' : 'far-background-half-resolution',
      sceneWidth: rt?.width ?? 0, sceneHeight: rt?.height ?? 0,
      outputWidth: this.renderer.domElement.width, outputHeight: this.renderer.domElement.height,
      reconstructionScale: this.scale, cpuRenderMs: this.cpuRenderMs, renderedFrames: this.successfulFrames,
      sampleOffset: this.fsr?.lastSampleOffset ?? null, cameraOffsetCleared: !this.camera.view?.enabled,
      unjitteredMotionProjection: !!this.fsr?.upscaler && velocity.projectionMatrix === this.fsr.upscaler.unjitteredProjectionMatrix,
      gpuTimings: this.fsr?.upscaler ? Object.fromEntries(this.fsr.upscaler.gpuTimings) : null,
      gpuTimingScope: this.fsr ? 'FSR compute only; excludes scene and post effects' : null };
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

  render(): boolean {
    if (!this.prepared) return false;
    this.camera.updateMatrixWorld();
    const planes = waterPlanes(this.scene);
    if (this.reflectionRevision !== planes.revision) {
      this.reflectionRevision = planes.revision;
      for (const [height, reflection] of this.reflections) if (!planes.planes.has(height)) {
        this.releaseBindings([reflection.pass]); reflection.pass.dispose(); this.resources = this.resources.filter(node => node !== reflection.pass); this.reflections.delete(height);
      }
    }
    for (const [height, reflection] of this.reflections) this.updateReflection(height, reflection);
    this.focusPoint.copy(this.target).applyMatrix4(this.camera.matrixWorldInverse);
    this.focus.value = -this.focusPoint.z;
    const toneMappingMode = this.renderer.toneMapping;
    const outputColorSpace = this.renderer.outputColorSpace;
    try {
      const start = performance.now();
      const rendered = renderNativeFrame(this.renderer, () => this.post.render());
      this.cpuRenderMs = performance.now() - start;
      if (!rendered) { this.resetHistory(); return false; }
      this.successfulFrames++;
      const canvas = this.renderer.domElement, scene = this.scenePass!.renderTarget;
      const resolution = `${scene.width}×${scene.height} → ${canvas.width}×${canvas.height}`;
      if (canvas.dataset.resolution !== resolution) {
        canvas.dataset.resolution = resolution;
        canvas.dispatchEvent(new Event('graphicsresolutionchange'));
      }
      return true;
    } finally {
      // Includes failed setup/render paths, whose after-hook may not have run.
      this.camera.clearViewOffset();
      this.renderer.toneMapping = toneMappingMode; this.renderer.outputColorSpace = outputColorSpace;
    }
  }

  private releaseBindings(resources: Node[]): void {
    const attachments = new Set<Texture>();
    for (const resource of resources) {
      const target = Reflect.get(resource, 'renderTarget') as { textures?: Texture[] } | undefined;
      target?.textures?.forEach(texture => attachments.add(texture));
    }
    const objects = Reflect.get(this.renderer, '_objects') as { _renderObjects: Set<{ context: { textures: Texture[] | null }; dispose(): void }> } | undefined;
    if (objects) for (const object of [...objects._renderObjects]) {
      if (object.context.textures?.some(texture => attachments.has(texture))) object.dispose();
    }
  }
  private release(): void {
    this.prepared = false; this.generation++;
    this.camera.clearViewOffset(); velocity.setProjectionMatrix(null);
    // r186 PassNode.dispose releases targets but leaves scene render objects
    // keyed by those target contexts. Release just this graph's native bindings.
    this.releaseBindings(this.resources);
    this.resources.forEach((node) => node.dispose()); this.reflections.clear(); this.resources = []; this.sceneResources = [];
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
  get preparing(): boolean { return this.queue.busy || preparingNativeFrame(this.renderer); }
  resetHistory(): void { this.active?.resetHistory(); }
  resize(): void { this.active?.resize(); }
  diagnostics() { return { ...(this.active?.diagnostics() ?? { ready: false, method: 'fsr-temporal', renderedFrames: 0 }), preparing: this.preparing, retainedGraphs: this.cache.size }; }
  async comparisonInputs() { if (!this.active) throw new Error('Pipeline is not ready.'); return this.active.comparisonInputs(); }
  render(): boolean { if (syncDisplayResolution(this.renderer)) this.resize(); return !this.queue.busy && (this.active?.render() ?? false); }
  dispose(): void { this.disposed = true; this.queue.dispose(); this.cache.forEach(graph => graph.dispose()); this.cache.clear(); this.active = null; }
}
