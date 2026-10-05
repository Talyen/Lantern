import manifest from '../../assets/audio/manifest.json';
import { readAudioSettings, type AudioSettings } from './settings';

export type SoundCue = keyof typeof manifest.cues;
export type SoundPosition = { x: number; z: number };
type Bus = 'effects' | 'ambience' | 'ui';
type Voice = { source: AudioBufferSourceNode; gain: GainNode; pan: StereoPannerNode; bus: Bus; position?: SoundPosition; level: number; key?: string; loop: boolean; filter?: BiquadFilterNode };
const cues = manifest.cues as Record<SoundCue, { clips: string[]; gain: number; bus: Bus; rate: number }>;
const clips = manifest.clips as Record<string, { url: string; loop: boolean; loopStart?: number; loopEnd?: number }>;

/** Presentation only. Semantic gameplay events decide which sounds happen. */
export class GameAudio {
  settings = readAudioSettings();
  private context?: AudioContext;
  private master?: GainNode;
  private buses = new Map<Bus, GainNode>();
  private buffers = new Map<string, AudioBuffer>();
  private voices = new Set<Voice>();
  private keyedVoices = new Map<string, Voice>();
  private last = new Map<SoundCue, number>();
  private listener: SoundPosition = { x: 0, z: 0 };
  private paused = true;
  private hidden = document.hidden || !document.hasFocus();
  private unlocked = false;
  private disposed = false;
  private failures = new Set<string>();
  private counts = new Map<SoundCue, number>();
  private loading = 0;
  private lifecycle: Promise<void> = Promise.resolve();
  private gesture = () => { void this.unlock().catch((error: unknown) => this.fail('unlock', error)); };
  private visibility = () => this.setHidden(document.hidden || !document.hasFocus());
  private blur = () => this.setHidden(true);
  private focus = () => this.setHidden(document.hidden);
  constructor() {
    window.addEventListener('pointerdown', this.gesture, true);
    window.addEventListener('keydown', this.gesture, true);
    document.addEventListener('visibilitychange', this.visibility);
    window.addEventListener('blur', this.blur);
    window.addEventListener('focus', this.focus);
    try {
      this.context = new AudioContext();
      this.master = this.context.createGain(); this.master.gain.value = this.hidden ? 0 : this.settings.master; this.master.connect(this.context.destination);
      for (const bus of ['effects', 'ambience', 'ui'] as const) { const node = this.context.createGain(); node.gain.value = bus === 'ui' ? this.settings.effects : 0; node.connect(this.master); this.buses.set(bus, node); }
      this.applySettings(this.settings);
      void this.prepare().catch((error: unknown) => this.fail('preparation', error));
    } catch (error) { this.fail('initialization', error); }
  }
  private fail(id: string, error: unknown): void {
    if (this.failures.has(id) || this.disposed) return;
    this.failures.add(id); console.warn(`Lantern audio unavailable (${id})`, error);
  }
  private async prepare(): Promise<void> {
    const pending = Object.entries(clips); this.loading = pending.length;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (pending.length && !this.disposed) {
        const [id, clip] = pending.shift()!;
        try {
          const response = await fetch(clip.url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const buffer = await this.context!.decodeAudioData(await response.arrayBuffer());
          if (!this.disposed) this.buffers.set(id, buffer);
        } catch (error) { this.fail(id, error); }
        finally { this.loading--; }
      }
    }));
  }
  private async unlock(): Promise<void> {
    if (!this.context || this.disposed) return;
    try {
      this.unlocked = true;
      if (!this.hidden && this.context.state !== 'running') await this.context.resume();
    } catch (error) { this.fail('unlock', error); }
  }
  private setHidden(hidden: boolean): void {
    this.hidden = hidden;
    if (hidden) this.clearTransient(true);
    this.lifecycle = this.lifecycle.then(async () => {
      if (!this.context || this.disposed) return;
      if (this.hidden) await this.context.suspend();
      else if (this.unlocked) await this.context.resume();
    }).catch((error: unknown) => this.fail('visibility', error));
    this.updateGains();
  }
  applySettings(settings: AudioSettings): void { this.settings = { ...settings }; this.updateGains(); }
  private updateGains(): void {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    this.master.gain.setTargetAtTime(this.hidden ? 0 : this.settings.master, now, .015);
    this.buses.get('ui')!.gain.setTargetAtTime(this.settings.effects, now, .015);
    this.buses.get('effects')!.gain.setTargetAtTime(this.paused ? 0 : this.settings.effects, now, .015);
    this.buses.get('ambience')!.gain.setTargetAtTime(this.paused ? 0 : this.settings.ambience, now, .06);
  }
  update(listener: SoundPosition, paused: boolean): void {
    this.listener.x = listener.x; this.listener.z = listener.z;
    if (paused !== this.paused) { this.paused = paused; if (paused) this.clearTransient(); this.updateGains(); }
    for (const voice of this.voices) this.position(voice);
  }
  private position(voice: Voice, immediate = false): void {
    if (!this.context) return;
    const dx = voice.position ? voice.position.x - this.listener.x : 0, dz = voice.position ? voice.position.z - this.listener.z : 0;
    const attenuation = voice.position ? Math.max(0, 1 - Math.hypot(dx, dz) / 18) ** 2 : 1;
    const level = voice.level * attenuation, pan = Math.max(-.8, Math.min(.8, (dx - dz) / 14));
    if (immediate) { voice.gain.gain.setValueAtTime(level, this.context.currentTime); voice.pan.pan.setValueAtTime(pan, this.context.currentTime); }
    else { voice.gain.gain.setTargetAtTime(level, this.context.currentTime, .015); voice.pan.pan.setTargetAtTime(pan, this.context.currentTime, .015); }
  }
  play(cue: SoundCue, position?: SoundPosition, options: { key?: string; loop?: boolean; rate?: number; gain?: number } = {}): void {
    const context = this.context, definition = cues[cue];
    if (!context || this.disposed || !this.unlocked || context.state !== 'running' || this.hidden || this.paused && definition.bus !== 'ui') return;
    if (options.key && this.keyedVoices.get(options.key)) return;
    let index = Math.floor(Math.random() * definition.clips.length);
    if (definition.clips.length > 1 && index === this.last.get(cue)) index = (index + 1) % definition.clips.length;
    const id = definition.clips[index], buffer = this.buffers.get(id);
    if (!buffer) return; // Never queue a stale attack or reward for later playback.
    this.last.set(cue, index);
    let count = 0, oldest: Voice | undefined;
    for (const voice of this.voices) if (voice.bus === definition.bus && !voice.loop) { count++; oldest ??= voice; }
    if (count >= (definition.bus === 'ui' ? 4 : 20) && oldest) this.stopVoice(oldest);
    const source = context.createBufferSource(), gain = context.createGain(), pan = context.createStereoPanner();
    gain.gain.value = 0;
    source.buffer = buffer; source.loop = options.loop ?? false;
    if (source.loop) { source.loopStart = clips[id].loopStart ?? 0; source.loopEnd = Math.min(buffer.duration,clips[id].loopEnd ?? buffer.duration); } source.playbackRate.value = options.rate ?? definition.rate;
    const filter = cue === 'rain' ? context.createBiquadFilter() : undefined;
    if (filter) { filter.type = 'lowpass'; filter.frequency.value = 20000; source.connect(filter); filter.connect(gain); } else source.connect(gain);
    gain.connect(pan); pan.connect(this.buses.get(definition.bus)!);
    const voice: Voice = { source, gain, pan, bus: definition.bus, position: position ? { x: position.x, z: position.z } : undefined, level: definition.gain * (options.gain ?? 1), key: options.key, loop: source.loop, filter };
    this.voices.add(voice);
    if (voice.key) this.keyedVoices.set(voice.key, voice);
    this.position(voice, !voice.loop);
    source.onended = () => { this.removeVoice(voice); source.disconnect(); filter?.disconnect(); gain.disconnect(); pan.disconnect(); };
    source.start(); this.counts.set(cue, (this.counts.get(cue) ?? 0) + 1);
  }
  loop(key: string, cue: SoundCue, position?: SoundPosition, gain = 1, lowpass = 20000): void {
    const voice = this.keyedVoices.get(key);
    if (voice) {
      if (position) { voice.position ??= { x: 0, z: 0 }; voice.position.x = position.x; voice.position.z = position.z; }
      else voice.position = undefined;
      voice.level = cues[cue].gain * gain;
      voice.filter?.frequency.setTargetAtTime(lowpass, this.context!.currentTime, .15); return;
    }
    let count = 0; for (const active of this.voices) if (active.loop) count++;
    if (count < 12) {
      this.play(cue, position, { key, loop: true, gain });
      this.keyedVoices.get(key)?.filter?.frequency.setTargetAtTime(lowpass, this.context!.currentTime, .15);
    }
  }
  keepLoops(keys: Set<string>): void { for (const voice of this.voices) if (voice.loop && voice.key && !keys.has(voice.key)) this.stopVoice(voice); }
  stop(key: string): void {
    const voice = this.keyedVoices.get(key); if (voice) this.stopVoice(voice);
  }
  private removeVoice(voice: Voice): void {
    this.voices.delete(voice);
    // A stopped voice may end after another voice has reused its key.
    if (voice.key && this.keyedVoices.get(voice.key) === voice) this.keyedVoices.delete(voice.key);
  }
  private stopVoice(voice: Voice): void {
    const now = this.context!.currentTime; voice.gain.gain.cancelScheduledValues(now); voice.gain.gain.setTargetAtTime(0, now, .005);
    voice.source.stop(now+.025); this.removeVoice(voice);
  }
  clearTransient(includeUi = false): void { for (const voice of this.voices) if (!voice.loop && (includeUi || voice.bus !== 'ui')) this.stopVoice(voice); }
  clearArea(): void { for (const voice of this.voices) if (voice.bus !== 'ui') this.stopVoice(voice); }
  diagnostics() { return { state: this.context?.state ?? 'unavailable', unlocked: this.unlocked, paused: this.paused, hidden: this.hidden, loaded: this.buffers.size, loading: this.loading, voices: this.voices.size, gains: {master:this.master?.gain.value,effects:this.buses.get('effects')?.gain.value,ambience:this.buses.get('ambience')?.gain.value,ui:this.buses.get('ui')?.gain.value}, loops: [...this.voices].filter(v => v.loop).map(v => v.key), played: Object.fromEntries(this.counts), errors: [...this.failures], settings: this.settings }; }
  dispose(): void {
    this.disposed = true;
    window.removeEventListener('pointerdown', this.gesture, true); window.removeEventListener('keydown', this.gesture, true);
    document.removeEventListener('visibilitychange', this.visibility); window.removeEventListener('blur', this.blur); window.removeEventListener('focus', this.focus);
    for (const voice of this.voices) this.stopVoice(voice);
    this.buffers.clear(); if (this.context) void this.context.close().catch((error: unknown) => console.warn('Unable to release audio.', error));
  }
}
