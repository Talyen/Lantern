import type { FrameRateLimit } from './graphics-settings';

/** Skip expensive frames while retaining the remainder for non-divisible display rates. */
export class FramePacer {
  private previous: number | undefined;
  private limit: FrameRateLimit | undefined;

  shouldRender(now: number, limit: FrameRateLimit): boolean {
    if (this.previous === undefined || limit !== this.limit || limit === 0) {
      this.previous = now; this.limit = limit; return true;
    }
    const interval = 1000 / limit;
    const elapsed = now - this.previous;
    // Avoid halving nominal 60 Hz displays due to small timestamp variations.
    if (elapsed + 0.5 < interval) return false;
    this.previous = now - (Math.max(0, elapsed - interval) % interval);
    return true;
  }
}
