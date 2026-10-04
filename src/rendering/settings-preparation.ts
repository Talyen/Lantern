type PreparedSettings = { commit(): void; dispose(): void };

/** Serialize expensive preparations; only the latest settled request may commit. */
export class SettingsPreparation<T> {
  private revision = 0;
  private pending: { value: T; revision: number } | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private disposed = false;
  constructor(private prepare: (value: T) => Promise<PreparedSettings>, private failed: (error: unknown) => void) {}
  get busy(): boolean { return this.running !== undefined; }
  request(value: T, delay = 150): void {
    if (this.disposed) return;
    this.pending = { value, revision: ++this.revision };
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = undefined; this.start(); }, delay);
  }
  private start(): void {
    if (this.running || !this.pending || this.timer !== undefined || this.disposed) return;
    this.running = this.pump().catch(this.failed).finally(() => { this.running = undefined; this.start(); });
  }
  flush(): void { clearTimeout(this.timer); this.timer = undefined; this.start(); }
  async ready(): Promise<void> {
    do {
      this.flush();
      if (this.running) await this.running;
    } while (this.running || this.pending);
  }
  private async pump(): Promise<void> {
    while (this.pending && this.timer === undefined && !this.disposed) {
      const request = this.pending;
      this.pending = null;
      let candidate: PreparedSettings | undefined, committed = false;
      try {
        try {
          candidate = await this.prepare(request.value);
          if (!this.disposed && request.revision === this.revision) { candidate.commit(); committed = true; }
        } finally { if (!committed) candidate?.dispose(); }
      } catch (error) {
        if (!this.disposed && request.revision === this.revision) this.failed(error);
      }
    }
  }
  dispose(): void {
    this.disposed = true; this.revision++; this.pending = null;
    clearTimeout(this.timer); this.timer = undefined;
  }
}
