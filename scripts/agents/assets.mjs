import { hashFile } from '../lib/assets.mjs';
import { lstat, readdir, mkdir, rm, rename } from 'node:fs/promises';
import { join, resolve, relative, sep, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { privateCopy, privateTree } from './copy.mjs';
import { writeJSON, saveTask, readJSON } from './state.mjs';
import { retainTaskSources, retainCurrentChecks } from './retention.mjs';
export async function assetIndex(directory) {
  const result = {};
  async function walk(path) {
    const info = await lstat(path, { bigint: true });
    if (info.isSymbolicLink()) throw new Error(`Runtime assets must be private files, not symlinks: ${path}`);
    if (info.isDirectory()) { for (const name of await readdir(path)) await walk(join(path, name)); }
    else if (info.isFile()) result[relative(directory, path)] = `${info.size}:${info.mtimeNs}:${info.ctimeNs}:${info.ino}`;
  }
  if (existsSync(directory)) await walk(directory);
  return result;
}
export function assetIdentity(index) { return createHash('sha256').update(JSON.stringify(Object.entries(index).sort())).digest('hex'); }
export async function fileHash(path) {
  try { return await hashFile(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
/** Freeze before validation: APFS cloning can change the source's ctime. */
export async function checkedAssetSnapshot(source, target) {
  const before = await assetIndex(source);
  await privateTree(source, target);
  const after = await assetIndex(source);
  // Accept clone metadata changes only with identical staged/source bytes.
  for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[name] === after[name]) continue;
    const [live, frozen] = await Promise.all([fileHash(safeAsset(source, name)), fileHash(safeAsset(target, name))]);
    if (live !== frozen) throw new Error('Candidate assets changed while preparing the promotion snapshot; retry finish.');
  }
  if (assetIdentity(await assetIndex(source)) !== assetIdentity(after)) throw new Error('Candidate assets changed while verifying the promotion snapshot; retry finish.');
  return after;
}
export function safeAsset(base, name) {
  const path = resolve(base, name);
  if (!name || !path.startsWith(resolve(base) + sep)) throw new Error(`Invalid asset path: ${name}`);
  return path;
}
export async function snapshotAssets(ctx, task) {
  const vendor = join(ctx.main, 'public/vendor');
  const local = join(task.path, 'public/vendor');
  const baseline = join(task.path, '.local/agents/base-vendor');
  const staging = join(task.path, '.local/agents/setup-assets');
  if (!task.assetsStaged) {
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    if (existsSync(vendor)) { await privateTree(vendor, join(staging, 'vendor')); await privateTree(vendor, join(staging, 'base')); }
    task.assetsStaged = true; await saveTask(ctx, task);
  }
  for (const [from, target] of [[join(staging, 'vendor'), local], [join(staging, 'base'), baseline]]) {
    if (existsSync(from)) {
      if (existsSync(target)) throw new Error(`Unexpected asset directory during setup; preserve it: ${target}`);
      await mkdir(resolve(target, '..'), { recursive: true }); await rename(from, target);
    }
  }
  task.assetIndex = await assetIndex(local); task.assetChanges = []; task.assetsPrepared = true;
  await saveTask(ctx, task); await rm(staging, { recursive: true, force: true });
}
/** Hash only edited artifact paths; untouched catalogs and source archives are not rehashed. */
export async function prepareAssets(ctx, task, mainHead, resolved = []) {
  const local = join(task.path, 'public/vendor');
  const baseline = join(task.path, '.local/agents/base-vendor');
  const current = join(ctx.main, 'public/vendor');
  const mainIdentity = assetIdentity(await assetIndex(current));
  const index = await assetIndex(local);
  const changed = new Set(task.assetChanges ?? []);
  for (const name of new Set([...Object.keys(index), ...Object.keys(task.assetIndex ?? {})])) if (index[name] !== task.assetIndex?.[name]) changed.add(name);
  const edits = [], conflicts = [], conflictHashes = {};
  for (const name of changed) {
    const [before, mine, theirs] = await Promise.all([fileHash(safeAsset(baseline, name)), fileHash(safeAsset(local, name)), fileHash(safeAsset(current, name))]);
    if (mine === theirs) continue;
    if (before !== theirs && mine !== before) {
      const acknowledged = resolved.includes(name) && task.assetConflictBase === mainHead && task.assetConflicts?.includes(name) && task.assetConflictHashes?.[name] === theirs;
      if (!acknowledged) { conflicts.push(name); conflictHashes[name] = theirs; continue; }
    }
    if (mine !== before) edits.push(name);
  }
  if (conflicts.length) {
    task.assetConflicts = conflicts; task.assetConflictHashes = conflictHashes; task.assetConflictBase = mainHead; task.status = 'needs-asset-repair'; await saveTask(ctx, task);
    throw new Error(`Asset conflicts: ${conflicts.join(', ')}. Reconcile/re-export these artifacts; then pass --resolved-assets with a JSON list of reviewed paths for this main revision.`);
  }
  // Byte comparisons proved no art edits, and this independent snapshot still
  // corresponds to main. Retain its settled metadata when retrying validation.
  if (!edits.length && task.mainAssetIdentity === mainIdentity) {
    if (assetIdentity(await assetIndex(current)) !== mainIdentity) throw new Error('Main assets changed during snapshot verification; retry finish.');
    task.assetIndex = index; task.assetChanges = [];
    await saveTask(ctx, task);
    return assetIdentity(index);
  }
  // Freeze the combined asset input before checks. Preserve old task files until the swap succeeds.
  const combined = join(task.path, '.local/agents/combined-vendor');
  await rm(combined, { recursive: true, force: true });
  if (existsSync(current)) await privateTree(current, combined); else await mkdir(combined, { recursive: true });
  for (const name of edits) {
    const target = safeAsset(combined, name);
    await rm(target, { force: true });
    if (existsSync(safeAsset(local, name))) await privateCopy(safeAsset(local, name), target);
  }
  if (assetIdentity(await assetIndex(current)) !== mainIdentity) throw new Error('Main assets changed during snapshot; retry finish.');
  const previous = join(task.path, '.local/agents/previous-vendor');
  await rm(previous, { recursive: true, force: true });
  if (existsSync(local)) await rename(local, previous);
  await mkdir(resolve(local, '..'), { recursive: true });
  await rename(combined, local);
  await rm(baseline, { recursive: true, force: true });
  if (existsSync(current)) await privateTree(current, baseline);
  task.assetIndex = await assetIndex(local); task.assetChanges = edits; task.mainAssetIdentity = mainIdentity;
  delete task.assetConflicts; delete task.assetConflictHashes; delete task.assetConflictBase;
  await saveTask(ctx, task);
  await rm(previous, { recursive: true, force: true });
  return assetIdentity(task.assetIndex);
}
export async function retainSources(ctx, task) {
  await retainTaskSources(ctx, task);
  await retainCurrentChecks(ctx, task);
  const archive = join(ctx.main, '.local/agent-archives', task.id);
  const retained = await readJSON(join(archive, 'retained.json'), {});
  const pin = retained.pin || task.retentionPin;
  if (!pin) return;
  const checks = join(task.path, '.local/checks');
  if (existsSync(checks)) {
    await privateTree(checks, join(archive, 'checks'));
    if (task.lastCheck?.evidence) task.lastCheck.evidence = join(archive, 'checks', basename(task.lastCheck.evidence));
  }
  const previewLog = join(task.path, '.local/agents/preview.log');
  if (existsSync(previewLog)) await privateCopy(previewLog, join(archive, 'preview.log'));
  const browsers = join(task.path, '.local/agents/browser-history.json');
  if (existsSync(browsers)) await privateCopy(browsers, join(archive, 'browser-history.json'));
  const captures = join(task.path, '.local/agents/captures');
  if (existsSync(captures)) await privateTree(captures, join(archive, 'captures'));
  const inspection = join(task.path, '.local/inspection');
  if (existsSync(inspection)) await privateTree(inspection, join(archive, 'inspection'));
  const views = join(task.path, '.local/level-design');
  if (existsSync(views)) await privateTree(views, join(archive, 'level-design'));
  await writeJSON(join(ctx.main, '.local/agent-archives', task.id, 'retained.json'), { ...retained, task: task.id, revision: task.candidate, pin });
}
