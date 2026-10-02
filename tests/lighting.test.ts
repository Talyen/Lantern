import { expect, test } from 'vitest';
import * as THREE from 'three';
import { LightingCache } from '../src/rendering/lighting-cache';
import { lightingBakeSignature } from '../src/rendering/lighting-bake';
import { resolveAreaLighting, resolveLighting } from '../src/levels/lighting';
import { validateAreas } from '../src/levels/validation';
import { resolveLocalLight } from '../src/levels/local-lighting';
import type { AreaDefinition, ResolvedAreaDefinition } from '../src/levels/types';
import homestead from '../src/levels/areas/homestead.json';
import clearing from '../src/levels/areas/clearing.json';

test('shared lighting covers the area and applies overrides without mutating its recipes', () => {
  const area = homestead as unknown as AreaDefinition;
  const shared = resolveLighting(), golden = resolveAreaLighting(area), baseline = structuredClone(golden);
  const boundary = area.layout.boundary;
  const points = boundary.kind === 'polygon' ? boundary.points : [
    [boundary.center[0] - boundary.radius, boundary.center[1] - boundary.radius],
    [boundary.center[0] + boundary.radius, boundary.center[1] + boundary.radius],
  ];
  const probes = golden.probes!;
  expect(points.every(([x, z]) => Math.abs(x - probes.position[0]) <= probes.size[0] / 2 && Math.abs(z - probes.position[2]) <= probes.size[2] / 2)).toBe(true);
  const overridden = resolveAreaLighting({ ...area, lighting: { overrides: { fogFar: 80, probes: false } } });
  expect(overridden.fogFar).toBe(80); expect(overridden.probes).toBeUndefined();
  expect(resolveLighting().sun.color).toBe(golden.sun.color);
  expect(resolveAreaLighting(clearing as unknown as AreaDefinition).sun.color).toBe(golden.sun.color);
  const invalid = structuredClone(area); invalid.lighting = { overrides: { fogNear: -1 } };
  expect(validateAreas({ homestead: invalid }).some(error => error.includes('invalid lighting'))).toBe(true);
  expect(validateAreas({ homestead: { ...area, lighting: golden } as unknown as AreaDefinition }).some(error => error.includes('shared Golden preset'))).toBe(true);
  expect(golden).toEqual(baseline);
  expect(resolveAreaLighting(area)).toEqual(baseline);
  expect(resolveLighting()).toEqual(shared);
  const flame = structuredClone(resolveLocalLight({ role: 'campfire' }));
  expect(resolveLocalLight({ role: 'campfire', intensity: 11, shadow: false })).toMatchObject({ intensity: 11, shadow: false });
  expect(resolveLocalLight({ role: 'campfire' })).toEqual(flame);
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
test('probe fingerprints ignore gameplay changes and grading but invalidate changed static shading', async () => {
  const source = homestead as unknown as AreaDefinition;
  const area: ResolvedAreaDefinition = { ...source, lighting: resolveAreaLighting(source) };
  const root = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); root.add(mesh);
  const initial = await lightingBakeSignature(area, root);
  // Native rendering promotes 16-bit indices to 32-bit storage without changing topology.
  mesh.geometry.setIndex(new THREE.Uint32BufferAttribute(mesh.geometry.index!.array, 1));
  expect(await lightingBakeSignature(area, root)).toBe(initial);
  const changed = structuredClone(area); changed.name = 'Another name'; changed.layout.player.position = [2, 3];
  changed.lighting.fogFar += 10; changed.lighting.grade!.strength = .5;
  expect(await lightingBakeSignature(changed, root)).toBe(initial);
  mesh.material.color.set('#995533'); expect(await lightingBakeSignature(area, root)).not.toBe(initial);
  mesh.geometry.dispose(); mesh.material.dispose();
});
