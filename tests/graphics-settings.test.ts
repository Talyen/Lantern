import { parseJson, isRecord } from '../src/data/json';
import { expect, test, vi } from 'vitest';
import { defaults, defaultsVersion, migrateSettings, parseSettings, readSettings, saveSettings, settingsKey } from '../src/rendering/graphics-settings';

test('FSR-only settings retire method controls and preserve applicable preferences', () => {
  const raw = parseJson('{"aa":"traa","renderScale":1.1,"historyWeight":0.94,"volumetricLighting":false,"quality":"laptop","upscaleQuality":"quality","sharpness":0.1,"dof":"off","atmosphericParticles":false}');
  if (!isRecord(raw)) throw new Error('Invalid test fixture');
  const saved = raw;
  expect(migrateSettings(saved)).toMatchObject({ shadowQuality: 'low', particleQuality: 'low', upscaleQuality: 'quality', sharpness: .1, dof: 'off', atmosphericParticles: false });
  expect(migrateSettings({ quality: 'enhanced' })).toMatchObject({ shadowQuality: 'high', particleQuality: 'high' });
  expect(migrateSettings({ ...saved, shadowQuality: 'medium', particleQuality: 'high' })).toMatchObject({ shadowQuality: 'medium', particleQuality: 'high' });
  const parsed = parseSettings(saved, new URLSearchParams('aa=none&quality=enhanced&renderScale=1.25&volumetricLighting=true&shadowQuality=medium&particleQuality=low&upscaleQuality=native'));
  expect(parsed).toMatchObject({ shadowQuality: 'medium', particleQuality: 'low', upscaleQuality: 'native' });
  for (const key of ['aa', 'quality', 'renderScale', 'historyWeight', 'motionThreshold', 'depthThreshold', 'volumetricLighting']) expect(parsed).not.toHaveProperty(key);
  expect(parseSettings({}, new URLSearchParams('shadowQuality=unknown&particleQuality=unknown&sharpness=NaN'))).toMatchObject({ shadowQuality: 'high', particleQuality: 'high', sharpness: .5 });
});

test('graphics modes preserve defaults, saved choices and temporary comparison URLs', () => {
  const storage = new Map<string, string>();
  vi.stubGlobal('location', { search: '' });
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  try {
    expect(readSettings()).toMatchObject({ dof: 'cinematic', sharpness: .5, outlines: true, textureDepth: true });
    saveSettings({ ...defaults(), dof: 'soft', exposure: .8 });
    expect(readSettings()).toMatchObject({ dof: 'soft', exposure: .8 });
    saveSettings({ ...defaults(), dof: 'off', sharpness: .3 });
    vi.stubGlobal('location', { search: '?dof=cinematic&sharpness=.8' });
    expect(readSettings()).toMatchObject({ dof: 'cinematic', sharpness: .8 });
    expect(parseJson(storage.get(settingsKey)!)).toMatchObject({ dof: 'off', sharpness: .3 });
    vi.stubGlobal('location', { search: '' });
    saveSettings(defaults());
    expect(parseSettings(parseJson('{"dof":0.6}')).dof).toBe('cinematic');
    expect(parseSettings({}, new URLSearchParams('dof=0.6')).dof).toBe('cinematic');
    expect(parseSettings({}, new URLSearchParams('dof=unknown')).dof).toBe('cinematic');
    saveSettings({ ...defaults(), atmosphericParticles: false, outlines: true, textureDepth: false });
    vi.stubGlobal('location', { search: '?atmosphericParticles=on&outlines=false&textureDepth=true' });
    expect(readSettings()).toMatchObject({ atmosphericParticles: true, outlines: false, textureDepth: true });
    expect(parseJson(storage.get(settingsKey)!)).toMatchObject({ atmosphericParticles: false, outlines: true, textureDepth: false });
    vi.stubGlobal('location', { search: '' });
    expect(readSettings()).toMatchObject({ atmosphericParticles: false, outlines: true, textureDepth: false });
    expect(parseSettings(parseJson('{"outlines":"true"}'), new URLSearchParams('outlines=unknown')).outlines).toBe(true);
    storage.set(settingsKey, JSON.stringify({ defaultsVersion: 2, volumetricLighting: false, atmosphericParticles: false, dof: 'off', sharpness: .3, outlines: false }));
    vi.stubGlobal('location', { search: '?dof=cinematic&sharpness=.8&outlines=on&atmosphericParticles=on' });
    expect(readSettings()).toMatchObject({ dof: 'cinematic', sharpness: .8, outlines: true, atmosphericParticles: true });
    const upgraded = parseJson(storage.get(settingsKey)!);
    expect(upgraded).not.toHaveProperty('volumetricLighting');
    expect(upgraded).toMatchObject({ defaultsVersion, dof: 'off', sharpness: .3, outlines: false, atmosphericParticles: false, textureDepth: true });
    saveSettings({ ...readSettings(), exposure: 1.1 }, 'exposure');
    const edited = parseJson(storage.get(settingsKey)!);
    expect(edited).toMatchObject({ exposure: 1.1, dof: 'off', sharpness: .3, outlines: false, atmosphericParticles: false });
    saveSettings({ ...readSettings(), atmosphericParticles: false }, 'atmosphericParticles');
    expect((parseJson(storage.get(settingsKey)!) as Record<string, unknown>).atmosphericParticles).toBe(false);
  } finally { vi.unstubAllGlobals(); }
});

// Admission: introducing weather must not silently re-enable previously disabled precipitation or overwrite unrelated settings.
test('new presentation preferences preserve old precipitation choices and independent saved switches',()=>{
  expect(migrateSettings({atmosphericParticles:false,dof:'off',exposure:.8})).toMatchObject({weatherEffects:false,cameraShake:true,resourceNumbers:true,dof:'off',exposure:.8});
  expect(migrateSettings({atmosphericParticles:false,weatherEffects:true,cameraShake:false,resourceNumbers:false})).toMatchObject({atmosphericParticles:false,weatherEffects:true,cameraShake:false,resourceNumbers:false});
});
