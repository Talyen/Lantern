/** Frame-driven UI keeps existing nodes and only mutates values that changed. */
export function setText(element: Element, value: string): void {
  if (element.textContent !== value) element.textContent = value;
}
export function setAttribute(element: Element, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}
export function setDisabled(button: HTMLButtonElement, value: boolean): void {
  if (button.disabled !== value) button.disabled = value;
}
