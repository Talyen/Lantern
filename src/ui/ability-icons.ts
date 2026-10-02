import { abilities, type AbilityId } from '../gameplay/abilities';
import { itemIcon } from './item-icons';
export function abilityIcon(id: AbilityId): string {
  if (id==='sweep') return '<svg viewBox="0 0 48 48" aria-hidden="true"><path class="skill-metal" d="m15 34 17-23 6-3-1 7-19 22z"/><path d="m11 30 12 9M12 39l-4 4"/><path class="skill-accent" d="M7 22a19 19 0 0 1 34 0M37 18l4 4 2-6"/></svg>';
  if (id==='piercing-shot') return '<svg viewBox="0 0 48 48" aria-hidden="true"><path class="skill-accent" d="m7 40 29-29M26 11h10v10M6 32l9 2 2 9"/><path d="M15 12a12 12 0 0 1 21 20M12 15l21 21"/><path class="skill-metal" d="m33 6 10-1-1 10z"/></svg>';
  return itemIcon(abilities[id].family);
}
