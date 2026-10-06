import { afterEach, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { RuntimeAssets, textureSharingKey } from '../src/assets/runtime-assets';
import { ArtCache } from '../src/assets/art-cache';
import { LoadQueue } from '../src/assets/load-queue';
import { disposeSceneResources, isMesh } from '../src/assets/resource-ownership';
import { createSurfaceMaterial, prepareSurfaceMaterial, SurfaceTemplates } from '../src/rendering/surface-detail';
import { snapshotNativeDescriptor, type NativePipelineDescriptor } from '../src/rendering/native-preparation';

// Admission: texture sharing must neither duplicate native storage nor close a
// surviving model's image; an ordinary scene-cache fixture does not cover this boundary.
function resources() {
  vi.stubGlobal('location', { href: 'http://fixture/' }); vi.stubGlobal('self', globalThis);
  vi.stubGlobal('ProgressEvent', class extends Event {
    constructor(type: string, properties: ProgressEventInit) { super(type); Object.assign(this, properties); }
  });
  const close = vi.fn(), bitmap = { width: 4, height: 4, close };
  const decode = vi.fn(async () => bitmap); vi.stubGlobal('createImageBitmap', decode);
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return new Response(url.startsWith('data:') ? Buffer.from(url.split(',')[1], 'base64') : new Uint8Array(24));
  }));
  const assets = new RuntimeAssets({ isWebGPURenderer: true, hasFeature: () => false } as unknown as WebGPURenderer);
  return { assets, close, decode };
}
function model(transform = false) {
  const positions = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer).toString('base64');
  return JSON.stringify({ asset: { version: '2.0' }, scenes: [{ nodes: [0] }], scene: 0, nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    buffers: [{ uri: `data:application/octet-stream;base64,${positions}`, byteLength: 36 }], bufferViews: [{ buffer: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
    images: [{ uri: '/palette.png' }], textures: [{ source: 0 }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0, ...(transform ? { extensions: { KHR_texture_transform: { offset: [.25, .5] } } } : {}) } } }],
    ...(transform ? { extensionsUsed: ['KHR_texture_transform'] } : {}),
  });
}
function map(root: THREE.Object3D): THREE.Texture {
  let texture: THREE.Texture | undefined;
  root.traverse(object => { if (isMesh(object) && !Array.isArray(object.material) && object.material instanceof THREE.MeshStandardMaterial) texture = object.material.map ?? undefined; });
  if (!texture) throw new Error('Fixture map missing'); return texture;
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

test('two GLTF owners share one decoded image and texture until the final owner releases', async () => {
  const { assets, close, decode } = resources();
  const first = await assets.loader.parseAsync(model(), 'http://fixture/');
  const second = await assets.loader.parseAsync(model(), 'http://fixture/');
  const texture = map(first.scene), disposed = vi.spyOn(texture, 'dispose');
  expect(map(second.scene)).toBe(texture); expect(decode).toHaveBeenCalledOnce();
  expect(assets.diagnostics().decodedSources.imageBytes).toBe(64);
  disposeSceneResources(first.scene); expect(close).not.toHaveBeenCalled(); expect(disposed).not.toHaveBeenCalled();
  disposeSceneResources(second.scene); expect(close).toHaveBeenCalledOnce(); expect(disposed).toHaveBeenCalledOnce();
  await assets.dispose(); expect(close).toHaveBeenCalledOnce();
  expect(assets.diagnostics().residentEstimatedBytes).toBe(0);
  expect(assets.diagnostics().decodedSources).toMatchObject({ imageBytes: 0, createdBytes: 64, releasedBytes: 64 });
});

test('different UV transforms keep distinct GPU textures while sharing decoded source storage', async () => {
  const { assets, close, decode } = resources();
  const first = await assets.loader.parseAsync(model(), 'http://fixture/');
  const second = await assets.loader.parseAsync(model(true), 'http://fixture/');
  expect(map(first.scene)).not.toBe(map(second.scene)); expect(decode).toHaveBeenCalledOnce();
  disposeSceneResources(first.scene); expect(close).not.toHaveBeenCalled();
  disposeSceneResources(second.scene); expect(close).toHaveBeenCalledOnce(); await assets.dispose();
});

test('color/data interpretation stays separate without decoding identical source pixels twice', async () => {
  const { assets, close, decode } = resources();
  const first = await assets.texture('/palette.png', true), second = await assets.texture('/palette.png', false);
  expect(first.texture).not.toBe(second.texture); expect(first.texture.colorSpace).toBe(THREE.SRGBColorSpace); expect(second.texture.colorSpace).toBe(THREE.NoColorSpace);
  expect(decode).toHaveBeenCalledOnce(); first.release(); first.release(); expect(close).not.toHaveBeenCalled(); second.release(); expect(close).toHaveBeenCalledOnce(); await assets.dispose();
});

test('GLTF decoder failure remains actionable instead of silently producing missing material maps', async () => {
  const { assets } = resources(); vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('image decode failed'); }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await expect(assets.loader.parseAsync(model(), 'http://fixture/')).rejects.toThrow('image decode failed');
  await assets.dispose(); expect(assets.diagnostics().textures.entries).toBe(0);
});

