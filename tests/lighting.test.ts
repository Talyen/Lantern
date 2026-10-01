import { expect, test } from 'vitest';
import * as THREE from 'three';
import { LightingCache } from '../src/rendering/lighting-cache';
import { lightingBakeSignature } from '../src/rendering/lighting-bake';
import { resolveAreaLighting, resolveLighting, entryLightingModesFor, defaultLightingModeFor } from '../src/levels/lighting';
import { validateAreas } from '../src/levels/validation';
import { resolveLocalLight } from '../src/levels/local-lighting';
import type { AreaDefinition, ResolvedAreaDefinition } from '../src/levels/types';
import homestead from '../src/levels/areas/homestead.json';

test('area profiles provide complete lighting, scoped moods, automatic coverage and local light recipes', () => {
  const area = homestead as unknown as AreaDefinition;
  const golden = resolveAreaLighting(area, 'golden'), silver = resolveAreaLighting(area, 'silver');
  expect(golden.sun.intensity).toBeGreaterThan(silver.sun.intensity);
  expect(golden.probes!.size[0]).toBeGreaterThan(30);
  expect(golden.probes!.position[1] - golden.probes!.size[1] / 2).toBeCloseTo(.6);
  expect(resolveLighting({ profile: 'studio' }, 'silver')).toEqual(resolveLighting({ profile: 'studio' }, 'golden'));
  const overridden = resolveAreaLighting({ ...area, lighting: { profile: 'woodland-dusk', overrides: { fogFar: 80, fill: { intensity: .8 }, probes: false } } }, 'silver');
  expect(overridden.fogFar).toBe(80); expect(overridden.fill!.intensity).toBe(.8); expect(overridden.probes).toBeUndefined();
  expect(entryLightingModesFor({ profile: 'woodland-night' })).toEqual([]);
  expect(defaultLightingModeFor({ profile: 'woodland-night' })).toBe('moonlit');
  expect(resolveAreaLighting({ ...area, lighting: { profile: 'woodland-night' } }, 'dark').sun.intensity).toBeLessThan(silver.sun.intensity);
  expect(golden.fill).toBeUndefined();
  const invalid = structuredClone(area); invalid.lighting = { profile: 'woodland-dusk', overrides: { fogNear: -1 } };
  expect(validateAreas({ homestead: invalid }).some(error => error.includes('invalid lighting'))).toBe(true);
  expect(golden.fogFar).toBe(60); // Resolving an override never mutates the shared profile.
  expect(resolveLocalLight({ role: 'torch' }).intensity).toBeGreaterThan(resolveLocalLight({ role: 'lantern' }).intensity);
  expect(resolveLocalLight({ role: 'campfire', intensity: 11, shadow: false })).toMatchObject({ intensity: 11, shadow: false });
});
test('lighting resources remain globally bounded across dozens of areas and protect active/candidate leases', () => {
  const destroyed: number[] = [], cache = new LightingCache<number>(2, 24, item => destroyed.push(item));
  const active = cache.insert('active', 0, 12);
  for (let i = 1; i <= 40; i++) cache.insert('area-' + i, i, 12).release();
  expect(cache.stats()).toMatchObject({ entries: 2, bytes: 24, leased: 1 }); expect(destroyed).not.toContain(0);
  const candidate = cache.insert('candidate', 41, 12);
  expect(destroyed).not.toContain(41); candidate.release(); active.release();
  cache.dispose(); expect(destroyed).toContain(0); expect(destroyed).toContain(41);
});
test('probe fingerprints ignore gameplay changes and fill but invalidate changed static shading', async () => {
  const source = homestead as unknown as AreaDefinition;
  const area: ResolvedAreaDefinition = { ...source, lighting: resolveAreaLighting(source) };
  const root = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); root.add(mesh);
  const initial = await lightingBakeSignature(area, root);
  // Native rendering promotes 16-bit indices to 32-bit storage without changing topology.
  mesh.geometry.setIndex(new THREE.Uint32BufferAttribute(mesh.geometry.index!.array, 1));
  expect(await lightingBakeSignature(area, root)).toBe(initial);
  const changed = structuredClone(area); changed.name = 'Another name'; changed.layout.player.position = [2, 3]; changed.lighting.fill = { color: '#ffffff', intensity: 2 };
  changed.lighting.fogFar += 10; changed.lighting.grade!.strength = .5;
  expect(await lightingBakeSignature(changed, root)).toBe(initial);
  mesh.material.color.set('#995533'); expect(await lightingBakeSignature(area, root)).not.toBe(initial);
  mesh.geometry.dispose(); mesh.material.dispose();
});
