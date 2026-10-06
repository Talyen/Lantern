import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import type { WebGPURenderer } from 'three/webgpu';
import { AssetLibrary } from './asset-library';
import { ArtCache, type ArtLease } from './art-cache';
import { LoadQueue } from './load-queue';
import { artResources, disposeSceneResources, isMesh, isTexture, registerArtRelease, shareTextureOwnership, shareImageOwnership, textureBytes, textureResources } from './resource-ownership';
import { parseJson } from '../data/json';
import { prepareStandardMaterials, filterMaterialTexture, SurfaceTemplates } from '../rendering/surface-detail';

type RuntimeDerivative = { url: string; contentHash: string; width?: number; height?: number; colorURL?: string; dataURL?: string; colorFlipURL?: string; dataFlipURL?: string };
type TextureSampling = { repeat?: boolean; flipY?: boolean; materialFiltering?: boolean; source?: string };
type ImageDefinition = { uri?: string; bufferView?: number; mimeType?: string; extras?: { lanternRuntime?: { contentHash?: string; width: number; height: number } } };
type ImageParser = { json: { images: ImageDefinition[]; buffers?: { uri?: string }[] }; options: { path: string }; getDependency(type: string, index: number): Promise<ArrayBuffer>; loadImageSource(index: number, loader: unknown): Promise<THREE.Texture>; loadBuffer(index: number): Promise<ArrayBuffer> };
type ImageEntry = { key: string; ready: Promise<THREE.Texture>; value?: THREE.Texture; storage?: { kind: 'image' | 'mips'; bytes: number }; parsers: number; textures: number };
type TextureEntry = { texture: THREE.Texture; image?: ImageEntry; references: number };
export type RigArt = Pick<GLTF, 'scene' | 'animations'>;
const scopes = new WeakMap<WebGPURenderer, RuntimeAssets>();
const loaderScopes = new WeakMap<GLTFLoader, RuntimeAssets>();
export function assetsForLoader(loader: GLTFLoader): RuntimeAssets | undefined { return loaderScopes.get(loader); }
export function runtimeAssets(renderer: WebGPURenderer): RuntimeAssets {
  let scope = scopes.get(renderer); if (!scope) { scope = new RuntimeAssets(renderer); scopes.set(renderer, scope); } return scope;
}

/** Immutable sampling state is part of GPU texture identity, not just image identity. */
export function textureSharingKey(texture: THREE.Texture, source: string): string {
  if (texture.matrixAutoUpdate) texture.updateMatrix();
  return JSON.stringify([source, texture.colorSpace, texture.format, texture.type, texture.internalFormat, texture.flipY, texture.premultiplyAlpha, texture.unpackAlignment,
    texture.generateMipmaps, texture.mipmaps.length, texture.magFilter, texture.minFilter, texture.wrapS, texture.wrapT, Reflect.get(texture, 'wrapR'), texture.anisotropy, texture.channel,
    texture.matrix.elements, texture.mapping, Reflect.get(texture, 'compareFunction')]);
}

class RuntimeLoader extends GLTFLoader {
  private imageUses = new Set<Set<ImageEntry>>();
  private imageFailures: unknown[] = [];
  constructor(private scope: RuntimeAssets) {
    super(); this.setKTX2Loader(scope.compressed);
    this.register(parser => {
      const images = parser as unknown as ImageParser, used = new Set<ImageEntry>();
      this.imageUses.add(used);
      const loadBuffer = images.loadBuffer.bind(images);
      images.loadBuffer = index => {
        const uri = images.json.buffers?.[index]?.uri;
        return uri ? scope.buffer(new URL(uri, images.options.path).href) : loadBuffer(index);
      };
      images.loadImageSource = async (index: number) => {
        try {
          const entry = await scope.image(images.json.images[index], images.options.path, images, used);
          return (await entry.ready).clone();
        } catch (error) { this.imageFailures.push(error); throw error; }
      };
      return { name: 'LanternRuntimeArt', afterRoot: async result => {
        // r186 loadTextureImage catches decoder failures and returns null maps.
        // Authored required maps must fail preparation, never reveal white art.
        if (this.imageFailures.length) { disposeSceneResources(result.scene); throw this.imageFailures[0]; }
        scope.shareRoot(result.scene);
        for (const entry of used) { entry.parsers--; scope.releaseImage(entry); } used.clear();
        this.imageUses.delete(used);
      } };
    });
  }
  override async loadAsync(url: string, _onProgress?: (event: ProgressEvent) => void): Promise<GLTF> {
    this.scope.requireOpen();
    return this.scope.track((async () => {
      const actual = this.scope.resolveURL(url), bytes = await this.scope.buffer(actual);
      const release = this.scope.retainEncoded(bytes); this.scope.loading++;
      try {
        const result = await this.parseAsync(bytes, new URL('.', new URL(actual, location.href)).href);
        result.scene.userData.runtimeSource = actual; return result;
      } finally { release(); this.scope.loading--; this.scope.retireWorkers(); }
    })());
  }
  override async parseAsync(data: string | ArrayBuffer, path: string): Promise<GLTF> {
    return this.scope.parsing.run(async () => {
      try { return await super.parseAsync(data, path); }
      finally {
        for (const used of this.imageUses) for (const entry of used) { entry.parsers--; this.scope.releaseImage(entry); }
        this.imageUses.clear(); this.imageFailures = [];
      }
    });
  }
}

