import { abilities, type AbilityId } from '../gameplay/abilities';
import { hudIcon } from './hud-art';
/** Shared painted ability art keeps HUD, assignment and binding views recognizable. */
export function abilityIcon(id: AbilityId): string {
  if (id === 'crushing-blow' || id === 'berserking') {
    const motif = id === 'crushing-blow' ? 'M24 3v19m-7-7 7 7 7-7M8 32l10-3 6 11 6-11 10 3' : 'M13 28c-6-11 3-14 5-23l5 12 8-12c1 12 12 16 4 27M16 37l8 7 8-7';
    return hudIcon('axe') + `<svg class="axe-ability-mark" viewBox="0 0 48 48" aria-hidden="true"><path d="${motif}"/></svg>`;
  }
  return hudIcon(id==='sweep' || id==='piercing-shot' ? id : abilities[id].family);
}
