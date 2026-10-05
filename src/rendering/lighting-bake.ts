import type { resolveWorldFlame } from '../levels/local-lighting';
import { lightingBakeVersion, type LightingPreparation } from '../levels/lighting-preparation';
import { materialRecipes } from './material-recipes';
import { isMesh, isTexture } from '../assets/resource-ownership';
import * as THREE from 'three';
import type { ProbeLighting, ResolvedAreaDefinition } from '../levels/types';
import type { LightProbeGrid } from 'three/addons/lighting/LightProbeGrid.js';
import type { RenderTarget, WebGPURenderer } from 'three/webgpu';

/** Increment when static shading or the pinned probe adapter changes. */
export { lightingBakeVersion } from '../levels/lighting-preparation';
export type ProbeComponent = { dimensions: [number, number, number]; data: number[] };
export type PreparedProbeBake = { version: number; three: string; signature: string; probes: ProbeLighting; flameEmitterCount: number; daylight: ProbeComponent; flame?: ProbeComponent; preparation?: LightingPreparation };
export type ProbeCoefficients = { dimensions: [number, number, number]; flameEmitterCount: number; daylight: Uint16Array; flame?: Uint16Array };


/** Render inputs only: gameplay names, arrivals, enemies and rewards do not invalidate GI. */
export async function lightingBakeSignature(area: ResolvedAreaDefinition, root: THREE.Group): Promise<string> {
  root.updateMatrixWorld(true);
  const meshes: string[] = [];
  const visible = (object: THREE.Object3D) => { for (let parent: THREE.Object3D | null = object; parent; parent = parent.parent) if (!parent.visible || parent.userData.transient || parent instanceof THREE.Light) return false; return true; };
  const digest = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))].map(b => b.toString(16).padStart(2, '0')).join('');
  // Instances share geometry buffers. Hash each view once per fingerprint, never
  // across calls: authoring edits and refreshed art must still invalidate bakes.
  const buffers = new WeakMap<ArrayBufferView, Promise<string>>();
  const buffer = (array: ArrayBufferView): Promise<string> => {
    let pending = buffers.get(array);
    if (!pending) {
      pending = digest(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
      buffers.set(array, pending);
    }
    return pending;
  };
  const indices = new WeakMap<THREE.BufferAttribute, Promise<string>>();
  const indexBuffer = (index: THREE.BufferAttribute): Promise<string> => {
    let pending = indices.get(index);
    if (!pending) {
      // Native rendering promotes indices to 32 bits; preserve the bake format.
      pending = buffer(new Uint32Array(index.array));
      indices.set(index, pending);
    }
    return pending;
  };
  const textures = new Map<THREE.Texture, Promise<unknown>>();
  const describeTexture = (texture: THREE.Texture): Promise<unknown> => {
    let pending = textures.get(texture);
    if (!pending) {
      pending = (async () => {
        const image = texture.image as { width?: number; height?: number; data?: ArrayBufferView; src?: string } | undefined;
        return { width: image?.width, height: image?.height, data: image?.data ? await buffer(image.data) : undefined,
          anisotropy: texture.anisotropy, minFilter: texture.minFilter, magFilter: texture.magFilter, channel: texture.channel, colorSpace: texture.colorSpace, flipY: texture.flipY, wrapS: texture.wrapS, wrapT: texture.wrapT,
          offset: texture.offset.toArray(), repeat: texture.repeat.toArray(), rotation: texture.rotation };
      })(); textures.set(texture, pending);
    }
    return pending;
  };
  const objects: THREE.Mesh[] = [];
  root.traverse(object => { if (isMesh(object) && !(object instanceof THREE.SkinnedMesh) && visible(object)) objects.push(object); });
  for (const mesh of objects) {
    const attributes: Record<string, string> = {};
    for (const [name, attribute] of Object.entries(mesh.geometry.attributes)) {
      const array = attribute instanceof THREE.InterleavedBufferAttribute ? attribute.data.array : attribute.array;
      attributes[name] = await buffer(array);
    }
    const materials = [];
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const properties: Record<string, unknown> = {};
      for (const key of ['color', 'emissive', 'emissiveIntensity', 'roughness', 'metalness', 'specularIntensity', 'specularColor', 'opacity', 'transparent', 'alphaTest', 'side', 'vertexColors', 'normalScale', 'aoMapIntensity']) {
        const value = Reflect.get(material, key) as { toArray?: () => unknown } | undefined; properties[key] = value?.toArray ? value.toArray() : value;
      }
      for (const [name, value] of Object.entries(material)) if (isTexture(value)) properties[name] = await describeTexture(value);
      materials.push(properties);
    }
    const instances = mesh instanceof THREE.InstancedMesh ? Array.from({ length: mesh.count }, (_, i) => ({ transform: Array.from(mesh.instanceMatrix.array.slice(i * 16, i * 16 + 16)), color: mesh.instanceColor ? Array.from(mesh.instanceColor.array.slice(i * 3, i * 3 + 3)) : undefined })).map(item => JSON.stringify(item)).sort() : undefined;
    // Browser math can differ below GPU precision; hash the world matrix
    // actually uploaded to WebGPU so prepared bakes work across engines.
    const transform = mesh.matrixWorld.toArray().map(Math.fround);
    meshes.push(JSON.stringify({ attributes, index: mesh.geometry.index ? await indexBuffer(mesh.geometry.index) : undefined,
      ...(mesh.userData.lightingOnly ? { lightingOnly: true } : {}), groups: mesh.geometry.groups, transform, materials,
      instances, castShadow: mesh.castShadow, receiveShadow: mesh.receiveShadow }));
  }
  // GLB bytes cover embedded image contents; URLs are recorded by the asset owner
  // after projected/original/fallback selection, so the signature describes the actual art.
  // Bound transient source buffers: prepared GLBs now include larger normal atlases.
  const sources: string[] = [];
  const urls = (root.userData.lightingSources as string[] | undefined ?? []).slice().sort();
  // Two fresh source reads overlap I/O without retaining the whole area's
  // GLB/normal-atlas bytes at once. Preserve complete, uncached byte hashes.
  for (let start = 0; start < urls.length; start += 2) {
    sources.push(...await Promise.all(urls.slice(start, start + 2).map(async url => {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Cannot fingerprint lighting source: ${url}`);
      return digest(new Uint8Array(await response.arrayBuffer()));
    })));
  }
  const look = area.lighting;
  const payload = { version: lightingBakeVersion, three: THREE.REVISION, materialRecipes,
    sun: look.sun, environment: look.environment, probes: look.probes, emitters: staticFlameEmitters(root), meshes: meshes.sort(), sources: sources.sort(),
    procedural: ((root.userData.lightingProcedural as unknown[] | undefined) ?? []).map((value: unknown) => JSON.stringify(value)).sort(), surfaces: (root.userData.surfaceMode as string | undefined) ?? 'authored' };
  return digest(new TextEncoder().encode(JSON.stringify(payload)));
}

export async function exportProbeComponent(renderer: WebGPURenderer, grid: LightProbeGrid, probes: ProbeLighting): Promise<ProbeComponent> {
  // r186 exposes the texture but not its render target. Keep this pinned adapter
  // here, and fail clearly if a dependency update changes the native atlas layout.
  const target = Reflect.get(grid, '_renderTarget') as RenderTarget | null;
  if (!target || !grid.texture) throw new Error('Native probe export adapter needs updating.');
  const [width, height, count] = probes.resolution;
  const depth = 7 * (count + 2), data: number[] = [];
  const rowStride = Math.ceil(width * 8 / 256) * 128;
  for (let z = 0; z < depth; z++) {
    const slice = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height, 0, z);
    if (!(slice instanceof Uint16Array)) throw new Error('Expected a half-float irradiance atlas.');
    for (let y = 0; y < height; y++) data.push(...slice.subarray(y * rowStride, y * rowStride + width * 4));
  }
  return { dimensions: [width, height, depth], data };
}

/** Actual built emitters, never transient personal lights. */
export function staticFlameEmitters(root: THREE.Object3D) {
  const emitters: ReturnType<typeof resolveWorldFlame>[] = [];
  root.traverse(object => {
    if (!(object instanceof THREE.PointLight) || !object.userData.staticFlame) return;
    const spec = object.userData.staticFlame as ReturnType<typeof resolveWorldFlame>;
    const position = object.getWorldPosition(new THREE.Vector3()).toArray();
    emitters.push({ ...spec, position });
  });
  return emitters.sort((a, b) => a.id.localeCompare(b.id));
}
export function decodeProbeBake(value: PreparedProbeBake, signature: string, probes: ProbeLighting): ProbeCoefficients {
  const dimensions: [number, number, number] = [probes.resolution[0], probes.resolution[1], 7 * (probes.resolution[2] + 2)];
  if (!Number.isInteger(value.flameEmitterCount) || value.flameEmitterCount < 0 || Boolean(value.flame) !== (value.flameEmitterCount > 0) || value.version !== lightingBakeVersion || value.three !== THREE.REVISION || value.signature !== signature || (['position', 'size', 'resolution'] as const).some(key => JSON.stringify(value.probes?.[key]) !== JSON.stringify(probes[key])) || value.probes?.intensity !== probes.intensity || value.probes?.bounces !== probes.bounces) throw new Error('Prepared irradiance bake is stale or invalid.');
  const decode = (component: ProbeComponent | undefined) => {
    if (!component || JSON.stringify(component.dimensions) !== JSON.stringify(dimensions)
      || !Array.isArray(component.data) || component.data.length !== dimensions.reduce((a,b) => a*b, 4)
      || component.data.some(n => !Number.isInteger(n) || n < 0 || n > 65535 || !Number.isFinite(THREE.DataUtils.fromHalfFloat(n)))) throw new Error('Prepared irradiance component is invalid.');
    return new Uint16Array(component.data);
  };
  return { dimensions, flameEmitterCount: value.flameEmitterCount, daylight: decode(value.daylight), flame: value.flame ? decode(value.flame) : undefined };
}
/** Mix signed coefficients, never evaluated/clamped radiance. Inputs stay immutable. */
export function mixProbeCoefficients(source: ProbeCoefficients, gain: number, output: Uint16Array): void {
  if (!Number.isFinite(gain) || gain < 0 || output.length !== source.daylight.length || (source.flame && source.flame.length !== output.length)) throw new Error('Invalid irradiance mix.');
  if (!source.flame) { output.set(source.daylight); return; }
  for (let i = 0; i < output.length; i++) {
    const value = THREE.DataUtils.fromHalfFloat(source.daylight[i]) + gain * THREE.DataUtils.fromHalfFloat(source.flame[i]);
    if (!Number.isFinite(value) || Math.abs(value) > 65504) throw new Error('Irradiance mix exceeds half-float range.');
    output[i] = THREE.DataUtils.toHalfFloat(value);
  }
}
export function combinedProbeTexture(source: ProbeCoefficients, gain: number): THREE.Data3DTexture {
  const pixels = new Uint16Array(source.daylight.length); mixProbeCoefficients(source, gain, pixels);
  const texture = new THREE.Data3DTexture(pixels, ...source.dimensions);
  texture.type = THREE.HalfFloatType; texture.format = THREE.RGBAFormat; texture.minFilter = texture.magFilter = THREE.LinearFilter; texture.generateMipmaps = false; texture.needsUpdate = true;
  return texture;
}
