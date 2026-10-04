import { expect, test, vi } from 'vitest';
import { AnimationClip } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadEquipmentMotions, motionStates } from '../src/animation/combat-animations';

// Admission: a nonnumeric contact can pass comparison checks, then corrupt attack clocks.
// The loader boundary exercises real preparation; gameplay tests use already-valid numeric timings.
test('malformed contact metadata cannot publish combat motions and reports how to repair the source', async () => {
  const clips = motionStates.map(role => ({ id: role, category: role, name: role, url: `/fixture/${role}`, duration: 1,
    ...(role === 'attack' ? { contact: '0.3' } : {}) }));
  const catalog = { version: 1, packs: [{ id: 'mixamo', clips }], profiles: { axe: Object.fromEntries(motionStates.map(role => [role, role])) } };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(catalog))));
  const loader = new GLTFLoader();
  const model = await loader.parseAsync(JSON.stringify({ asset: { version: '2.0' }, scenes: [{}], scene: 0 }), '');
  model.animations = [new AnimationClip('fixture', 1, [])];
  const loading = vi.spyOn(loader, 'loadAsync').mockResolvedValue(model);
  try {
    await expect(loadEquipmentMotions(loader, 'enemy', { main: 'axe', off: null }))
      .rejects.toThrow('Unavailable reviewed contacts for attack. Prepare compatible Mixamo motions with npm run assets:export-character.');
  } finally { loading.mockRestore(); vi.unstubAllGlobals(); }
});

// Protect startup retry and independent actor playback after sharing an asset request.
// The catalog validation test above starts with a successful GLTF load.
test('failed motion loads retry and shared clips retain independent playback state', async () => {
  const { loadMotionClip } = await import('../src/animation/combat-animations');
  const loader = new GLTFLoader();
  const model = await loader.parseAsync(JSON.stringify({ asset: { version: '2.0' }, scenes: [{}], scene: 0 }), '');
  model.animations = [new AnimationClip('source', 1, [])];
  const load = vi.spyOn(loader, 'loadAsync').mockRejectedValueOnce(new Error('temporary')).mockResolvedValue(model);
  const clip = { id: 'retry', name: 'Retry', category: 'idle', url: '/fixture/retry.glb', duration: 1 };
  try {
    await expect(loadMotionClip(loader, clip)).rejects.toThrow('temporary');
    const [first, second] = await Promise.all([loadMotionClip(loader, clip), loadMotionClip(loader, clip)]);
    first.name = 'player'; first.duration = 2;
    expect(second.name).toBe('source'); expect(second.duration).toBe(1);
    expect(load).toHaveBeenCalledTimes(2);
  } finally { load.mockRestore(); }
});
