/** Serialize expensive preparations; only the latest settled request may commit. */
export class SettingsPreparation<T> {
  private revision = 0;
  private pending: { value: T; revision: number } | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private disposed = false;
  private waiters: (() => void)[] = [];
  constructor(private prepare: (value: T) => Promise<{ commit(): void; dispose(): void }>, private failed: (error: unknown) => void) {}
  get busy(): boolean { return this.running; }
  request(value: T, delay = 150): void {
    if (this.disposed) return;
    this.pending = { value, revision: ++this.revision };
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = undefined; void this.pump().catch(this.failed); }, delay);
  }
  flush(): void { clearTimeout(this.timer); this.timer = undefined; void this.pump().catch(this.failed); }
  async ready(): Promise<void> {
    this.flush();
    if (this.running || this.pending) await new Promise<void>(resolve => this.waiters.push(resolve));
  }
  private async pump(): Promise<void> {
    if (this.running || this.timer !== undefined || this.disposed) return;
    const request = this.pending;
    if (!request) { this.waiters.splice(0).forEach(resolve => resolve()); return; }
    this.pending = null; this.running = true;
    let candidate: Awaited<ReturnType<SettingsPreparation<T>['prepare']>> | undefined;
    let retired = false;
    const discard = () => { if (candidate && !retired) { retired = true; candidate.dispose(); } };
    try {
      candidate = await this.prepare(request.value);
      if (!this.disposed && request.revision === this.revision) candidate.commit();
      else discard();
    } catch (error) {
      discard();
      if (!this.disposed && request.revision === this.revision) this.failed(error);
    } finally {
      this.running = false;
      if (this.disposed) this.waiters.splice(0).forEach(resolve => resolve());
      else void this.pump().catch(this.failed);
    }
  }
  dispose(): void {
    this.disposed = true; this.revision++; this.pending = null;
    clearTimeout(this.timer); this.timer = undefined;
    if (!this.running) this.waiters.splice(0).forEach(resolve => resolve());
  }
}
