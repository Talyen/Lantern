import { expect, test } from 'vitest';
import { Adventure, characterSaveKey } from '../src/gameplay/adventure';
import { decodeCharacter } from '../src/gameplay/character-save';
import { createEncounter } from '../src/gameplay/encounter';
import { GatheringAction } from '../src/gameplay/gathering-action';
import { resourceDefinitions } from '../src/levels/resources';
import { areas } from '../src/levels/registry';
import { GatheringController } from '../src/session/gathering';
import { makeActor } from '../src/session/actors';
import { Scene } from 'three';
import { memory } from './helpers/storage';

// Admission: sound/particles ran between depletion and saved reward creation.
// Exercise the actual presentation adapter after a numeric contact; harvesting tests
// cannot detect that interruption or prove that retry does not grant another reward.
test.each(['sound', 'particles'] as const)('failed gathering %s retains saved depletion, reward and collision state without replay', failure => {
  const storage = memory(), adventure = new Adventure(storage);
  adventure.configureAreas(areas);
  const area = areas.homestead, encounter = createEncounter('playing', area.layout);
  adventure.enter(encounter, area);
  const resource = { ...resourceDefinitions(area)[0], contacts: 1 };
  adventure.harvesting.register(area.id, [resource]);
  encounter.player.x = resource.position[0]; encounter.player.z = resource.position[2];
  let collided = false;
  const action = new GatheringAction(encounter, adventure, {
    area: () => area, paused: () => false, timing: () => ({ duration: 1, contact: .3 }), visible: () => true,
    setTreeFelled: (_id, felled) => { collided = felled; },
  });
  const actor = makeActor(new Scene(), encounter.player);
  const presentation = new GatheringController(action, adventure.harvesting, actor,
    { show: () => {} },
    { play: () => { if (failure === 'sound') throw new Error('Sound unavailable'); } },
    { instance: () => undefined, effects: () => ({ burst: () => { throw new Error('Particles unavailable'); } }) });
  try {
    action.select(resource); action.takeEvents();
    action.advance(.3);
    const events = action.takeEvents();
    expect(() => presentation.present(events)).toThrow('unavailable');
    const saved = decodeCharacter(storage.data.get(characterSaveKey)!);
    const drops = saved.outing.areas[area.id].drops;
    expect(saved.outing.areas[area.id].resources[resource.id].hits).toBe(1);
    expect(drops).toHaveLength(1);
    expect(drops[0]).toMatchObject({ source: { kind: 'resource', id: resource.id }, harvestXp: { skill: 'woodcutting' } });
    expect(collided).toBe(true);
    action.advance(.1);
    expect(action.takeEvents()).toEqual([]);
    expect(adventure.areaDrops().map(drop => drop.id)).toEqual(drops.map(drop => drop.id));
  } finally { adventure.closeSave(); }
});
