import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BloomEffect, DepthOfFieldEffect, Effect, EffectComposer, EffectPass, FXAAEffect, SMAAEffect, SMAAPreset, NormalPass, RenderPass, SSAOEffect, ToneMappingEffect, ToneMappingMode } from 'postprocessing';
import { CoreEffects } from './effects';
import { defaults, ranges, readSettings, settingsKey, usesTemporal, usesWebGPU, type GraphicsSettings, type NumericSetting } from './graphics-settings';
import type { WebGPURenderer } from 'three/webgpu';
import type { WebGPUArtPipeline } from './webgpu-art';
import './options.css';

export type ArtSettings = GraphicsSettings;
export type ArtContext = { scene: THREE.Scene; camera: THREE.OrthographicCamera; renderer: THREE.WebGLRenderer | WebGPURenderer;
  controls: OrbitControls; sun: THREE.DirectionalLight; ambient: THREE.HemisphereLight; player: THREE.Group; enemy: THREE.Group;
  ground: THREE.Mesh; rocks: THREE.Group[]; resetEncounter: () => void; clearInput: () => void };
const labels: Record<NumericSetting, string> = { renderScale: 'Render resolution', historyWeight: 'History weight', motionThreshold: 'Motion rejection (px)', depthThreshold: 'Depth rejection (m)',
  exposure: 'Exposure', warmth: 'Firelight', fog: 'Atmosphere', bloom: 'Bloom', ao: 'Ambient occlusion', dof: 'Depth of field' };
class NorthernGrade extends Effect {
  constructor() { super('NorthernGrade', `uniform float exposure; void mainImage(const in vec4 inputColor,const in vec2 uv,out vec4 outputColor){
    float luma=dot(inputColor.rgb,vec3(0.2126,0.7152,0.0722)); vec3 color=mix(vec3(luma),inputColor.rgb,0.72)*exposure;
    outputColor=vec4(color*(1.0-0.10*smoothstep(0.25,0.8,length(uv-0.5))),inputColor.a); }`, { uniforms: new Map([['exposure', new THREE.Uniform(1.1)]]) }); }
}

export class GraphicsOptions {
  paused = false;
  readonly effects: CoreEffects;
  private settings = readSettings();
  private dialog = document.getElementById('options-dialog') as HTMLDialogElement;
  private webgpu: boolean;
  private gpuPipeline: WebGPUArtPipeline | null = null;
  private composer: EffectComposer | null = null;
  private bloom: BloomEffect | null = null;
  private dof: DepthOfFieldEffect | null = null;
  private ao: SSAOEffect | null = null;
  private grade: NorthernGrade | null = null;
  private fires: THREE.PointLight[] = [];
  private shadow: THREE.SpotLight | null = null;
  private fills: THREE.PointLight[] = [];
  private environment = new THREE.Group();
  private failed: string[] = [];
  private time = 0;
  private intervals: number[] = [];
  private lastFrame = 0;
  private statsAt = 0;

  constructor(private ctx: ArtContext) {
    this.webgpu = !(ctx.renderer instanceof THREE.WebGLRenderer);
    if (!this.webgpu && usesWebGPU(this.settings.aa)) this.settings.aa = 'smaa';
    ctx.scene.add(this.environment);
    this.effects = new CoreEffects(this.webgpu); ctx.scene.add(this.effects.root);
    for (const root of ctx.scene.children) if (root.userData.foliage) this.effects.addFoliage(root);
    // Retain the existing clearing's effects; no alternate spaces are loaded.
    this.effects.addWater(this.environment, 4.8, -3.4, { width: 3.2, length: 2.2 });
    this.effects.addWater(this.environment, 6.1, 0.5, { width: 0.8, length: 5.8, flow: 0.1 });
    const grass = new THREE.Group(); const blade = new THREE.PlaneGeometry(0.08, 0.45, 1, 4); blade.translate(0, 0.225, 0);
    const grassMaterial = new THREE.MeshStandardMaterial({ color: '#53604a', roughness: 1, side: THREE.DoubleSide });
    for (let i = 0; i < 36; i++) { const mesh = new THREE.Mesh(blade, grassMaterial); const angle = i * 2.39996;
      mesh.position.set(Math.sin(angle) * (5 + i % 3 * 0.3), 0.03, Math.cos(angle) * (5 + i % 3 * 0.3)); mesh.rotation.y = angle; mesh.castShadow = true; grass.add(mesh); }
    this.environment.add(grass); this.effects.addFoliage(grass);
    for (const actor of [ctx.player, ctx.enemy]) { const fill = new THREE.PointLight('#d5e2ec', 0.5, 2.8, 2); fill.position.set(0, 1.6, 0.6); actor.add(fill); this.fills.push(fill); }
    this.buildControls(); this.apply();
    window.addEventListener('pagehide', () => { this.effects.dispose(); this.gpuPipeline?.dispose(); this.composer?.dispose(); blade.dispose(); grassMaterial.dispose(); }, { once: true });
  }

