import { diagnosticExportButton } from '../diagnostics/report';
import { qualityLevels } from '../rendering/quality-presets';
import { cameraDistances, defaults, depthOfFieldModes, frameRateLimits, ranges, parseSettings, readSettings, saveSettings, upscaleQualities, type GraphicsSettings, type NumericSetting } from '../rendering/graphics-settings';
import './options.css';
import { combatTextDefaults, readCombatTextSettings, saveCombatTextSettings, type CombatTextSettings } from './combat-text-settings';
import { audioDefaults, readAudioSettings, saveAudioSettings, type AudioSettings } from '../audio/settings';
import { bindMenuDismissal } from './menu';

const labels: Record<NumericSetting, string> = { sharpness: 'Sharpening',
  exposure: 'Exposure', warmth: 'Firelight', fog: 'Atmosphere', bloom: 'Bloom', ao: 'Ambient occlusion' };
type OptionsContext = {
  apply: (settings: GraphicsSettings) => void;
  combatText: (settings: CombatTextSettings) => void;
  flushSettings: () => void;
  resetMeasurements: () => void;
  clearInput: () => void;
  focus: () => void;
  keybindings: () => void;
  audio: {apply(settings: AudioSettings): void; play(cue: 'menuOpen' | 'menuClose' | 'uiClick'): void};
};

