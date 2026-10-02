import type { CharacterSave } from './character-save';
import { countItem, validItems, type InventoryItem, type LootItem } from './inventory';
import { progression, shelterRecipe } from './skills';

type ShelterState = Pick<CharacterSave, 'items' | 'shelterRestored'>;
type Containers = Pick<CharacterSave, 'items' | 'stash'>;

export function canRepairShelter(state: ShelterState): boolean {
  const carried = state.items.filter(entry => entry.slot === 'bag');
  return !state.shelterRestored && Object.entries(shelterRecipe).every(
    ([item, cost]) => countItem(carried, item as LootItem) >= cost,
  );
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
  if (!validItems(items) || !validItems(stash) || stash.some(entry => entry.slot !== 'bag')
    || new Set([...items, ...stash].map(entry => entry.id)).size !== items.length + stash.length)
    throw new Error('Item does not fit.');
  return { items, stash };
}
