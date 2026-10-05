import { keyboardInput, inputFor, type InputAction, type InputPreferences } from '../input/bindings';

/** Physical inputs belong here; gameplay receives actions and held states, never key names. */
export function createInput(
  canvas: HTMLCanvasElement,
  preferences: InputPreferences,
  onAction: (action: InputAction) => void,
  onWorldClick: (x: number, y: number) => boolean,
  onClear: () => void = () => {},
) {
  const listeners = new AbortController();
  const { signal } = listeners;
  const down = new Set<string>();
  const menus = new Set<InputAction>(['inventory', 'skills', 'options']);
  let pointer: { x: number; y: number } | undefined;
  const menuOpen = () => !!document.querySelector('dialog[open]');

  function clearHeld(): void { down.clear(); pointer = undefined; }
  function clear(): void { clearHeld(); onClear(); }

  function trackPointer(event: PointerEvent): void {
    if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
    const rect = canvas.getBoundingClientRect();
    pointer = event.clientX >= rect.left && event.clientX < rect.right &&
      event.clientY >= rect.top && event.clientY < rect.bottom
      ? { x: event.clientX, y: event.clientY }
      : undefined;
  }

  canvas.addEventListener('pointermove', event => {
    if (!menuOpen()) trackPointer(event);
  }, { signal });
  canvas.addEventListener('pointerleave', () => { pointer = undefined; }, { signal });
  canvas.addEventListener('pointercancel', clear, { signal });
  // Camera distance belongs to Options; also prevent browser pinch/wheel zoom over play.
  canvas.addEventListener('wheel', event => event.preventDefault(), { passive: false, signal });
  canvas.addEventListener('contextmenu', event => event.preventDefault(), { signal });
  canvas.addEventListener('auxclick', event => event.preventDefault(), { signal });
  canvas.addEventListener('pointerdown', event => {
    if (menuOpen()) return;
    event.preventDefault();
    canvas.focus();
    trackPointer(event);
    // World selection always consumes a left click before its assigned combat action.
    if (event.button === 0 && onWorldClick(event.clientX, event.clientY)) return;
    const binding = `mouse:${event.button}`;
    down.add(binding);
    const action = inputFor(preferences.value, binding);
    if (action) onAction(action);
  }, { signal });

  window.addEventListener('pointerdown', event => {
    if (event.defaultPrevented || !menuOpen()) return;
    if (event.button === 0 && event.target instanceof Element &&
      event.target.closest('button,input,textarea,select,summary,a,[contenteditable=true]')) return;
    const binding = `mouse:${event.button}`, action = inputFor(preferences.value, binding);
    if (!action || !menus.has(action)) return;
    event.preventDefault();
    event.stopPropagation();
    onAction(action);
  }, { signal });

  window.addEventListener('pointerup', event => down.delete(`mouse:${event.button}`), { signal });
  window.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.target instanceof HTMLElement &&
      event.target.closest('input,textarea,[contenteditable=true]')) return;
    const binding = keyboardInput(event), action = inputFor(preferences.value, binding);
    if (!action) return;
    const control = event.target instanceof HTMLElement
      ? event.target.closest('select,button,summary,a') : null;
    // Remapped menu inputs must leave native control activation and selection intact.
    if (control && (control.matches('select') && event.key !== 'Escape'
      || ['Enter', ' '].includes(event.key))) return;
    if (menus.has(action)) {
      event.preventDefault();
      if (!event.repeat) onAction(action);
      return;
    }
    if (menuOpen()) return;
    if (event.target instanceof HTMLElement && event.target.closest('select,button,summary,a')) return;
    event.preventDefault();
    // Clearing or suppressing a held key requires a fresh press, not its next repeat.
    if (event.repeat && !down.has(binding)) return;
    down.add(binding);
    if (!event.repeat) onAction(action);
  }, { signal });
  window.addEventListener('keyup', event => down.delete(keyboardInput(event)), { signal });
  window.addEventListener('blur', clear, { signal });

  const held = (action: InputAction) =>
    preferences.value[action].some(binding => binding !== null && down.has(binding));
  return {
    clear, clearHeld,
    dispose: () => { listeners.abort(); clear(); },
    pointer: () => pointer,
    held,
    suppress: (action: InputAction) => preferences.value[action].forEach(binding => {
      if (binding) down.delete(binding);
    }),
    movement: () => {
      const forward = Number(held('moveUp')) - Number(held('moveDown'));
      const right = Number(held('moveRight')) - Number(held('moveLeft'));
      return { x: -forward + right, z: -forward - right };
    },
  };
}
