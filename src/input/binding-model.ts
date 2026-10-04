import { isRecord } from '../data/json';

export const actionSlotInputs = ['slot0', 'slot1', 'slot2', 'slot3', 'slot4', 'slot5'] as const;
export type BindingPair = [string | null, string | null];
type ActionDefinition = { name: string; group: 'Action Bar' | 'Movement' | 'Combat & Utility' | 'Menus'; bindings: BindingPair };

// Declaration order is the action dispatch and Keybindings display order.
const definitions = {
  slot0: { name: 'Slot 1', group: 'Action Bar', bindings: ['key:KeyQ', null] },
  slot1: { name: 'Slot 2', group: 'Action Bar', bindings: ['key:KeyE', null] },
  slot2: { name: 'Slot 3', group: 'Action Bar', bindings: ['key:KeyR', null] },
  slot3: { name: 'Slot 4', group: 'Action Bar', bindings: ['key:KeyG', null] },
  slot4: { name: 'Slot 5', group: 'Action Bar', bindings: ['mouse:0', null] },
  slot5: { name: 'Slot 6', group: 'Action Bar', bindings: ['mouse:2', null] },
  moveUp: { name: 'Move forward', group: 'Movement', bindings: ['key:KeyW', 'key:ArrowUp'] },
  moveDown: { name: 'Move backward', group: 'Movement', bindings: ['key:KeyS', 'key:ArrowDown'] },
  moveLeft: { name: 'Move left', group: 'Movement', bindings: ['key:KeyA', 'key:ArrowLeft'] },
  moveRight: { name: 'Move right', group: 'Movement', bindings: ['key:KeyD', 'key:ArrowRight'] },
  dodge: { name: 'Dodge', group: 'Combat & Utility', bindings: ['key:ShiftLeft', 'key:ShiftRight'] },
  swap: { name: 'Swap weapons', group: 'Combat & Utility', bindings: ['key:Tab', null] },
  potion: { name: 'Use Health Potion', group: 'Combat & Utility', bindings: ['key:KeyF', null] },
  portal: { name: 'Use Scroll of Return', group: 'Combat & Utility', bindings: ['key:KeyT', null] },
  inventory: { name: 'Inventory', group: 'Menus', bindings: ['key:KeyB', null] },
  skills: { name: 'Skills', group: 'Menus', bindings: ['key:KeyK', null] },
  options: { name: 'Options', group: 'Menus', bindings: ['key:Escape', null] },
} satisfies Record<string, ActionDefinition>;

export type InputAction = keyof typeof definitions;
export type Bindings = Record<InputAction, BindingPair>;
// Object.keys/fromEntries erase literal keys; restore them only for this owned table.
export const inputActions: readonly InputAction[] = Object.keys(definitions) as InputAction[];
export const actionNames = Object.fromEntries(inputActions.map(action => [action, definitions[action].name])) as Record<InputAction, string>;
export const inputGroups = [...new Set(inputActions.map(action => definitions[action].group))].map(name => ({
  name, actions: inputActions.filter(action => definitions[action].group === name),
}));

export function defaultBindings(): Bindings {
  return Object.fromEntries(inputActions.map(action => [action, [...definitions[action].bindings]])) as Bindings;
}
/** Current actions only, with independent pairs for drafts and persisted snapshots. */
export function copyBindings(value: Bindings): Bindings {
  return Object.fromEntries(inputActions.map(action => [action, [...value[action]]])) as Bindings;
}

export function isMovementAction(action: InputAction): boolean {
  return definitions[action].group === 'Movement';
}

export function validBinding(value: unknown): value is string | null {
  return value === null || typeof value === 'string' && /^(key:(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|F([1-9]|1[0-9]|2[0-4])|Shift(Left|Right)|Control(Left|Right)|Alt(Left|Right)|Meta(Left|Right)|Space|Tab|Escape|Enter|Numpad\w+|Backspace|Delete|Insert|Home|End|PageUp|PageDown|CapsLock|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash)|mouse:[0-4])$/.test(value);
}
export function validBindings(value: unknown): value is Bindings {
  if (!isRecord(value)) return false;
  const inputs = new Set<string>();
  for (const action of inputActions) {
    const pair = value[action];
    if (!Array.isArray(pair) || pair.length !== 2) return false;
    if (isMovementAction(action) && !pair.some(Boolean)) return false;
    for (const binding of pair as unknown[]) {
      if (!validBinding(binding)) return false;
      if (binding === null) continue;
      if (inputs.has(binding)) return false;
      inputs.add(binding);
    }
  }
  return true;
}

export function bindingLabel(binding: string | null): string {
  if (!binding) return '—';
  if (binding.startsWith('mouse:')) return ['LMB', 'MMB', 'RMB', 'Mouse 4', 'Mouse 5'][Number(binding.slice(6))];
  const code = binding.slice(4);
  return code
    .replace(/^Key|^Digit/, '')
    .replace(/^Arrow(Up|Down|Left|Right)$/, (_, direction: string) => '↑↓←→'[['Up', 'Down', 'Left', 'Right'].indexOf(direction)])
    .replace(/(Shift|Control|Alt|Meta)(Left|Right)/, (_, key: string, side: string) =>
      `${side === 'Left' ? 'L' : 'R'} ${key === 'Control' ? 'Ctrl' : key}`)
    .replace('Numpad', 'Num ');
}

export function inputFor(bindings: Bindings, binding: string): InputAction | undefined {
  return inputActions.find(action => bindings[action].includes(binding));
}

export function bindingConflict(
  bindings: Bindings, binding: string, action: InputAction, index: number,
): { action: InputAction; index: number } | undefined {
  for (const other of inputActions) {
    for (const [i, value] of bindings[other].entries()) {
      if (value === binding && (other !== action || i !== index)) return { action: other, index: i };
    }
  }
}
