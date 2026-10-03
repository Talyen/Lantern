import * as THREE from 'three';
import { AssetLibrary } from '../../assets/asset-library';
import type { ReviewAsset } from '../../assets/asset-review';
import { sceneryLoader } from '../../assets/scenery-loader';
import { disposeSceneResources, sceneResourceBytes } from '../../assets/resource-ownership';
import { prepareEnvironmentMaterials } from '../../assets/environment-surfaces';
import { prepareStandardMaterials } from '../../rendering/surface-detail';
import { markOutline } from '../../rendering/outlines';

export type PreparedReviewAsset = { asset: ReviewAsset; object: THREE.Group; content: THREE.Group; size: THREE.Vector3; bytes: number; compiled: Set<string>; release(): void };
/** Current, two successors and one recent asset; large entries evict speculative work. */
export class PreparedAssets {
  private entries = new Map<string, { promise: Promise<PreparedReviewAsset>; loaded?: PreparedReviewAsset }>();
  private pinned?: string;
  private leases = new WeakMap<PreparedReviewAsset, { count: number; retired: boolean }>();
  private disposed = false;
  private readonly byteLimit = 512 * 1024 * 1024;
  private key(asset: ReviewAsset): string { return `${asset.id}:${asset.fingerprint}`; }
  async get(asset: ReviewAsset, selected = false): Promise<PreparedReviewAsset> {
    if (this.disposed) throw new Error('Asset preparation closed.');
    const key = this.key(asset); if (selected) this.pinned = key;
    let entry = this.entries.get(key);
    if (entry) { this.entries.delete(key); this.entries.set(key, entry); }
    else {
      entry = { promise: this.load(asset) }; this.entries.set(key, entry);
      const current = entry;
      entry.promise.then(loaded => { if (this.disposed || this.entries.get(key) !== current) this.retire(loaded); else { current.loaded = loaded; this.trim(); } }).catch(() => { if (this.entries.get(key) === current) this.entries.delete(key); });
    }
    this.trim();
    const result = await entry.promise;
    if (this.disposed || this.entries.get(key) !== entry) throw new Error('Asset preparation superseded.');
    return result;
  }
  private trim(): void {
    let bytes = [...this.entries.values()].reduce((sum, entry) => sum + (entry.loaded?.bytes ?? 0), 0);
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= 4 && bytes <= this.byteLimit) break;
      if (key === this.pinned || entry.loaded && this.leases.get(entry.loaded)?.count) continue;
      this.entries.delete(key); bytes -= entry.loaded?.bytes ?? 0; if (entry.loaded) this.retire(entry.loaded);
    }
  }
  private retire(asset: PreparedReviewAsset): void {
    const lease = this.leases.get(asset);
    if (lease?.count) lease.retired = true;
    else asset.release();
  }
  keep(asset: PreparedReviewAsset): () => void {
    let lease = this.leases.get(asset);
    if (!lease) { lease = { count: 0, retired: false }; this.leases.set(asset, lease); }
    lease.count++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--lease.count === 0 && lease.retired) asset.release();
      this.trim();
    };
  }
  unpin(): void { this.pinned = undefined; this.trim(); }
  diagnostics() { return { entries: this.entries.size, estimatedBytes: [...this.entries.values()].reduce((sum, entry) => sum + (entry.loaded?.bytes ?? 0), 0), byteLimit: this.byteLimit }; }
  private async load(asset: ReviewAsset): Promise<PreparedReviewAsset> {
    if (!asset.available || !asset.fingerprint) throw new Error('Prepared asset unavailable. Restore its export or inspect its conversion warnings.');
    let content: THREE.Group, release: () => void;
    if (asset.libraryId) {
      // The server supplies only this root and its dependencies, not the entire library.
      const library = new AssetLibrary(`/__asset-review/catalog?id=${encodeURIComponent(asset.id)}&revision=${asset.fingerprint}`);
      try { const instance = await library.loadAsset(asset.libraryId); content = instance.object; release = () => { instance.release(); library.dispose().catch((error: unknown) => console.error(error)); }; }
      catch (error) { await library.dispose(); throw error; }
    } else {
      const gltf = await sceneryLoader.loadAsync(asset.url); content = gltf.scene; release = () => disposeSceneResources(content);
      try { if (asset.url.startsWith('/vendor/synty/environment/')) await prepareEnvironmentMaterials(content, asset.url); prepareStandardMaterials(content); }
      catch (error) { release(); throw error; }
    }
    try {
      content.updateMatrixWorld(true); const initial = new THREE.Box3().setFromObject(content).getSize(new THREE.Vector3());
      if (initial.length() <= 0 || !initial.toArray().every(Number.isFinite)) throw new Error('Asset has no visible geometry.');
      const object = new THREE.Group().add(content);
      if (asset.height && initial.y > 0) object.scale.setScalar(asset.height / initial.y);
      object.updateMatrixWorld(true); const box = new THREE.Box3().setFromObject(object), center = box.getCenter(new THREE.Vector3());
      object.position.set(-center.x, -box.min.y, -center.z); object.updateMatrixWorld(true);
      content.traverse(node => { if (node instanceof THREE.Mesh) node.castShadow = node.receiveShadow = true; });
      if (asset.category === 'Characters' || asset.category === 'Equipment') markOutline(content, 'actor');
      else if (asset.category === 'Props' || asset.category === 'Structures' || asset.category === 'Rocks/Terrain') markOutline(content, 'prop');
      let released = false;
      return { asset, object, content, size: new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3()), bytes: sceneResourceBytes(object), compiled: new Set(), release: () => { if (released) return; released = true; object.removeFromParent(); release(); } };
    } catch (error) { release(); throw error; }
  }
  dispose(): void { this.disposed = true; for (const entry of this.entries.values()) if (entry.loaded) this.retire(entry.loaded); this.entries.clear(); }
}
