export type Antialiasing = 'traa' | 'traa-smaa' | 'smaa' | 'fxaa' | 'msaa' | 'none';
export type GraphicsSettings = {
  aa: Antialiasing; quality: 'laptop' | 'enhanced'; renderScale: number;
  historyWeight: number; motionThreshold: number; depthThreshold: number;
  exposure: number; warmth: number; fog: number; bloom: number; ao: number; dof: number;
  fireShadows: boolean; characterFill: boolean;
};
export const defaultCameraZoom = 1.35;
export const settingsKey = 'lantern.options.v1';
export const defaults = (): GraphicsSettings => ({ aa: 'traa', quality: 'enhanced', renderScale: 1,
  historyWeight: 0.95, motionThreshold: 16, depthThreshold: 0.1,
  exposure: 1.1, warmth: 0.85, fog: 0.7, bloom: 0.8, ao: 1, dof: 1,
  fireShadows: true, characterFill: true });
export const ranges = {
  renderScale: [0.5, 2, 0.05], historyWeight: [0.5, 0.98, 0.01], motionThreshold: [2, 64, 1], depthThreshold: [0.01, 0.5, 0.01],
  exposure: [0.5, 2, 0.01], warmth: [0, 1, 0.01], fog: [0, 1, 0.01], bloom: [0, 1, 0.01], ao: [0, 1, 0.01], dof: [0, 1, 0.01],
} as const;
export type NumericSetting = keyof typeof ranges;
export const aaMethods: Antialiasing[] = ['traa', 'traa-smaa', 'smaa', 'fxaa', 'msaa', 'none'];
export const usesTemporal = (aa: Antialiasing) => aa === 'traa' || aa === 'traa-smaa';
export const usesWebGPU = (aa: Antialiasing) => usesTemporal(aa) || aa === 'none';
export function readSettings(): GraphicsSettings {
  const result = defaults();
  let saved: Partial<GraphicsSettings> = {};
  try { saved = JSON.parse(localStorage.getItem(settingsKey) ?? '{}') ?? {}; } catch { /* Defaults remain usable. */ }
  const query = new URLSearchParams(location.search);
  const aa = query.get('aa') ?? saved.aa;
  if (aaMethods.includes(aa as Antialiasing)) result.aa = aa as Antialiasing;
  if (query.get('renderer') === 'webgl' && usesWebGPU(result.aa)) result.aa = 'smaa';
  const quality = query.get('quality') ?? saved.quality;
  if (quality === 'laptop' || quality === 'enhanced') result.quality = quality;
  for (const key of Object.keys(ranges) as NumericSetting[]) {
    const value = query.has(key) ? Number(query.get(key)) : saved[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= ranges[key][0] && value <= ranges[key][1]) result[key] = value;
  }
  for (const key of ['fireShadows', 'characterFill'] as const) if (typeof saved[key] === 'boolean') result[key] = saved[key];
  return result;
}
