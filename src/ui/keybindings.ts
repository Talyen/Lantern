import {
  isMovementAction, keyboardInput, actionSlotInputs, actionNames,
  bindingConflict, bindingLabel, defaultBindings, inputActions, inputGroups,
  validBinding, validBindings, type Bindings, type InputAction, type InputPreferences,
} from '../input/bindings';
import { abilities, type ActionBar } from '../gameplay/abilities';
import { abilityIcon } from './ability-icons';
import { bindMenuDismissal } from './menu';
type Cell = {
  action: InputAction;
  index: number;
};
export class KeybindingsMenu {
  private dialog = document.createElement('dialog');
  private draft: Bindings = defaultBindings();
  private editing: { kind: 'capture'; cell: Cell } | { kind: 'conflict'; cell: Cell; other: Cell; binding: string } | null = null;
  private capturedClick: AbortController | null = null;
  private get capture(): Cell | null { return this.editing?.kind === 'capture' ? this.editing.cell : null; }
  private get conflict() { return this.editing?.kind === 'conflict' ? this.editing : null; }
  private content = document.createElement('div');
  private status = document.createElement('div');
  private apply = document.createElement('button');
  constructor(private preferences: InputPreferences, private bar: () => ActionBar, private clear: () => void, private focus: () => void, mount = document.getElementById('app')!) {
    this.dialog.id = 'keybindings-dialog';
    this.dialog.className = 'combat-menu';
    this.dialog.setAttribute('aria-labelledby', 'keybindings-title');
    this.dialog.innerHTML = '<header><h2 id="keybindings-title">Keybindings</h2><button type="button" data-close>Close</button></header><div class="binding-columns"><span>Action</span><span>Primary</span><span>Secondary</span></div>';
    this.content.className = 'bindings-content';
    this.status.className = 'bindings-status';
    this.status.setAttribute('role', 'status');
    const footer = document.createElement('footer'), reset = document.createElement('button'), cancel = document.createElement('button');
    reset.dataset.captureControl = 'true';
    cancel.dataset.captureControl = 'true';
    this.dialog.querySelector<HTMLButtonElement>('[data-close]')!.dataset.captureControl = 'true';
    reset.textContent = 'Restore defaults';
    reset.onclick = () => {
      this.editing = null;
      this.draft = defaultBindings();
      this.render();
    };
    cancel.textContent = 'Cancel';
    cancel.onclick = () => this.close();
    this.apply.textContent = 'Apply';
    this.apply.onclick = () => this.save();
    footer.append(reset, cancel, this.apply);
    this.dialog.append(this.content, this.status, footer);
    mount.append(this.dialog);
    this.dialog.querySelector<HTMLButtonElement>('[data-close]')!.onclick = () => this.close();
    bindMenuDismissal(this.dialog, () => this.close());
    window.addEventListener('keydown', event => {
      this.capturedClick?.abort();
      if (!this.dialog.open || !this.capture) return;
      if (event.target instanceof Element && event.target.closest('[data-capture-control]') && ['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === 'Escape') {
        this.editing = null;
        this.render();
        return;
      }
      if (!event.repeat)
        this.choose(keyboardInput(event));
    }, true);
    window.addEventListener('pointerdown', event => {
      this.capturedClick?.abort();
      if (!this.dialog.open || !this.capture || (event.target as Element).closest('[data-capture-control]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.choose(`mouse:${event.button}`);
      // Consume the matching click too: it must not open another binding cell.
      if (event.button === 0) {
        this.capturedClick = new AbortController();
        window.addEventListener('click', click => { click.preventDefault(); click.stopImmediatePropagation(); },
          { capture: true, once: true, signal: this.capturedClick.signal });
      }
    }, true);
    this.dialog.addEventListener('auxclick', event => event.preventDefault());
    this.dialog.addEventListener('contextmenu', event => event.preventDefault());
    window.addEventListener('pointercancel', () => this.capturedClick?.abort());
    window.addEventListener('blur', () => {
      this.capturedClick?.abort();
      if (this.capture) {
        this.editing = null;
        this.render();
      }
    });
  }
  get paused(): boolean { return this.dialog.open; }

  open(): void {
    this.clear();
    this.draft = structuredClone(this.preferences.value);
    this.editing = null;
    this.render();
    this.dialog.showModal();
  }

  close(): void {
    this.capturedClick?.abort();
    this.editing = null;
    this.dialog.close();
    this.clear();
    this.focus();
  }

  private choose(binding: string): void {
    const cell = this.capture;
    if (!cell) return;
    if (!validBinding(binding)) {
      this.status.textContent = 'This input is unavailable.';
      return;
    }
    const other = bindingConflict(this.draft, binding, cell.action, cell.index);
    this.editing = null;
    if (other)
      this.editing = { kind: 'conflict', cell, other, binding };
    else
      this.draft[cell.action][cell.index] = binding;
    this.render();
  }

  private resolveConflict(swap: boolean): void {
    const conflict = this.conflict;
    if (!conflict) return;
    this.draft[conflict.other.action][conflict.other.index] = swap ? this.draft[conflict.cell.action][conflict.cell.index] : null;
    this.draft[conflict.cell.action][conflict.cell.index] = conflict.binding;
    this.editing = null;
    this.render();
    this.content.querySelector<HTMLButtonElement>(`[data-binding-focus="${conflict.cell.action}/${conflict.cell.index}"]`)?.focus();
  }

  private render(): void {
    const focused = document.activeElement instanceof HTMLElement && this.dialog.contains(document.activeElement)
      ? document.activeElement.dataset.bindingFocus : undefined;
    this.content.replaceChildren();
    this.status.replaceChildren();
    const bar = this.bar();
    for (const group of inputGroups) {
      const section = document.createElement('section'), title = document.createElement('h3');
      title.textContent = group.name;
      section.append(title);
      for (const action of group.actions) {
        const row = document.createElement('div');
        row.className = 'binding-row';
        const label = document.createElement('span');
        label.className = 'binding-action';
        const slot = actionSlotInputs.findIndex(input => input === action), id = slot >= 0 ? bar[slot] : null;
        if (id) {
          const icon = document.createElement('span');
          icon.className = 'binding-icon';
          icon.innerHTML = abilityIcon(id);
          label.append(icon);
        }
        const text = document.createElement('span');
        text.textContent = actionNames[action];
        label.append(text);
        if (slot >= 0) {
          const ability = document.createElement('small');
          ability.textContent = id ? abilities[id].name : 'Empty';
          text.append(ability);
        }
        row.append(label);
        for (const [index, binding] of this.draft[action].entries()) {
          const cell = document.createElement('span');
          cell.className = 'binding-cell';
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.bindingFocus = `${action}/${index}`;
          button.textContent = this.capture?.action === action && this.capture.index === index ? 'Press an input…' : bindingLabel(binding);
          button.setAttribute('aria-label', `${actionNames[action]}, ${index === 0 ? 'Primary' : 'Secondary'}: ${bindingLabel(binding)}`);
          button.classList.toggle('capturing', this.capture?.action === action && this.capture.index === index);
          button.onclick = () => { this.editing = { kind: 'capture', cell: { action, index } }; this.render(); };
          const clear = document.createElement('button');
          clear.type = 'button';
          clear.dataset.bindingFocus = `${action}/${index}/clear`;
          clear.dataset.captureControl = 'true';
          clear.textContent = '×';
          clear.className = 'clear-binding';
          clear.setAttribute('aria-label', `Clear ${actionNames[action]} ${index === 0 ? 'Primary' : 'Secondary'}`);
          clear.disabled = !binding;
          clear.onclick = () => { this.draft[action][index] = null; this.editing = null; this.render(); this.content.querySelector<HTMLButtonElement>(`[data-binding-focus="${action}/${index}"]`)?.focus(); };
          cell.append(button, clear);
          row.append(cell);
        }
        section.append(row);
      }
      this.content.append(section);
    }
    const missing = inputActions.filter(action => isMovementAction(action) && !this.draft[action].some(Boolean));
    this.apply.disabled = !validBindings(this.draft) || !!this.capture || !!this.conflict;
    if (this.capture) {
      this.status.textContent = 'Press a key or mouse button. Escape cancels.';
      this.statusAction('Use Escape', () => this.choose('key:Escape'));
      this.statusAction('Cancel', () => { this.editing = null; this.render(); });
    } else if (this.conflict) {
      this.status.textContent = `${bindingLabel(this.conflict.binding)} is assigned to ${actionNames[this.conflict.other.action]}.`;
      this.statusAction('Swap', () => this.resolveConflict(true));
      this.statusAction('Replace', () => this.resolveConflict(false));
      this.statusAction('Cancel', () => { const cell = this.conflict!.cell; this.editing = null; this.render(); this.content.querySelector<HTMLButtonElement>(`[data-binding-focus="${cell.action}/${cell.index}"]`)?.focus(); });
    } else if (missing.length)
      this.status.textContent = `Bind ${missing.map(action => actionNames[action].toLowerCase()).join(', ')} before applying.`;
    else
      this.status.textContent = '';
    if (this.conflict) this.status.querySelector<HTMLButtonElement>('button')?.focus();
    else if (focused) this.dialog.querySelector<HTMLButtonElement>(`[data-binding-focus="${CSS.escape(focused)}"]`)?.focus();
  }

  private statusAction(name: string, callback: () => void): void {
    const button = document.createElement('button');
    button.textContent = name; button.dataset.captureControl = 'true'; button.onclick = callback;
    this.status.append(button);
  }

  private save(): void {
    if (this.apply.disabled) return;
    this.clear();
    if (this.preferences.save(this.draft)) this.close();
    else this.render();
  }
}
