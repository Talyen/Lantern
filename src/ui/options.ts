import { qualityLevels } from '../rendering/quality-presets';
import { defaults, depthOfFieldModes, frameRateLimits, ranges, readSettings, saveSettings, upscaleQualities, type GraphicsSettings, type NumericSetting, type FrameRateLimit } from '../rendering/graphics-settings';
import './options.css';
import { bindMenuDismissal } from './menu';

const labels: Record<NumericSetting, string> = { sharpness: 'Sharpening',
  exposure: 'Exposure', warmth: 'Firelight', fog: 'Atmosphere', bloom: 'Bloom', ao: 'Ambient occlusion' };
type OptionsContext = {
  apply: (settings: GraphicsSettings) => void;
  flushSettings: () => void;
  resetMeasurements: () => void;
  clearInput: () => void;
  focus: () => void;
};

export class Options {
  paused = false;
  settings = readSettings();
  private dialog = document.getElementById('options-dialog') as HTMLDialogElement;
  constructor(private ctx: OptionsContext) {
    this.buildControls(); this.apply();
    const error = document.createElement('p'); error.hidden = true; error.setAttribute('role', 'alert');
    document.getElementById('graphics-settings')!.append(error);
    document.getElementById('scene')!.addEventListener('graphicssettingschange', event => {
      const canvas = event.target as HTMLCanvasElement;
      error.textContent = canvas.dataset.settingsError ?? ''; error.hidden = !error.textContent;
    }, true);
  }
  private buildControls(): void {
    const mount = document.getElementById('graphics-settings')!;
    mount.innerHTML = `<label>Resolution Quality<select id="option-upscaleQuality">${upscaleQualities.map((quality) => `<option value="${quality}">${quality[0].toUpperCase() + quality.slice(1)}</option>`).join('')}</select></label>
      <label>Frame rate limit<select id="option-fpsLimit">${frameRateLimits.map((limit) => `<option value="${limit}">${limit || 'Unlimited'}</option>`).join('')}</select></label>
      ${(['shadowQuality', 'particleQuality'] as const).map(key => `<label>${key === 'shadowQuality' ? 'Shadow Quality' : 'Particle Effects'}<select id="option-${key}">${[...qualityLevels].reverse().map(value => `<option value="${value}">${value[0].toUpperCase() + value.slice(1)}</option>`).join('')}</select></label>`).join('')}
      <label>Depth of field<select id="option-dof">${depthOfFieldModes.map((mode) => `<option value="${mode}">${mode[0].toUpperCase() + mode.slice(1)}</option>`).join('')}</select></label>
      <label>Atmospheric particles<select id="option-atmosphericParticles"><option value="true">On</option><option value="false">Off</option></select></label>
      <label>Outlines<select id="option-outlines"><option value="true">On</option><option value="false">Off</option></select></label>
      ${Object.keys(ranges).map((key) => `<label class="slider-label">${labels[key as NumericSetting]}<output id="value-${key}"></output><input id="option-${key}" type="range" min="${ranges[key as NumericSetting][0]}" max="${ranges[key as NumericSetting][1]}" step="${ranges[key as NumericSetting][2]}" aria-label="${labels[key as NumericSetting]}" /></label>`).join('')}`;
    document.getElementById('options-close')!.addEventListener('click', () => this.close());
    bindMenuDismissal(this.dialog, () => this.close());
    this.input<HTMLSelectElement>('upscaleQuality').addEventListener('change', () => { this.settings.upscaleQuality = this.input<HTMLSelectElement>('upscaleQuality').value as GraphicsSettings['upscaleQuality']; this.apply(); this.save('upscaleQuality'); });
    for (const key of ['shadowQuality', 'particleQuality'] as const) this.input<HTMLSelectElement>(key).addEventListener('change', () => { this.settings[key] = this.input<HTMLSelectElement>(key).value as GraphicsSettings[typeof key]; this.apply(); this.save(key); });
    this.input<HTMLSelectElement>('dof').addEventListener('change', () => {
      const value = this.input<HTMLSelectElement>('dof').value as GraphicsSettings['dof'];
      this.settings.dof = value; this.apply(); this.save('dof');
    });
    this.input<HTMLSelectElement>('fpsLimit').addEventListener('change', () => {
      this.settings.fpsLimit = Number(this.input<HTMLSelectElement>('fpsLimit').value) as FrameRateLimit;
      this.apply(); this.ctx.resetMeasurements(); this.save('fpsLimit');
    });
    for (const key of ['atmosphericParticles', 'outlines'] as const) this.input<HTMLSelectElement>(key).addEventListener('change', () => {
      this.settings[key] = this.input<HTMLSelectElement>(key).value === 'true';
      this.apply(); this.save(key);
    });
    for (const key of Object.keys(ranges) as NumericSetting[]) this.input<HTMLInputElement>(key).addEventListener('input', () => {
      const value = Number(this.input<HTMLInputElement>(key).value);
      this.settings[key] = value; this.apply(); this.save(key);
    });
    document.getElementById('options-reset')!.addEventListener('click', () => { this.settings = defaults(); this.apply(); this.save(); });
  }
  private input<T extends HTMLElement>(name: string): T { return document.getElementById(`option-${name}`) as T; }
  private save(changedKey?: keyof GraphicsSettings): void { saveSettings(this.settings, changedKey); }
  open(): void { if (document.querySelector('dialog[open]')) return; this.ctx.clearInput(); this.paused = true; this.dialog.showModal(); }
  close(): void { this.dialog.close(); this.ctx.flushSettings(); this.paused = false; this.ctx.clearInput(); this.ctx.focus(); }

  private apply(): void {
    const s = this.settings;
    for (const key of ['shadowQuality', 'particleQuality'] as const) this.input<HTMLSelectElement>(key).value = s[key];
    this.input<HTMLSelectElement>('fpsLimit').value = String(s.fpsLimit);
    this.input<HTMLSelectElement>('upscaleQuality').value = s.upscaleQuality;
    this.input<HTMLSelectElement>('dof').value = s.dof;
    this.input<HTMLSelectElement>('atmosphericParticles').value = String(s.atmosphericParticles);
    this.input<HTMLSelectElement>('outlines').value = String(s.outlines);
    for (const key of Object.keys(ranges) as NumericSetting[]) {
      this.input<HTMLInputElement>(key).value = String(s[key]);
      document.getElementById(`value-${key}`)!.textContent = s[key].toFixed(2);
    }
    this.ctx.apply(Object.freeze({ ...s }));
  }

}
