
import type { LightingMode } from './lighting-profiles';
export type { LightingMode } from './lighting-profiles';

/** Commit only after destination construction succeeds; retries and hot reload retain the mood. */
export class EnvironmentMood {
  mode: LightingMode = 'golden';
  private entered = false;
  constructor(private random: () => number = Math.random) {}
  choose(retain = false, modes: readonly LightingMode[] = ['golden', 'silver']): LightingMode { return this.entered && retain && modes.includes(this.mode) ? this.mode : modes[Math.min(modes.length - 1, Math.floor(this.random() * modes.length))] ?? 'golden'; }
  commit(mode: LightingMode): void { this.mode = mode; this.entered = true; }
}
