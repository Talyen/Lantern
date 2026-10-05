import { expect, test } from 'vitest';
import { AreaTransitionController, type AreaOperation, type AreaRequest } from '../src/session/area-transition';
import { AreaActivation } from '../src/session/area-activation';
import { PreparedArea, type AreaPresentationResources } from '../src/session/area-candidate';
import { Adventure, characterSaveKey } from '../src/gameplay/adventure';
import { decodeCharacter } from '../src/gameplay/character-save';
import { createEncounter } from '../src/gameplay/encounter';
import type { AreaChange } from '../src/session/area-change';
import type { AreaDefinition } from '../src/levels/types';
import homestead from '../src/levels/areas/homestead.json';
import clearing from '../src/levels/areas/clearing.json';
import { memory } from './helpers/storage';
import { MovementWorld } from '../src/gameplay/movement';
import { dodge, stepExploration, type Timings } from '../src/gameplay/encounter';
import { syncMovement } from '../src/gameplay/encounter-movement';

const home = homestead as unknown as AreaDefinition, field = clearing as unknown as AreaDefinition;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}
function resources(id: string, borrowed?: Set<unknown>) {
  const releases = { area: 0, navigation: 0, lighting: 0, abilities: 0, enemies: 0, visuals: 0 };
  const borrowedAtRelease: string[] = [];
  const bundle = new PreparedArea();
  const area = { area: { id } }, enemies = {}, lighting = {};
  const build = async (owner: PreparedArea, failureAt?: keyof typeof releases) => {
    for (const key of Object.keys(releases) as (keyof typeof releases)[]) {
      const release = () => {
        if (borrowed?.has(key === 'area' ? area : key === 'enemies' ? enemies : key === 'lighting' ? lighting : key)) borrowedAtRelease.push(key);
        releases[key]++;
      };
      if (key === 'navigation') {
        if (!owner.simulationResources) owner.ownSimulation({ dispose: release } as unknown as MovementWorld);
      } else owner.own(key, release);
      if (key === failureAt) throw Error('Missing enemy art');
    }
    return { area, enemies, lighting } as AreaPresentationResources;
  };
  const prepare = (failureAt?: keyof typeof releases) => bundle.prepare(owner => build(owner, failureAt));
  return { bundle, prepare, build, releases, borrowedAtRelease };
}
const idle = { activate: () => {}, deactivate: () => {}, cancelled: async () => {}, failed: async () => 'back' as const, finish: () => {} };