/** Renderer-local art: one decoder, texture pool, admission queues and cross-cache idle budget. */
export class RuntimeAssets {
  readonly cache = new ArtCache(512 * 1024 * 1024, () => this.recordResourcePeak());
  readonly surfaceTemplates = new SurfaceTemplates();
  readonly transfers = new LoadQueue(4);
  readonly parsing = new LoadQueue(1);
  readonly decoding = new LoadQueue(2, 128 * 1024 * 1024);
  readonly compressed = new KTX2Loader().setWorkerLimit(2);
  readonly loader: GLTFLoader;
  readonly library: AssetLibrary;
  loading = 0;
  private derivatives = new Map<string, RuntimeDerivative>();
  private libraries = new Map<string, AssetLibrary>();
  private images = new Map<string, ImageEntry>();
  private payloadHashes = new WeakMap<ArrayBuffer, Promise<string>>();
  private imageIdentity = new WeakMap<object, ImageEntry>();
  private textures = new Map<string, TextureEntry>();
  private roots = new WeakSet<THREE.Object3D>();
  private initialization?: Promise<void>;
  private closed = false;
  private accepted = new Set<Promise<unknown>>();
  private disposal?: Promise<void>;
  private decoded = { image: 0, mips: 0, created: 0, released: 0, peak: 0 };
  private resourcePeak = 0;
  private formats = new Map<string, number>();
  private capabilities: Record<string, boolean>;
  private createdTextures = 0;
  private createdTextureBytes = 0;
  private releasedTextureBytes = 0;
  private peakTextureBytes = 0;
  private textureResidentBytes = 0;
  private encodedBytes = 0;
  private peakEncodedBytes = 0;
  constructor(renderer: WebGPURenderer) {
    this.capabilities = Object.fromEntries(['texture-compression-astc', 'texture-compression-bc', 'texture-compression-etc2'].map(feature => [feature, renderer.hasFeature(feature)]));
    this.compressed.detectSupport(renderer); this.loader = new RuntimeLoader(this); loaderScopes.set(this.loader, this); this.library = new AssetLibrary(undefined, this);
  }
  initialize(): Promise<void> {
    return this.initialization ??= (async () => {
      const response = await fetch('/vendor/runtime-art/index.json');
      if (response.status === 404) return; // Source-only checkouts and unoptimized optional sources remain valid.
      if (!response.ok) throw new Error('Prepared runtime art index is unavailable. Prepare runtime art, then reload.');
      const value = parseJson(await response.text()) as { version?: unknown; assets?: Record<string, unknown> } | null;
      if (value?.version !== 1 || !value.assets || typeof value.assets !== 'object') throw new Error('Prepared runtime art index needs updating.');
      for (const [source, raw] of Object.entries(value.assets)) {
        const derivative = raw as Partial<RuntimeDerivative>;
        if ((!source.startsWith('/vendor/') && !source.startsWith('/assets/')) || typeof derivative.url !== 'string' || !derivative.url.startsWith('/vendor/runtime-art/') || typeof derivative.contentHash !== 'string') throw new Error('Invalid prepared runtime art reference.');
        this.derivatives.set(source, derivative as RuntimeDerivative);
        this.derivatives.set(derivative.url, derivative as RuntimeDerivative);
      }
    })();
  }
  requireOpen(): void { if (this.closed) throw new Error('Runtime art has been closed.'); }
  track<T>(promise: Promise<T>): Promise<T> {
    this.accepted.add(promise); promise.then(() => this.accepted.delete(promise), () => this.accepted.delete(promise)); return promise;
  }
  retainEncoded(data: ArrayBuffer): () => void {
    const bytes = data.byteLength; this.encodedBytes += bytes; this.peakEncodedBytes = Math.max(this.peakEncodedBytes, this.encodedBytes); let released = false;
    return () => { if (released) return; released = true; this.encodedBytes -= bytes; };
  }
  resolveURL(url: string, color?: boolean, flipY = false): string {
    const derivative = this.derivatives.get(new URL(url, location.href).pathname); if (!derivative) return url;
    if (color !== undefined) {
      const selected = flipY ? color ? derivative.colorFlipURL : derivative.dataFlipURL : color ? derivative.colorURL : derivative.dataURL;
      // Never reuse a differently encoded color/orientation interpretation.
      return selected ?? url;
    }
    return derivative.url;
  }
  libraryFor(url: string): AssetLibrary { let library = this.libraries.get(url); if (!library) { library = new AssetLibrary(url, this); this.libraries.set(url, library); } return library; }
  async buffer(url: string): Promise<ArrayBuffer> {
    return this.transfers.run(async () => { const response = await fetch(url); if (!response.ok) throw new Error(`Asset unavailable (${response.status}): ${url}`); return response.arrayBuffer(); });
  }
  async image(definition: ImageDefinition, path: string, parser?: ImageParser, used?: Set<ImageEntry>): Promise<ImageEntry> {
    let bytes: ArrayBuffer | undefined;
    const url = definition.uri ? new URL(definition.uri, path).href : undefined;
    const prepared = definition.extras?.lanternRuntime;
    let key = prepared?.contentHash ?? url;
    if (!url) {
      if (definition.bufferView === undefined || !parser) throw new Error('Image has no runtime source.');
      bytes = await parser.getDependency('bufferView', definition.bufferView);
      if (!key) {
        let hash = this.payloadHashes.get(bytes);
        if (!hash) {
          const payload = bytes;
          hash = crypto.subtle.digest('SHA-256', payload).then(value => Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, '0')).join('')).catch((error: unknown) => { this.payloadHashes.delete(payload); throw error; });
          this.payloadHashes.set(payload, hash);
        }
        key = await hash;
      }
    }
    if (!key) throw new Error('Image has no runtime identity.');
    const reserve = (entry: ImageEntry) => { if (used && !used.has(entry)) { used.add(entry); entry.parsers++; } return entry; };
    const existing = this.images.get(key); if (existing) return reserve(existing);
    const entry: ImageEntry = { key, ready: Promise.resolve(new THREE.Texture()), parsers: 0, textures: 0 };
    this.images.set(key, entry);
    reserve(entry);
    const ktx = definition.mimeType === 'image/ktx2' || url?.endsWith('.ktx2');
    // Admit image work before transfer, so a large GLTF cannot retain hundreds
    // of fetched image buffers behind its two decoder slots.
    const widthHint = prepared?.width ?? 4096, heightHint = prepared?.height ?? 4096;
    entry.ready = this.decoding.run(async () => {
      const data = bytes ?? await this.buffer(url!);
      const releaseEncoded = this.retainEncoded(data);
      try {
        const texture = await (async () => {
          if (ktx) {
            const result = await new Promise<THREE.CompressedTexture>((resolve, reject) => this.compressed.parse(data, resolve, reject));
            const format: number = result.format;
            if (!result.isCompressedTexture || format === THREE.RGBAFormat || format === THREE.RGFormat || format === THREE.RedFormat) throw new Error('GPU-compressed art is unavailable on this device. Use a browser with native compressed-texture support.');
            return result;
          }
          const bitmap = await createImageBitmap(new Blob([data]), { premultiplyAlpha: 'none', colorSpaceConversion: 'none', imageOrientation: 'none' });
          const result = new THREE.Texture(bitmap); result.needsUpdate = true; return result;
        })();
        const storage = new Map(textureResources(texture).filter(resource => resource.kind !== 'texture').map(resource => [resource.identity, resource]));
        const kind = texture instanceof THREE.CompressedTexture ? 'mips' : 'image';
        const bytes = [...storage.values()].reduce((total, resource) => total + resource.bytes, 0);
        entry.storage = { kind, bytes }; this.decoded[kind] += bytes; this.decoded.created += bytes;
        this.decoded.peak = Math.max(this.decoded.peak, this.decoded.image + this.decoded.mips); this.recordResourcePeak();
        texture.name = definition.uri ?? prepared?.contentHash ?? key; shareImageOwnership(texture); entry.value = texture; this.imageIdentity.set(texture.source, entry); return texture;
      } finally { releaseEncoded(); }
    }, ktx ? Math.ceil(widthHint * heightHint * 8 / 3) : widthHint * heightHint * 4).catch((error: unknown) => { if (this.images.get(key) === entry) this.images.delete(key); throw error; });
    return entry;
  }
  releaseImage(entry: ImageEntry): void {
    if (entry.parsers || entry.textures || !entry.value) return;
    if (this.images.get(entry.key) === entry) this.images.delete(entry.key);
    if (entry.storage) { this.decoded[entry.storage.kind] -= entry.storage.bytes; this.decoded.released += entry.storage.bytes; entry.storage = undefined; }
    const image = entry.value.image as { close?: () => void } | undefined; image?.close?.(); entry.value.dispose(); entry.value = undefined;
  }
  private intern(texture: THREE.Texture, materialFiltering = true): { texture: THREE.Texture; release(this: void): void } {
    if (materialFiltering) filterMaterialTexture(texture);
    const image = this.imageIdentity.get(texture.source), key = textureSharingKey(texture, image?.key ?? texture.source.uuid);
    let entry = this.textures.get(key);
    if (!entry) {
      entry = { texture, image, references: 0 }; this.textures.set(key, entry); image && image.textures++;
      const format = `${texture.format}/${texture.colorSpace || 'linear'}`; this.formats.set(format, (this.formats.get(format) ?? 0) + 1);
      shareTextureOwnership(texture); const bytes = textureBytes(texture); this.createdTextures++; this.createdTextureBytes += bytes; this.textureResidentBytes += bytes; this.peakTextureBytes = Math.max(this.peakTextureBytes, this.textureResidentBytes); this.recordResourcePeak();
    } else if (texture !== entry.texture) texture.dispose();
    entry.references++; const leased = entry; let released = false;
    return { texture: leased.texture, release: () => {
      if (released) return; released = true; if (--leased.references) return;
      this.textures.delete(key); const format = `${leased.texture.format}/${leased.texture.colorSpace || 'linear'}`; const count = (this.formats.get(format) ?? 1) - 1; if (count) this.formats.set(format, count); else this.formats.delete(format);
      const bytes = textureBytes(leased.texture); this.releasedTextureBytes += bytes; this.textureResidentBytes -= bytes; leased.texture.dispose();
      if (leased.image) { leased.image.textures--; this.releaseImage(leased.image); }
    } };
  }
  textureView(texture: THREE.Texture): { texture: THREE.Texture; release(this: void): void } { return this.intern(texture); }
  shareRoot(root: THREE.Object3D): void {
    if (this.roots.has(root)) return;
    this.roots.add(root); const mapped = new Map<THREE.Texture, THREE.Texture>(), releases: (() => void)[] = [], materials = new Set<THREE.Material>();
    root.traverse(object => { if (isMesh(object)) for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material); });
    for (const material of materials) for (const [key, value] of Object.entries(material)) if (isTexture(value)) {
      let shared = mapped.get(value); if (!shared) { const lease = this.intern(value); shared = lease.texture; mapped.set(value, shared); releases.push(lease.release); }
      Reflect.set(material, key, shared);
    }
    registerArtRelease(root, () => releases.forEach(release => release()));
  }
  async texture(url: string, color: boolean, sampling: TextureSampling = {}): Promise<{ texture: THREE.Texture; url: string; release(this: void): void }> {
    if (this.closed) throw new Error('Runtime art has been closed.');
    const used = new Set<ImageEntry>();
    const source = sampling.source ?? url, resolved = this.resolveURL(source, color, sampling.flipY);
    const actual = resolved === source ? url : resolved;
    const derivative = this.derivatives.get(new URL(source, location.href).pathname);
    const extras = derivative?.width && derivative.height ? { lanternRuntime: { width: derivative.width, height: derivative.height, contentHash: actual === derivative.url ? derivative.contentHash : undefined } } : undefined;
    const entry = await this.image({ uri: actual, extras }, location.href, undefined, used);
    try {
      const texture = (await entry.ready).clone(); texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      // Compressed flip variants have the original upload orientation baked in.
      texture.flipY = texture instanceof THREE.CompressedTexture ? false : sampling.flipY ?? false;
      texture.wrapS = texture.wrapT = sampling.repeat === false ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
      return { ...this.intern(texture, sampling.materialFiltering !== false), url: actual };
    } finally { entry.parsers--; this.releaseImage(entry); this.retireWorkers(); }
  }
  acquireRig(url: string, surfaces = true, signal?: AbortSignal): ArtLease<RigArt> {
    return this.cache.acquire(`rig:${surfaces}:${this.resolveURL(url)}`, async () => {
      const gltf = await this.loader.loadAsync(url);
      try { if (surfaces) prepareStandardMaterials(gltf.scene, this.surfaceTemplates); return { scene: gltf.scene, animations: gltf.animations }; }
      catch (error) { disposeSceneResources(gltf.scene); throw error; }
    },
      art => [...artResources(art.scene), ...art.animations.flatMap(clip => clip.tracks.flatMap(track => [track.times.buffer, track.values.buffer].map(buffer => ({ identity: buffer, kind: 'motion' as const, bytes: buffer.byteLength }))))],
      art => disposeSceneResources(art.scene), signal);
  }
  acquireScene(url: string, prepare: (root: THREE.Group) => Promise<void> = async () => {}): ArtLease<THREE.Group> {
    return this.cache.acquire(`scene:${this.resolveURL(url)}`, async () => { const gltf = await this.loader.loadAsync(url); try { await prepare(gltf.scene); return gltf.scene; } catch (error) { disposeSceneResources(gltf.scene); throw error; } }, artResources, disposeSceneResources);
  }
  retireWorkers(): void { if (!this.loading && !this.decoding.diagnostics().running && !this.decoding.diagnostics().queued) this.compressed.workerPool.dispose(); }
  private resourceKinds() {
    return { ...this.cache.diagnostics().byKind, image: this.decoded.image, mips: this.decoded.mips, texture: this.textureResidentBytes };
  }
  private recordResourcePeak(): void { this.resourcePeak = Math.max(this.resourcePeak, Object.values(this.resourceKinds()).reduce((sum, bytes) => sum + bytes, 0)); }
  diagnostics() {
    const cache = this.cache.diagnostics(), byKind = this.resourceKinds();
    const cumulative = (kind: 'created' | 'released') => {
      const counts = kind === 'created' ? cache.createdByKind : cache.releasedByKind;
      return counts.geometry + counts.motion + counts.metadata + this.decoded[kind] + (kind === 'created' ? this.createdTextureBytes : this.releasedTextureBytes);
    };
    return { ...cache, byKind, residentEstimatedBytes: Object.values(byKind).reduce((sum, bytes) => sum + bytes, 0), createdBytes: cumulative('created'), releasedBytes: cumulative('released'), peakEstimatedBytes: this.resourcePeak,
      cache: { residentEstimatedBytes: cache.residentEstimatedBytes, createdBytes: cache.createdBytes, releasedBytes: cache.releasedBytes, peakEstimatedBytes: cache.peakEstimatedBytes },
      decodedSources: { imageBytes: this.decoded.image, mipBytes: this.decoded.mips, createdBytes: this.decoded.created, releasedBytes: this.decoded.released, peakEstimatedBytes: this.decoded.peak },
      textures: { capabilities: this.capabilities, formats: Object.fromEntries(this.formats), entries: this.textures.size, created: this.createdTextures, createdBytes: this.createdTextureBytes, releasedBytes: this.releasedTextureBytes, residentEstimatedBytes: this.textureResidentBytes, peakEstimatedBytes: this.peakTextureBytes },
      encoded: { bytes: this.encodedBytes, peakBytes: this.peakEncodedBytes }, transfers: this.transfers.diagnostics(), parsing: this.parsing.diagnostics(), decoding: this.decoding.diagnostics() };
  }
  dispose(): Promise<void> { this.closed = true; return this.disposal ??= this.releaseAll(); }
  private async releaseAll(): Promise<void> {
    while (this.accepted.size) await Promise.allSettled([...this.accepted]);
    await Promise.all([this.library.dispose(), ...[...this.libraries.values()].map(library => library.dispose())]); await this.parsing.close(); await this.decoding.close(); await this.transfers.close(); await this.cache.dispose();
    for (const entry of this.images.values()) { entry.parsers = 0; entry.textures = 0; this.releaseImage(entry); }
    this.compressed.workerPool.dispose();
  }
}

export { textureResources };