export class Options {
  get paused(): boolean { return this.dialog.open; }
  settings = readSettings();
  audioSettings = readAudioSettings();
  private combatTextSettings = readCombatTextSettings();
  private dialog = document.getElementById('options-dialog') as HTMLDialogElement;
  constructor(private ctx: OptionsContext) {
    this.buildControls(); this.buildAudio(); this.buildCombatText(); this.apply();
    this.dialog.querySelector('.options-footer')!.prepend(diagnosticExportButton());
    const bindings=document.createElement('button'); bindings.type='button'; bindings.textContent='Keybindings'; bindings.id='options-keybindings'; bindings.onclick=()=>{this.close();this.ctx.keybindings();};this.dialog.querySelector('#options-close')!.before(bindings);
    const error = document.createElement('p'); error.hidden = true; error.setAttribute('role', 'alert');
    document.getElementById('graphics-settings')!.append(error);
    document.getElementById('scene')!.addEventListener('graphicsresolutionchange', () => this.updateResolution(), true);
    this.updateResolution();
    document.getElementById('scene')!.addEventListener('graphicssettingschange', event => {
      const canvas = event.target as HTMLCanvasElement;
      error.textContent = canvas.dataset.settingsError ?? ''; error.hidden = !error.textContent;
    }, true);
  }
  private updateResolution(): void {
    const resolution = document.querySelector<HTMLCanvasElement>('#scene canvas')?.dataset.resolution;
    document.getElementById('graphics-resolution')!.textContent = resolution ? `Scene → Output: ${resolution}` : '';
  }
  private buildControls(): void {
    const mount = document.getElementById('graphics-settings')!;
    mount.innerHTML = `<label>Camera Distance<select id="option-cameraDistance">${cameraDistances.map(distance => `<option value="${distance}">${distance === 'default' ? 'Default' : 'Far'}</option>`).join('')}</select></label>
      <label>Resolution Quality<select id="option-upscaleQuality" aria-label="Resolution Quality">${upscaleQualities.map((quality) => `<option value="${quality}">${quality[0].toUpperCase() + quality.slice(1)}</option>`).join('')}</select><output id="graphics-resolution" class="graphics-resolution" aria-label="Scene and output resolution"></output></label>
      <label>Frame rate limit<select id="option-fpsLimit">${frameRateLimits.map((limit) => `<option value="${limit}">${limit || 'Unlimited'}</option>`).join('')}</select></label>
      ${(['shadowQuality', 'particleQuality'] as const).map(key => `<label>${key === 'shadowQuality' ? 'Shadow Quality' : 'Particle Effects'}<select id="option-${key}">${[...qualityLevels].reverse().map(value => `<option value="${value}">${value[0].toUpperCase() + value.slice(1)}</option>`).join('')}</select></label>`).join('')}
      <label>Depth of field<select id="option-dof">${depthOfFieldModes.map((mode) => `<option value="${mode}">${mode[0].toUpperCase() + mode.slice(1)}</option>`).join('')}</select></label>
      <label>Camera Shake<select id="option-cameraShake"><option value="true">On</option><option value="false">Off</option></select></label>
      <label>Resource Numbers<select id="option-resourceNumbers"><option value="true">On</option><option value="false">Off</option></select></label>
      <label>Weather Effects<select id="option-weatherEffects"><option value="true">On</option><option value="false">Off</option></select></label>
      <label>Atmospheric particles<select id="option-atmosphericParticles"><option value="true">On</option><option value="false">Off</option></select></label>
      <label title="Adds raised and recessed texture detail">Texture Depth<select id="option-textureDepth"><option value="true">On</option><option value="false">Off</option></select></label>
      <label>Outlines<select id="option-outlines"><option value="true">On</option><option value="false">Off</option></select></label>
      ${Object.keys(ranges).map((key) => `<label class="slider-label">${labels[key as NumericSetting]}<output id="value-${key}"></output><input id="option-${key}" type="range" min="${ranges[key as NumericSetting][0]}" max="${ranges[key as NumericSetting][1]}" step="${ranges[key as NumericSetting][2]}" aria-label="${labels[key as NumericSetting]}" /></label>`).join('')}`;
    document.getElementById('options-close')!.addEventListener('click', () => this.close());
    bindMenuDismissal(this.dialog, () => this.close());
    // The preference schema owns conversion and validation for every select.
    mount.querySelectorAll<HTMLSelectElement>('select').forEach(select => select.addEventListener('change', () => {
      const key = select.id.slice('option-'.length) as keyof GraphicsSettings;
      this.settings = parseSettings(this.settings, new URLSearchParams([[key, select.value]]));
      this.apply();
      if (key === 'fpsLimit') this.ctx.resetMeasurements();
      this.save(key);
    }));
    for (const key of Object.keys(ranges) as NumericSetting[]) this.input<HTMLInputElement>(key).addEventListener('input', () => {
      const value = Number(this.input<HTMLInputElement>(key).value);
      this.settings[key] = value; this.apply(); this.save(key);
    });
    document.getElementById('options-reset')!.addEventListener('click', () => { this.settings = defaults(); this.combatTextSettings = combatTextDefaults(); this.applyCombatText(); this.audioSettings = audioDefaults(); this.applyAudio(); this.apply(); this.save(); });
  }
  private buildAudio(): void {
    const section = document.createElement('section'); section.className = 'audio-settings'; section.innerHTML = '<h2>Sound</h2><div></div>';
    this.dialog.querySelector('.options-content')!.prepend(section);
    const graphicsTitle = document.createElement('h2'); graphicsTitle.className = 'graphics-title'; graphicsTitle.textContent = 'Graphics';
    document.getElementById('graphics-settings')!.before(graphicsTitle);
    for (const key of ['master','effects','ambience'] as const) {
      const label = document.createElement('label'); label.className = 'slider-label';
      label.innerHTML = `${key[0].toUpperCase()+key.slice(1)}<output id="audio-value-${key}"></output><input id="audio-${key}" type="range" min="0" max="100" step="1" aria-label="${key[0].toUpperCase()+key.slice(1)} volume">`;
      section.querySelector('div')!.append(label);
      label.querySelector('input')!.addEventListener('input', event => { this.audioSettings[key] = Number((event.target as HTMLInputElement).value)/100; this.applyAudio(); });
    }
    this.applyAudio();
  }
  private buildCombatText(): void {
    const section = document.createElement('section'); section.className = 'combat-text-settings';
    section.innerHTML = '<h2>Combat Text</h2><div></div>';
    this.dialog.querySelector('.options-content')!.append(section);
    const labels = { outgoing: 'Damage dealt', incoming: 'Damage received', healing: 'Healing', blocks: 'Block labels', size: 'Text size' };
    for (const key of ['outgoing', 'incoming', 'healing', 'blocks', 'size'] as const) {
      const label = document.createElement('label');
      label.innerHTML = `${labels[key]}<select id="combat-text-${key}">${key === 'size' ? '<option value="normal">Normal</option><option value="large">Large</option>' : '<option value="true">On</option><option value="false">Off</option>'}</select>`;
      section.querySelector('div')!.append(label);
      label.querySelector('select')!.addEventListener('change', event => {
        const value = (event.target as HTMLSelectElement).value;
        if (key === 'size') this.combatTextSettings.size = value === 'large' ? 'large' : 'normal';
        else this.combatTextSettings[key] = value === 'true';
        this.applyCombatText();
      });
    }
    this.applyCombatText();
  }
  private applyCombatText(): void {
    for (const key of ['outgoing', 'incoming', 'healing', 'blocks', 'size'] as const) {
      this.dialog.querySelector<HTMLSelectElement>(`#combat-text-${key}`)!.value = String(this.combatTextSettings[key]);
    }
    this.ctx.combatText({ ...this.combatTextSettings }); saveCombatTextSettings(this.combatTextSettings);
  }
  private applyAudio(): void {
    for (const key of ['master','effects','ambience'] as const) {
      this.dialog.querySelector<HTMLInputElement>(`#audio-${key}`)!.value = String(Math.round(this.audioSettings[key]*100));
      this.dialog.querySelector<HTMLOutputElement>(`#audio-value-${key}`)!.value = `${Math.round(this.audioSettings[key]*100)}%`;
    }
    this.ctx.audio.apply({...this.audioSettings}); saveAudioSettings(this.audioSettings);
  }
  private input<T extends HTMLElement>(name: string): T { return document.getElementById(`option-${name}`) as T; }
  private save(changedKey?: keyof GraphicsSettings): void { saveSettings(this.settings, changedKey); }
  open(): void { if (document.querySelector('dialog[open]')) return; this.ctx.clearInput(); this.dialog.showModal(); this.ctx.audio.play('menuOpen'); }
  close(): void { if (!this.dialog.open) return; this.ctx.audio.play('menuClose'); this.dialog.close(); this.ctx.flushSettings(); this.ctx.clearInput(); this.ctx.focus(); }

  private apply(): void {
    const s = this.settings;
    for (const key of Object.keys(s) as (keyof GraphicsSettings)[])
      this.input<HTMLInputElement | HTMLSelectElement>(key).value = String(s[key]);
    for (const key of Object.keys(ranges) as NumericSetting[]) {
      document.getElementById(`value-${key}`)!.textContent = s[key].toFixed(2);
    }
    this.ctx.apply(Object.freeze({ ...s }));
  }

}
