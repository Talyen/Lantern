import { expect, test, vi } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
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