  private buildControls(): void {
    const mount = document.getElementById('graphics-settings')!;
    mount.innerHTML = `<label>Anti-aliasing<select id="option-aa"><option value="traa">TAA</option><option value="traa-smaa">TAA + SMAA</option><option value="smaa">SMAA</option><option value="fxaa">FXAA</option><option value="msaa">4× MSAA</option><option value="none">Off</option></select></label>
      <label>Quality<select id="option-quality"><option value="enhanced">High</option><option value="laptop">Low</option></select></label>
      ${Object.keys(ranges).map((key) => `<label class="slider-label">${labels[key as NumericSetting]}<output id="value-${key}"></output><input id="option-${key}" type="range" min="${ranges[key as NumericSetting][0]}" max="${ranges[key as NumericSetting][1]}" step="${ranges[key as NumericSetting][2]}" aria-label="${labels[key as NumericSetting]}" /></label>`).join('')}
      <label class="checkbox-label"><input type="checkbox" id="option-fireShadows" />Fire shadows</label><label class="checkbox-label"><input type="checkbox" id="option-characterFill" />Character fill</label>`;
    document.getElementById('options-open')!.addEventListener('click', () => this.open());
    document.getElementById('options-close')!.addEventListener('click', () => this.close());
    this.dialog.addEventListener('cancel', (event) => { event.preventDefault(); this.close(); });
    window.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !this.dialog.open) { event.preventDefault(); this.open(); } });
    for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-options-tab]'))) button.addEventListener('click', () => {
      const active = button.dataset.optionsTab!;
      for (const panel of Array.from(document.querySelectorAll<HTMLElement>('[data-options-panel]'))) panel.hidden = panel.dataset.optionsPanel !== active;
      for (const tab of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-options-tab]'))) tab.setAttribute('aria-selected', String(tab === button));
    });
    this.input<HTMLSelectElement>('aa').addEventListener('change', () => {
      this.settings.aa = this.input<HTMLSelectElement>('aa').value as GraphicsSettings['aa'];
      if (usesWebGPU(this.settings.aa) !== this.webgpu) { this.save(); const url = new URL(location.href);
        url.search = ''; url.searchParams.set('aa', this.settings.aa); url.searchParams.set('renderer', usesWebGPU(this.settings.aa) ? 'webgpu' : 'webgl'); location.assign(url.href); return; }
      this.apply(); this.save();
    });
    this.input<HTMLSelectElement>('quality').addEventListener('change', () => { this.settings.quality = this.input<HTMLSelectElement>('quality').value as GraphicsSettings['quality']; this.apply(); this.save(); });
    for (const key of Object.keys(ranges) as NumericSetting[]) this.input<HTMLInputElement>(key).addEventListener('input', () => {
      const value = Number(this.input<HTMLInputElement>(key).value);
      const rebuild = ['bloom', 'ao', 'dof'].includes(key) && (value === 0 || this.settings[key] === 0);
      this.settings[key] = value; this.apply(rebuild); this.save();
    });
    for (const key of ['fireShadows', 'characterFill'] as const) this.input<HTMLInputElement>(key).addEventListener('change', () => { this.settings[key] = this.input<HTMLInputElement>(key).checked; this.apply(); this.save(); });
    document.getElementById('options-reset')!.addEventListener('click', () => { this.settings = defaults(); if (!this.webgpu) this.settings.aa = 'smaa'; this.apply(); this.save(); });
    document.getElementById('options-restart')!.addEventListener('click', () => { this.close(); ctxReset(this.ctx); });
    document.getElementById('options-inspect')!.addEventListener('click', () => { this.close(); document.getElementById('rock-focus')!.click(); });
  }
  private input<T extends HTMLElement>(name: string): T { return document.getElementById(`option-${name}`) as T; }
  private save(): void { try { localStorage.setItem(settingsKey, JSON.stringify(this.settings)); } catch { /* Current settings still apply. */ } }
  open(): void { this.ctx.clearInput(); this.paused = true; this.dialog.showModal(); }
  close(): void { this.dialog.close(); this.paused = false; this.ctx.clearInput(); this.ctx.renderer.domElement.focus(); }

  private apply(rebuild = true): void {
    const { scene, ambient, sun, renderer } = this.ctx; const s = this.settings;
    scene.background = new THREE.Color('#20282b'); scene.fog = new THREE.Fog('#20282b', 25 - s.fog * 12, 65 - s.fog * 32);
    ambient.color.set('#a4b6bf'); ambient.groundColor.set('#393c37'); ambient.intensity = 0.95;
    sun.color.set('#d3d1bd'); sun.intensity = 1.1;
    this.fills.forEach((light) => { light.intensity = s.characterFill ? 0.5 : 0; });
    if (this.shadow) { this.shadow.castShadow = s.fireShadows; this.shadow.intensity = (8 + s.warmth * 18) * 0.45; this.shadow.shadow.needsUpdate = true; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, s.quality === 'enhanced' ? 1.5 : 1) * s.renderScale);
    renderer.toneMapping = THREE.NoToneMapping; renderer.toneMappingExposure = 1;
    this.effects.setQuality(s.quality); this.effects.setWeather(null);
    if (rebuild) this.rebuildComposer();
    this.gpuPipeline?.update(s, 0.72);
    if (this.grade) this.grade.uniforms.get('exposure')!.value = s.exposure;
    if (this.bloom) this.bloom.intensity = s.bloom;
    if (this.dof) this.dof.bokehScale = s.dof * 1.6;
    if (this.ao) this.ao.intensity = s.ao * 1.5;
    this.resize();
    this.input<HTMLSelectElement>('aa').value = s.aa; this.input<HTMLSelectElement>('quality').value = s.quality;
    for (const key of Object.keys(ranges) as NumericSetting[]) {
      this.input<HTMLInputElement>(key).value = String(s[key]);
      this.input<HTMLInputElement>(key).disabled = ['historyWeight', 'motionThreshold', 'depthThreshold'].includes(key) && !usesTemporal(s.aa);
      document.getElementById(`value-${key}`)!.textContent = key === 'renderScale' ? `${Math.round(s[key] * 100)}%` : key === 'historyWeight' || key === 'depthThreshold' ? s[key].toFixed(2) : key === 'motionThreshold' ? String(s[key]) : s[key].toFixed(2);
    }
    for (const key of ['fireShadows', 'characterFill'] as const) this.input<HTMLInputElement>(key).checked = s[key];
    this.intervals = []; this.lastFrame = 0;
  }

  resetHistory(): void { if (this.webgpu) this.rebuildComposer(); }
  private rebuildComposer(): void {
    this.composer?.dispose(); this.composer = null; this.bloom = null; this.dof = null; this.ao = null; this.grade = null;
    const { scene, camera, renderer } = this.ctx; const s = this.settings;
    if (!(renderer instanceof THREE.WebGLRenderer)) { this.gpuPipeline?.configure(s, 0.72); return; }
    const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: s.aa === 'msaa' ? 4 : 0 });
    composer.addPass(new RenderPass(scene, camera));
    if (s.ao > 0) { const normals = new NormalPass(scene, camera, { resolutionScale: 0.5 }); composer.addPass(normals);
      this.ao = new SSAOEffect(camera, normals.texture, { samples: 8, rings: 3, radius: 0.1, intensity: s.ao * 1.5, resolutionScale: 0.5, luminanceInfluence: 0.3 }); composer.addPass(new EffectPass(camera, this.ao)); }
    if (s.dof > 0) { this.dof = new DepthOfFieldEffect(camera, { focusRange: 16, focusDistance: 22, bokehScale: s.dof * 1.6, resolutionScale: 0.5 }); this.dof.target = this.ctx.controls.target; composer.addPass(new EffectPass(camera, this.dof)); }
    if (s.bloom > 0) { this.bloom = new BloomEffect({ luminanceThreshold: 1.1, luminanceSmoothing: 0.2, intensity: s.bloom, mipmapBlur: true, levels: s.quality === 'laptop' ? 4 : 6 }); this.bloom.luminancePass.resolution.scale = s.quality === 'laptop' ? 0.35 : 0.5; composer.addPass(new EffectPass(camera, this.bloom)); }
    this.grade = new NorthernGrade(); composer.addPass(new EffectPass(camera, this.grade, new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })));
    if (s.aa === 'fxaa') composer.addPass(new EffectPass(camera, new FXAAEffect()));
    if (s.aa === 'smaa') composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));
    this.composer = composer;
  }
  resize(): void {
    const mount = document.getElementById('scene')!; this.ctx.renderer.setSize(mount.clientWidth, mount.clientHeight); this.composer?.setSize(mount.clientWidth, mount.clientHeight);
    if (this.bloom) { const factor = this.settings.quality === 'laptop' ? 0.35 : 0.5; const ratio = this.ctx.renderer.getPixelRatio(); this.bloom.mipmapBlurPass.setSize(Math.round(mount.clientWidth * ratio * factor), Math.round(mount.clientHeight * ratio * factor)); }
  }

  async load(): Promise<void> {
    const loader = new GLTFLoader();
    const load = async (url: string) => { try { return (await loader.loadAsync(url)).scene; } catch { this.failed.push(url.split('/').pop()!); return null; } };
    const [rock, brazier, ground] = await Promise.all([load('/vendor/synty/art-lab/rock-painterly.glb'), load('/vendor/synty/art-lab/brazier.glb'), load('/vendor/terrain/ground-painterly.glb')]);
    if (rock) for (const original of this.ctx.rocks) { const model = rock.clone(true); model.position.copy(original.position); model.rotation.copy(original.rotation); model.scale.copy(original.scale);
      model.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } }); this.environment.add(model); original.visible = false; }
    if (ground) { ground.position.y = 0.012; ground.traverse((o) => { if (o instanceof THREE.Mesh) o.receiveShadow = true; }); this.ctx.scene.add(ground); }
    if (brazier) for (const [index, [x, z]] of [[1.4, 0.8], [-3.7, -1.9]].entries()) {
      const model = brazier.clone(true); const bounds = new THREE.Box3().setFromObject(model); const size = bounds.getSize(new THREE.Vector3()); const center = bounds.getCenter(new THREE.Vector3()); const scale = 1.1 / size.y;
      model.scale.multiplyScalar(scale); model.position.set(x - center.x * scale, -bounds.min.y * scale, z - center.z * scale);
      model.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } }); this.environment.add(model);
      const light = new THREE.PointLight('#ffb35c', 25, 8, 2); light.position.set(x, 1.3, z); this.environment.add(light); this.fires.push(light);
      if (index === 0) { this.shadow = new THREE.SpotLight('#ffb35c', 10, 14, 1.15, 0.8, 2); this.shadow.position.copy(light.position); this.shadow.target.position.set(0, 0, 0);
        this.shadow.shadow.mapSize.set(1024, 1024); this.shadow.shadow.camera.near = 0.2; this.shadow.shadow.camera.far = 14; this.shadow.shadow.bias = -0.0002; this.shadow.shadow.normalBias = 0.035; this.shadow.shadow.radius = 2.5;
        this.environment.add(this.shadow, this.shadow.target); }
      this.effects.addEmitter('fire', new THREE.Vector3(x, 1.25, z), this.environment, 20); this.effects.addEmitter('smoke', new THREE.Vector3(x, 1.6, z), this.environment, 5); this.effects.addEmitter('sparks', new THREE.Vector3(x, 1.4, z), this.environment, 4);
    }
    if (this.webgpu) { const { WebGPUArtPipeline } = await import('./webgpu-art'); this.gpuPipeline = new WebGPUArtPipeline(this.ctx.renderer as WebGPURenderer, this.ctx.scene, this.ctx.camera, this.ctx.controls.target); }
    this.apply();
    if (this.failed.length) document.getElementById('asset-status')!.textContent = `Missing art: ${this.failed.join(', ')}.`;
    if (document.body.dataset.rendererFallback) document.getElementById('asset-status')!.textContent = 'WebGPU unavailable. Using SMAA.';
  }

  render(dt: number): void {
    const now = performance.now(); if (this.lastFrame) this.intervals.push(now - this.lastFrame); this.lastFrame = now; if (this.intervals.length > 180) this.intervals.shift();
    if (!this.paused) this.time += dt;
    const base = 8 + this.settings.warmth * 18;
    this.fires.forEach((light, i) => { light.intensity = base * (1 + Math.sin(this.time * 3.3 + i * 1.7) * 0.025 + Math.sin(this.time * 7.1 + i) * 0.015); });
    if (this.shadow) this.shadow.intensity = base * 0.45 * (1 + Math.sin(this.time * 3.3) * 0.025);
    this.effects.paused = this.paused; this.effects.update(dt);
    if (this.gpuPipeline) this.gpuPipeline.render(); else if (this.composer) this.composer.render(dt); else this.ctx.renderer.render(this.ctx.scene, this.ctx.camera);
    if (now - this.statsAt > 500 && this.intervals.length >= 30) { const sorted = [...this.intervals].sort((a, b) => a - b);
      this.ctx.renderer.domElement.dataset.graphics = JSON.stringify({ settings: this.settings, renderer: this.webgpu ? 'webgpu' : 'webgl', median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.floor(sorted.length * 0.95)],
        width: this.ctx.renderer.domElement.width, height: this.ctx.renderer.domElement.height, cameraOffset: this.ctx.camera.position.clone().sub(this.ctx.controls.target).toArray(), camera: this.ctx.camera.position.toArray(), zoom: this.ctx.camera.zoom,
        fireShadow: { enabled: this.shadow?.castShadow, map: !!this.shadow?.shadow.map, intensity: this.shadow?.intensity }, fill: this.fills.map((light) => light.intensity) }); this.statsAt = now; }
  }
}
function ctxReset(ctx: ArtContext): void { ctx.resetEncounter(); ctx.renderer.domElement.focus(); }
