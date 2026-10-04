import { expect, test } from 'vitest';
import * as THREE from 'three';
import { LightingCache } from '../src/rendering/lighting-cache';
import { lightingBakeSignature } from '../src/rendering/lighting-bake';
import { resolveAreaLighting } from '../src/levels/lighting';
import type { AreaDefinition, ResolvedAreaDefinition } from '../src/levels/types';
import homestead from '../src/levels/areas/homestead.json';
import clearing from '../src/levels/areas/clearing.json';

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

test('cutaway ceilings remain hidden to gameplay and opaque in sun shadows and probe captures', async () => {
  const {lightingOnly,restoreBakeVisibility,includeCutawayShadows}=await import('../src/rendering/cutaway');
  const roof=new THREE.Mesh(new THREE.BoxGeometry(10,.3,10),new THREE.MeshStandardMaterial());
  roof.castShadow=true;lightingOnly(roof);
  const camera=new THREE.PerspectiveCamera(),sun=new THREE.DirectionalLight();includeCutawayShadows(sun);
  expect(camera.layers.test(roof.layers)).toBe(false);expect(sun.shadow.camera.layers.test(roof.layers)).toBe(true);
  const capture=roof.clone();restoreBakeVisibility(capture);
  expect(camera.layers.test(capture.layers)).toBe(true);expect(camera.layers.test(roof.layers)).toBe(false);
  const area={...clearing,lighting:resolveAreaLighting(clearing as unknown as AreaDefinition)} as unknown as ResolvedAreaDefinition;
  const root=new THREE.Group();root.add(roof);
  const initial=await lightingBakeSignature(area,root);roof.userData.lightingOnly=false;
  expect(await lightingBakeSignature(area,root)).not.toBe(initial);
  roof.geometry.dispose();roof.material.dispose();sun.dispose();
});

// Observed Safari/Chromium rotation rounding must not force a live world bake
// when the native model matrix is identical; real GPU-visible edits still do.
test('prepared lighting fingerprints share identical GPU transforms across browser engines', async () => {
  const source = homestead as unknown as AreaDefinition;
  const area: ResolvedAreaDefinition = { ...source, lighting: resolveAreaLighting(source) };
  const root = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  root.add(mesh); mesh.matrixAutoUpdate = false;
  mesh.matrix.elements[1] = .0599640064794446;
  const safari = await lightingBakeSignature(area, root);
  mesh.matrix.elements[1] = .059964006479444616;
  expect(await lightingBakeSignature(area, root)).toBe(safari);
  mesh.matrix.elements[1] = .06;
  expect(await lightingBakeSignature(area, root)).not.toBe(safari);
  mesh.geometry.dispose(); mesh.material.dispose();
});
