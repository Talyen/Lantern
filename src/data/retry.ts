export const storageRetryDelays = [1000, 2000, 5000, 15000, 30000] as const;

/** One capped retry timer; callers own pending data and whether another attempt is safe. */
export class RetryTimer {
  private timer?: ReturnType<typeof setTimeout>;
  private failures = 0;

  get scheduled(): boolean { return this.timer !== undefined; }
  get attempts(): number { return this.failures; }

  schedule(attempt: () => void): void {
    if (this.scheduled) return;
    const delay = storageRetryDelays[Math.min(this.failures++, storageRetryDelays.length - 1)];
    this.timer = setTimeout(() => {
      this.timer = undefined;
      attempt();
    }, delay);
    // Storage retries must not keep command-line consumers alive.
    if (typeof this.timer === 'object') this.timer.unref();
  }

  cancel(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  reset(): void {
    this.cancel();
    this.failures = 0;
  }
}
