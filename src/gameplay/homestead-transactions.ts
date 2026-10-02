import type { CharacterSave } from './character';
import { countItem, validItems, validStash, type InventoryItem } from './inventory';
import { progression, shelterRecipe } from './skills';

type ShelterState = Pick<CharacterSave, 'items' | 'shelterRestored'>;
type Containers = Pick<CharacterSave, 'items' | 'stash'>;

/** Recipe progress is shared by the repair menu and the transaction eligibility check. */
export function shelterMaterials(items: readonly InventoryItem[]) {
  const carried = items.filter(entry => entry.slot === 'bag');
  return (Object.keys(shelterRecipe) as (keyof typeof shelterRecipe)[]).map(item => ({
    item,
    cost: shelterRecipe[item],
    held: countItem(carried, item),
  }));
}

export function canRepairShelter(state: ShelterState): boolean {
  return !state.shelterRestored && shelterMaterials(state.items).every(({ held, cost }) => held >= cost);
}

/** Consume the recipe on a candidate; area preparation must succeed before commit. */
export function restoredShelter(state: ShelterState): Pick<CharacterSave, 'items' | 'shelterRestored' | 'restedSeconds'> {
  if (!canRepairShelter(state)) throw new Error('Not enough materials.');
  const items = structuredClone(state.items);
  for (const [item, cost] of Object.entries(shelterRecipe)) {
    let remaining = cost;
    for (const entry of items.filter(entry => entry.slot === 'bag' && entry.item === item)) {
      const amount = Math.min(remaining, entry.quantity);
      entry.quantity -= amount;
      remaining -= amount;
    }
  }
  return {
    items: items.filter(entry => entry.quantity > 0),
    shelterRestored: true,
    restedSeconds: progression.restedSeconds,
  };
}

/** Validate both containers together, including identities shared across them. */
export function validatedContainers(items: InventoryItem[], stash: InventoryItem[]): Containers {
  if (!validItems(items) || !validStash(stash, items))
    throw new Error('Item does not fit.');
  return { items, stash };
}
