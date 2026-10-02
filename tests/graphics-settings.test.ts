import { expect, test, vi } from 'vitest';
import { Scene, DirectionalLight, PointLight, RenderTarget } from 'three/webgpu';
import { applyShadowQuality } from '../src/rendering/quality-presets';
import { defaults, defaultsVersion, depthOfFieldModes, migrateSettings, parseSettings, readSettings, saveSettings, settingsKey } from '../src/rendering/graphics-settings';

test('FSR-only settings retire method controls and preserve applicable preferences', () => {
  const saved = JSON.parse('{"aa":"traa","renderScale":1.1,"historyWeight":0.94,"volumetricLighting":false,"quality":"laptop","upscaleQuality":"quality","sharpness":0.1,"dof":"off","atmosphericParticles":false}');
  expect(migrateSettings(saved)).toMatchObject({ shadowQuality: 'low', particleQuality: 'low', upscaleQuality: 'quality', sharpness: .1, dof: 'off', atmosphericParticles: false });
  expect(migrateSettings({ quality: 'enhanced' })).toMatchObject({ shadowQuality: 'high', particleQuality: 'high' });
  expect(migrateSettings({ ...saved, shadowQuality: 'medium', particleQuality: 'high' })).toMatchObject({ shadowQuality: 'medium', particleQuality: 'high' });
  const parsed = parseSettings(saved, new URLSearchParams('aa=none&quality=enhanced&renderScale=1.25&volumetricLighting=true&shadowQuality=medium&particleQuality=low&upscaleQuality=native'));
  expect(parsed).toMatchObject({ shadowQuality: 'medium', particleQuality: 'low', upscaleQuality: 'native' });
  for (const key of ['aa', 'quality', 'renderScale', 'historyWeight', 'motionThreshold', 'depthThreshold', 'volumetricLighting']) expect(parsed).not.toHaveProperty(key);
  expect(parseSettings({}, new URLSearchParams('shadowQuality=unknown&particleQuality=unknown&sharpness=NaN'))).toMatchObject({ shadowQuality: 'high', particleQuality: 'high', sharpness: .5 });
});

test('quality presets update existing shadows without changing authored light properties', () => {
  const scene = new Scene(), sun = new DirectionalLight(), fire = new PointLight(), quiet = new PointLight();
  sun.castShadow = fire.castShadow = true; scene.add(sun, fire, quiet);
  sun.shadow.radius = 3; sun.shadow.bias = -.001;
  const target = new RenderTarget(2048, 2048), dispose = vi.spyOn(target, 'dispose'); sun.shadow.map = target;
  applyShadowQuality(scene, 'low');
  expect([sun.shadow.mapSize.x, fire.shadow.mapSize.x]).toEqual([1024, 256]);
  expect(dispose).toHaveBeenCalledOnce(); expect(sun.shadow.map?.width).toBe(1024); expect(quiet.castShadow).toBe(false);
  applyShadowQuality(scene, 'medium');
  expect([sun.shadow.mapSize.x, fire.shadow.mapSize.x]).toEqual([2048, 512]);
  applyShadowQuality(scene, 'high');
  expect([sun.shadow.mapSize.x, fire.shadow.mapSize.x, sun.shadow.radius, sun.shadow.bias]).toEqual([2048, 1024, 3, -.001]);
});

test('graphics modes preserve defaults, saved choices and temporary comparison URLs', () => {
  const storage = new Map<string, string>();
  vi.stubGlobal('location', { search: '' });
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  try {
    expect(readSettings()).toMatchObject({ dof: 'cinematic', sharpness: .5, outlines: true, textureDepth: true });
    for (const dof of depthOfFieldModes) {
      saveSettings({ ...defaults(), dof, exposure: .8 });
      expect([readSettings().dof, readSettings().exposure]).toEqual([dof, .8]);
      expect(parseSettings({ dof: 'off' }, new URLSearchParams({ dof })).dof).toBe(dof);
    }
    saveSettings({ ...defaults(), dof: 'off', sharpness: .3 });
    vi.stubGlobal('location', { search: '?dof=cinematic&sharpness=.8' });
    expect(readSettings()).toMatchObject({ dof: 'cinematic', sharpness: .8 });
    expect(JSON.parse(storage.get(settingsKey)!)).toMatchObject({ dof: 'off', sharpness: .3 });
    vi.stubGlobal('location', { search: '' });
    saveSettings(defaults());
    expect(parseSettings(JSON.parse('{"dof":0.6}')).dof).toBe('cinematic');
    expect(parseSettings({}, new URLSearchParams('dof=0.6')).dof).toBe('cinematic');
    expect(parseSettings({}, new URLSearchParams('dof=unknown')).dof).toBe('cinematic');
    for (const key of ['atmosphericParticles', 'outlines', 'textureDepth'] as const) for (const enabled of [true, false]) {
      saveSettings({ ...defaults(), [key]: enabled });
      for (const value of enabled ? ['off', 'false'] : ['on', 'true']) {
        vi.stubGlobal('location', { search: `?${key}=${value}` });
        expect(readSettings()[key]).toBe(!enabled);
        const saved = JSON.parse(storage.get(settingsKey)!);
        expect(saved[key]).toBe(enabled);
      }
      vi.stubGlobal('location', { search: '' });
      expect(readSettings()[key]).toBe(enabled);
    }
    expect(parseSettings(JSON.parse('{"outlines":"true"}'), new URLSearchParams('outlines=unknown')).outlines).toBe(true);
    storage.set(settingsKey, JSON.stringify({ defaultsVersion: 2, volumetricLighting: false, atmosphericParticles: false, dof: 'off', sharpness: .3, outlines: false }));
    vi.stubGlobal('location', { search: '?dof=cinematic&sharpness=.8&outlines=on&atmosphericParticles=on' });
    expect(readSettings()).toMatchObject({ dof: 'cinematic', sharpness: .8, outlines: true, atmosphericParticles: true });
    const upgraded = JSON.parse(storage.get(settingsKey)!);
    expect(upgraded).not.toHaveProperty('volumetricLighting');
    expect(upgraded).toMatchObject({ defaultsVersion, dof: 'off', sharpness: .3, outlines: false, atmosphericParticles: false, textureDepth: true });
    saveSettings({ ...readSettings(), exposure: 1.1 }, 'exposure');
    const edited = JSON.parse(storage.get(settingsKey)!);
    expect(edited).toMatchObject({ exposure: 1.1, dof: 'off', sharpness: .3, outlines: false, atmosphericParticles: false });
    saveSettings({ ...readSettings(), atmosphericParticles: false }, 'atmosphericParticles');
    expect(JSON.parse(storage.get(settingsKey)!).atmosphericParticles).toBe(false);
  } finally { vi.unstubAllGlobals(); }
});
