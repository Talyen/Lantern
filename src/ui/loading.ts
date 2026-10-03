import { diagnosticExportButton } from '../diagnostics/report';
import './ui-tokens.css';
import './loading.css';

export type LoadingOperation = number;
type Recovery = { retry(): void; back(): void };

/** Presentation only: readiness and travel eligibility belong to the coordinator. */
class LoadingScreen {
  private operation = 1;
  private pending = true;
  private recoverySettled: (() => void) | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly root = document.getElementById('loading-screen')!;
  private readonly app = document.getElementById('app')!;
  private readonly title = document.getElementById('loading-title')!;
  private readonly status = document.getElementById('loading-status')!;
  private readonly actions = document.getElementById('loading-actions')!;
  private readonly reduced = matchMedia('(prefers-reduced-motion: reduce)');

  constructor() {
    const art = this.root.querySelector('img')!;
    art.addEventListener('error', () => { art.hidden = true; });
    if (art.complete && !art.naturalWidth) art.hidden = true;
  }

  get blocking(): boolean { return this.pending; }
  get current(): LoadingOperation { return this.operation; }

  begin(destination: string): LoadingOperation {
    this.recoverySettled?.();
    this.recoverySettled = undefined;
    const token = ++this.operation;
    clearTimeout(this.timer);
    this.pending = true;
    this.app.inert = true;
    this.root.hidden = false;
    this.root.dataset.state = 'waiting';
    delete this.root.dataset.revealing;
    this.actions.replaceChildren();
    this.title.textContent = destination;
    this.status.textContent = 'Loading';
    this.status.setAttribute('role', 'status');
    this.root.getBoundingClientRect();
    this.root.style.opacity = '1';
    this.timer = setTimeout(() => {
      if (token === this.operation) this.root.dataset.state = 'loading';
    }, 400);
    return token;
  }

  async ready(token: LoadingOperation): Promise<boolean> {
    if (token !== this.operation) return false;
    clearTimeout(this.timer);
    this.root.dataset.revealing = 'true';
    this.root.style.opacity = '0';
    if (!this.reduced.matches) await new Promise(resolve => setTimeout(resolve, 180));
    if (token !== this.operation) return false;
    this.root.hidden = true;
    this.app.inert = false;
    this.pending = false;
    return true;
  }

  dismiss(): void {
    this.recoverySettled?.();
    this.recoverySettled = undefined;
    ++this.operation;
    clearTimeout(this.timer);
    this.root.hidden = true;
    this.app.inert = false;
    this.pending = false;
  }

  recover(token: LoadingOperation, error: unknown): Promise<'retry' | 'back' | 'superseded'> {
    if (token !== this.operation) return Promise.resolve('superseded');
    return new Promise(resolve => {
      const settle = (choice: 'retry' | 'back' | 'superseded') => {
        this.recoverySettled = undefined;
        resolve(choice);
      };
      this.recoverySettled = () => settle('superseded');
      this.fail(token, error, { retry: () => settle('retry'), back: () => settle('back') });
    });
  }

  fail(token: LoadingOperation, error: unknown, recovery?: Recovery): void {
    if (token !== this.operation) return;
    clearTimeout(this.timer);
    this.root.hidden = false;
    this.root.style.opacity = '1';
    this.pending = true;
    this.app.inert = true;
    this.root.dataset.state = 'error';
    this.title.textContent = recovery ? 'Unable to travel' : 'Unable to load Lantern';
    const detail = String(error);
    this.status.textContent = /WebGPU|FSR|shader|graphics/i.test(detail)
      ? 'Graphics preparation failed. Use a browser with native WebGPU and hardware acceleration enabled, update your graphics driver, then reload.'
      : /character|art|model|404|fetch/i.test(detail)
        ? 'Required game art could not be loaded. Check that the game files are installed and accessible, then try again.'
        : recovery ? 'The destination could not be prepared. Try again or return to your current area.'
          : 'The game could not be prepared. Reload to try again. If it keeps failing, export a diagnostic report.';
    this.status.setAttribute('role', 'alert');
    this.actions.replaceChildren();
    const button = (name: string, action: () => void) => {
      const element = document.createElement('button');
      element.type = 'button'; element.textContent = name; element.onclick = action;
      this.actions.append(element);
      return element;
    };
    const first = recovery ? button('Retry', recovery.retry) : button('Reload', () => location.reload());
    if (recovery) button('Back', recovery.back);
    this.actions.append(diagnosticExportButton());
    first.focus();
  }
}
export const loadingScreen = new LoadingScreen();
