/** Global resource budget for one renderer; active and in-flight leases cannot be evicted. */
export class LightingCache<T> {
  private entries = new Map<string, { value: T; bytes: number; references: number }>();
  private closed = false;
  constructor(readonly maxEntries: number, readonly maxBytes: number, private destroy: (value: T) => void) {}

  acquire(key: string): { value: T; release(): void } | undefined {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key); this.entries.set(key, entry); entry.references++;
    let released = false;
    return { value: entry.value, release: () => {
      if (released) return; released = true; entry.references--; this.trim();
    } };
  }
  insert(key: string, value: T, bytes: number): { value: T; release(): void } {
    if (this.closed) { this.destroy(value); throw new Error('Lighting cache is closed.'); }
    if (this.entries.has(key)) throw new Error('Lighting cache entry already exists.');
    this.entries.set(key, { value, bytes, references: 0 });
    const lease = this.acquire(key)!; this.trim(); return lease;
  }
  setBytes(key: string, bytes: number): void {
    const entry = this.entries.get(key); if (!entry) throw new Error('Lighting cache entry is unavailable.');
    entry.bytes = bytes; this.trim();
  }
  private trim(): void {
    let { entries, bytes } = this.stats();
    for (const [key, entry] of this.entries) {
      if (entries <= this.maxEntries && bytes <= this.maxBytes) break;
      if (entry.references) continue;
      this.entries.delete(key); entries--; bytes -= entry.bytes; this.destroy(entry.value);
    }
  }
  stats() {
    let bytes = 0, leased = 0;
    for (const entry of this.entries.values()) { bytes += entry.bytes; if (entry.references > 0) leased++; }
    return { entries: this.entries.size, bytes, leased, maxEntries: this.maxEntries, maxBytes: this.maxBytes };
  }
  dispose(): void { this.closed = true; this.entries.forEach(entry => this.destroy(entry.value)); this.entries.clear(); }
}