// Protect blocked gameplay and saved travel after partial activation; preparation/first-frame tests alone cannot detect dangling presentation borrows.
test('failed preparation and late eligibility rejection retain the active world and release every rejected resource once', async () => {
  const active = resources('homestead'), failed = resources('clearing'), rejected = resources('clearing');
  let selected = active, visible = 'homestead', allowed = true;
  const transitions: AreaTransitionController = new AreaTransitionController(() => ({ ...idle,
    prepare: async () => {
      const bundle = await selected.prepare(selected === failed ? 'enemies' : undefined);
      if (selected === rejected) allowed = false;
      return bundle;
    },
    commitGameplay: bundle => { visible = bundle.area.area.id; }, ready: async () => true,
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
  const transitions: AreaTransitionController = new AreaTransitionController(change => ({ ...idle,
    prepare: async () => {
      const id = change.kind === 'travel' ? change.area : '';
      const candidate = id === 'clearing' ? slow : id === 'graveyard-crypt' ? closing : fresh;
      const bundle = await candidate.prepare();
      if (candidate === slow) { slowStarted.resolve(); await slowWait.promise; }
      if (candidate === closing) { closeStarted.resolve(); await closeWait.promise; }
      return bundle;
    }, commitGameplay: bundle => { visible = bundle.area.area.id; }, ready: async () => true,
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

test.each(['first-frame', 'enemies', 'lighting', 'area'])('a %s failure retains saved arrival and releases all presentation bindings before retirement', async failureAt => {
  const storage = memory(), adventure = new Adventure(storage), encounter = createEncounter('playing', field.layout);
  adventure.configureAreas({ homestead: home, clearing: field });
  adventure.enter(encounter, field);
  const link = { area: field.id, departure: { ...field.layout.player, height: 0 } };
  adventure.portal = link; adventure.enter(encounter, home);
  const bindings = new Set<unknown>();
  const original = resources('homestead', bindings), entered = resources('clearing', bindings), rebuilt = resources('clearing', bindings);
  let entryCount = 0, failed = false, armed = false;
  let boundEnemies: unknown, boundLighting: unknown;
  const activation = new AreaActivation({
    attachEnemies: enemies => { bindings.add(enemies); boundEnemies = enemies; fail('enemies'); },
    detachEnemies: () => { bindings.delete(boundEnemies); boundEnemies = undefined; },
    attachLighting: lighting => { bindings.add(lighting); boundLighting = lighting; fail('lighting'); },
    detachLighting: () => { bindings.delete(boundLighting); boundLighting = undefined; },
    attachArea: area => { bindings.add(area); fail('area'); },
    detachArea: area => { bindings.delete(area); },
  });
  function fail(stage: string) {
    if (armed && !failed && stage === failureAt) { failed = true; throw Error('Area activation failed'); }
  }
  const transitions: AreaTransitionController = new AreaTransitionController((change: AreaChange, request: AreaRequest): AreaOperation => ({ ...idle,
    prepare: () => {
      const selected = change.kind === 'travel' ? entered : adventure.currentArea === home.id ? original : rebuilt;
      return transitions.prepare(change, selected.build);
    },
    commitGameplay: () => {
      if (change.kind === 'travel') { entryCount++; adventure.enter(encounter, field, link.departure, false, change.consumePortal); }
    },
    activate: candidate => activation.activate(candidate.value, () => {}),
    deactivate: () => activation.deactivate(),
    ready: async () => {
      fail('first-frame');
      request.stage('ready'); return true;
    },
  }));
  await transitions.change({ kind: 'refresh' });
  armed = true;
  expect(await transitions.change({ kind: 'travel', area: field.id, consumePortal: link })).toMatchObject({ status: 'committed', readiness: 'failed' });
  expect(transitions.transitioning).toBe(true);
  expect(transitions.current?.area.area.id).toBe('clearing');
  if (failureAt !== 'first-frame') expect(bindings.size).toBe(0);
  expect(adventure.currentArea).toBe(field.id); expect(adventure.portal).toBeNull();
  expect(decodeCharacter(storage.data.get(characterSaveKey)!).outing.portal).toBeNull();
  const saved = storage.data.get(characterSaveKey), state = structuredClone(encounter), outing = structuredClone(adventure.capture().outing);
  expect(await transitions.change({ kind: 'presentation-recovery', canCommit: () => false })).toEqual({ status: 'cancelled' });
  expect(transitions.transitioning).toBe(true);
  expect(await transitions.change({ kind: 'presentation-recovery' })).toEqual({ status: 'committed', readiness: 'ready' });
  expect(transitions.transitioning).toBe(false); expect(entryCount).toBe(1);
  expect(encounter).toEqual(state); expect(adventure.capture().outing).toEqual(outing); expect(storage.data.get(characterSaveKey)).toBe(saved);
  expect(Object.values(entered.releases)).toEqual([1, 0, 1, 1, 1, 1]);
  expect(transitions.current?.area.area.id).toBe('clearing');
  await transitions.dispose(); expect(bindings.size).toBe(0);
  expect(transitions.current).toBeUndefined();
  expect(Object.values(rebuilt.releases)).toEqual([1, 0, 1, 1, 1, 1]);
  for (const candidate of [original, entered, rebuilt]) {
    expect(Object.values(candidate.releases)).toEqual(candidate === rebuilt ? [1, 0, 1, 1, 1, 1] : [1, 1, 1, 1, 1, 1]);
    expect(candidate.borrowedAtRelease).toEqual([]);
  }
  // An obsolete interaction must not consume a replacement link.
  adventure.portal = { ...link }; adventure.enter(encounter, home);
  adventure.enter(encounter, field, link.departure, false, link);
  expect(adventure.portal).not.toBeNull();
});

test('closing a session after promotion cancels frame readiness and releases the committed area', async () => {
  const candidate = resources('clearing'), frames = deferred<boolean>(), started = deferred<void>();
  const transitions: AreaTransitionController = new AreaTransitionController((_change, request) => ({ ...idle,
    prepare: () => candidate.prepare(), commitGameplay: () => {}, ready: () => { started.resolve(); return request.wait(frames.promise); },
  }));
  const result = transitions.change({ kind: 'travel', area: 'clearing' }); await started.promise;
  await transitions.dispose();
  expect(await result).toEqual({ status: 'committed', readiness: 'superseded' });
  expect(Object.values(candidate.releases)).toEqual([1, 1, 1, 1, 1, 1]);
});

// Admission: recovery used to replace Rapier's shortened dodge and landing reservation.
// Exercise the production candidate factory/controller with real movement; generic
// resource mocks and encounter-only fixtures cannot detect that loss of state.
test('presentation recovery retains a shortened dodge and its reserved landing through failure and retry', async () => {
  const boundary = { kind: 'polygon' as const, points: [[-8,-8],[8,-8],[8,8],[-8,8]] as [number, number][] };
  const state = createEncounter('playing', { boundary, player: { position: [0,0], yaw: 0 }, enemy: { position: [0,2.4], yaw: 0 } });
  const movement = await MovementWorld.create(boundary);
  let simulationReleases = 0, presentationReleases = 0, commits = 0, fail = false;
  const release = movement.dispose.bind(movement);
  movement.dispose = () => { simulationReleases++; release(); };
  const transitions: AreaTransitionController = new AreaTransitionController(change => ({ ...idle,
    prepare: () => transitions.prepare(change, async owner => {
      if (change.kind !== 'presentation-recovery') owner.ownSimulation(movement);
      owner.own({}, () => { presentationReleases++; });
      return { area: { area: { id: 'clearing' } } } as AreaPresentationResources;
    }),
    commitGameplay: () => { commits++; },
    activate: () => { if (fail) throw Error('Presentation unavailable'); }, ready: async () => true,
  }));
  const input = { x: 0, z: 0, paused: false };
  const timing: Timings = { player: { attack: .7, hit: .3, contacts: [.3] }, enemy: { attack: 1, hit: .5, contacts: [.5] } };
  try {
    await transitions.change({ kind: 'travel', area: 'clearing' });
    syncMovement(state, movement); dodge(state, { x: 0, z: 1 }, false);
    stepExploration(state, .2, input, movement, timing);
    const before = structuredClone(state), collision = movement.diagnostics();
    fail = true;
    expect(await transitions.change({ kind: 'presentation-recovery' })).toMatchObject({ status: 'committed', readiness: 'failed' });
    expect(transitions.current?.movement).toBe(movement); expect(transitions.transitioning).toBe(true);
    expect(simulationReleases).toBe(0); expect(state).toEqual(before); expect(movement.diagnostics()).toEqual(collision);
    fail = false;
    expect(await transitions.change({ kind: 'presentation-recovery' })).toEqual({ status: 'committed', readiness: 'ready' });
    expect(commits).toBe(1); expect(simulationReleases).toBe(0); expect(presentationReleases).toBe(2);
    const walker = { ...state.enemies.enemy, x: 0, z: 3.5, hp: 200 };
    movement.syncActors([{ id: 'player', state: state.player, dodging: true }, { id: 'enemy', state: state.enemies.enemy }, { id: 'walker', state: walker }]);
    movement.move('walker', walker, 0, -2, .1);
    expect(walker.z).toBeGreaterThan(2.3);
    for (let i = 0; i < 5; i++) stepExploration(state, .05, input, movement, timing);
    expect(state.dodgeRemaining).toBeCloseTo(0, 8);
    expect(state.player.z).toBeGreaterThan(1.6); expect(state.player.z).toBeLessThan(1.8);
  } finally { await transitions.dispose(); }
  expect(simulationReleases).toBe(1); expect(presentationReleases).toBe(3);
});

// Rejected/superseded visual preparation borrows a live simulation: releasing it
// would strand core movement even though the prior destination remains active.
test('rejected and superseded recovery preparation cannot release borrowed simulation', async () => {
  const initial = resources('homestead'), late = resources('homestead'), failing = resources('homestead');
  const waiting = deferred<void>(), started = deferred<void>();
  let reject = false;
  const transitions: AreaTransitionController = new AreaTransitionController(change => ({ ...idle,
    prepare: () => transitions.prepare(change, async owner => {
      if (change.kind !== 'presentation-recovery') return initial.build(owner);
      if (reject) return failing.build(owner, 'enemies');
      const result = await late.build(owner); started.resolve(); await waiting.promise; return result;
    }), commitGameplay: () => {}, ready: async () => true,
  }));
  try {
    await transitions.change({ kind: 'travel', area: 'homestead' });
    const movement = transitions.current!.movement;
    reject = true;
    expect(await transitions.change({ kind: 'presentation-recovery' })).toMatchObject({ status: 'failed' });
    expect(transitions.current!.movement).toBe(movement); expect(initial.releases.navigation).toBe(0);
    reject = false;
    const pending = transitions.change({ kind: 'presentation-recovery' }); await started.promise;
    transitions.invalidate(); waiting.resolve();
    expect(await pending).toEqual({ status: 'cancelled' });
    expect(transitions.current!.movement).toBe(movement); expect(initial.releases.navigation).toBe(0);
    expect(late.releases.navigation).toBe(0); expect(failing.releases.navigation).toBe(0);
    expect(late.releases.enemies).toBe(1); expect(failing.releases.enemies).toBe(1);
  } finally { waiting.resolve(); await transitions.dispose(); }
  expect(initial.releases.navigation).toBe(1);
});
