import { parseJson } from '../src/data/json';
import { expect, test, vi } from 'vitest';
import { defaults, defaultsVersion, readSettings, saveSettings, settingsKey } from '../src/rendering/graphics-settings';

// Keep durable preference isolation; repeated individual control permutations add no protection.
test('graphics migration and edits preserve saved choices beneath temporary URL overrides', () => {
  const storage = new Map<string, string>();
  const saved = () => parseJson(storage.get(settingsKey)!);
  vi.stubGlobal('location', { search: '' });
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  try {
    saveSettings({ ...defaults(), dof: 'soft', exposure: .8 });
    expect(readSettings()).toMatchObject({ dof: 'soft', exposure: .8 });
    storage.set(settingsKey, JSON.stringify({ defaultsVersion: 2, volumetricLighting: false, atmosphericParticles: false, dof: 'off', sharpness: .3, outlines: false }));
    vi.stubGlobal('location', { search: '?dof=cinematic&sharpness=.8&outlines=on&atmosphericParticles=on' });
    expect(readSettings()).toMatchObject({ dof: 'cinematic', sharpness: .8, outlines: true, atmosphericParticles: true });
    expect(saved()).not.toHaveProperty('volumetricLighting');
    expect(saved()).toMatchObject({ defaultsVersion, dof: 'off', sharpness: .3, outlines: false, atmosphericParticles: false, textureDepth: false, weatherEffects: false });
    saveSettings({ ...readSettings(), exposure: 1.1 }, 'exposure');
    expect(saved()).toMatchObject({ exposure: 1.1, dof: 'off', sharpness: .3, outlines: false, atmosphericParticles: false });
    saveSettings({ ...readSettings(), atmosphericParticles: true }, 'atmosphericParticles');
    vi.stubGlobal('location', { search: '' });
    expect(readSettings()).toMatchObject({ exposure: 1.1, dof: 'off', sharpness: .3, outlines: false, atmosphericParticles: true });
  } finally { vi.unstubAllGlobals(); }
});
