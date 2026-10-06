/** Admission belongs to leaf operations: parents never hold a slot while awaiting children. */
export class LoadQueue {
  private waiting: { bytes: number; begin(): void }[] = [];
  private running = 0;
  private bytes = 0;
  private peak = 0;
  private closed = false;
  private drains: (() => void)[] = [];
  constructor(private limit: number, private byteLimit = Infinity) {}
  run<T>(operation: () => Promise<T>, bytes = 0, signal?: AbortSignal): Promise<T> {
    if (this.closed || signal?.aborted) return Promise.reject(new Error('Asset preparation cancelled.'));
    return new Promise<T>((resolve, reject) => {
      const job = { bytes, begin: () => {
        signal?.removeEventListener('abort', abort);
        this.running++; this.bytes += bytes; this.peak = Math.max(this.peak, this.running);
        Promise.resolve().then(operation).then(resolve, reject).finally(() => {
          this.running--; this.bytes -= bytes; this.pump();
        }).catch((error: unknown) => console.error('Asset admission cleanup failed.', error));
      } };
      const abort = () => { const index = this.waiting.indexOf(job); if (index < 0) return; this.waiting.splice(index, 1); reject(new Error('Asset preparation cancelled.')); this.pump(); };
      signal?.addEventListener('abort', abort, { once: true });
      this.waiting.push(job); this.pump();
    });
  }
  private pump(): void {
    while (this.waiting.length && this.running < this.limit) {
      const job = this.waiting[0];
      if (this.running && this.bytes + job.bytes > this.byteLimit) break;
      this.waiting.shift(); job.begin();
    }
    if (!this.running && !this.waiting.length) this.drains.splice(0).forEach(resolve => resolve());
  }
  async idle(): Promise<void> { if (this.running || this.waiting.length) await new Promise<void>(resolve => { this.drains.push(resolve); }); }
  async close(): Promise<void> {
    this.closed = true;
    await this.idle();
  }
  diagnostics() { return { queued: this.waiting.length, running: this.running, peak: this.peak, bytes: this.bytes, limit: this.limit, byteLimit: Number.isFinite(this.byteLimit) ? this.byteLimit : null }; }
}
