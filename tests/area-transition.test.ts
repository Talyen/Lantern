import { expect, test } from 'vitest';
import { AreaTransitionController, type AreaOperation, type AreaRequest } from '../src/session/area-transition';
import { PreparedArea, type AreaResources } from '../src/session/area-candidate';
import { Adventure, characterSaveKey } from '../src/gameplay/adventure';
import { decodeCharacter } from '../src/gameplay/character-save';
import { createEncounter } from '../src/gameplay/encounter';
import type { AreaChange } from '../src/session/area-change';
import type { AreaDefinition } from '../src/levels/types';
import homestead from '../src/levels/areas/homestead.json';
import clearing from '../src/levels/areas/clearing.json';
import { memory } from './helpers/storage';

const home = homestead as unknown as AreaDefinition, field = clearing as unknown as AreaDefinition;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}
function resources(id: string) {
  const releases = { area: 0, navigation: 0, lighting: 0, abilities: 0, enemies: 0, visuals: 0 };
  const bundle = new PreparedArea();
  const prepare = (failureAt?: keyof typeof releases) => bundle.prepare(async owner => {
    for (const key of Object.keys(releases) as (keyof typeof releases)[]) {
      owner.own(key, () => releases[key]++);
      if (key === failureAt) throw Error('Missing enemy art');
    }
    return { area: { area: { id } } } as AreaResources;
  });
  return { bundle, prepare, releases };
}
const idle = { cancelled: async () => {}, failed: async () => 'back' as const, finish: () => {} };

// These cases protect complete resource lifetimes and durable travel outcomes; ordinary candidate tests cannot cover readiness after commit.
test('failed preparation and late eligibility rejection retain the active world and release every rejected resource once', async () => {
  const active = resources('homestead'), failed = resources('clearing'), rejected = resources('clearing');
  let selected = active, visible = 'homestead', allowed = true;
  const transitions = new AreaTransitionController(() => ({ ...idle,
    prepare: async () => {
      const bundle = await selected.prepare(selected === failed ? 'enemies' : undefined);
      if (selected === rejected) allowed = false;
      return bundle;
    },
    commit: bundle => { visible = bundle.area.area.id; }, ready: async () => true,
  }));
  await transitions.change({ kind: 'travel', area: 'homestead' });
  selected = failed;
  expect(await transitions.change({ kind: 'travel', area: 'clearing' })).toMatchObject({ status: 'failed' });
  selected = rejected;
  expect(await transitions.change({ kind: 'travel', area: 'clearing', canCommit: () => allowed })).toEqual({ status: 'cancelled' });
  expect(visible).toBe('homestead');
  expect(Object.values(active.releases)).toEqual([0, 0, 0, 0, 0, 0]);
  expect(Object.values(failed.releases)).toEqual([1, 1, 1, 1, 1, 0]);
  expect(Object.values(rejected.releases)).toEqual([1, 1, 1, 1, 1, 1]);
  await transitions.dispose();
  expect(Object.values(active.releases)).toEqual([1, 1, 1, 1, 1, 1]);
});

test('superseded preparation and session disposal settle pending requests without promoting or leaking their worlds', async () => {
  const slow = resources('clearing'), fresh = resources('homestead'), closing = resources('graveyard-crypt');
  const slowWait = deferred<void>(), closeWait = deferred<void>();
  let visible = '';
  const slowStarted = deferred<void>(), closeStarted = deferred<void>();
  const transitions = new AreaTransitionController(change => ({ ...idle,
    prepare: async () => {
      const id = change.kind === 'travel' ? change.area : '';
      const candidate = id === 'clearing' ? slow : id === 'graveyard-crypt' ? closing : fresh;
      const bundle = await candidate.prepare();
      if (candidate === slow) { slowStarted.resolve(); await slowWait.promise; }
      if (candidate === closing) { closeStarted.resolve(); await closeWait.promise; }
      return bundle;
    }, commit: bundle => { visible = bundle.area.area.id; }, ready: async () => true,
  }));
  const old = transitions.change({ kind: 'travel', area: 'clearing' });
  await slowStarted.promise;
  await transitions.change({ kind: 'travel', area: 'homestead' });
  slowWait.resolve(); expect(await old).toEqual({ status: 'cancelled' });
  expect(visible).toBe('homestead');
  const pending = transitions.change({ kind: 'travel', area: 'graveyard-crypt' });
  await closeStarted.promise;
  const disposed = transitions.dispose(); closeWait.resolve();
  expect(await pending).toEqual({ status: 'cancelled' }); await disposed;
  for (const candidate of [slow, fresh, closing]) expect(Object.values(candidate.releases)).toEqual([1, 1, 1, 1, 1, 1]);
  expect(visible).toBe('homestead');
});

