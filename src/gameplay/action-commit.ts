import { abilities } from './abilities';
import type { Encounter, EncounterEvent, PlayerAction } from './encounter-model';

export { cooldownForAbility as abilityCooldown } from './abilities';
/** A strike/release (or successful parry) commits exactly once, at its frame offset. */
export function commitAction(state: Encounter, action: PlayerAction, events: EncounterEvent[], offset = 0): void {
  if (action.committed) return;
  action.committed = true;
  const remaining = Math.max(0,(state.frameElapsed ?? 0)-offset);
  const manaAtContact = state.frameManaStart === undefined ? state.playerMana : Math.min(state.stats.maxMana,state.frameManaStart + offset * state.stats.manaRegen);
  state.playerMana = Math.min(state.stats.maxMana,manaAtContact - (action.mana ?? 0) + remaining * state.stats.manaRegen);
  if (action.ability) {
    const cooldown = Math.max(0,(action.cooldown ?? 0)-remaining);
    if (abilities[action.ability].tier === 'ultimate') state.ultimateCooldown = cooldown;
    else if (action.cooldown) state.abilityCooldowns[action.ability] = cooldown;
    events.push({type:'abilityCommitted',ability:action.ability,id:action.impactId!});
  }
}
