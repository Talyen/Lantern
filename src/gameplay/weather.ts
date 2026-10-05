import { isRecord } from '../data/json';

export type WeatherPhase = 'dry' | 'gathering' | 'shower' | 'clearing';
export type WeatherState = { phase: WeatherPhase; elapsed: number; drySeconds: number; showerSeconds: number; peak: number; seed: number; wetness: number };
const fadeSeconds = 15;
function random(state: WeatherState): number {
  state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0;
  return state.seed / 4294967296;
}
function schedule(state: WeatherState): void {
  state.drySeconds = 1080 + random(state) * 840;
  state.showerSeconds = 60 + random(state) * 120;
  state.peak = .65 + random(state) * .35;
}
export function freshWeather(seed = crypto.getRandomValues(new Uint32Array(1))[0]): WeatherState {
  const state: WeatherState = { phase: 'dry', elapsed: 0, drySeconds: 1080, showerSeconds: 60, peak: 1, seed: seed >>> 0, wetness: 0 };
  schedule(state); return state;
}
export function weatherIntensity(state: WeatherState): number {
  if (state.phase === 'dry') return 0;
  if (state.phase === 'shower') return state.peak;
  const t = Math.min(1, state.elapsed / fadeSeconds), smooth = t * t * (3 - 2 * t);
  return state.peak * (state.phase === 'gathering' ? smooth : 1 - smooth);
}
/** Active-play time only; this independent random stream never consumes loot rolls. */
export function advanceWeather(state: WeatherState, seconds: number): void {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  while (seconds > 0) {
    const duration = state.phase === 'dry' ? state.drySeconds : state.phase === 'shower' ? state.showerSeconds : fadeSeconds;
    const step = Math.min(seconds, duration - state.elapsed);
    const before = weatherIntensity(state);
    state.elapsed += step;
    const intensity = (before + weatherIntensity(state)) / 2;
    state.wetness = Math.max(0, Math.min(1, state.wetness + (intensity > 0 ? intensity / 60 : -1 / 300) * step));
    seconds -= step;
    if (state.elapsed >= duration) {
      state.elapsed = 0;
      if (state.phase === 'dry') state.phase = 'gathering';
      else if (state.phase === 'gathering') state.phase = 'shower';
      else if (state.phase === 'shower') state.phase = 'clearing';
      else { state.phase = 'dry'; schedule(state); }
    }
  }
}
export function decodeWeather(value: unknown): WeatherState {
  if (!isRecord(value) || !['dry','gathering','shower','clearing'].includes(String(value.phase))
    || !['elapsed','drySeconds','showerSeconds','peak','seed','wetness'].every(key => typeof value[key] === 'number' && Number.isFinite(value[key]))
    || Number(value.drySeconds) < 1080 || Number(value.drySeconds) > 1920 || Number(value.showerSeconds) < 60 || Number(value.showerSeconds) > 180
    || Number(value.peak) < .65 || Number(value.peak) > 1 || !Number.isInteger(value.seed) || Number(value.seed) < 0 || Number(value.seed) > 4294967295
    || Number(value.wetness) < 0 || Number(value.wetness) > 1 || Number(value.elapsed) < 0
    || Number(value.elapsed) >= (value.phase === 'dry' ? Number(value.drySeconds) : value.phase === 'shower' ? Number(value.showerSeconds) : fadeSeconds)) throw new Error('Invalid weather save');
  return { phase: value.phase as WeatherPhase, elapsed: Number(value.elapsed), drySeconds: Number(value.drySeconds), showerSeconds: Number(value.showerSeconds), peak: Number(value.peak), seed: Number(value.seed), wetness: Number(value.wetness) };
}
