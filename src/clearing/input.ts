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

  function clear(): void {
    down.clear();
    pointer = undefined;
    onClear();
  }

  function trackPointer(event: PointerEvent): void {
    if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
    const rect = canvas.getBoundingClientRect();
    pointer = event.clientX >= rect.left && event.clientX < rect.right &&
      event.clientY >= rect.top && event.clientY < rect.bottom
      ? { x: event.clientX, y: event.clientY }
      : undefined;
  }

  function dispatch(binding: string, repeat = false): void {
    const action = inputFor(preferences.value, binding);
    if (action && (!repeat || action === 'zoomIn' || action === 'zoomOut')) onAction(action);
  }

  canvas.addEventListener('pointermove', event => {
    if (!menuOpen()) trackPointer(event);
  }, { signal });
  canvas.addEventListener('pointerleave', () => { pointer = undefined; }, { signal });
  canvas.addEventListener('pointercancel', clear, { signal });
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
    dispatch(binding);
  }, { signal });

  window.addEventListener('pointerup', event => down.delete(`mouse:${event.button}`), { signal });
  window.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.target instanceof HTMLElement &&
      event.target.closest('input,textarea,[contenteditable=true]')) return;
    const binding = keyboardInput(event), action = inputFor(preferences.value, binding);
    if (!action) return;
    if (menus.has(action)) {
      event.preventDefault();
      if (!event.repeat) onAction(action);
      return;
    }
    if (menuOpen()) return;
    if (event.target instanceof HTMLElement && event.target.closest('select,button,summary,a')) return;
    event.preventDefault();
    down.add(binding);
    dispatch(binding, event.repeat);
  }, { signal });
  window.addEventListener('keyup', event => down.delete(keyboardInput(event)), { signal });
  window.addEventListener('blur', clear, { signal });
  canvas.addEventListener('wheel', event => {
    if (menuOpen() || event.deltaY === 0) return;
    event.preventDefault();
    dispatch(event.deltaY < 0 ? 'wheel:up' : 'wheel:down');
  }, { passive: false, signal });

  const held = (action: InputAction) =>
    preferences.value[action].some(binding => binding !== null && down.has(binding));
  return {
    clear,
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
