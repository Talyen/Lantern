import { abilities, type AbilityId } from '../gameplay/abilities';
import { hudIcon } from './hud-art';
export const abilityMotifs: Partial<Record<AbilityId,string>>={
  thrust:'M8 36 37 7 M24 7h13v13 M9 29l10 10',
  riposte:'M10 10a19 19 0 0 1 29 15 M39 25l-9-5 M39 25l4-9 M12 38 29 21 M7 32l11 11',
  executioner:'M24 5v31 M18 28l6 8 6-8 M8 42l9-5 M40 42l-9-5',
  onslaught:'M7 11 38 37 M7 24l28 17 M13 5l29 24',
  'poison-arrow':'M10 40 34 8 M28 8h8v8 M20 27c-6 8-7 10-7 13a7 7 0 0 0 14 0c0-3-1-5-7-13Z',
  multishot:'M24 40V6 M20 12l4-6 4 6 M18 35 7 12 M7 12l-1 8 M7 12l8 2 M30 35l11-23 M41 12l1 8 M41 12l-8 2',
  'arrow-rain':'M12 5v25 M8 24l4 6 4-6 M25 10v25 M21 29l4 6 4-6 M38 5v25 M34 24l4 6 4-6 M7 42h34',
  deadeye:'M24 4v8 M24 36v8 M4 24h8 M36 24h8 M24 15a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M18 30 31 17',
};
/** Distinct technique marks extend the existing painted weapon art in every UI context. */
export function abilityIcon(id:AbilityId): string {
  if (id === 'crushing-blow' || id === 'berserking') {
    const motif = id === 'crushing-blow' ? 'M24 3v19m-7-7 7 7 7-7M8 32l10-3 6 11 6-11 10 3' : 'M13 28c-6-11 3-14 5-23l5 12 8-12c1 12 12 16 4 27M16 37l8 7 8-7';
    return hudIcon('axe') + `<svg class="axe-ability-mark" viewBox="0 0 48 48" aria-hidden="true"><path d="${motif}"/></svg>`;
  }
  const base=hudIcon(id==='sweep' || id==='piercing-shot' ? id : abilities[id].family);
  const motif=abilityMotifs[id];
  return motif ? '<span class="ability-art ability-art--'+id+'">'+base+'<svg class="ability-mark" viewBox="0 0 48 48" aria-hidden="true"><path d="'+motif+'"/></svg></span>' : base;
}
