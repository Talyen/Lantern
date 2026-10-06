import { afterEach, expect, test, vi } from 'vitest';
import { SessionLifecycle } from '../src/session/lifecycle';
import type { AreaOperation } from '../src/session/area-transition';
import type { AreaPresentationResources } from '../src/session/area-candidate';
import { Adventure } from '../src/gameplay/adventure';
import { createEncounter } from '../src/gameplay/encounter';
import type { MovementWorld } from '../src/gameplay/movement';
import type { AreaDefinition } from '../src/levels/types';
import homeJson from '../src/levels/areas/homestead.json';
import clearingJson from '../src/levels/areas/clearing.json';
import { memory } from './helpers/storage';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}
afterEach(() => vi.unstubAllGlobals());

// Admission: session-level failure/retry can resume frames while area readiness is still pending.
// Existing transition and frame-loop tests do not exercise the shared input/simulation gates.
test.each(['first-frame', 'feedback'])('%s failure blocks gameplay until recovery without repeating saved arrival', async failureAt => {
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  const home = homeJson as unknown as AreaDefinition, clearing = clearingJson as unknown as AreaDefinition;
  const adventure = new Adventure(memory()), encounter = createEncounter('playing', home.layout);
  adventure.configureAreas({ homestead: home, clearing });
  let fail = false, menuOpen = false, loading = false, entries = 0, simulationReleases = 0;
  let retry: (() => void) | undefined;
  let recovery: Promise<unknown> | undefined;
  const recoveryStarted = deferred(), recoveryReady = deferred(), recoveryFinished = deferred();
  const lifecycle: SessionLifecycle = new SessionLifecycle({
    hidden: () => false, loading: () => loading, pauseReasons: () => menuOpen, fpsLimit: () => 60,
    clearInput: () => {}, render: () => { if (fail) throw new Error('Display failed'); return true; },
    feedbackFailed: (_error, again) => { retry = again; },
    beginAreaChange: (change, request): AreaOperation => {
      const presentationOnly = change.kind === 'presentation-recovery';
      const operation: AreaOperation = {
        prepare: () => lifecycle.areas.prepare(change, async owner => {
          if (!presentationOnly) owner.ownSimulation({ dispose: () => { simulationReleases++; } } as unknown as MovementWorld);
          return { area: { area: change.kind === 'travel' && change.area === 'clearing' ? clearing : home } } as AreaPresentationResources;
        }),
        commitGameplay: () => {
          entries++;
          if (change.kind === 'travel') adventure.enter(encounter, change.area === 'clearing' ? clearing : home, change.spawn, false, change.consumePortal);
        },
        activate: () => {}, deactivate: () => {}, cancelled: async () => {}, finish: () => { if (presentationOnly) recoveryFinished.resolve(); },
        failed: async () => 'back',
        ready: async () => {
          if (presentationOnly) { recoveryStarted.resolve(); await request.wait(recoveryReady.promise); }
          lifecycle.render(0);
          return true;
        },
      };
      return operation;
    },
  });
  try {
    await lifecycle.changeArea({ kind: 'travel', area: 'homestead' });
    expect(lifecycle.canAdvanceSimulation).toBe(true);
    menuOpen = true;
    expect(lifecycle.canAcceptMenuInput).toBe(true);
    expect(lifecycle.canAcceptGameplayInput).toBe(false);
    menuOpen = false;
    const link = { area: clearing.id, departure: { ...clearing.layout.player, height: 0 } };
    adventure.portal = link;
    fail = failureAt === 'first-frame';
    const result = await lifecycle.changeArea({ kind: 'travel', area: 'clearing', consumePortal: link });
    const movement = lifecycle.areas.current!.movement;
    lifecycle.frames.start();
    if (failureAt === 'feedback') {
      const waiting = expect(lifecycle.frames.waitFrames()).rejects.toThrow('Display failed');
      lifecycle.present(() => { throw new Error('Display failed'); });
      await waiting;
    } else expect(result).toMatchObject({ status: 'committed', readiness: 'failed' });
    expect(adventure.currentArea).toBe(clearing.id);
    expect(adventure.capture().outing.portal).toBeNull();
    expect(lifecycle.phase).toBe('failed');
    expect(lifecycle.canAdvanceSimulation).toBe(false);
    expect(lifecycle.canAcceptMenuInput).toBe(false);
    expect(lifecycle.canEditEquipment).toBe(false);
    if (retry) expect(await lifecycle.changeArea({ kind: 'travel', area: 'homestead' })).toEqual({ status: 'cancelled' });
    fail = false;
    // The feedback callback uses the same public recovery operation as transition Retry.
    if (retry) retry();
    else recovery = lifecycle.changeArea({ kind: 'presentation-recovery' });
    await recoveryStarted.promise;
    expect(lifecycle.phase).toBe('recovering');
    expect(lifecycle.canAcceptGameplayInput).toBe(false);
    expect(lifecycle.preserveAcceptedActions).toBe(true);
    expect(lifecycle.areas.current!.movement).toBe(movement);
    loading = true; recoveryReady.resolve();
    if (recovery) await recovery;
    else await recoveryFinished.promise;
    expect(lifecycle.canAdvanceSimulation).toBe(false);
    loading = false;
    expect(lifecycle.canAcceptGameplayInput).toBe(true);
    expect(entries).toBe(2);
    expect(adventure.capture().outing.portal).toBeNull();
    expect(simulationReleases).toBe(1);
    expect(lifecycle.areas.current!.movement).toBe(movement);
  } finally { await lifecycle.dispose(async () => {}); }
  expect(simulationReleases).toBe(2);
  expect(lifecycle.phase).toBe('disposed');
  expect(lifecycle.canAcceptMenuInput).toBe(false);
});
