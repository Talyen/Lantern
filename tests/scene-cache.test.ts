import { expect, test, vi } from 'vitest';
import { BoxGeometry, BufferAttribute, BufferGeometry, InterleavedBuffer, InterleavedBufferAttribute, Group, Mesh, MeshBasicMaterial } from 'three';
import { SceneCache } from '../src/assets/scene-cache';

// Protect native shared art during overlapping shutdowns and in-flight area preparation.
// Library cleanup tests do not exercise the separately owned scenery cache.
test('concurrent scene shutdowns wait for loading and release shared art exactly once', async () => {
  const cache = new SceneCache();
  const geometry = new BoxGeometry(), material = new MeshBasicMaterial();
  const root = new Group().add(new Mesh(geometry, material));
  const releases = [geometry, material].map(resource => vi.spyOn(resource, 'dispose'));
  let finish!: (root: Group) => void;
  const load = vi.fn(() => new Promise<Group>(resolve => { finish = resolve; }));
  const first = cache.acquire('scene', load), second = cache.acquire('scene', load);
  await Promise.resolve();
  const closing = Promise.all([cache.dispose(), cache.dispose()]);
  expect(() => cache.acquire('other', load)).toThrow('closed');
  expect(releases.every(release => release.mock.calls.length === 0)).toBe(true);
  finish(root);
  expect(await first.scene).toBe(await second.scene);
  await closing;
  first.release(); first.release(); second.release(); await cache.dispose();
  expect(load).toHaveBeenCalledOnce();
  for (const release of releases) expect(release).toHaveBeenCalledOnce();
});

// Cache eviction must measure shared vertex storage once and include morph storage.
test('scene budgets count shared interleaved storage once, including morph targets', async () => {
  const { sceneResourceBytes } = await import('../src/assets/resource-ownership');
  const data = new InterleavedBuffer(new Float32Array(18), 6), geometry = new BufferGeometry();
  geometry.setAttribute('position', new InterleavedBufferAttribute(data, 3, 0));
  geometry.setAttribute('normal', new InterleavedBufferAttribute(data, 3, 3));
  geometry.morphAttributes.position = [new BufferAttribute(new Float32Array(9), 3)];
  const material = new MeshBasicMaterial(), root = new Group().add(new Mesh(geometry, material), new Mesh(geometry, material));
  try { expect(sceneResourceBytes(root)).toBe((18 + 9) * 4); }
  finally { geometry.dispose(); material.dispose(); }
});
