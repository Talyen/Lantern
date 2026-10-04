import { parseJson } from '../src/data/json';
import { expect, test, vi } from 'vitest';
import { defaults, defaultsVersion, migrateSettings, parseSettings, readSettings, saveSettings, settingsKey } from '../src/rendering/graphics-settings';

test('FSR-only settings retire method controls and preserve applicable preferences', () => {
  const saved = { aa: 'traa', renderScale: 1.1, historyWeight: .94, volumetricLighting: false, quality: 'laptop', upscaleQuality: 'quality', sharpness: .1, dof: 'off', atmosphericParticles: false };
  expect(migrateSettings(saved)).toMatchObject({ shadowQuality: 'low', particleQuality: 'low', upscaleQuality: 'quality', sharpness: .1, dof: 'off', atmosphericParticles: false });
  expect(migrateSettings({ quality: 'enhanced' })).toMatchObject({ shadowQuality: 'high', particleQuality: 'high' });
  expect(migrateSettings({ ...saved, shadowQuality: 'medium', particleQuality: 'high' })).toMatchObject({ shadowQuality: 'medium', particleQuality: 'high' });
  const parsed = parseSettings(saved, new URLSearchParams('aa=none&quality=enhanced&renderScale=1.25&volumetricLighting=true&shadowQuality=medium&particleQuality=low&upscaleQuality=native'));
  expect(parsed).toMatchObject({ shadowQuality: 'medium', particleQuality: 'low', upscaleQuality: 'native' });
  for (const key of ['aa', 'quality', 'renderScale', 'historyWeight', 'motionThreshold', 'depthThreshold', 'volumetricLighting']) expect(parsed).not.toHaveProperty(key);
  expect(parseSettings({}, new URLSearchParams('shadowQuality=unknown&particleQuality=unknown&sharpness=NaN'))).toMatchObject({ shadowQuality: 'high', particleQuality: 'high', sharpness: .5 });
});

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
    expect(saved()).toMatchObject({ defaultsVersion, dof: 'off', sharpness: .3, outlines: false, atmosphericParticles: false, textureDepth: true });
    saveSettings({ ...readSettings(), exposure: 1.1 }, 'exposure');
    expect(saved()).toMatchObject({ exposure: 1.1, dof: 'off', sharpness: .3, outlines: false, atmosphericParticles: false });
    saveSettings({ ...readSettings(), atmosphericParticles: true }, 'atmosphericParticles');
    vi.stubGlobal('location', { search: '' });
    expect(readSettings()).toMatchObject({ exposure: 1.1, dof: 'off', sharpness: .3, outlines: false, atmosphericParticles: true });
  } finally { vi.unstubAllGlobals(); }
});

// Admission: introducing weather must not silently re-enable previously disabled precipitation or overwrite unrelated settings.
test('new presentation preferences preserve old precipitation choices and independent saved switches',()=>{
  expect(migrateSettings({atmosphericParticles:false,dof:'off',exposure:.8})).toMatchObject({weatherEffects:false,cameraShake:true,resourceNumbers:true,dof:'off',exposure:.8});
  expect(migrateSettings({atmosphericParticles:false,weatherEffects:true,cameraShake:false,resourceNumbers:false})).toMatchObject({atmosphericParticles:false,weatherEffects:true,cameraShake:false,resourceNumbers:false});
});
