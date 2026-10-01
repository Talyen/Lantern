import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, rename, readdir, statfs } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { root } from '../lib/cli.mjs';
const execute = promisify(execFile);
export async function git(args, cwd = root) {
  try { return (await execute('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 })).stdout.trimEnd(); }
  catch (error) { throw new Error(error.stderr?.trim() || error.message); }
}
export async function context(cwd = root) {
  const common = resolve(cwd, await git(['rev-parse', '--git-common-dir'], cwd));
  const entries = (await git(['worktree', 'list', '--porcelain'], cwd)).split('\n\n');
  const primary = entries.find(entry => entry.includes('\nbranch refs/heads/main'))?.match(/^worktree (.+)$/m)?.[1];
  if (!primary) throw new Error('A main checkout is required; do not switch another checkout to main.');
  return { common, main: primary, store: join(common, 'lantern'), cwd };
}
export async function readJSON(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' && arguments.length > 1) return fallback; throw error; }
}
export async function writeJSON(path, value) {
  await mkdir(resolve(path, '..'), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n');
  await rename(temporary, path);
}
export async function tasks(ctx) {
  const directory = join(ctx.store, 'tasks');
  const names = await readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  return Promise.all(names.filter(name => name.endsWith('.json')).map(name => readJSON(join(directory, name))));
}
export function taskPath(ctx, id) { return join(ctx.store, 'tasks', `${id}.json`); }
export async function saveTask(ctx, task) { await writeJSON(taskPath(ctx, task.id), task); }
export async function currentTask(ctx) {
  const task = (await tasks(ctx)).find(record => record.path === ctx.cwd && record.status !== 'cleaned');
  if (!task) throw new Error('Run agent:start from main, then use its returned worktree directory.');
  return task;
}
export async function clean(cwd) {
  if (await git(['status', '--porcelain'], cwd)) throw new Error(`Checkout has uncommitted changes: ${cwd}. Preserve them; commit only reviewed task paths.`);
}
export async function freeSpace(path) {
  const value = await statfs(path, { bigint: true });
  return Number(value.bavail * value.bsize);
}
export async function reserveSpace(path) {
  const available = await freeSpace(path);
  if (available < 20 * 1024 ** 3) throw new Error(`Large operation needs 20 GiB free; ${(available / 1024 ** 3).toFixed(1)} GiB available. Run agent:cleanup for completed tasks.`);
  return available;
}
export async function processIdentity(pid) {
  try { return (await execute('ps', ['-p', String(pid), '-o', 'lstart='])).stdout.trim(); }
  catch { return ''; }
}
export async function liveLeases(ctx) {
  const directory = join(ctx.store, 'leases');
  const names = await readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  const records = await Promise.all(names.filter(name => name.endsWith('.json')).map(name => readJSON(join(directory, name), null)));
  const live = await Promise.all(records.map(async record => record?.started && await processIdentity(record.pid) === record.started ? {
    resource: record.resource, slot: record.slot, pid: record.pid, task: record.task,
  } : null));
  return live.filter(Boolean).sort((a, b) => a.resource.localeCompare(b.resource) || a.slot - b.slot);
}
export async function lastSuccessfulCheck(cwd) {
  const cache = await readJSON(join(cwd, '.local/checks/cache.json'), null);
  if (!cache?.passed || !cache.evidence) return null;
  const [inputs, stages] = await Promise.all([
    readJSON(join(cache.evidence, 'inputs.json'), null),
    readJSON(join(cache.evidence, 'summary.json'), null),
  ]);
  if (!inputs?.passed || !stages) return null;
  return {
    evidence: cache.evidence, revision: inputs.head, base: inputs.base,
    assets: inputs.assets, full: inputs.full, ms: stages.reduce((sum, stage) => sum + (stage.ms ?? 0), 0),
    stages: stages.map(stage => stage.name),
  };
}
