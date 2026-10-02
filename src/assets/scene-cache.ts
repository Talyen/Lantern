import type * as THREE from 'three';
import { disposeSceneResources, sceneResourceBytes } from './resource-ownership';

/** Active and loading scenes stay leased. Keep a warm, byte-bounded pool for repeat travel. */
export class SceneCache {
  private entries = new Map<string, { scene: Promise<THREE.Group>; root?: THREE.Group; references: number; bytes: number }>();
  private closed = false;
  constructor(private unusedBytes = 256 * 1024 * 1024) {}
  acquire(key: string, load: () => Promise<THREE.Group>): { scene: Promise<THREE.Group>; release(this: void): void } {
    if (this.closed) throw new Error('Scene cache is closed.');
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { scene: Promise.resolve().then(load), references: 0, bytes: 0 }; const created = entry;
      this.entries.set(key, entry);
      entry.scene.then(root => { created.root = root; created.bytes = sceneResourceBytes(root); this.trim(); }, () => { this.entries.delete(key); });
    }
    this.entries.delete(key); this.entries.set(key, entry); entry.references++;
    let released = false;
    return { scene: entry.scene, release: () => { if (!released) { released = true; entry.references--; this.trim(); } } };
  }
  private trim(): void {
    let unused = 0;
    for (const entry of this.entries.values()) if (!entry.references) unused += entry.bytes;
    for (const [key, entry] of this.entries) {
      if (unused <= this.unusedBytes) break;
      if (entry.references || !entry.root) continue;
      unused -= entry.bytes; disposeSceneResources(entry.root); this.entries.delete(key);
    }
  }
  async dispose(): Promise<void> {
    this.closed = true; await Promise.allSettled([...this.entries.values()].map(entry => entry.scene));
    for (const entry of this.entries.values()) if (entry.root) disposeSceneResources(entry.root);
    this.entries.clear();
  }
}
