import type { FrameRateLimit } from '../rendering/graphics-settings';
import type { AreaChange, AreaChangeResult } from './area-change';
import { AreaTransitionController, type AreaOperation, type AreaRequest, type AreaTransitionPhase } from './area-transition';
import { FrameLoop } from './frame-loop';

type LifecycleContext = {
  beginAreaChange(change: AreaChange, request: AreaRequest): AreaOperation;
  hidden(): boolean;
  loading(): boolean;
  /** Independent menu, equipment, visibility, graphics and inspection pauses. */
  pauseReasons(): boolean;
  fpsLimit(): FrameRateLimit;
  clearInput(): void;
  render(dt: number): boolean;
  feedbackFailed(error: unknown, retry: () => void): void;
};

/** Session policy; area resources/readiness and frame scheduling retain their existing owners. */
export class SessionLifecycle {
  readonly areas: AreaTransitionController;
  readonly frames: FrameLoop;
  private readonly abort = new AbortController();
  private feedbackFailure?: { error: unknown };
  private disposal?: Promise<void>;

  constructor(private readonly context: LifecycleContext) {
    this.areas = new AreaTransitionController((change, request) => context.beginAreaChange(change, request));
    this.frames = new FrameLoop({ hidden: () => context.hidden(), fpsLimit: () => context.fpsLimit(),
      paused: () => !this.canAdvanceSimulation, onPause: () => context.clearInput(), render: dt => this.render(dt) });
  }

  get signal(): AbortSignal { return this.abort.signal; }
  get closed(): boolean { return this.signal.aborted; }
  get phase(): AreaTransitionPhase {
    return this.closed ? 'disposed' : this.feedbackFailure ? 'failed' : this.areas.phase;
  }
  get canAdvanceSimulation(): boolean { return this.phase === 'ready' && !this.context.loading() && !this.context.pauseReasons(); }
  get canAcceptGameplayInput(): boolean { return this.canAdvanceSimulation; }
  // An open menu pauses simulation but still needs its close/toggle input.
  get canAcceptMenuInput(): boolean { return this.phase === 'ready' && !this.context.loading(); }
  get canEditEquipment(): boolean { return this.phase === 'ready'; }
  get preserveAcceptedActions(): boolean { return !!this.feedbackFailure || this.phase === 'recovering'; }

  changeArea(change: AreaChange): Promise<AreaChangeResult> {
    if (this.closed || this.feedbackFailure && change.kind !== 'presentation-recovery') return Promise.resolve({ status: 'cancelled' });
    if (change.kind === 'presentation-recovery') this.feedbackFailure = undefined;
    const operation = this.areas.change(change);
    // Publish the blocked recovery request before allowing another frame.
    if (change.kind === 'presentation-recovery') this.frames.setManual(false);
    return operation;
  }

  render(dt: number): boolean {
    if (this.closed || this.feedbackFailure) return false;
    try { return this.context.render(dt); }
    catch (error) {
      // First-frame failures belong to the destination's transition recovery.
      if (this.areas.transitioning || !this.areas.current) throw error;
      this.failPresentation(error);
      return false;
    }
  }

  present(feedback: () => void): void {
    if (this.closed) return;
    try { feedback(); } catch (error) { this.failPresentation(error); }
  }

  failPresentation(error: unknown): void {
    if (this.closed || this.feedbackFailure) return;
    this.feedbackFailure = { error };
    this.frames.suspend(error);
    this.context.feedbackFailed(error, () => {
      void this.changeArea({ kind: 'presentation-recovery' }).catch((failure: unknown) => console.error('Unable to recover adventure presentation.', failure));
    });
  }

  dispose(beforeAreas: () => Promise<void>): Promise<void> {
    if (this.disposal) return this.disposal;
    this.abort.abort();
    this.frames.dispose();
    this.areas.invalidate();
    this.disposal = (async () => { try { await beforeAreas(); } finally { await this.areas.dispose(); } })();
    return this.disposal;
  }
}
