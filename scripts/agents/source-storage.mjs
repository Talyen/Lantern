import { lstat, mkdir, readdir, readFile, open, rm, rmdir } from 'node:fs/promises';
import { join, relative, dirname } from 'node:path';
import { assetSourceRoot, originalTrees, sourceCollections, sourceRelative, retainedSource } from '../lib/source-location.mjs';
import { hashFile } from '../lib/assets.mjs';
import { retainSourceTree, retentionFiles, safeRetentionPath, sourceCloneBaseline } from './retention.mjs';
import { acquire, withResource } from './resources.mjs';
import { readJSON, writeJSON, tasks, taskPath, freeSpace } from './state.mjs';

async function exists(path) {
  try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
const identity = value => `${value.size}:${value.mtimeNs}:${value.ctimeNs}:${value.ino}`;
async function emptyDirectories(path) {
  if (!await exists(path) || !(await lstat(path)).isDirectory()) return;
  for (const name of await readdir(path)) await emptyDirectories(join(path, name));
  try { await rmdir(path); } catch (error) { if (!['ENOTEMPTY', 'ENOENT'].includes(error.code)) throw error; }
}
/** Only conversion caches are rewritten; source receipts and masters retain their exact bytes. */
async function rebaseCaches(task) {
  const base = join(task.path, '.local/synty-library');
  for (const name of ['inventory.json', 'metadata.json', 'coverage.json', 'metadata', 'requests', 'results']) {
    for (const file of await retentionFiles(join(base, name))) {
      if (!file.path.endsWith('.json')) continue;
      const before = await readFile(file.path, 'utf8');
      const value = JSON.parse(before);
      function rebase(item) {
        if (typeof item === 'string') {
          const marker = '/.local/synty-library/';
          const index = item.indexOf(marker);
          return index < 0 ? item : join(task.path, item.slice(index + 1));
        }
        if (Array.isArray(item)) return item.map(rebase);
        if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, rebase(child)]));
        return item;
      }
      const after = rebase(value);
      if (JSON.stringify(value) !== JSON.stringify(after)) await writeJSON(file.path, after);
    }
  }
}
export async function retrieveSources(ctx, task, names, selected = []) {
  if (!names.length || !names.every(name => sourceCollections.includes(name)) || new Set(names).size !== names.length) throw new Error('Choose distinct source collections: animation-packs,synty-library.');
  if (!Array.isArray(selected) || selected.some(path => typeof path !== 'string' || !names.includes(sourceRelative(path).split('/')[0]))) throw new Error('--paths must be a JSON list of collection-relative paths within --sources.');
  await withResource('heavy', () => withResource('source-retention', async () => {
    const selections = selected.length ? selected : names.flatMap(name => originalTrees(name, name));
    const found = new Set();
    for (const selection of selections) {
      let from;
      try { from = await retainedSource(selection, { ctx, cwd: ctx.main }); }
      catch (error) {
        if (!selected.length && error.message.startsWith('Original source unavailable:')) continue;
        throw error;
      }
      found.add(selection.split('/')[0]);
      const target = join(task.path, '.local', selection);
      await safeRetentionPath(task.path, target);
      const before = new Set((await retentionFiles(target)).map(file => file.path));
      const result = await retainSourceTree(from, target, { apply: true });
      // Existing edits are never treated as unchanged clones or overwritten.
      const name = selection.split('/')[0], base = join(task.path, '.local', name);
      const baselinePath = join(task.path, '.local/agents/source-baselines', name + '.json');
      const baseline = await readJSON(baselinePath, {});
      const added = await sourceCloneBaseline(from, target);
      for (const [path, value] of Object.entries(added)) if (!before.has(join(target, path))) baseline[relative(base, join(target, path))] = value;
      await writeJSON(baselinePath, baseline);
      console.log(`Retrieved ${selection} from ${from}; ${result.conflicts.length} existing edited files preserved.`);
    }
    for (const name of names) if (!found.has(name)) throw new Error(`Original source collection unavailable: ${name}. Restore it under ${assetSourceRoot(ctx)} before retrieving working copies.`);
    if (names.includes('synty-library')) {
      const main = join(ctx.main, '.local/synty-library'), target = join(task.path, '.local/synty-library');
      // Metadata is a reusable local conversion cache, not an original source collection.
      for (const name of ['inventory.json', 'metadata.json', 'coverage.json', 'metadata']) {
        if (await exists(join(main, name))) await retainSourceTree(join(main, name), join(target, name), { apply: true });
      }
      await rebaseCaches(task);
    }
  }, { ctx }), { ctx });
}

