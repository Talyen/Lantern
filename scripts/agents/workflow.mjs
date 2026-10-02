import { mkdir, readFile, rm, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { git, taskCapacity, taskPath, readJSON, saveTask, writeJSON, clean, reserveSpace, freeSpace } from './state.mjs';
import { withResource } from './resources.mjs';
import { privateTree } from './copy.mjs';
import { snapshotAssets, prepareAssets, assetIndex, assetIdentity, retainSources } from './assets.mjs';
import { run } from '../lib/cli.mjs';
export async function recover(ctx) {
  const path = join(ctx.store, 'promotion.json');
  const journal = await readJSON(path, null);
  if (!journal) return;
  const head = await git(['rev-parse', 'HEAD'], ctx.main);
  if (![journal.base, journal.candidate].includes(head)) throw new Error('Promotion interrupted and main changed unexpectedly. Preserve the journal and repair the integration before proceeding.');
  if (head === journal.base) await clean(ctx.main);
  const vendor = join(ctx.main, 'public/vendor');
  if (journal.assets) {
    // Filesystem renames can precede the journal update: existence makes recovery idempotent.
    if (existsSync(journal.nextVendor)) {
      if (existsSync(vendor)) {
        if (existsSync(journal.oldVendor)) throw new Error('Ambiguous vendor promotion; preserve both directories and inspect promotion.json.');
        await rename(vendor, journal.oldVendor);
      }
      await mkdir(resolve(vendor, '..'), { recursive: true });
      await rename(journal.nextVendor, vendor);
    } else if (!existsSync(vendor)) throw new Error('Prepared vendor snapshot is missing; preserve the promotion journal.');
  }
  if (head === journal.base) await git(['merge', '--ff-only', journal.candidate], ctx.main);
  const task = await readJSON(taskPath(ctx, journal.task));
  task.status = 'integrated'; task.candidate = journal.candidate; task.integratedAt = new Date().toISOString();
  await saveTask(ctx, task);
  await writeJSON(join(ctx.store, 'main-revision.json'), { revision: journal.candidate, task: task.id, assets: journal.assetIdentity });
  await rm(path);
  await rm(journal.transaction, { recursive: true, force: true });
}
export async function startTask(ctx, id, { wait = true, signal } = {}) {
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(id)) throw new Error('Task name must be a short lowercase slug starting with a letter.');
  let announced = false;
  for (;;) {
    signal?.throwIfAborted();
    const attempt = await admitTask(ctx, id);
    if (attempt.task) return attempt.task;
    const message = `All ${attempt.limit} task worktree slots are occupied.`;
    if (!wait) throw new Error(`${message} Clean completed tasks or omit --no-wait to queue.`);
    if (!announced) {
      console.log(`${message} Waiting for capacity; agent:cleanup can free completed tasks. Ctrl+C cancels.`);
      announced = true;
    }
    // Waiting must leave the promotion lock free for finish and cleanup.
    await delay(1000, undefined, { signal });
  }
}
async function admitTask(ctx, id) {
  return withResource('promotion', async () => {
    await recover(ctx);
    let task = await readJSON(taskPath(ctx, id), null);
    if (task?.status === 'cleaned') throw new Error('This task is archived; choose a new task slug.');
    if (task && task.status !== 'preparing') return { task };
    if (!task) {
      await clean(ctx.main);
      const capacity = await taskCapacity(ctx);
      if (capacity.used >= capacity.limit) return { limit: capacity.limit };
      await reserveSpace(ctx.main);
      const path = join(ctx.main, '.local/worktrees', id), branch = `codex/${id}`;
      const head = await git(['rev-parse', 'HEAD'], ctx.main);
      if (existsSync(path)) throw new Error(`Unregistered worktree directory exists: ${path}; preserve and inspect it.`);
      await mkdir(resolve(path, '..'), { recursive: true });
      if (await git(['branch', '--list', branch], ctx.main)) throw new Error(`Branch ${branch} already exists; choose another task slug.`);
      task = { id, path, branch, base: head, status: 'preparing', createdAt: new Date().toISOString(), began: Date.now(), available: await freeSpace(ctx.main) };
      // Register intent first: an interrupted git worktree add can be resumed by the same task.
      await saveTask(ctx, task);
      await git(['worktree', 'add', '-b', branch, path, head], ctx.main);
    } else {
      const worktrees = await git(['worktree', 'list', '--porcelain'], ctx.main);
      if (!worktrees.includes(`worktree ${task.path}\n`)) {
        if (existsSync(task.path)) throw new Error('Unregistered partial worktree exists; preserve and inspect it.');
        if (await git(['branch', '--list', task.branch], ctx.main)) await git(['worktree', 'add', task.path, task.branch], ctx.main);
        else await git(['worktree', 'add', '-b', task.branch, task.path, task.base], ctx.main);
      }
      await clean(task.path);
    }
    if (!task.assetsPrepared) await snapshotAssets(ctx, task);
    const dependencies = join(ctx.main, 'node_modules'), target = join(task.path, 'node_modules');
    if (existsSync(dependencies) && !existsSync(target)) {
      const staged = join(task.path, '.local/agents/setup-dependencies');
      await rm(staged, { recursive: true, force: true });
      await privateTree(dependencies, staged); await rename(staged, target);
      await writeJSON(join(task.path, '.local/agents/dependencies.json'), { signature: await dependencyIdentity(task.path) });
    }
    task.status = 'working'; task.setupMs = Date.now() - task.began; task.freeSpaceChange = task.available - await freeSpace(ctx.main);
    await saveTask(ctx, task); return { task };
  }, { ctx });
}
export async function dependencyIdentity(cwd) {
  const hash = createHash('sha256').update(process.version).update(process.platform).update(process.arch);
  const manifest = JSON.parse(await readFile(join(cwd, 'package.json')));
  hash.update(JSON.stringify([manifest.dependencies, manifest.devDependencies, manifest.engines]));
  hash.update(await readFile(join(cwd, 'package-lock.json')));
  return hash.digest('hex');
}
/** A source signature alone cannot establish that main's cloned install is current. */
export async function installedDependenciesMatch(cwd) {
  if (!existsSync(join(cwd, 'node_modules'))) return false;
  const manifest = await readJSON(join(cwd, 'package.json'));
  const lock = await readJSON(join(cwd, 'package-lock.json'));
  const names = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
  const matches = await Promise.all(names.map(async name => {
    const expected = lock.packages?.[`node_modules/${name}`]?.version;
    const installed = await readJSON(join(cwd, 'node_modules', name, 'package.json'), null);
    return typeof expected === 'string' && installed?.version === expected;
  }));
  return matches.every(Boolean);
}
export async function ensureDependencies(task) {
  const path = join(task.path, '.local/agents/dependencies.json');
  const signature = await dependencyIdentity(task.path);
  if ((await readJSON(path, null))?.signature === signature && await installedDependenciesMatch(task.path)) return;
  await withResource('heavy', () => run('npm', ['ci'], { cwd: task.path }), { cwd: task.path });
  await writeJSON(path, { signature });
}
export async function prepareSources(ctx, task, names) {
  if (!names.every(name => ['animation-packs', 'synty-library'].includes(name))) throw new Error('Sources must be animation-packs or synty-library.');
  await withResource('heavy', async () => {
    for (const name of names) {
      const target = join(task.path, '.local', name);
      if (existsSync(target)) continue;
      const source = join(ctx.main, '.local', name);
      if (!existsSync(source)) throw new Error(`Private sources unavailable: ${source}`);
      await privateTree(source, target);
    }
  }, { ctx });
}
export async function finishTask(ctx, task, { paths = [], message = `feat: ${task.id}`, resolvedAssets = [] } = {}) {
  return withResource(`task-${task.id}`, async () => {
    if (task.status === 'integrated') {
      if (await git(['status', '--porcelain'], task.path) || assetIdentity(await assetIndex(join(task.path, 'public/vendor'))) !== assetIdentity(task.assetIndex)) throw new Error('Integrated task contains new work; preserve it and create a new task for the follow-up.');
      return task;
    }
    if (await git(['diff', '--cached', '--name-only'], task.path)) throw new Error('The task index already contains changes; inspect and commit them explicitly before finish.');
    const dirty = await git(['status', '--porcelain'], task.path);
    if (dirty) {
      if (!paths.length) throw new Error('Supply --paths with a JSON list of reviewed repository-relative paths to commit task changes.');
      for (const path of paths) {
        if (typeof path !== 'string' || !path || path.startsWith('-') || resolve(task.path, path) === task.path || !resolve(task.path, path).startsWith(task.path + '/') || /^(?:\.local|public\/vendor|node_modules|dist|\.env)(?:\/|\.|$)/.test(path)) throw new Error(`Private or invalid reviewed path: ${path}`);
      }
      await git(['add', '--', ...paths], task.path);
      await git(['diff', '--cached', '--check'], task.path);
      await git(['commit', '-m', message], task.path);
    }
    await clean(task.path);
    for (;;) {
      await withResource('promotion', () => recover(ctx), { ctx });
      const base = await git(['rev-parse', 'HEAD'], ctx.main);
      try { await git(['rebase', base], task.path); }
      catch (error) {
        task.status = 'needs-code-repair'; await saveTask(ctx, task);
        throw new Error(`Resolve the rebase in ${task.path}, run git rebase --continue, then retry agent:finish. ${error.message}`, { cause: error });
      }
      task.base = base; task.status = 'checking'; await saveTask(ctx, task);
      const assets = await withResource('promotion', async () => {
        await recover(ctx);
        if (await git(['rev-parse', 'HEAD'], ctx.main) !== base) return null;
        return prepareAssets(ctx, task, base, resolvedAssets);
      }, { ctx });
      if (assets === null) continue;
      await ensureDependencies(task);
      const candidate = await git(['rev-parse', 'HEAD'], task.path);
      try { await run(process.execPath, ['scripts/check.mjs', '--base', base, ...(task.assetChanges.length ? ['--assets'] : [])], { cwd: task.path }); }
      catch (error) { task.status = 'needs-check-repair'; await saveTask(ctx, task); throw error; }
      const cache = await readJSON(join(task.path, '.local/checks/cache.json'), null);
      if (cache) {
        task.lastCheck = { evidence: cache.evidence, inputs: await readJSON(join(cache.evidence, 'inputs.json'), null), stages: await readJSON(join(cache.evidence, 'summary.json'), []) };
        await saveTask(ctx, task);
      }
      await clean(task.path);
      if (await git(['rev-parse', 'HEAD'], task.path) !== candidate || assetIdentity(await assetIndex(join(task.path, 'public/vendor'))) !== assets) throw new Error('Candidate changed during checks; retry after completing edits.');
      const transaction = join(ctx.store, 'transactions', randomUUID());
      await mkdir(transaction, { recursive: true });
      const nextVendor = join(transaction, 'vendor'), oldVendor = join(transaction, 'old-vendor');
      if (task.assetChanges.length) await privateTree(join(task.path, 'public/vendor'), nextVendor);
      const promoted = await withResource('promotion', async () => {
        await recover(ctx);
        if (await git(['rev-parse', 'HEAD'], ctx.main) !== base || assetIdentity(await assetIndex(join(ctx.main, 'public/vendor'))) !== task.mainAssetIdentity) return false;
        if (await git(['rev-parse', 'HEAD'], task.path) !== candidate || assetIdentity(await assetIndex(join(task.path, 'public/vendor'))) !== assets) throw new Error('Candidate changed after validation; retry finish.');
        await clean(task.path);
        await clean(ctx.main);
        task.candidate = candidate;
        await writeJSON(join(ctx.store, 'promotion.json'), { task: task.id, base, candidate, transaction, nextVendor, oldVendor, assets: task.assetChanges.length > 0, assetIdentity: assets });
        await recover(ctx); return true;
      }, { ctx });
      if (promoted) { task = await readJSON(taskPath(ctx, task.id)); console.log(`Integrated ${task.id}: ${candidate}`); return task; }
      await rm(transaction, { recursive: true, force: true });
      console.log('Main advanced; updating the candidate and repeating relevant checks.');
    }
  }, { ctx });
}
export async function cleanupTask(ctx, task) {
  return withResource(`task-${task.id}`, async () => {
    if (task.status === 'cleaned') return;
    if (task.status !== 'integrated') throw new Error(`Preserving unfinished task ${task.id} (${task.status}).`);
    await clean(task.path);
    if (assetIdentity(await assetIndex(join(task.path, 'public/vendor'))) !== assetIdentity(task.assetIndex)) throw new Error('Task assets changed after integration; preserve and finish them before cleanup.');
    await retainSources(ctx, task);
    await git(['worktree', 'remove', task.path], ctx.main);
    task.status = 'cleaned'; task.cleanedAt = new Date().toISOString(); await saveTask(ctx, task);
  }, { ctx });
}
