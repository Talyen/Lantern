import type { CharacterSave } from './character';
import { buybackLimit, sellPrices, shopStock } from './economy';
import { isItemId } from './equipment';
import { receive, type LootItem } from './inventory';

type ShopState = Pick<CharacterSave, 'items' | 'gold' | 'buyback'>;

/** Prepare complete wallet/container changes; Adventure checks reach and commits once. */
export function purchase(state: ShopState, item: LootItem, newId: () => string): ShopState {
  const offer = shopStock.find(offer => offer.item === item);
  if (!offer) throw new Error('Item is not for sale.');
  if (state.gold < offer.price) throw new Error('Not enough gold.');

  const items = structuredClone(state.items);
  if (receive(items, item, 1, newId) !== 1) throw new Error('Inventory full.');
  return { items, gold: state.gold - offer.price, buyback: state.buyback };
}

export function sale(state: ShopState, id: string): ShopState {
  const entry = state.items.find(entry => entry.id === id);
  if (!entry || entry.slot !== 'bag' || !isItemId(entry.item))
    throw new Error('Select equipment from your bag.');

  const item = entry.item;
  const price = sellPrices[item];
  if (!Number.isSafeInteger(state.gold + price)) throw new Error('Gold wallet is full.');
  return {
    items: state.items.filter(entry => entry.id !== id),
    gold: state.gold + price,
    buyback: [{ id, item, price }, ...state.buyback].slice(0, buybackLimit),
  };
}

export function repurchase(state: ShopState, id: string, newId: () => string): ShopState {
  const entry = state.buyback.find(entry => entry.id === id);
  if (!entry) throw new Error('Item is no longer available.');
  if (state.gold < entry.price) throw new Error('Not enough gold.');

  const items = structuredClone(state.items);
  if (receive(items, entry.item, 1, newId, entry.id) !== 1) throw new Error('Inventory full.');
  return {
    items,
    gold: state.gold - entry.price,
    buyback: state.buyback.filter(other => other.id !== id),
  };
}