test('sharing keys distinguish texture sampling and source revisions', () => {
  const first = new THREE.Texture(), second = first.clone(); const baseline = textureSharingKey(first, 'revision-1');
  expect(textureSharingKey(second, 'revision-1')).toBe(baseline);
  second.wrapS = THREE.RepeatWrapping; expect(textureSharingKey(second, 'revision-1')).not.toBe(baseline);
  second.copy(first); second.offset.x = .5; expect(textureSharingKey(second, 'revision-1')).not.toBe(baseline);
  expect(textureSharingKey(first, 'revision-2')).not.toBe(baseline);
});

// Admission: shared active resources cannot be evicted through an idle sibling;
// cancellation must not abort another owner's in-flight request.
test('the global idle budget counts shared resources once and protects active leases', async () => {
  const cache = new ArtCache(8), shared = {}, dispose = vi.fn();
  const records = () => [{ identity: shared, kind: 'image' as const, bytes: 16 }];
  const first = cache.acquire('first', async () => ({}), records, dispose), second = cache.acquire('second', async () => ({}), records, dispose);
  await Promise.all([first.ready, second.ready]); expect(cache.diagnostics().residentEstimatedBytes).toBe(16);
  first.release(); expect(dispose).not.toHaveBeenCalled(); second.release();
  expect(cache.diagnostics().idleBytes).toBeLessThanOrEqual(8); expect(dispose).toHaveBeenCalledTimes(2); await cache.dispose();
});

test('cancelling one pending lease does not cancel a shared request or its surviving owner', async () => {
  const cache = new ArtCache(), controller = new AbortController(); let complete!: (value: object) => void;
  const load = vi.fn(() => new Promise<object>(resolve => { complete = resolve; }));
  const first = cache.acquire('shared', load, () => [], () => {}, controller.signal), second = cache.acquire('shared', load, () => [], () => {});
  const cancelled = expect(first.ready).rejects.toThrow('cancelled'); await Promise.resolve(); controller.abort(); await cancelled;
  complete({}); await second.ready; expect(load).toHaveBeenCalledOnce(); second.release(); await cache.dispose();
});

// Admission: an oversized image must run alone, rather than hang startup forever.
test('leaf admission preserves byte bounds and runs an oversized job alone', async () => {
  const queue = new LoadQueue(2, 8); let finish!: () => void; const order: string[] = [];
  const first = queue.run(() => new Promise<void>(resolve => { order.push('first'); finish = resolve; }), 6);
  const second = queue.run(async () => { order.push('oversized'); expect(queue.diagnostics().running).toBe(1); }, 12);
  const third = queue.run(async () => { order.push('last'); }, 4);
  await Promise.resolve(); expect(order).toEqual(['first']); finish(); await Promise.all([first, second, third]);
  expect(order).toEqual(['first', 'oversized', 'last']); await queue.close();
});

// Admission: sharing the shader graph must not alias another renderer or a
// different UV channel, and repeated preparation must preserve graph identity.
test('surface graphs share material structure within one renderer and preserve structural distinctions', () => {
  const templates = new SurfaceTemplates();
  const first = createSurfaceMaterial({ color: '#ab895f', roughness: .4 }), second = createSurfaceMaterial({ color: '#385921', roughness: .9 });
  first.map = new THREE.Texture(); second.map = new THREE.Texture();
  prepareSurfaceMaterial(first, undefined, 0, 2, templates); prepareSurfaceMaterial(second, undefined, 0, 2, templates);
  expect(second.colorNode).toBe(first.colorNode); expect(second.specularIntensityNode).toBe(first.specularIntensityNode);
  const version = second.version, graph = second.colorNode; prepareSurfaceMaterial(second, undefined, 0, 2, templates);
  expect(second.version).toBe(version); expect(second.colorNode).toBe(graph);
  const alternate = createSurfaceMaterial(); alternate.map = new THREE.Texture(); alternate.map.channel = 1;
  prepareSurfaceMaterial(alternate, undefined, 0, 2, templates); expect(alternate.colorNode).not.toBe(first.colorNode);
  const otherRenderer = createSurfaceMaterial(); otherRenderer.map = new THREE.Texture();
  prepareSurfaceMaterial(otherRenderer, undefined, 0, 2, new SurfaceTemplates()); expect(otherRenderer.colorNode).not.toBe(first.colorNode);
});

// Admission: r186 reuses mutable state during submission. Delayed native work
// must preserve the queued material/attachments without copying GPU handles.
test('queued pipeline descriptor survives reset while retaining GPU handles', () => {
  const module = {}, layout = {};
  const descriptor: NativePipelineDescriptor = { layout, vertex: { module, buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }] }, fragment: { module, targets: [{ format: 'rgba16float' }] }, primitive: { cullMode: 'back' } };
  const snapshot = snapshotNativeDescriptor(descriptor);
  descriptor.vertex.buffers = []; descriptor.fragment!.targets = []; descriptor.primitive!.cullMode = 'front';
  expect(snapshot.layout).toBe(layout); expect(snapshot.vertex.module).toBe(module);
  expect(Array.from(snapshot.vertex.buffers!)).toHaveLength(1); expect(Array.from(snapshot.fragment!.targets)).toHaveLength(1);
  expect(snapshot.primitive!.cullMode).toBe('back');
});
