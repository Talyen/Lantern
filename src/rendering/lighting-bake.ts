import { materialRecipes } from './material-recipes';
import { isMesh, isTexture } from '../assets/resource-ownership';
import * as THREE from 'three';
import type { ProbeLighting, ResolvedAreaDefinition } from '../levels/types';
import type { LightProbeGrid } from 'three/addons/lighting/LightProbeGrid.js';
import type { RenderTarget, WebGPURenderer } from 'three/webgpu';

/** Increment when static shading or the pinned probe adapter changes. */
export const lightingBakeVersion = 7;
export type PreparedProbeBake = { version: number; three: string; signature: string; probes: ProbeLighting; dimensions: [number, number, number]; data: number[] };

/** Render inputs only: gameplay names, arrivals, enemies and rewards do not invalidate GI. */
export async function lightingBakeSignature(area: ResolvedAreaDefinition, root: THREE.Group): Promise<string> {
  root.updateMatrixWorld(true);
  const meshes: string[] = [];
  const visible = (object: THREE.Object3D) => { for (let parent: THREE.Object3D | null = object; parent; parent = parent.parent) if (!parent.visible || parent.userData.transient || parent instanceof THREE.Light) return false; return true; };
  const digest = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))].map(b => b.toString(16).padStart(2, '0')).join('');
  const buffer = async (array: ArrayBufferView) => digest(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
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
    meshes.push(JSON.stringify({ attributes, index: mesh.geometry.index ? await buffer(new Uint32Array(mesh.geometry.index.array)) : undefined,
      ...(mesh.userData.lightingOnly ? { lightingOnly: true } : {}), groups: mesh.geometry.groups, transform: mesh.matrixWorld.toArray(), materials,
      instances, castShadow: mesh.castShadow, receiveShadow: mesh.receiveShadow }));
  }
  // GLB bytes cover embedded image contents; URLs are recorded by the asset owner
  // after projected/original/fallback selection, so the signature describes the actual art.
  // Bound transient source buffers: prepared GLBs now include larger normal atlases.
  const sources: string[] = [];
  for (const url of (root.userData.lightingSources as string[] | undefined ?? []).slice().sort()) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Cannot fingerprint lighting source: ${url}`);
    sources.push(await digest(new Uint8Array(await response.arrayBuffer())));
  }
  const look = area.lighting;
  const payload = { version: lightingBakeVersion, three: THREE.REVISION, materialRecipes,
    sun: look.sun, environment: look.environment, probes: look.probes, meshes: meshes.sort(), sources: sources.sort(),
    procedural: ((root.userData.lightingProcedural as unknown[] | undefined) ?? []).map((value: unknown) => JSON.stringify(value)).sort(), surfaces: (root.userData.surfaceMode as string | undefined) ?? 'authored' };
  return digest(new TextEncoder().encode(JSON.stringify(payload)));
}

export async function exportProbeBake(renderer: WebGPURenderer, grid: LightProbeGrid, probes: ProbeLighting, signature: string): Promise<PreparedProbeBake> {
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
  return { version: lightingBakeVersion, three: THREE.REVISION, signature, probes, dimensions: [width, height, depth], data };
}

export function decodeProbeBake(value: PreparedProbeBake, signature: string, probes: ProbeLighting): THREE.Data3DTexture {
  const dimensions = [probes.resolution[0], probes.resolution[1], 7 * (probes.resolution[2] + 2)];
  if (value.version !== lightingBakeVersion || value.three !== THREE.REVISION || value.signature !== signature || (['position', 'size', 'resolution'] as const).some(key => JSON.stringify(value.probes[key]) !== JSON.stringify(probes[key])) || value.probes.intensity !== probes.intensity || value.probes.bounces !== probes.bounces || JSON.stringify(value.dimensions) !== JSON.stringify(dimensions)
    || value.data.length !== dimensions.reduce((a,b) => a*b, 4) || value.data.some(n => !Number.isInteger(n) || n < 0 || n > 65535)) throw new Error('Prepared irradiance bake is stale or invalid.');
  const texture = new THREE.Data3DTexture(new Uint16Array(value.data), ...value.dimensions);
  texture.type = THREE.HalfFloatType; texture.format = THREE.RGBAFormat; texture.minFilter = texture.magFilter = THREE.LinearFilter; texture.generateMipmaps = false; texture.needsUpdate = true;
  return texture;
}
