import { lootDefinitions, type InventoryItem } from '../gameplay/inventory-catalog';
import { itemIcon } from './item-icons';

/** Shared item presentation; each menu owns selection, actions and availability. */
export function inventoryItemButton(entry: InventoryItem): HTMLButtonElement {
  const definition = lootDefinitions[entry.item];
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'bag-item';
  button.title = definition.name;
  button.setAttribute('aria-label', `${definition.name}${definition.stackable ? `, ${entry.quantity}` : ''}`);
  button.innerHTML = itemIcon(entry.item);
  if (definition.stackable) {
    const count = document.createElement('span');
    count.className = 'stack-count';
    count.textContent = String(entry.quantity);
    button.append(count);
  }
  return button;
}

export function placeInventoryItem(element: HTMLElement, entry: InventoryItem): void {
  const { width, height } = lootDefinitions[entry.item];
  element.style.gridColumn = `${entry.x + 1} / span ${width}`;
  element.style.gridRow = `${entry.y + 1} / span ${height}`;
}
