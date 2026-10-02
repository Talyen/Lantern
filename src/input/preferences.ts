import { parseJson } from '../data/json';
import { defaultBindings, validBindings, type Bindings } from './binding-model';

export const bindingKey = 'lantern.bindings.v1';
const retryDelays = [1000, 2000, 5000, 15000, 30000];
type BindingStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Preferences apply immediately; one timer retries the latest snapshot after a storage failure. */
export class InputPreferences {
  value = defaultBindings();
  private error = '';
  private pending = false;
  private timer?: ReturnType<typeof setTimeout>;
  private failures = 0;

  constructor(private readonly source?: BindingStorage | (() => BindingStorage)) {
    if (!source) return;
    try {
      const raw = this.storage()!.getItem(bindingKey);
      if (!raw) return;
      const saved = parseJson(raw);
      if (!validBindings(saved)) throw new Error('Invalid bindings');
      this.value = saved;
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
    if (!this.timer) this.flush();
    return true;
  }

  private flush(closing = false): void {
    if (!this.pending) return;
    try {
      this.storage()?.setItem(bindingKey, JSON.stringify(this.value));
      this.pending = false;
      this.error = '';
      this.failures = 0;
    } catch (error) {
      this.error = String(error);
      if (!closing) {
        const delay = retryDelays[Math.min(this.failures++, retryDelays.length - 1)];
        this.timer = setTimeout(() => {
          this.timer = undefined;
          this.flush();
        }, delay);
        if (typeof this.timer === 'object') this.timer.unref();
      }
    }
  }

  close(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.flush(true);
  }

  diagnostics() { return { pending: this.pending, error: this.error }; }
}
