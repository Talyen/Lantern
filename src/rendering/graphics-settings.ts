import { readPreference } from '../data/preferences';
import { isRecord, parseJson } from '../data/json';
import { qualityLevels, type QualityLevel } from './quality-presets';
export const frameRateLimits = [60, 120, 144, 240, 0] as const;
export type FrameRateLimit = typeof frameRateLimits[number];
export function defaultFrameRate(refreshRate = 0): FrameRateLimit {
  if (!Number.isFinite(refreshRate) || refreshRate <= 0) return 60;
  // Allow nominal rates such as 59.94 and 143.98 Hz.
  return ([240, 144, 120, 60] as const).find((rate) => rate <= refreshRate + 1) ?? 60;
}
export const upscaleQualities = ['native', 'quality', 'balanced', 'performance'] as const;
export type UpscaleQuality = typeof upscaleQualities[number];
export const depthOfFieldModes = ['off', 'soft', 'cinematic'] as const;
export type DepthOfFieldMode = typeof depthOfFieldModes[number];
export const upscaleRatio = (quality: UpscaleQuality) => ({ native: 1, quality: 1.5, balanced: 1.7, performance: 2 })[quality];
export const cameraDistances = ['default', 'far'] as const;
export type CameraDistance = typeof cameraDistances[number];
export const cameraDistanceMultipliers: Record<CameraDistance, number> = { default: 0.6, far: 0.78 };
export const defaultCameraZoom = 1 / cameraDistanceMultipliers.default;
export type GraphicsSettings = {
  cameraDistance: CameraDistance;
  upscaleQuality: UpscaleQuality; sharpness: number; shadowQuality: QualityLevel; particleQuality: QualityLevel; fpsLimit: FrameRateLimit;
  exposure: number; warmth: number; fog: number; bloom: number; ao: number; dof: DepthOfFieldMode;
  cameraShake: boolean; resourceNumbers: boolean; weatherEffects: boolean;
  atmosphericParticles: boolean; outlines: boolean; textureDepth: boolean;
};
export const settingsKey = 'lantern.options.v1';
export const defaults = (query = new URLSearchParams(typeof location === 'undefined' ? '' : location.search)): GraphicsSettings => ({ cameraDistance: 'default', upscaleQuality: 'quality', sharpness: 0.50, shadowQuality: 'high', particleQuality: 'high',
  fpsLimit: defaultFrameRate(Number(query.get('displayHz'))),
  exposure: 1.25, warmth: 0.85, fog: 0.7, bloom: 0.4, ao: 0.65, dof: 'cinematic', cameraShake: true, resourceNumbers: true, weatherEffects: true, atmosphericParticles: true, outlines: true, textureDepth: true });
export const ranges = {
  sharpness: [0, 1, 0.01],
  exposure: [0.5, 2, 0.01], warmth: [0, 1, 0.01], fog: [0, 1, 0.01], bloom: [0, 1, 0.01], ao: [0, 1, 0.01],
} as const;
export type NumericSetting = keyof typeof ranges;
export const defaultsVersion = 8;
export type SavedSettings = Partial<GraphicsSettings> & { defaultsVersion?: number; quality?: 'laptop' | 'enhanced' };
/** Apply this visual-default revision once; later player choices remain authoritative. */
export function migrateSettings(value: unknown): GraphicsSettings {
  // Preserve applicable preferences; retiring rendering methods changes no other choices.
  const saved = isRecord(value) ? value : {};
  const level = saved.quality === 'laptop' ? 'low' : 'high';
  const migrated = { ...saved, weatherEffects: saved.weatherEffects ?? (typeof saved.atmosphericParticles === 'boolean' ? saved.atmosphericParticles : true), shadowQuality: saved.shadowQuality ?? level, particleQuality: saved.particleQuality ?? level };
  return parseSettings(migrated);
}
export function saveSettings(settings: GraphicsSettings, changedKey?: keyof GraphicsSettings): void {
  try {
    // Save only an explicitly edited control so comparison URL values stay temporary.
    const persisted = changedKey ? { ...migrateSettings(parseJson(localStorage.getItem(settingsKey) ?? '{}')), [changedKey]: settings[changedKey] } : settings;
    localStorage.setItem(settingsKey, JSON.stringify({ ...persisted, defaultsVersion }));
  } catch { /* Current settings still apply. */ }
}
export function readSettings(): GraphicsSettings {
  const value = readPreference(settingsKey), saved = isRecord(value) ? value : {};
  const query = new URLSearchParams(location.search);
  const migrated = migrateSettings({ fpsLimit: defaults(query).fpsLimit, ...saved });
  // Persist before URL overrides so temporary comparison URLs do not become preferences.
  if (saved.defaultsVersion !== defaultsVersion) saveSettings(migrated);
  return parseSettings(migrated, query);
}
export function parseSettings(value: unknown = {}, query = new URLSearchParams()): GraphicsSettings {
  const saved = isRecord(value) ? value : {};
  const result = defaults(query);
  for (const key of ['atmosphericParticles', 'outlines', 'textureDepth', 'cameraShake', 'resourceNumbers', 'weatherEffects'] as const) {
    if (typeof saved[key] === 'boolean') result[key] = saved[key];
    const override = query.get(key);
    if (override === 'on' || override === 'true') result[key] = true;
    else if (override === 'off' || override === 'false') result[key] = false;
  }
  const cameraDistance = query.get('cameraDistance') ?? saved.cameraDistance;
  if (cameraDistances.includes(cameraDistance as CameraDistance)) result.cameraDistance = cameraDistance as CameraDistance;
  const dof = query.get('dof') ?? saved.dof;
  if (depthOfFieldModes.includes(dof as DepthOfFieldMode)) result.dof = dof as DepthOfFieldMode;
  const upscaleQuality = query.get('upscaleQuality') ?? saved.upscaleQuality;
  if (upscaleQualities.includes(upscaleQuality as UpscaleQuality)) result.upscaleQuality = upscaleQuality as UpscaleQuality;
  for (const key of ['shadowQuality', 'particleQuality'] as const) {
    const value = query.get(key) ?? saved[key];
    if (qualityLevels.includes(value as QualityLevel)) result[key] = value as QualityLevel;
  }
  const fpsLimit = query.has('fpsLimit') ? Number(query.get('fpsLimit')) : saved.fpsLimit;
  if (frameRateLimits.includes(fpsLimit as FrameRateLimit)) result.fpsLimit = fpsLimit as FrameRateLimit;
  for (const key of Object.keys(ranges) as NumericSetting[]) {
    const value = query.has(key) ? Number(query.get(key)) : saved[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (value >= ranges[key][0] && value <= ranges[key][1]) result[key] = value;
    }
  }
  return result;
}
