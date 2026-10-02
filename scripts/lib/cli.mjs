import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const defaultBlender = '/Applications/Blender.app/Contents/MacOS/Blender';
export class UsageError extends Error {}
export function parseArgs(argv, options = {}) {
  const values = {};
  for (let i = 0; i < argv.length; i++) {
    const [name, ...parts] = argv[i].split('=');
    const kind = name === '--help' ? 'boolean' : Object.hasOwn(options, name) ? options[name] : undefined;
    if (!kind) throw new UsageError(`Unknown option: ${name}`);
    if (Object.hasOwn(values, name)) throw new UsageError(`Repeated option: ${name}`);
    if (kind === 'boolean') {
      if (parts.length) throw new UsageError(`${name} takes no value`);
      values[name] = true;
    } else {
      const value = parts.length ? parts.join('=') : argv[++i];
      if (!value || value.startsWith('--')) throw new UsageError(`${name} requires a value`);
      values[name] = value;
    }
  }
  return values;
}
export async function cli(main) {
  try { await main(); } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  }
}
/** Literal arguments; owned children are stopped on interruption and optional deadlines. */
export async function run(command, args, { timeout = 0, stdio = 'inherit', cwd = root } = {}) {
  const resources = await import('../agents/resources.mjs');
  const grouped = process.platform !== 'win32' && resources.ownsResources();
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, stdio, shell: false, detached: grouped, env: resources.childEnvironment() });
    let interrupted = false;
    let killTimer;
    const kill = signal => { try { if (grouped) process.kill(-child.pid, signal); else child.kill(signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
    resources.registerChild(child.pid).catch(() => {});
    const stop = () => { interrupted = true; kill('SIGTERM'); killTimer = setTimeout(() => kill('SIGKILL'), 2000); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    const timer = timeout ? setTimeout(stop, timeout) : undefined;
    const cleanup = () => { resources.releaseChild(child.pid); clearTimeout(timer); clearTimeout(killTimer); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); };
    child.once('error', (error) => { cleanup(); reject(error); });
    child.once('exit', (code, signal) => {
      cleanup();
      if (interrupted || signal || code !== 0) reject(new Error(`${command} failed (${signal ?? code ?? 'interrupted'})`));
      else resolveRun();
    });
  });
}
export function blender(script, args, executable = defaultBlender) {
  return run(executable, ['-b', '--factory-startup', '--python-exit-code', '1', '--python', resolve(root, 'scripts', script), '--', ...args]);
}
