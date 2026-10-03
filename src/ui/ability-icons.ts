import { abilities, type AbilityId } from '../gameplay/abilities';
import { hudIcon } from './hud-art';
/** Shared painted ability art keeps HUD, assignment and binding views recognizable. */
export function abilityIcon(id: AbilityId): string {
  return hudIcon(id==='sweep' || id==='piercing-shot' ? id : abilities[id].family);
}
