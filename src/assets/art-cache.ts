export type ArtLease<T> = { ready: Promise<T>; release(this: void): void };
export type ArtResource = { identity: object; kind: 'geometry' | 'image' | 'mips' | 'texture' | 'motion' | 'metadata'; bytes: number };
type Entry = { ready: Promise<unknown>; references: number; settled: boolean; resources: ArtResource[]; dispose(): void };

/** One renderer-wide idle budget; shared resources are counted once across all art owners. */
export class ArtCache {
  private entries = new Map<string, Entry>();
  private closed = false;
  private disposal?: Promise<void>;
  private created = 0;
  private released = 0;
  private peak = 0;
  private previous = new Map<object, { bytes: number; kind: ArtResource['kind'] }>();
  private createdByKind: Record<ArtResource['kind'], number> = { geometry: 0, image: 0, mips: 0, texture: 0, motion: 0, metadata: 0 };
  private releasedByKind = { ...this.createdByKind };
  constructor(readonly idleLimit = 512 * 1024 * 1024, private changed: () => void = () => {}) {}
  acquire<T>(key: string, load: () => Promise<T>, resources: (value: T) => ArtResource[], dispose: (value: T) => void, signal?: AbortSignal): ArtLease<T> {
    if (signal?.aborted) return { ready: Promise.reject(new Error('Asset preparation cancelled.')), release() {} };
    if (this.closed) throw new Error('Runtime art has been closed.');
    let entry = this.entries.get(key);
    if (!entry) {
      const created: Entry = { ready: Promise.resolve().then(load), references: 0, settled: false, resources: [], dispose() {} };
      this.entries.set(key, created); entry = created;
      created.ready = created.ready.then(value => {
        const art = value as T;
        try { created.resources = resources(art); } catch (error) { dispose(art); if (this.entries.get(key) === created) this.entries.delete(key); throw error; }
        created.settled = true; created.dispose = () => dispose(art);
        this.account(); this.trim(); return art;
      }, (error: unknown) => { if (this.entries.get(key) === created) this.entries.delete(key); throw error; });
    }
    this.entries.delete(key); this.entries.set(key, entry); entry.references++;
    const leased = entry; let released = false;
    const release = () => { if (released) return; released = true; leased.references--; this.trim(); };
    const ready = signal ? new Promise<T>((resolve, reject) => {
      const abort = () => { release(); reject(new Error('Asset preparation cancelled.')); };
      signal.addEventListener('abort', abort, { once: true });
      leased.ready.then(value => { signal.removeEventListener('abort', abort); if (!signal.aborted) resolve(value as T); }, (error: unknown) => { signal.removeEventListener('abort', abort); reject(error); });
    }) : leased.ready as Promise<T>;
    return { ready, release };
  }
  private sizes() {
    const resources = new Map<object, ArtResource>(), active = new Set<object>();
    for (const entry of this.entries.values()) for (const resource of entry.resources) {
      resources.set(resource.identity, resource); if (entry.references) active.add(resource.identity);
    }
    let idleBytes = 0, residentBytes = 0;
    const byKind: Record<ArtResource['kind'], number> = { geometry: 0, image: 0, mips: 0, texture: 0, motion: 0, metadata: 0 };
    for (const resource of resources.values()) { residentBytes += resource.bytes; byKind[resource.kind] += resource.bytes; if (!active.has(resource.identity)) idleBytes += resource.bytes; }
    return { resources, active, idleBytes, residentBytes, byKind };
  }
  private account(): void {
    const sizes = this.sizes();
    for (const [identity, resource] of sizes.resources) if (!this.previous.has(identity)) { this.created += resource.bytes; this.createdByKind[resource.kind] += resource.bytes; }
    for (const [identity, resource] of this.previous) if (!sizes.resources.has(identity)) { this.released += resource.bytes; this.releasedByKind[resource.kind] += resource.bytes; }
    this.previous = new Map([...sizes.resources].map(([identity, resource]) => [identity, { bytes: resource.bytes, kind: resource.kind }])); this.peak = Math.max(this.peak, sizes.residentBytes); this.changed();
  }
  trim(): void {
    for (const [key, entry] of this.entries) {
      if (this.sizes().idleBytes <= this.idleLimit) break;
      if (entry.references || !entry.settled) continue;
      this.entries.delete(key); entry.dispose();
    }
    this.account();
  }
  pending(): string[] { return [...this.entries].filter(([, entry]) => !entry.settled).slice(0, 16).map(([key]) => key); }
  diagnostics() {
    const sizes = this.sizes(); return { entries: this.entries.size, leases: [...this.entries.values()].reduce((sum, entry) => sum + entry.references, 0), residentEstimatedBytes: sizes.residentBytes, idleBytes: sizes.idleBytes, idleLimit: this.idleLimit, byKind: sizes.byKind, createdByKind: this.createdByKind, releasedByKind: this.releasedByKind, createdBytes: this.created, releasedBytes: this.released, peakEstimatedBytes: this.peak };
  }
  dispose(): Promise<void> { this.closed = true; return this.disposal ??= this.releaseAll(); }
  private async releaseAll(): Promise<void> {
    await Promise.allSettled([...this.entries.values()].map(entry => entry.ready));
    for (const entry of this.entries.values()) if (entry.settled) entry.dispose();
    this.entries.clear(); this.account();
  }
}
