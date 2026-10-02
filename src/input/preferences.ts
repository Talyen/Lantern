import { RetryTimer } from '../data/retry';
import { parseJson } from '../data/json';
import { defaultBindings, inputActions, validBindings, type Bindings } from './binding-model';

export const bindingKey = 'lantern.bindings.v1';
type BindingStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Preferences apply immediately; one timer retries the latest snapshot after a storage failure. */
export class InputPreferences {
  value = defaultBindings();
  private error = '';
  private pending = false;
  private readonly retry = new RetryTimer();

  constructor(private readonly source?: BindingStorage | (() => BindingStorage)) {
    if (!source) return;
    try {
      const raw = this.storage()!.getItem(bindingKey);
      if (!raw) return;
      const saved = parseJson(raw);
      if (!validBindings(saved)) throw new Error('Invalid bindings');
      // Project onto current actions so retired zoom bindings never return at runtime.
      this.value = Object.fromEntries(inputActions.map(action => [action, saved[action]])) as Bindings;
    } catch (error) {
      this.error = String(error);
    }
  }

  private storage(): BindingStorage | undefined {
    return typeof this.source === 'function' ? this.source() : this.source;
  }

  save(value: Bindings): boolean {
    if (!validBindings(value)) return false;
    this.value = structuredClone(value);
    this.pending = true;
    if (!this.retry.scheduled) this.flush();
    return true;
  }

  private flush(closing = false): void {
    if (!this.pending) return;
    try {
      this.storage()?.setItem(bindingKey, JSON.stringify(this.value));
      this.pending = false;
      this.error = '';
      this.retry.reset();
    } catch (error) {
      this.error = String(error);
      if (!closing) {
        this.retry.schedule(() => this.flush());
      }
    }
  }

  close(): void {
    this.retry.cancel();
    this.flush(true);
  }

  diagnostics() { return { pending: this.pending, error: this.error }; }
}
