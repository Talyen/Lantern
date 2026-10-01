/** Dismiss only a click that starts and ends outside the panel; never forward it to play. */
export function bindMenuDismissal(dialog: HTMLDialogElement, close: () => void): void {
  const outside = (event: MouseEvent) => {
    const rect = dialog.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
  };
  let beganOutside = false;
  dialog.addEventListener('pointerdown', event => { beganOutside = event.target === dialog && outside(event); });
  dialog.addEventListener('click', event => {
    if (!beganOutside || event.target !== dialog || !outside(event)) return;
    beganOutside = false; event.preventDefault(); event.stopPropagation(); close();
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
}