test('a first-frame failure commits and saves portal consumption once; presentation recovery preserves gameplay', async () => {
  const storage = memory(), adventure = new Adventure(storage), encounter = createEncounter('playing', field.layout);
  adventure.configureAreas({ homestead: home, clearing: field });
  adventure.enter(encounter, field);
  const link = { area: field.id, departure: { ...field.layout.player, height: 0 } };
  adventure.portal = link; adventure.enter(encounter, home);
  const entered = resources('clearing'), rebuilt = resources('clearing');
  let entryCount = 0, failFrame = true;
  const transitions = new AreaTransitionController((change: AreaChange, request: AreaRequest): AreaOperation => ({ ...idle,
    prepare: () => (change.kind === 'travel' ? entered : rebuilt).prepare(),
    commit: () => {
      if (change.kind === 'travel') { entryCount++; adventure.enter(encounter, field, link.departure, false, change.consumePortal); }
    },
    ready: async () => {
      if (failFrame) { failFrame = false; throw Error('WebGPU first frame failed'); }
      request.stage('ready'); return true;
    },
  }));
  expect(await transitions.change({ kind: 'travel', area: field.id, consumePortal: link })).toMatchObject({ status: 'committed', readiness: 'failed' });
  expect(transitions.transitioning).toBe(true);
  expect(adventure.currentArea).toBe(field.id); expect(adventure.portal).toBeNull();
  expect(decodeCharacter(storage.data.get(characterSaveKey)!).outing.portal).toBeNull();
  const saved = storage.data.get(characterSaveKey), state = structuredClone(encounter), outing = structuredClone(adventure.capture().outing);
  expect(await transitions.change({ kind: 'refresh', presentationOnly: true, canCommit: () => false })).toEqual({ status: 'cancelled' });
  expect(transitions.transitioning).toBe(true);
  expect(await transitions.change({ kind: 'refresh', presentationOnly: true })).toEqual({ status: 'committed', readiness: 'ready' });
  expect(transitions.transitioning).toBe(false); expect(entryCount).toBe(1);
  expect(encounter).toEqual(state); expect(adventure.capture().outing).toEqual(outing); expect(storage.data.get(characterSaveKey)).toBe(saved);
  expect(Object.values(entered.releases)).toEqual([1, 1, 1, 1, 1, 1]);
  await transitions.dispose(); expect(Object.values(rebuilt.releases)).toEqual([1, 1, 1, 1, 1, 1]);
  // An obsolete interaction must not consume a replacement link.
  adventure.portal = { ...link }; adventure.enter(encounter, home);
  adventure.enter(encounter, field, link.departure, false, link);
  expect(adventure.portal).not.toBeNull();
});

test('closing a session after promotion cancels frame readiness and releases the committed area', async () => {
  const candidate = resources('clearing'), frames = deferred<boolean>(), started = deferred<void>();
  const transitions = new AreaTransitionController((_change, request) => ({ ...idle,
    prepare: () => candidate.prepare(), commit: () => {}, ready: () => { started.resolve(); return request.wait(frames.promise); },
  }));
  const result = transitions.change({ kind: 'travel', area: 'clearing' }); await started.promise;
  await transitions.dispose();
  expect(await result).toEqual({ status: 'committed', readiness: 'superseded' });
  expect(Object.values(candidate.releases)).toEqual([1, 1, 1, 1, 1, 1]);
});
