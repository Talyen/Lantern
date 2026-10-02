export type AudioSettings = { master: number; effects: number; ambience: number };
export const audioSettingsKey = 'lantern.audio.v1';
export const audioDefaults = (): AudioSettings => ({ master: .8, effects: 1, ambience: .6 });
export function readAudioSettings(): AudioSettings {
  const defaults = audioDefaults();
  try {
    const saved = JSON.parse(localStorage.getItem(audioSettingsKey) ?? '{}');
    for (const key of Object.keys(defaults) as (keyof AudioSettings)[]) if (typeof saved?.[key] === 'number' && Number.isFinite(saved[key])) defaults[key] = Math.min(1, Math.max(0, saved[key]));
  } catch { /* Audio preferences must never prevent play. */ }
  return defaults;
}
export function saveAudioSettings(settings: AudioSettings): void {
  try { localStorage.setItem(audioSettingsKey, JSON.stringify(settings)); } catch { /* Keep the working session preferences. */ }
}
