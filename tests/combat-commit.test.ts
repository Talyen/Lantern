import { expect, test } from 'vitest';
import { Adventure, characterSaveKey } from '../src/gameplay/adventure';
import { decodeCharacter } from '../src/gameplay/character-save';
import { createEncounter, stepEncounter } from '../src/gameplay/encounter';
import { resolveCombatStats } from '../src/gameplay/combat-stats';
import { areas } from '../src/levels/registry';
import { CombatController } from '../src/session/combat';
import { memory } from './helpers/storage';

// Admission: presentation previously committed XP/set changes and preceded cooldown saves.
// This boundary fixture protects earned/saved progress when presentation is absent or throws;
// encounter tests check emitted events, and Adventure tests apply rewards separately.
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
  const combat = new CombatController(encounter, adventure, {},
    { movement: () => ({ x: 0, z: 0 }), pointer: () => undefined, held: () => false, suppress: () => {} },
    { resolve: () => undefined, attack: () => undefined },
    { abilityTimings: () => ({ sweep: { attack: 1, contacts: [.2] } }) },
    {
      paused: () => false, impactHolding: () => false, safeArea: () => false,
      interruptApproach: () => {}, clearHold: () => {}, blocking: () => false,
      present: () => { if (presentation.fail) throw new Error('Presentation unavailable'); },
    });
  return { adventure, encounter, combat, storage, presentation };
}

test('an immediate ability swap saves the accepted weapon set before presentation fails', () => {
  const { adventure, encounter, combat, storage, presentation } = setup();
  try {
    presentation.fail = true;
    expect(() => combat.startAbility('sweep')).toThrow('Presentation unavailable');
    expect(encounter.playerAction?.ability).toBe('sweep');
    expect(encounter.activeSet).toBe(1);
    expect(decodeCharacter(storage.data.get(characterSaveKey)!).activeSet).toBe(1);
  } finally { adventure.closeSave(); }
});

test.each([false, true])('frame combat commits XP, unlocks and cooldowns with failed presentation=%s', failed => {
  const { adventure, encounter, combat, storage, presentation } = setup();
  try {
    combat.startAbility('sweep');
    const acceptedDamage = encounter.playerAction!.damage;
    const events = stepEncounter(encounter, .25, { x: 0, z: 0, paused: false }, combat.timings());
    expect(events.some(event => event.type === 'proficiency')).toBe(true);
    expect(events.some(event => event.type === 'abilityCommitted')).toBe(true);
    const { hp } = encounter.player, mana = encounter.playerMana;
    presentation.fail = failed;
    if (failed) expect(() => combat.complete(events)).toThrow('Presentation unavailable');
    else combat.complete(events);

    const saved = decodeCharacter(storage.data.get(characterSaveKey)!);
    expect(saved.xp.sword).toBeGreaterThan(1000);
    expect(saved.actionBar).toContain('executioner');
    expect(saved.activeSet).toBe(1);
    expect(saved.outing.cooldowns.abilityCooldowns.sweep).toBeGreaterThan(0);
    expect(saved.outing.cooldowns).toEqual(adventure.capture().outing.cooldowns);
    expect(saved.outing.areas.clearing.enemies.enemy).toMatchObject({ hp: 0, lowestHp: 0, rewarded: false });
    expect(encounter.proficiency).toEqual(saved.xp);
    expect(encounter.stats).toEqual(resolveCombatStats(saved.items, saved.activeSet, saved.xp));
    expect(encounter.playerAction!.damage).toBe(acceptedDamage);
    expect(encounter.player.hp).toBe(hp);
    expect(encounter.playerMana).toBe(mana);
  } finally { adventure.closeSave(); }
});
