import type { AreaChange, AreaChangeResult } from './area-change';
import { PreparedArea, type AreaResources, type AreaSimulation, type AreaPresentationResources } from './area-candidate';

export type AreaRequest = {
  generation: number;
  current(): boolean;
  stage(value: string): void;
  check(): void;
  wait<T>(promise: Promise<T>): Promise<T>;
};
export type AreaTransitionPhase = 'startup' | 'ready' | 'replacing' | 'recovering' | 'failed' | 'disposed';

export type AreaOperation = {
  prepare(): Promise<PreparedArea>;
  commitGameplay(candidate: PreparedArea): void;
  activate(candidate: PreparedArea): void;
  deactivate(): void;
  ready(): Promise<boolean>;
  cancelled(): Promise<void>;
  failed(error: unknown, committed: boolean): Promise<'retry' | 'back' | 'superseded'>;
  finish(): void;
};

/** Owns the active area and every in-flight replacement, including readiness failure. */
export class AreaTransitionController {
  private generation = 0;
  private request?: AbortController;
  private active?: PreparedArea;
  private simulation?: AreaSimulation;
  private activeReady = false;
  private deactivateActive?: () => void;
  private closed = false;
  private pending = new Set<Promise<AreaChangeResult>>();
  private blocked = false;
  private pendingChange?: AreaChange['kind'];
  preparation = { generation: 0, destination: 'startup', stage: 'character' };

  constructor(private readonly begin: (change: AreaChange, request: AreaRequest) => AreaOperation) {}
  get current(): AreaResources | undefined { return this.active?.value; }
  get transitioning(): boolean { return this.blocked; }
  /** Derived from the request and published bundle; no second readiness state. */
  get phase(): AreaTransitionPhase {
    if (this.closed) return 'disposed';
    if (!this.active) return 'startup';
    if (this.pendingChange) return this.pendingChange === 'presentation-recovery' ? 'recovering' : 'replacing';
    return this.activeReady ? 'ready' : 'failed';
  }

  change(change: AreaChange): Promise<AreaChangeResult> {
    if (this.closed) return Promise.resolve({ status: 'cancelled' });
    this.invalidate();
    const controller = this.request = new AbortController(), generation = this.generation;
    const current = () => !this.closed && generation === this.generation;
    this.blocked = true;
    this.pendingChange = change.kind;
    this.preparation = { generation, destination: change.kind === 'travel' ? change.area : this.active?.area.area.id ?? 'startup', stage: 'validation' };
    const request: AreaRequest = {
      generation, current,
      stage: value => { if (current()) this.preparation.stage = value; },
      check: () => { controller.signal.throwIfAborted(); },
      wait: promise => new Promise((resolve, reject) => {
        if (controller.signal.aborted) { reject(controller.signal.reason); return; }
        const abort = () => reject(controller.signal.reason);
        controller.signal.addEventListener('abort', abort, { once: true });
        promise.then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', abort));
      }),
    };
    const operation = this.run(change, request);
    this.pending.add(operation);
    void operation.then(() => this.pending.delete(operation), () => this.pending.delete(operation));
    return operation;
  }

  /** Recovery candidates borrow simulation; rejected preparation cannot release it. */
  prepare(change: AreaChange, build: (owner: PreparedArea) => Promise<AreaPresentationResources>): Promise<PreparedArea> {
    if (change.kind === 'presentation-recovery' && !this.simulation) return Promise.reject(new Error('No committed area to recover.'));
    return new PreparedArea(change.kind === 'presentation-recovery' ? this.simulation : undefined).prepare(build);
  }

  invalidate(): void {
    this.generation++;
    this.request?.abort(new Error('Area transition superseded.'));
    this.pendingChange = undefined;
    this.blocked = !!this.active && !this.activeReady;
  }

  private async run(change: AreaChange, request: AreaRequest): Promise<AreaChangeResult> {
    let operation: AreaOperation | undefined, candidate: PreparedArea | undefined, committed = false;
    try {
      operation = this.begin(change, request);
      if (change.canCommit && !change.canCommit()) {
        await operation.cancelled();
        return { status: 'cancelled' };
      }
      candidate = await operation.prepare();
      request.check();
      if (change.canCommit && !change.canCommit()) {
        candidate.dispose(); candidate = undefined;
        await operation.cancelled();
        return { status: 'cancelled' };
      }
      // The only precommit gameplay callback is an eligible shelter repair.
      if (change.kind === 'refresh') change.onCommit?.();
      const previous = this.active, previousSimulation = this.simulation, deactivatePrevious = this.deactivateActive;
      if (change.kind === 'presentation-recovery' && candidate.simulationResources !== previousSimulation)
        throw new Error('Presentation recovery cannot replace area simulation.');
      this.simulation = candidate.promoteSimulation();
      this.active = candidate;
      this.activeReady = false;
      candidate = undefined;
      committed = true;
      this.deactivateActive = () => operation!.deactivate();
      try {
        if (change.kind !== 'presentation-recovery') operation.commitGameplay(this.active);
        deactivatePrevious?.();
        operation.activate(this.active);
      } catch (error) {
        // Both old and partially installed bindings must let go before retirement.
        deactivatePrevious?.();
        operation.deactivate();
        throw error;
      } finally {
        previous?.dispose();
        if (previousSimulation !== this.simulation) previousSimulation?.dispose();
      }
      const ready = await operation.ready();
      if (ready && request.current()) this.activeReady = true;
      return { status: 'committed', readiness: ready && request.current() ? 'ready' : 'superseded' };
    } catch (error) {
      candidate?.dispose(); candidate = undefined;
      if (!request.current()) return committed ? { status: 'committed', readiness: 'superseded' } : { status: 'cancelled' };
      request.stage('failed');
      let choice: 'retry' | 'back' | 'superseded' | undefined;
      try { choice = await operation?.failed(error, committed); }
      catch (failure) {
        if (!request.current()) return committed ? { status: 'committed', readiness: 'superseded' } : { status: 'cancelled' };
        console.error('Unable to show area recovery.', failure);
      }
      if (!request.current()) return committed ? { status: 'committed', readiness: 'superseded' } : { status: 'cancelled' };
      if (!committed && choice === 'retry' && request.current()) return await this.change(change);
      return committed ? { status: 'committed', readiness: 'failed', error } : { status: 'failed', error };
    } finally {
      candidate?.dispose();
      if (request.current()) {
        this.blocked = !!this.active && !this.activeReady;
        this.pendingChange = undefined;
        operation?.finish();
      }
    }
  }

  async dispose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.invalidate();
    // Let pending preparation release its resources while renderer/services still exist.
    await Promise.allSettled([...this.pending]);
    this.deactivateActive?.(); this.deactivateActive = undefined;
    this.active?.dispose(); this.active = undefined;
    this.simulation?.dispose(); this.simulation = undefined;
  }
}