/** Publish and durably inventory a collection before any local original is removed. */
export async function migrateSourceTree(source, destination, journal, { apply = false, beforeRemove } = {}) {
  await safeRetentionPath(dirname(source), source);
  await safeRetentionPath(dirname(destination), destination);
  const rows = [], cache = new Map();
  const verified = async row => {
    const sourceIdentity = identity(await lstat(row.source, { bigint: true }));
    const destinationIdentity = identity(await lstat(row.destination, { bigint: true }));
    rows.push({ ...row, sourceIdentity, destinationIdentity });
  };
  const report = await retainSourceTree(source, destination, { apply, cache, verified });
  if (!apply) return { ...report, files: (await retentionFiles(source)).length };
  for (const conflict of report.conflicts) {
    for (const file of await retentionFiles(join(source, conflict))) {
      const sha256 = await hashFile(file.path);
      const version = join(dirname(journal), 'source-replacements', sha256, relative(source, file.path) || 'original');
      const result = await retainSourceTree(file.path, version, { apply: true, cache, verified });
      if (result.conflicts.length) throw new Error(`Conflicting retained version: ${version}`);
    }
  }
  await mkdir(dirname(journal), { recursive: true });
  const handle = await open(journal, 'a+');
  try {
    // A torn final line cannot have authorized deletion: deletion starts after sync.
    const previous = await handle.readFile();
    if (previous.length && previous.at(-1) !== 10) await handle.truncate(previous.lastIndexOf(10) + 1);
    for (let index = 0; index < rows.length; index += 256) await handle.write(rows.slice(index, index + 256).map(row => JSON.stringify(row) + '\n').join(''));
    await handle.sync();
  } finally { await handle.close(); }
  await beforeRemove?.(rows);
  for (const row of rows) {
    await safeRetentionPath(source, row.source);
    await safeRetentionPath(dirname(journal), row.destination);
    if (identity(await lstat(row.source, { bigint: true })) !== row.sourceIdentity
      || identity(await lstat(row.destination, { bigint: true })) !== row.destinationIdentity
      || await hashFile(row.source) !== row.sha256 || await hashFile(row.destination) !== row.sha256) throw new Error(`Source changed or retained hash mismatch; preserve local original: ${row.source}`);
    if (identity(await lstat(row.source, { bigint: true })) !== row.sourceIdentity
      || identity(await lstat(row.destination, { bigint: true })) !== row.destinationIdentity) throw new Error(`Source changed during final verification: ${row.source}`);
    await rm(row.source);
  }
  await emptyDirectories(source);
  return { ...report, movedFiles: rows.length, movedLogicalBytes: rows.reduce((sum, row) => sum + row.bytes, 0) };
}

export async function migrateSources(ctx, { apply = false, progress = console.log } = {}) {
  const external = assetSourceRoot(ctx), journal = join(external, 'migration-inventory.jsonl');
  await safeRetentionPath(dirname(external), external);
  if (external === ctx.main || external.startsWith(ctx.main + '/')) throw new Error('The permanent source library must be outside Lantern.');
  const before = await freeSpace(ctx.main), report = { external, journal, apply, collections: [], preserved: [] };
  const candidates = sourceCollections.flatMap(name => originalTrees(name, join(ctx.main, '.local', name)).map(path => [path, join(external, name, relative(join(ctx.main, '.local', name), path))]));
  candidates.push([join(ctx.main, '.local/source-replacements'), join(external, 'source-replacements')]);
  const archiveRoot = join(ctx.main, '.local/agent-archives');
  const archives = await readdir(archiveRoot).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  const registered = await tasks(ctx);
  for (const id of archives) {
    const task = registered.find(task => task.id === id);
    const retained = await readJSON(join(archiveRoot, id, 'retained.json'), null);
    if (!task && retained?.task !== id) { report.preserved.push({ path: join(archiveRoot, id), reason: 'unconfirmed archive ownership' }); continue; }
    if (task && !['integrated', 'cleaned'].includes(task.status)) { report.preserved.push({ path: join(archiveRoot, id), reason: 'unfinished task' }); continue; }
    for (const name of sourceCollections) for (const path of originalTrees(name, join(archiveRoot, id, name))) candidates.push([path, join(external, name, relative(join(archiveRoot, id, name), path)), id]);
  }
  for (const [source, destination, id] of candidates) {
    if (!await exists(source)) continue;
    const owner = id ? await acquire(`task-${id}`, { ctx, tryOnly: true }) : null;
    if (id && !owner) { report.preserved.push({ path: source, reason: 'task operation owns its lock' }); continue; }
    try {
      const current = id ? await readJSON(taskPath(ctx, id), null) : null;
      if (current && !['integrated', 'cleaned'].includes(current.status)) { report.preserved.push({ path: source, reason: 'task resumed' }); continue; }
      await withResource('source-retention', async () => {
        progress(`${apply ? 'Migrating' : 'Inspecting'} ${source}`);
        report.collections.push(await migrateSourceTree(source, destination, journal, { apply }));
      }, { ctx });
    } finally { await owner?.release(); }
  }
  report.freeSpaceChangeBytes = await freeSpace(ctx.main) - before;
  if (apply) await writeJSON(join(external, 'migration-summary.json'), report);
  return report;
}
