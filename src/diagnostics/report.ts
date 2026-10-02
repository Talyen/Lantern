/** Reporting is local and deliberately never consumes character/save snapshots. */
export type RuntimeSnapshot = {
  area?: string; ready?: boolean; backend?: string; missing?: string[]; errors?: string[];
  settings?: Record<string, string | number | boolean>;
  graphics?: { ready: boolean; method: string; sceneWidth: number; sceneHeight: number; outputWidth: number; outputHeight: number };
  audio?: { state: string; loaded: number; loading: number; voices: number; errors: string[] };
  persistence?: { pending: boolean; loaded: boolean; failures: number; blockedByExisting: boolean; error: string };
};
type Failure = { at: string; kind: string; message: string };
type Report = { schemaVersion: 1; createdAt: string; build: typeof __LANTERN_BUILD__; runtime: { platform: string; userAgent: string; webgpuAvailable: boolean }; state: RuntimeSnapshot; failures: Failure[] };
type DesktopReporting = {
  runtime: { electron: string; chromium: string; node: string; platform: string; arch: string };
  update(report: string): void;
  export(report: string): Promise<boolean>;
};
declare global { interface Window { lanternReporting?: DesktopReporting } }
const failures: Failure[] = [];
let snapshot: () => RuntimeSnapshot = () => ({ ready: false });
let installed = false;

export function cleanMessage(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value);
  return message
    .replace(/(?:https?|file):\/\/[^\s)"'<>]+/gi, '[url]')
    .replace(/(?:[A-Z]:[\\/]Users[\\/]|\/(?:Users|home)\/)[^\r\n\/\\]+[\\/][^\s)"'<>]+/gi, '[path]')
    .replace(/(?:[A-Z]:[\\/]|\/(?:Users|home|Volumes|private|tmp|var|Applications)\/)[^\s)"'<>]+/gi, '[path]')
    .replace(/\bauthorization\s*[:=]\s*(?:Bearer|Basic)\s+[^\s,;]+/gi, '[redacted]')
    .replace(/\b(?:token|password|secret|authorization|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '[redacted]')
    .slice(0, 1000);
}
function clean<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (key, item: unknown) => {
    if (typeof item === 'string') return cleanMessage(item);
    if (Array.isArray(item) && ['missing', 'errors'].includes(key)) return item.slice(-16).map((entry: unknown) => cleanMessage(entry).slice(0, 256));
    return item;
  })) as T;
}
export function diagnosticReport(): Report {
  let state: RuntimeSnapshot;
  try { state = snapshot(); } catch { state = { ready: false }; }
  return clean({ schemaVersion: 1, createdAt: new Date().toISOString(), build: __LANTERN_BUILD__,
    runtime: { platform: navigator.platform, userAgent: navigator.userAgent, webgpuAvailable: !!Reflect.get(navigator, 'gpu') },
    state, failures: [...failures] });
}
export function retainDiagnostics(): void { window.lanternReporting?.update(JSON.stringify(diagnosticReport())); }
export function recordFailure(kind: string, error: unknown): void {
  failures.push({ at: new Date().toISOString(), kind, message: cleanMessage(error) });
  if (failures.length > 32) failures.shift();
  retainDiagnostics();
}
export function registerRuntimeSnapshot(provider: () => RuntimeSnapshot): void { snapshot = provider; retainDiagnostics(); }
export function initializeDiagnostics(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('error', event => recordFailure('runtime', event.error ?? event.message));
  window.addEventListener('unhandledrejection', event => recordFailure('promise', event.reason));
  window.addEventListener('pagehide', retainDiagnostics);
  window.setInterval(retainDiagnostics, 10000);
  retainDiagnostics();
}
export async function exportDiagnostics(): Promise<boolean> {
  const report = JSON.stringify(diagnosticReport(), null, 2);
  if (window.lanternReporting) return window.lanternReporting.export(report);
  const url = URL.createObjectURL(new Blob([report], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = 'lantern-diagnostics.json'; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
export function diagnosticExportButton(): HTMLButtonElement {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Export diagnostic report';
  button.addEventListener('click', () => {
    button.disabled = true;
    exportDiagnostics().catch((error: unknown) => { recordFailure('export', error); button.textContent = 'Retry diagnostic export'; })
      .finally(() => { button.disabled = false; }).catch((error: unknown) => console.error(error));
  });
  return button;
}
