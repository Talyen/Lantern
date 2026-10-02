import './shop.css';
import { bindMenuDismissal } from './menu';
import { itemIcon } from './item-icons';
import { renderEquipmentDetails } from './equipment-details';
import { shopStock, sellPrices } from '../gameplay/economy';
import { equipmentCatalog, itemIds, type ItemId } from '../gameplay/equipment';
import { lootDefinitions, type InventoryItem, type LootItem } from '../gameplay/inventory';
import type { CharacterSave } from '../gameplay/character-save';

type Selection = { kind: 'stock'; item: LootItem } | { kind: 'bag' | 'buyback'; id: string };
type ShopContext = { buy(item: LootItem): void; sell(id: string): void; buyBack(id: string): void; clear(): void; focus(): void; sound(cue: 'menuOpen' | 'menuClose'): void };
/** Selection is presentation-only. Adventure revalidates and commits every trade. */
export class ShopMenu {
  private dialog = document.createElement('dialog');
  private character?: CharacterSave;
  private key = '';
  private tab: 'stock' | 'buyback' = 'stock';
  private selection: Selection = { kind: 'stock', item: 'potion' };
  private offers: HTMLElement;
  private bag: HTMLElement;
  private details: HTMLElement;
  private comparison: HTMLElement;
  private action: HTMLButtonElement;
  private error: HTMLElement;
  constructor(private context: ShopContext) {
    this.dialog.id = 'shop-dialog'; this.dialog.className = 'game-menu'; this.dialog.setAttribute('aria-labelledby', 'shop-title');
    this.dialog.innerHTML = `<header><h2 id="shop-title">Shop</h2><strong class="gold-wallet"></strong><button type="button" data-close>Close</button></header>
      <div class="shop-layout"><section class="shop-stock"><nav aria-label="Merchant stock"><button type="button" data-tab="stock">Stock</button><button type="button" data-tab="buyback" title="Keeps the last ten sold items">Buyback</button></nav><div class="shop-offers"></div></section>
      <section class="shop-player"><div class="bag-toolbar"><span>Bag</span></div><div class="shop-bag" aria-label="Bag"></div></section>
      <aside class="shop-details"><h3></h3><div class="shop-item-stats"></div><div class="shop-comparison"></div><strong class="shop-price"></strong><button type="button" class="shop-action">Buy</button><p class="shop-error" role="status"></p></aside></div>`;
    document.getElementById('app')!.append(this.dialog);
    this.offers = this.dialog.querySelector('.shop-offers')!; this.bag = this.dialog.querySelector('.shop-bag')!;
    this.details = this.dialog.querySelector('.shop-item-stats')!; this.comparison = this.dialog.querySelector('.shop-comparison')!;
    this.action = this.dialog.querySelector('.shop-action')!; this.error = this.dialog.querySelector('.shop-error')!;
    this.dialog.querySelector<HTMLButtonElement>('[data-close]')!.onclick = () => this.close();
    bindMenuDismissal(this.dialog, () => this.close());
    this.dialog.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(button => { button.onclick = () => {
      this.tab = button.dataset.tab === 'buyback' ? 'buyback' : 'stock';
      this.selection = this.tab === 'stock' ? { kind: 'stock', item: 'potion' } : { kind: 'buyback', id: this.character?.buyback[0]?.id ?? '' };
      this.refresh();
    }; });
    this.action.onclick = () => {
      try {
        if (this.selection.kind === 'stock') this.context.buy(this.selection.item);
        else if (this.selection.kind === 'bag') this.context.sell(this.selection.id);
        else this.context.buyBack(this.selection.id);
        this.refresh();
      } catch (error) { this.error.textContent = error instanceof Error ? error.message : String(error); }
    };
  }
  get paused(): boolean { return this.dialog.open; }
  open(): void { this.context.clear(); this.tab = 'stock'; this.selection = { kind: 'stock', item: 'potion' }; this.refresh(); this.dialog.showModal(); this.context.sound('menuOpen'); }
  close(): void { if (!this.paused) return; this.dialog.close(); this.context.clear(); this.context.focus(); this.context.sound('menuClose'); }
  update(character: CharacterSave): void {
    this.character = character;
    if (!this.paused) return;
    const key = JSON.stringify([character.gold, character.items, character.buyback, character.activeSet]);
    if (key !== this.key) this.refresh();
  }
  private select(selection: Selection): void { this.selection = selection; this.refreshSelection(); }
  private offer(item: LootItem, price: number, selection: Selection): HTMLButtonElement {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'shop-offer';
    const icon = document.createElement('span'); icon.innerHTML = itemIcon(item);
    const name = document.createElement('span'); name.textContent = lootDefinitions[item].name;
    const amount = document.createElement('strong'); amount.textContent = `${price} Gold`;
    button.append(icon, name, amount); button.onclick = () => this.select(selection);
    button.dataset.selection = JSON.stringify(selection); return button;
  }
  private refresh(): void {
    const character = this.character; if (!character) return;
    this.key = JSON.stringify([character.gold, character.items, character.buyback, character.activeSet]);
    this.dialog.querySelector('.gold-wallet')!.textContent = `${character.gold} Gold`;
    this.dialog.querySelectorAll<HTMLElement>('[data-tab]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.tab === this.tab)));
    this.offers.replaceChildren();
    if (this.tab === 'stock') for (const offer of shopStock) this.offers.append(this.offer(offer.item, offer.price, { kind: 'stock', item: offer.item }));
    else for (const entry of character.buyback) this.offers.append(this.offer(entry.item, entry.price, { kind: 'buyback', id: entry.id }));
    if (this.tab === 'buyback' && !character.buyback.length) { const empty = document.createElement('p'); empty.className = 'shop-empty'; empty.textContent = 'No sold items'; this.offers.append(empty); }
    this.bag.replaceChildren();
    for (const entry of character.items.filter(entry => entry.slot === 'bag')) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'bag-item';
      const definition = lootDefinitions[entry.item]; button.innerHTML = itemIcon(entry.item);
      button.setAttribute('aria-label', `${definition.name}${definition.stackable ? `, ${entry.quantity}` : ''}`); button.title = definition.name;
      if (definition.stackable) { const count = document.createElement('span'); count.className = 'stack-count'; count.textContent = String(entry.quantity); button.append(count); }
      Object.assign(button.style, { gridColumn: `${entry.x + 1} / span ${definition.width}`, gridRow: `${entry.y + 1} / span ${definition.height}` });
      button.dataset.selection = JSON.stringify({ kind: 'bag', id: entry.id }); button.onclick = () => this.select({ kind: 'bag', id: entry.id }); this.bag.append(button);
    }
    this.refreshSelection();
  }
  private refreshSelection(): void {
    const character = this.character; if (!character) return;
    this.error.textContent = ''; this.details.replaceChildren(); this.comparison.replaceChildren();
    let entry: InventoryItem | undefined, price: number | undefined;
    const selection = this.selection;
    if (selection.kind === 'stock') {
      const offer = shopStock.find(offer => offer.item === selection.item);
      if (offer) { entry = { id: `offer-${offer.item}`, item: offer.item, quantity: 1, slot: 'bag', x: 0, y: 0 }; price = offer.price; }
    } else if (selection.kind === 'buyback') {
      const sold = character.buyback.find(entry => entry.id === selection.id);
      if (sold) { entry = { ...sold, quantity: 1, slot: 'bag', x: 0, y: 0 }; price = sold.price; }
    } else {
      entry = character.items.find(entry => entry.id === selection.id && entry.slot === 'bag');
      if (entry && itemIds.includes(entry.item as ItemId)) price = sellPrices[entry.item as ItemId];
    }
    this.dialog.querySelector('h3')!.textContent = entry ? lootDefinitions[entry.item].name : '';
    if (entry && itemIds.includes(entry.item as ItemId)) {
      const slot = equipmentCatalog[entry.item as ItemId].slot;
      renderEquipmentDetails(this.details, this.comparison, entry, character, character.activeSet,
        slot === 'ring' ? character.items.some(item => item.slot === 'ring-left') && !character.items.some(item => item.slot === 'ring-right') ? 'ring-right' : 'ring-left' : slot);
    } else if (entry?.item === 'potion') this.details.textContent = 'Restore 40 Health';
    this.action.textContent = selection.kind === 'bag' ? 'Sell' : selection.kind === 'buyback' ? 'Buy Back' : 'Buy';
    this.action.hidden = price === undefined;
    this.action.disabled = price === undefined || selection.kind !== 'bag' && character.gold < price;
    this.action.title = this.action.disabled && price !== undefined ? 'Not enough gold' : '';
    this.dialog.querySelector('.shop-price')!.textContent = price === undefined ? '' : `${price} Gold`;
    const selected = JSON.stringify(selection);
    this.dialog.querySelectorAll<HTMLElement>('[data-selection]').forEach(button => { const active = button.dataset.selection === selected; button.classList.toggle('selected', active); button.setAttribute('aria-pressed', String(active)); });
  }
  dispose(): void { this.dialog.remove(); }
}
