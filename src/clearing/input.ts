export function createInput(canvas: HTMLCanvasElement, onAttack: (x: number, y: number) => void, onDodge: () => void,
  onInteract: () => void, onInventory: () => void, onOptions: () => void, onClear: () => void = () => {}) {
  const keys = new Set<string>();
  let blocking = false;
  let pointer: { x: number; y: number } | undefined;
  const clear = () => { keys.clear(); pointer = undefined; blocking = false; onClear(); };
  const trackPointer = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
    // OrbitControls can capture a pressed pointer, delaying pointerleave until release.
    const rect = canvas.getBoundingClientRect();
    pointer = event.clientX >= rect.left && event.clientX < rect.right && event.clientY >= rect.top && event.clientY < rect.bottom
      ? { x: event.clientX, y: event.clientY } : undefined;
  };
  canvas.addEventListener('pointermove', event => {
    if (!document.querySelector('dialog[open]')) trackPointer(event);
  });
  canvas.addEventListener('pointerleave', () => { pointer = undefined; });
  canvas.addEventListener('pointercancel', () => { pointer = undefined; blocking = false; });
  canvas.addEventListener('contextmenu', event => event.preventDefault());
  window.addEventListener('pointerup', event => { if (event.button === 2) blocking = false; });
  window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (event.target instanceof HTMLElement && event.target.closest('input[type="text"], textarea, [contenteditable="true"]')) return;
    if (key === 'b' || key === 'escape') {
      event.preventDefault();
      if (!event.repeat) (key === 'b' ? onInventory : onOptions)();
      return;
    }
    if (document.querySelector('dialog[open]')) return;
    if (event.target instanceof HTMLElement && event.target.closest('select, input, button, summary, a')) return;
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowleft', 'arrowdown', 'arrowright', 'shift'].includes(key)) event.preventDefault();
    keys.add(key);
    if (!event.repeat && key === 'e') { event.preventDefault(); onInteract(); }
    if (!event.repeat && key === 'shift') onDodge();
  });
  canvas.addEventListener('pointerdown', event => {
    if (document.querySelector('dialog[open]')) return;
    if (event.button === 2) { event.preventDefault(); canvas.focus(); trackPointer(event); blocking = true; return; }
    if (event.button !== 0) return;
    event.preventDefault(); canvas.focus(); trackPointer(event); onAttack(event.clientX, event.clientY);
  });
  window.addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));
  window.addEventListener('blur', clear);
  return {
    clear,
    pointer: () => pointer,
    blocking: () => blocking,
    interacting: () => keys.has('e'),
    movement: () => {
      const forward = Number(keys.has('w') || keys.has('arrowup')) - Number(keys.has('s') || keys.has('arrowdown'));
      const right = Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft'));
      return { x: -forward + right, z: -forward - right };
    },
  };
}
