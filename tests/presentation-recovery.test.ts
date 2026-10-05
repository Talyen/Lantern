import { expect, test } from 'vitest';
import { AnimationClip, AnimationMixer, LoopOnce, Scene } from 'three';
import { createEncounter, useAbility, stepExploration, type ActorState, type Motion, type Timings } from '../src/gameplay/encounter';
import { Adventure } from '../src/gameplay/adventure';
import { areas } from '../src/levels/registry';
import { makeActor } from '../src/session/actors';
import { EncounterPresentation } from '../src/session/encounter-presentation';
import { memory } from './helpers/storage';

function actor(state: ActorState) {
  const actor = makeActor(new Scene(), state);
  actor.mixer = new AnimationMixer(actor.root);
  for (const motion of ['idle', 'attack', 'hit', 'death', 'dodge', 'sweep', 'riposte-stance'] as Motion[]) {
    const action = actor.mixer.clipAction(new AnimationClip(motion, motion === 'hit' ? .5 : 1, []));
    action.setLoop(LoopOnce, 1); action.clampWhenFinished = true;
    actor.actions[motion] = action;
  }
  return actor;
}

// Admission: a recovered action used to deal damage while its actor stood idle.
// Real mixers and authoritative contacts protect visual/combat continuity without
// adding a browser test or repeating ordinary ability fixtures.
test('recovery restores accepted attack speed and enemy windup without replaying feedback or changing saves', () => {
  const storage = memory(), adventure = new Adventure(storage, () => 0);
  adventure.configureAreas(areas);
  const state = createEncounter('playing', areas.clearing.layout);
  adventure.enter(state, areas.clearing);
  state.player.x = state.player.z = 0; state.player.yaw = 0;
  state.enemies.enemy.x = 0; state.enemies.enemy.z = 1.4;
  const timing: Timings = { player: { attack: 1, hit: .5, contacts: [.3], abilities: { 'axe-basic': { attack: 1, contacts: [.3] } } }, enemy: { attack: 1, hit: .5, contacts: [.7] } };
  const player = actor(state.player), enemy = actor(state.enemies.enemy);
  const actors = { player, enemy };
  const forbidden = () => { throw Error('One-shot feedback replayed'); };
  const presentation = new EncounterPresentation(state, actors, { encounter: forbidden } as never, { update: forbidden }, { effects: forbidden, weaponSet: forbidden });
  try {
    state.stats = { ...state.stats, attackRate: 1.6 };
    useAbility(state, 'axe-basic', timing.player, false);
    stepExploration(state, .1, { x: 0, z: 0, paused: false }, undefined, timing);
    state.enemies.enemy.attackTime = .2; state.enemies.enemy.lock = .8;
    adventure.save();
    const before = structuredClone(state), saved = new Map(storage.data);
    presentation.restoreActors(false);
    expect(state).toEqual(before); expect(storage.data).toEqual(saved);
    expect(player.current).toBe('attack');
    expect(player.actions.attack!.time).toBeCloseTo(state.player.attackTime * state.playerAction!.rate);
    expect(player.actions.attack!.getEffectiveTimeScale()).toBe(state.playerAction!.rate);
    expect(enemy.current).toBe('attack'); expect(enemy.actions.attack!.time).toBeCloseTo(.2);
    const hp = state.enemies.enemy.hp;
    const events = stepExploration(state, .25, { x: 0, z: 0, paused: false }, undefined, timing);
    expect(state.enemies.enemy.hp).toBeLessThan(hp);
    expect(events.filter(event => event.type === 'action' && event.action === 'contact')).toHaveLength(1);
  } finally { adventure.closeSave(); }
});

test('recovery restores dodge, interrupted enemy and retained death poses from current state', () => {
  const state = createEncounter('playing', areas.clearing.layout);
  state.dodgeRemaining = .225;
  state.enemies.enemy.attackTime = -1; state.enemies.enemy.lock = .2;
  const player = actor(state.player), enemy = actor(state.enemies.enemy);
  const presentation = new EncounterPresentation(state, { player, enemy }, {} as never, {} as never, {} as never);
  presentation.restoreActors(false);
  expect(player.current).toBe('dodge'); expect(player.actions.dodge!.time).toBeCloseTo(.5);
  expect(enemy.current).toBe('hit'); expect(enemy.actions.hit!.time).toBeCloseTo(.3);
  state.enemies.enemy.hp = 0;
  enemy.current = 'death'; enemy.actions.death!.time = .4;
  presentation.rememberPlayback(); presentation.restoreActors(false);
  expect(enemy.current).toBe('death'); expect(enemy.actions.death!.time).toBeCloseTo(.4);
});
