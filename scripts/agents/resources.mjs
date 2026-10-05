import { AsyncLocalStorage } from 'node:async_hooks';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { context, readJSON, processIdentity, reserveSpace } from './state.mjs';
import { root } from '../lib/cli.mjs';
export const RESOURCE_LIMITS = Object.freeze({ gpu: 2, checks: 1, heavy: 1 });
const owned = new Map(), scope = new AsyncLocalStorage();
const inheritedAtStart = JSON.parse(process.env.LANTERN_LEASES ?? '{}');
const active = () => scope.getStore() ?? owned;
export function ownsResources() { return [...active().values()].some(lease => lease.child); }
export function childEnvironment() {
  const values = { ...inheritedAtStart };
  for (const [resource, lease] of active()) values[resource] = { token: lease.record.token, slot: lease.record.slot, store: lease.store };
  return { ...process.env, LANTERN_LEASES: JSON.stringify(values) };
}
export async function registerChild(pid) {
  const started = await processIdentity(pid);
  for (const lease of active().values()) if (lease.child && !lease.child.stdin.destroyed) lease.child.stdin.write(JSON.stringify({ child: pid, started }) + '\n');
}
export function releaseChild(pid) {
  for (const lease of active().values()) if (lease.child && !lease.child.stdin.destroyed) lease.child.stdin.write(JSON.stringify({ done: pid }) + '\n');
}
export async function acquire(resource, { cwd = root, ctx, slots = RESOURCE_LIMITS[resource] ?? 1, slot, tryOnly = false } = {}) {
  ctx ??= await context(cwd);
  if (!/^[a-z0-9-]+$/.test(resource)) throw new Error('Invalid resource name');
  const limit = RESOURCE_LIMITS[resource];
  if (limit && (slots !== limit || (slot !== undefined && (!Number.isInteger(slot) || slot < 0 || slot >= limit)))) throw new Error(`Managed ${resource} operations require ${limit} slot${limit === 1 ? '' : 's'} and a valid slot index.`);
  const scoped = scope.getStore()?.get(resource);
  if (scoped?.store === ctx.store && (slot === undefined || scoped.record.slot === slot)) return { ...scoped, release: async () => {} };
  const inherited = JSON.parse(process.env.LANTERN_LEASES ?? '{}')[resource];
  if (inherited && (slot === undefined || inherited.slot === slot) && (!inherited.store || inherited.store === ctx.store)) {
    const record = await readJSON(join(ctx.store, 'leases', `${resource}-${inherited.slot}.json`), null);
    if (record?.token === inherited.token && await processIdentity(record.pid) === record.started) return { record, store: ctx.store, release: async () => {} };
    throw new Error(`Inherited ${resource} lease no longer belongs to a live owner.`);
  }
  if (resource === 'heavy') await reserveSpace(ctx.main);
  const token = randomUUID();
  // Cleanup may have removed the calling checkout; its integrated tools remain on main.
  const helper = existsSync(resolve(root, 'scripts/agents/native.py')) ? resolve(root, 'scripts/agents/native.py') : resolve(ctx.main, 'scripts/agents/native.py');
  const child = spawn('python3', [helper, 'lease', join(ctx.store, 'leases'), resource, '--slots', String(slots), '--token', token, '--task', cwd, ...(resource === 'checks' ? ['--drain-slots', '2'] : []), ...(slot === undefined ? [] : ['--slot',String(slot)]), ...(tryOnly ? ['--try-only'] : [])], { cwd: ctx.main, stdio: ['pipe', 'pipe', 'inherit'] });
  const exited = new Promise(accept => child.once('exit', accept));
  const record = await new Promise((accept, reject) => {
    child.once('error', reject);
    child.once('exit', () => reject(new Error(`${resource} lease exited before acquisition`)));
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      try { const result = JSON.parse(line); if (result.waiting) console.log(`Waiting for ${resource} resource`); if (result.acquired) accept(result.acquired); if(result.deferred) accept(null); }
      catch (error) { reject(error); }
    });
  });
  if(!record){child.stdin.end();await exited;return null;}
  const lease = { child, record, store: ctx.store,
    cleanup: (command, timeout = 10) => child.stdin.write(JSON.stringify({ cleanup: command, timeout }) + '\n'),
    cleanupGroup: group => child.stdin.write(JSON.stringify({ cleanupGroup: group }) + '\n'),
    release: async () => {
    if (owned.get(resource) === lease) owned.delete(resource);
    child.stdin.end(); const code = await exited;
    if (code !== 0) throw new Error(`${resource} guardian cleanup failed; preserve its ownership records.`);
  } };
  // Explicit acquire is used by the single preview owner. Callback leases use async scopes.
  if (!scope.getStore()) owned.set(resource, lease);
  return lease;
}
export async function withResource(resource, operation, options) {
  const lease = await acquire(resource, options);
  const leases = new Map(scope.getStore() ?? []); leases.set(resource, lease);
  try { return await scope.run(leases, operation); } finally { await lease.release(); }
}

/** Measurements borrow the owned preview's single GPU lease. */
export async function reserveGpuMeasurement(options = {}) {
  return acquire('gpu', options);
}
