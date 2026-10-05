import { expect, test } from 'vitest';
import { Scene } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { AreaActivation } from '../src/session/area-activation';
import { EnemyActors, type PreparedEnemies } from '../src/session/enemy-actors';
import { makeActor } from '../src/session/actors';
import { CasterVisuals } from '../src/rendering/projectiles';
import { createEncounter } from '../src/gameplay/encounter';
import type { AreaResources } from '../src/session/area-candidate';
import type { AreaDefinition } from '../src/levels/types';
import clearing from '../src/levels/areas/clearing.json';

// A partial scene attachment must not strand borrowed actors or caster roots; the transition fixture cannot inspect this real registry.
test('failed enemy attachment detaches every borrowed actor and permits retry without releasing shared resources', () => {
  const state = createEncounter('playing', (clearing as unknown as AreaDefinition).layout);
  const scene = new Scene(), staging = new Scene();
  const player = makeActor(scene, state.player), actors = { player };
  const presenter = new EnemyActors(scene, new GLTFLoader(), actors);
  let released = 0;
  const enemies: PreparedEnemies = {
    entries: Object.fromEntries(state.enemyIds.filter(id => state.enemies[id].home).map(id => {
      const actor = makeActor(staging, state.enemies[id]);
      return [id, { actor, caster: new CasterVisuals(staging, actor.root, id) }];
    })) as PreparedEnemies['entries'],
    dispose: () => { released++; for (const { actor, caster } of Object.values(enemies.entries)) { actor.root.removeFromParent(); caster?.dispose(); } },
  };
  const failure = Error('Enemy scene attachment failed');
  const second = Object.values(enemies.entries)[1].actor.root;
  const fail = () => { throw failure; };
  second.addEventListener('added', fail);
  const activation = new AreaActivation({
    attachEnemies: value => presenter.commit(value, true), detachEnemies: () => presenter.detach(),
    attachLighting: () => {}, detachLighting: () => {}, attachArea: () => {}, detachArea: () => {},
  });
  const resources = { enemies } as AreaResources;
  expect(() => activation.activate(resources, () => {})).toThrow(failure);
  expect(Object.keys(actors)).toEqual(['player']);
  expect(scene.children).toEqual([player.root]);
  expect(presenter.diagnostics()).toEqual({});
  expect(released).toBe(0);
  second.removeEventListener('added', fail);
  activation.activate(resources, () => {});
  expect(Object.keys(actors)).toEqual(['player', ...Object.keys(enemies.entries)]);
  activation.deactivate(); presenter.dispose();
  expect(scene.children).toEqual([player.root]);
  expect(released).toBe(0);
  enemies.dispose(); expect(released).toBe(1);
});
