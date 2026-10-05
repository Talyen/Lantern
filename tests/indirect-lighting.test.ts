import { MeshPhysicalNodeMaterial, type WebGPURenderer } from 'three/webgpu';
import { installIndirectLighting } from '../src/rendering/indirect-lighting';
import { expect, test } from 'vitest';
import * as THREE from 'three';
import { combinedProbeTexture, decodeProbeBake, mixProbeCoefficients, staticFlameEmitters, lightingBakeVersion, type PreparedProbeBake } from '../src/rendering/lighting-bake';
import { resolveWorldFlame, worldFirelightGain } from '../src/levels/local-lighting';
import { lightingPreparationKey } from '../src/levels/lighting-preparation';
import { resolveAreaLighting } from '../src/levels/lighting';
import homestead from '../src/levels/areas/homestead.json';
import type { AreaDefinition } from '../src/levels/types';
const probes = { position: [0, 1, 0] as [number, number, number], size: [4, 2, 4] as [number, number, number], resolution: [2, 2, 2] as [number, number, number], intensity: 1, bounces: 1 };
function fixture(): PreparedProbeBake {
  const dimensions: [number, number, number] = [2, 2, 28];
  return { version: lightingBakeVersion, three: THREE.REVISION, signature: 'fixture', probes, flameEmitterCount: 1,
    daylight: { dimensions, data: Array<number>(448).fill(0) }, flame: { dimensions, data: Array<number>(448).fill(0) } };
}
// Admission: signed SH mixing, incomplete paired preparation and owner mutation
// can silently break every area's lighting; ordinary static checks cannot prove them.
test('flame gain mixes signed SH while leaving daylight and other owners immutable', () => {
  const bake = fixture(); bake.daylight.data[0] = THREE.DataUtils.toHalfFloat(-2); bake.flame!.data[0] = THREE.DataUtils.toHalfFloat(1);
  const source = decodeProbeBake(bake, 'fixture', probes), first = combinedProbeTexture(source, 1), second = combinedProbeTexture(source, 2);
  const pixels = first.image.data as Uint16Array, other = second.image.data as Uint16Array;
  expect(THREE.DataUtils.fromHalfFloat(pixels[0])).toBe(-1);
  expect(THREE.DataUtils.fromHalfFloat(other[0])).toBe(0);
  mixProbeCoefficients(source, 3, pixels);
  expect(THREE.DataUtils.fromHalfFloat(pixels[0])).toBe(1);
  expect(THREE.DataUtils.fromHalfFloat(other[0])).toBe(0);
  expect(THREE.DataUtils.fromHalfFloat(source.daylight[0])).toBe(-2);
  expect(worldFirelightGain(0)).toBe(.65); expect(worldFirelightGain(1)).toBe(1.15);
  first.dispose(); second.dispose();
});
test('paired preparation rejects missing flame, corrupt coefficients and stale capture versions', () => {
  for (const alter of [
    (b: PreparedProbeBake) => { delete b.flame; },
    (b: PreparedProbeBake) => { b.daylight.data[0] = 0x7e00; },
    (b: PreparedProbeBake) => { b.flame!.dimensions[2] = 27; },
    (b: PreparedProbeBake) => { b.version--; },
  ]) { const bake = fixture(); alter(bake); expect(() => decodeProbeBake(bake, 'fixture', probes)).toThrow(); }
});
test('bake emitters come from built fixed lights, excluding the moving personal lantern', () => {
  const root = new THREE.Group(), fixed = new THREE.PointLight(), personal = new THREE.PointLight();
  const definition = { id: 'torch', position: [1, 2], role: 'torch' as const };
  fixed.userData.staticFlame = resolveWorldFlame(definition); fixed.position.set(1, 1.6, 2);
  personal.userData.transient = true; root.add(fixed, personal);
  expect(staticFlameEmitters(root)).toHaveLength(1);
  expect(staticFlameEmitters(root)[0]).toMatchObject({ id: 'torch', intensity: 12, distance: 8, position: [1, 1.6, 2] });
});
test('resolved emitter shading invalidates preparation while Firelight remains a runtime choice', async () => {
  const source = structuredClone(homestead) as unknown as AreaDefinition;
  const key = () => lightingPreparationKey({ ...source, lighting: resolveAreaLighting(source) }, 'projected', false, THREE.REVISION, {});
  const initial = await key(); source.effects.fires[0].intensity = 10;
  expect(await key()).not.toBe(initial);
});

test('prepared probe validation accepts serializer-reordered metadata fields', () => {
  const bake = fixture(); bake.probes = { bounces: probes.bounces, intensity: probes.intensity, position: probes.position, resolution: probes.resolution, size: probes.size };
  expect(() => decodeProbeBake(bake, 'fixture', probes)).not.toThrow();
});

test('native material adaptation does not add method strings to render-object cache keys', () => {
  const material = new MeshPhysicalNodeMaterial({ clearcoat: 1 });
  const library = { fromMaterial: () => material, lightNodes: new WeakMap() };
  installIndirectLighting({ library } as unknown as WebGPURenderer);
  library.fromMaterial();
  expect(Object.prototype.propertyIsEnumerable.call(material, 'setupLightingModel')).toBe(false);
  expect(material.setupLightingModel()).toHaveProperty('clearcoat', true);
  material.dispose();
});
