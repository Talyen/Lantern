import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, rename, readdir, statfs } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { root } from '../lib/cli.mjs';
const execute = promisify(execFile);
export async function git(args, cwd = root) {
  try { return (await execute('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 })).stdout.trimEnd(); }
  catch (error) { throw new Error(error.stderr?.trim() || error.message, { cause: error }); }
}
export async function repositoryFiles(cwd = root) {
  return [...new Set((await git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd)).split('\0').filter(Boolean))].sort();
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
export const defaultTaskWorktreeLimit = 8;
/** Local Git configuration is shared by every task worktree in this repository. */
export async function taskCapacity(ctx, records) {
  records ??= await tasks(ctx);
  const configured = await git(['config', '--local', '--get', 'lantern.maxWorktrees'], ctx.main).catch(error => {
    if (error.cause?.code === 1) return null;
    throw error;
  });
  if (configured !== null && (!/^[1-9]\d*$/.test(configured) || !Number.isSafeInteger(Number(configured)))) {
    throw new Error('lantern.maxWorktrees must be a positive integer.');
  }
  return { used: records.filter(task => task.status !== 'cleaned').length, limit: configured === null ? defaultTaskWorktreeLimit : Number(configured) };
}
export function taskPath(ctx, id) { return join(ctx.store, 'tasks', `${id}.json`); }
export async function saveTask(ctx, task) { await writeJSON(taskPath(ctx, task.id), task); }
export async function currentTask(ctx) {
  const task = (await tasks(ctx)).find(record => record.path === ctx.cwd && record.status !== 'cleaned');
  if (!task) throw new Error('Run agent:start from main, then use its returned worktree directory.');
  return task;
}
export async function clean(cwd, candidate) {
  const entries = (await git(['status', '--porcelain', '-z', '--untracked-files=all'], cwd)).split('\0').filter(Boolean);
  if (!entries.length) return;
  const reject = () => { throw new Error(`Checkout has uncommitted changes: ${cwd}. Preserve them; commit only reviewed task paths.`); };
  // Task checkouts remain strict. Main may retain unrelated user art, but every
  // incoming tracked path (including parent/file conflicts) is checked first.
  if (!candidate || entries.some(entry => !entry.startsWith('?? '))) reject();
  const incoming = (await git(['ls-tree', '-r', '--name-only', '-z', candidate], cwd)).split('\0').filter(Boolean);
  for (const entry of entries) {
    const path = entry.slice(3).normalize('NFC').toLowerCase();
    if (incoming.some(source => { const file = source.normalize('NFC').toLowerCase(); return file === path || file.startsWith(path + '/') || path.startsWith(file + '/'); })) reject();
  }
}

export async function freeSpace(path) {
  const value = await statfs(path, { bigint: true });
  return Number(value.bavail * value.bsize);
}
export function spaceRequirement(path, ci = process.env.CI === 'true' || process.env.CI === '1') {
  const privateInputs = ['public/vendor', '.local/animation-packs', '.local/synty-library'].some(name => existsSync(join(path, name)));
  // Hosted source-only CI has a smaller disk and never prepares the private catalogs.
  return (ci && !privateInputs ? 1 : 20) * 1024 ** 3;
}
export async function reserveSpace(path) {
  const available = await freeSpace(path), required = spaceRequirement(path);
  if (available < required) throw new Error(`Operation needs ${required / 1024 ** 3} GiB free; ${(available / 1024 ** 3).toFixed(1)} GiB available. Run agent:cleanup for completed tasks.`);
  return available;
}
export async function processIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Invalid process identity PID');
  try {
    const started = (await execute('ps', ['-p', String(pid), '-o', 'lstart='])).stdout.trim();
    if (!/^\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4}$/.test(started)) throw new Error('Process identity could not be parsed');
    return started;
  } catch (error) { if (error.code === 1 && !error.stderr?.trim() && !error.stdout?.trim()) return ''; throw error; }
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
