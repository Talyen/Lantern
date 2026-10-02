import { isRecord, parseJson } from '../data/json';
export type AudioSettings = { master: number; effects: number; ambience: number };
export const audioSettingsKey = 'lantern.audio.v1';
export const audioDefaults = (): AudioSettings => ({ master: .8, effects: 1, ambience: .6 });
export function readAudioSettings(): AudioSettings {
  const defaults = audioDefaults();
  try {
    const saved = parseJson(localStorage.getItem(audioSettingsKey) ?? '{}');
    if (!isRecord(saved)) return defaults;
    for (const key of Object.keys(defaults) as (keyof AudioSettings)[]) { const value = saved[key]; if (typeof value === 'number' && Number.isFinite(value)) defaults[key] = Math.min(1, Math.max(0, value)); }
  } catch { /* Audio preferences must never prevent play. */ }
  return defaults;
}
export function saveAudioSettings(settings: AudioSettings): void {
  try { localStorage.setItem(audioSettingsKey, JSON.stringify(settings)); } catch { /* Keep the working session preferences. */ }
}
