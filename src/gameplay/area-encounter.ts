import { applyEquipment, createEncounter, type Encounter } from './encounter';
import type { CharacterSave } from './character';
import type { Spawn } from './area';
import type { AreaDefinition } from '../levels/types';

type AreaEntry = {
  previous?: Encounter;
  character: CharacterSave;
  arrival: Spawn & { height?: number };
  recover: boolean;
  /** Null means the first area entry; subsequent travel preserves current health. */
  health: number | null;
};

/** Restore authored enemies and carry player resources across a prepared area commit. */
export function enterAreaEncounter(encounter: Encounter, area: AreaDefinition, entry: AreaEntry): void {
  const { previous, character, arrival, recover, health } = entry;
  const resources = {
    weapon: encounter.weapon,
    shield: encounter.shield,
    playerMana: encounter.playerMana,
    abilityCooldowns: { ...encounter.abilityCooldowns },
    ultimateCooldown: encounter.ultimateCooldown,
    berserkingRemaining: recover ? 0 : encounter.berserkingRemaining,
    proficiency: { ...character.xp },
    potionCooldown: encounter.potionCooldown,
    healthRecoveryDelay: encounter.healthRecoveryDelay,
    dodgeCooldown: encounter.dodgeCooldown,
    weaponSets: encounter.weaponSets,
    activeSet: encounter.activeSet,
  };
  const next = createEncounter('playing', area.layout);
  if (previous && area.kind !== 'safe') {
    for (const id of next.enemyIds) {
      const authored = next.enemies[id];
      const saved = previous.enemies[id];
      if (authored.home && saved?.home) {
        next.enemies[id] = {
          ...saved,
          kind: authored.kind,
          interruption: authored.interruption,
          rig: authored.rig,
          loadout: authored.loadout,
          home: authored.home,
          lock: 0,
          attackTime: -1,
          contactIndex: 0,
        };
      }
    }

    next.phase = next.enemyIds.every(id => next.enemies[id].hp <= 0) ? 'won' : 'playing';
  }

  next.player.x = arrival.position[0];
  next.player.z = arrival.position[1];
  next.player.yaw = arrival.yaw;
  next.player.y = arrival.height ?? 0;
  Object.assign(encounter, next, resources);
  applyEquipment(encounter, character.items, character.activeSet);
  encounter.player.hp = recover || health === null ? encounter.stats.maxHealth : Math.min(health, encounter.stats.maxHealth);
  if (health === null) encounter.playerMana = encounter.stats.maxMana;
}
