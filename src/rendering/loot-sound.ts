/** Quiet procedural foley keeps pickup feedback local and needs no external audio dependency. */
export class LootSound {
  private audio?: AudioContext;
  private unlock = () => { this.audio ??= new AudioContext(); void this.audio.resume().catch(() => {}); };
  private last = 0;
  constructor() { window.addEventListener('pointerdown', this.unlock); window.addEventListener('keydown', this.unlock); }
  play(collection: boolean): void {
    const audio = this.audio; if (!audio || audio.state !== 'running' || audio.currentTime - this.last < .06) return;
    this.last = audio.currentTime;
    const oscillator = audio.createOscillator(), gain = audio.createGain();
    oscillator.type = collection ? 'sine' : 'triangle'; oscillator.frequency.setValueAtTime(collection ? 760 : 180, audio.currentTime); oscillator.frequency.exponentialRampToValueAtTime(collection ? 420 : 65, audio.currentTime + .07);
    gain.gain.setValueAtTime(.0001, audio.currentTime); gain.gain.exponentialRampToValueAtTime(collection ? .025 : .015, audio.currentTime + .006); gain.gain.exponentialRampToValueAtTime(.0001, audio.currentTime + .1);
    oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + .11); oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
  dispose(): void { window.removeEventListener('pointerdown', this.unlock); window.removeEventListener('keydown', this.unlock); if (this.audio) void this.audio.close().catch(error => console.warn('Unable to release pickup audio.', error)); }
}
