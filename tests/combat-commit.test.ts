import { expect, test } from 'vitest';
import { Adventure, characterSaveKey } from '../src/gameplay/adventure';
import { decodeCharacter } from '../src/gameplay/character-save';
import { createEncounter } from '../src/gameplay/encounter';
import { resolveCombatStats } from '../src/gameplay/combat-stats';
import { areas } from '../src/levels/registry';
import { CombatController } from '../src/session/combat';
import { SessionRuntime } from '../src/session/runtime';
import { GatheringAction } from '../src/gameplay/gathering-action';
import { memory } from './helpers/storage';

// Admission: the real tick previously presented combat before rolling enemy loot.
// Protect saved XP, loadout, cooldowns and exactly-once loot after feedback throws;
// isolated encounter/Adventure tests do not exercise the session's authoritative sequence.
function setup() {
  const storage = memory(), adventure = new Adventure(storage, () => 0);
  adventure.character.items.push({ id: adventure.newId(), item: 'sword', quantity: 1, slot: 'main', weaponSet: 1, x: 0, y: 0 });
  adventure.character.xp.sword = 990;
  adventure.configureAreas(areas);
  const encounter = createEncounter('playing', areas.clearing.layout);
  adventure.enter(encounter, areas.clearing);
  encounter.player.x = encounter.player.z = 0;
  encounter.player.yaw = 0;
  encounter.player.hp = 61;
  const enemy = encounter.enemies.enemy;
  enemy.x = 0; enemy.z = 1.4; enemy.hp = enemy.lowestHp = 20;
  const presentation = { fail: false };
  const gathering = new GatheringAction(encounter, adventure, {
    area: () => areas.clearing, paused: () => false, timing: () => undefined, visible: () => true, setTreeFelled: () => {},
  });
  const runtime = new SessionRuntime(encounter, adventure, gathering, {
    area: () => areas.clearing, movement: () => undefined, timings: () => combat.timings(),
    interruptApproach: () => {}, defeated: () => {},
  });
  const present = () => {
    const feedback = runtime.takeFeedback();
    if (presentation.fail) throw new Error('Presentation unavailable');
    return feedback;
  };
  const combat = new CombatController(encounter, adventure, {},
    { movement: () => ({ x: 0, z: 0 }), pointer: () => undefined, held: () => false, suppress: () => {} },
    { resolve: () => undefined, attack: () => undefined },
    { abilityTimings: () => ({ sweep: { attack: 1, contacts: [.2] } }) },
    {
      paused: () => false, impactHolding: () => false, safeArea: () => false,
      interruptApproach: () => {}, clearHold: () => {}, blocking: () => false,
      complete: events => runtime.complete(events),
    });
  return { adventure, encounter, combat, runtime, storage, presentation, present };
}

test('an immediate ability swap saves the accepted weapon set before presentation fails', () => {
  const { adventure, encounter, combat, storage, presentation, present } = setup();
  try {
    presentation.fail = true;
    combat.startAbility('sweep');
    expect(present).toThrow('Presentation unavailable');
    expect(encounter.playerAction?.ability).toBe('sweep');
    expect(encounter.activeSet).toBe(1);
    expect(decodeCharacter(storage.data.get(characterSaveKey)!).activeSet).toBe(1);
  } finally { adventure.closeSave(); }
});

test.each([false, true])('frame combat commits XP, unlocks and cooldowns with failed presentation=%s', failed => {
  const { adventure, encounter, combat, runtime, storage, presentation, present } = setup();
  try {
    combat.startAbility('sweep');
    const acceptedDamage = encounter.playerAction!.damage;
    runtime.advance(.25, { x: 0, z: 0, paused: false });
    const { hp } = encounter.player, mana = encounter.playerMana;
    presentation.fail = failed;
    if (failed) expect(present).toThrow('Presentation unavailable');
    else present();

    const saved = decodeCharacter(storage.data.get(characterSaveKey)!);
    expect(saved.xp.sword).toBeGreaterThan(1000);
    expect(saved.actionBar).toContain('executioner');
    expect(saved.activeSet).toBe(1);
    expect(saved.outing.cooldowns.abilityCooldowns.sweep).toBeGreaterThan(0);
    expect(saved.outing.cooldowns).toEqual(adventure.capture().outing.cooldowns);
    expect(saved.outing.areas.clearing.enemies.enemy).toMatchObject({ hp: 0, lowestHp: 0, rewarded: true });
    expect(encounter.proficiency).toEqual(saved.xp);
    expect(encounter.stats).toEqual(resolveCombatStats(saved.items, saved.activeSet, saved.xp));
    expect(encounter.playerAction!.damage).toBe(acceptedDamage);
    expect(encounter.player.hp).toBe(hp);
    expect(encounter.playerMana).toBe(mana);
    const loot = saved.outing.areas.clearing.drops.filter(drop => drop.source?.id === 'enemy');
    expect(loot.length).toBeGreaterThan(0);
    // A display rebuild consumes feedback only; the next tick cannot roll this kill again.
    presentation.fail = false; present();
    runtime.advance(0, { x: 0, z: 0, paused: false });
    expect(adventure.session().drops.filter(drop => drop.source?.id === 'enemy').map(drop => drop.id)).toEqual(loot.map(drop => drop.id));
  } finally { adventure.closeSave(); }
});
