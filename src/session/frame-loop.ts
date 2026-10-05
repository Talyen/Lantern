import { FramePacer } from '../rendering/frame-pacer';
import type { FrameRateLimit } from '../rendering/graphics-settings';

type FrameContext = {
  hidden(): boolean;
  paused(): boolean;
  fpsLimit(): FrameRateLimit;
  maxDeltaSeconds?: number;
  onPause(): void;
  render(dt: number): boolean;
};
type FrameWaiter = { left: number; resolve(): void; reject(error: Error): void };
const settlingFrames = 64;

/** Owns scheduling and elapsed time; the coordinator owns simulation and drawing. */
export class FrameLoop {
  private readonly pacer = new FramePacer();
  private readonly waiters = new Set<FrameWaiter>();
  private request = 0;
  private started = false;
  private manual = false;
  private closed = false;
  private settle = settlingFrames;
  private lastTick: number | undefined;
  private previouslyPaused = true;

  constructor(private readonly context: FrameContext) {}

  get running(): boolean { return this.started; }

  start(): void {
    if (this.closed) return;
    this.started = true;
    this.requestFrame();
  }

  /** Development replay owns explicit frames; resume resets wall-clock pacing. */
  setManual(value: boolean): void {
    this.manual = value; this.lastTick = undefined;
    if (value) { cancelAnimationFrame(this.request); this.request = 0; }
    else this.requestFrame();
  }

  /** Pause failed presentation and reject frame waits until explicit recovery resumes it. */
  suspend(error: unknown): void {
    this.setManual(true);
    const failure = error instanceof Error ? error : new Error(String(error));
    for (const waiter of this.waiters) waiter.reject(failure);
    this.waiters.clear();
  }

  invalidate(): void {
    this.settle = settlingFrames;
    this.requestFrame();
  }

  visibilityChanged(): void {
    this.lastTick = undefined;
    if (this.context.hidden()) {
      cancelAnimationFrame(this.request);
      this.request = 0;
    } else this.invalidate();
  }

  waitFrames(count = 16): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Frame loop has been closed.'));
    return new Promise((resolve, reject) => {
      this.waiters.add({ left: count, resolve, reject });
      this.invalidate();
    });
  }

  dispose(): void {
    this.started = false;
    this.closed = true;
    cancelAnimationFrame(this.request);
    this.request = 0;
    for (const waiter of this.waiters) waiter.reject(new Error('Frame loop has been closed.'));
    this.waiters.clear();
  }

  private requestFrame(): void {
    if (this.started && !this.manual && !this.request && !this.context.hidden()) {
      this.request = requestAnimationFrame(this.tick);
    }
  }

  private tick = (now: number): void => {
    this.request = 0;
    if (this.context.hidden()) { this.lastTick = undefined; return; }
    if (!this.pacer.shouldRender(now, this.context.fpsLimit())) {
      this.requestFrame();
      return;
    }

    const paused = this.context.paused();
    if (paused && !this.previouslyPaused) {
      this.context.onPause();
      this.settle = settlingFrames;
    }
    const dt = !paused && !this.previouslyPaused && this.lastTick !== undefined
      ? Math.min((now - this.lastTick) / 1000, this.context.maxDeltaSeconds ?? .05)
      : 0;
    this.lastTick = now;
    this.previouslyPaused = paused;
    if (paused && this.settle === 0 && !this.waiters.size) {
      this.lastTick = undefined;
      return;
    }

    let rendered: boolean;
    try { rendered = this.context.render(dt); }
    catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      for (const waiter of this.waiters) waiter.reject(failure);
      this.waiters.clear();
      throw error;
    }
    if (rendered) {
      this.settle = paused ? Math.max(0, this.settle - 1) : settlingFrames;
      for (const waiter of this.waiters) {
        if (--waiter.left > 0) continue;
        this.waiters.delete(waiter);
        waiter.resolve();
      }
    }
    if (!this.context.paused() || this.settle || this.waiters.size) this.requestFrame();
  };
}
