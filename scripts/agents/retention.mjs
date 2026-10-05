import { lstat, readdir, mkdir, rm, rmdir, rename, appendFile } from 'node:fs/promises';
import { join, resolve, relative, dirname, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hashFile } from '../lib/assets.mjs';
import { privateCopy, privateTree } from './copy.mjs';
import { readJSON, writeJSON, readTask, saveTask, taskPath, freeSpace, compactTask, processIdentity, git, liveLeases } from './state.mjs';
import { acquire, withResource } from './resources.mjs';

export const retentionPolicy = Object.freeze({ days: 0, bytes: 0 });
const sourceNames = ['animation-packs', 'synty-library'];
const evidenceNames = ['checks', 'captures', 'level-design', 'inspection', 'preview.log'];
const slug = /^[a-z][a-z0-9-]{0,47}$/;

async function info(path) {
  try { return await lstat(path, { bigint: true }); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
const stamp = value => `${value.size}:${value.mtimeNs}:${value.ctimeNs}:${value.ino}`;

/** Check every parent, including the boundary; never traverse private symlinks. */
export async function safeRetentionPath(base, path) {
  base = resolve(base); path = resolve(path);
  const rel = relative(base, path);
  if (rel === '..' || rel.startsWith('..' + sep) || rel.startsWith(sep)) throw new Error(`Retention path escapes its owner: ${path}`);
  let current = base;
  for (const part of ['', ...rel.split(sep).filter(Boolean)]) {
    if (part) current = join(current, part);
    const value = await info(current);
    if (value?.isSymbolicLink()) throw new Error(`Preserving symlink: ${current}`);
    if (current !== path && value && !value.isDirectory()) throw new Error(`Retention parent is not a directory: ${current}`);
  }
  return path;
}

export async function retentionFiles(base) {
  await safeRetentionPath(dirname(base), base);
  const files = [];
  async function visit(path) {
    const value = await info(path);
    if (!value) return;
    if (value.isSymbolicLink()) throw new Error(`Preserving symlink: ${path}`);
    if (value.isDirectory()) {
      for (const name of (await readdir(path)).sort()) await visit(join(path, name));
    } else if (value.isFile()) files.push({ path, bytes: Number(value.size), identity: stamp(value) });
    else throw new Error(`Preserving unsupported file: ${path}`);
  }
  await visit(base);
  return files;
}

async function digest(file, cache) {
  const key = file.path + ':' + file.identity;
  if (stamp(await info(file.path)) !== file.identity) throw new Error(`Source changed before verification: ${file.path}`);
  if (!cache.has(key)) {
    const hash = await hashFile(file.path);
    if (stamp(await info(file.path)) !== file.identity) throw new Error(`Source changed during verification: ${file.path}`);
    cache.set(key, hash);
  }
  return cache.get(key);
}

async function removeEmptyDirectories(path) {
  const value = await info(path);
  if (!value?.isDirectory()) return;
  for (const name of await readdir(path)) await removeEmptyDirectories(join(path, name));
  try { await rmdir(path); } catch (error) { if (!['ENOTEMPTY', 'ENOENT'].includes(error.code)) throw error; }
}

/** Missing source subtrees are cloned atomically and verified before publication. */
async function publishSource(source, target, cache) {
  await safeRetentionPath(dirname(target), target);
  const temporary = target + '.retaining-' + randomUUID();
  const value = await info(source);
  const before = await retentionFiles(source);
  const expected = [];
  for (const file of before) expected.push(await digest(file, cache));
  await mkdir(dirname(target), { recursive: true });
  if (value.isDirectory()) await privateTree(source, temporary);
  else await privateCopy(source, temporary);
  try {
    const copied = await retentionFiles(temporary), current = await retentionFiles(source);
    if (before.length !== current.length) throw new Error(`Source changed during copying: ${source}`);
    if (before.length !== copied.length) throw new Error(`Source copy is incomplete: ${source}`);
    for (let index = 0; index < before.length; index++) {
      const prior = before[index], fresh = current[index];
      const stable = identity => identity.split(':').filter((_, index) => index !== 2).join(':');
      // A copy may update status metadata. Preserve inode/size/mtime and verify
      // original bytes before and after copying instead of reusing an old stamp.
      if (relative(source, prior.path) !== relative(source, fresh.path) || stable(prior.identity) !== stable(fresh.identity)
        || await digest(fresh, cache) !== expected[index]) throw new Error(`Source changed during copying: ${source}`);
      if (relative(source, prior.path) !== relative(temporary, copied[index].path)
        || expected[index] !== await digest(copied[index], cache)) throw new Error(`Source copy differs: ${source}`);
    }
    if (await info(target)) throw new Error(`Canonical source appeared during retention: ${target}`);
    await rename(temporary, target);
  } catch (error) {
    // Interrupted/unverified copies remain recoverable and are reported as unknown.
    throw new Error(`Preserve source and temporary copy ${temporary}: ${error.message}`, { cause: error });
  }
}

/** Retain unique versions; discard a copy only while verified canonical bytes remain. */
export async function retainSourceTree(source, canonical, { apply = false, removeDuplicates = false, cache = new Map(), baseline = {}, versions, references, protectedSources = new Set(), progress = () => {} } = {}) {
  await safeRetentionPath(dirname(source), source);
  await safeRetentionPath(dirname(canonical), canonical);
  const report = { source, canonical, duplicateFiles: 0, duplicateBytes: 0, publishedFiles: 0, retainedReferences: 0, conflicts: [] };
  async function preserveVersion(file, target) {
    if (!versions) { report.conflicts.push(relative(source, file.path)); return; }
    const hash = await digest(file, cache), key = target + ':' + hash, previous = versions.get(key);
    if (!previous) { versions.set(key, file); report.conflicts.push(relative(source, file.path)); return; }
    const current = await info(previous.path);
    if (!current || stamp(current) !== previous.identity || stamp(await info(file.path)) !== file.identity) throw new Error('Retained source version changed; preserve both copies.');
    report.duplicateFiles++; report.duplicateBytes += file.bytes;
    if (apply && removeDuplicates) {
      if (!references) throw new Error('Source-version deduplication requires a durable reference record.');
      await safeRetentionPath(dirname(source), references);
      await appendFile(references, JSON.stringify({ source: relative(source, file.path), retained: previous.path, sha256: hash }) + '\n', { flush: true });
      if (stamp(await info(file.path)) !== file.identity || stamp(await info(previous.path)) !== previous.identity) throw new Error('Source changed while recording its retained version; preserve both copies.');
      await rm(file.path);
    }
  }
  async function visit(from, to) {
    await safeRetentionPath(source, from); await safeRetentionPath(canonical, to);
    let mine = await info(from);
    const theirs = await info(to);
    if (!mine) return;
    if (mine.isDirectory()) {
      if (!theirs && apply) { await publishSource(from, to, cache); report.publishedFiles += (await retentionFiles(to)).length; }
      else if (theirs && !theirs.isDirectory()) { report.conflicts.push(relative(source, from)); return; }
      for (const name of (await readdir(from)).sort()) await visit(join(from, name), join(to, name));
      if (apply && removeDuplicates) await removeEmptyDirectories(from);
      return;
    }
    if (!mine.isFile()) throw new Error(`Preserving unsupported source: ${from}`);
    if (protectedSources.has(from)) { report.retainedReferences++; return; }
    if (!theirs && apply) {
      await publishSource(from, to, cache); report.publishedFiles++;
      mine = await info(from);
    }
    const a = { path: from, bytes: Number(mine.size), identity: stamp(mine) };
    const current = await info(to);
    if (!current?.isFile() || current.size !== mine.size) { await preserveVersion(a, to); return; }
    const b = { path: to, bytes: Number(current.size), identity: stamp(current) };
    const initial = baseline[relative(source, from)];
    const unchangedClone = initial?.copy === a.identity && initial?.canonical === b.identity;
    if (!unchangedClone && await digest(a, cache) !== await digest(b, cache)) { await preserveVersion(a, to); return; }
    report.duplicateFiles++; report.duplicateBytes += a.bytes;
    if (apply && removeDuplicates) {
      await safeRetentionPath(source, from); await safeRetentionPath(canonical, to);
      if (stamp(await info(from)) !== a.identity || stamp(await info(to)) !== b.identity) throw new Error(`Source changed before deduplication: ${from}`);
      await rm(from);
    }
    if (report.duplicateFiles % 2000 === 0) progress(report);
  }
  if (await info(source)) await visit(source, canonical);
  return report;
}

/** Clone baselines avoid hashing unchanged libraries during ordinary task cleanup. */
export async function sourceCloneBaseline(source, copy) {
  const a = new Map((await retentionFiles(source)).map(file => [relative(source, file.path), file.identity]));
  return Object.fromEntries((await retentionFiles(copy)).map(file => [relative(copy, file.path), { canonical: a.get(relative(copy, file.path)), copy: file.identity }]));
}

/** Legacy archive recovery first protects the complete supplied collection on main. */
export async function restorePlayableSource(ctx, actor, cwd) {
  if (!actor.source) return;
  const canonical = resolve(ctx.main, actor.source), target = resolve(cwd, actor.source);
  await safeRetentionPath(ctx.main, canonical); await safeRetentionPath(cwd, target);
  if (await info(target)) return;
  await withResource('source-retention', async () => {
    if (!await info(canonical)) {
      const archives = join(ctx.main, '.local/agent-archives');
      const candidates = [];
      for (const name of await readdir(archives)) {
        const path = resolve(archives, name, actor.source.replace(/^\.local\//, ''));
        await safeRetentionPath(archives, path);
        if (await info(path)) candidates.push(path);
      }
      const cache = new Map(), hashes = new Set();
      for (const path of candidates) hashes.add(await digest((await retentionFiles(path))[0], cache));
      if (hashes.size !== 1) throw new Error(`Supply one unambiguous private source for ${actor.name}: ${actor.source}`);
      // Include acquisition records/editable masters, not just the immediate GLB parent.
      const collection = actor.source.match(/^\.local\/animation-packs\/Protagonists\/([^/]+)\//)?.[1];
      if (!collection) throw new Error(`Supplied source needs an explicit collection owner: ${actor.source}`);
      const root = join(ctx.main, '.local/animation-packs/Protagonists', collection);
      for (const path of candidates) {
        const prefix = path.slice(0, path.indexOf('/animation-packs/'));
        await retainSourceTree(join(prefix, 'animation-packs/Protagonists', collection), root, { apply: true, cache });
      }
    }
    if (!await info(target)) await privateTree(dirname(canonical), dirname(target));
  }, { ctx });
}

export async function retainTaskSources(ctx, task) {
  return withResource('source-retention', async () => {
    await safeRetentionPath(ctx.main, join(ctx.main, '.local'));
    for (const name of sourceNames) {
      const source = join(task.path, '.local', name);
      if (!await info(source)) continue;
      // Keep the worktree intact until git removes it; originals belong to asset owners.
      const canonical = join(ctx.main, '.local', name);
      const baseline = await readJSON(join(task.path, '.local/agents/source-baselines', name + '.json'), {});
      const report = await retainSourceTree(source, canonical, { apply: true, baseline });
      await preserveSourceConflicts(ctx, name, source, report.conflicts);
    }
  }, { ctx });
}

/** Content-addressed originals survive independently of the task that supplied them. */
async function preserveSourceConflicts(ctx, collection, source, conflicts, remove = false) {
  const cache = new Map();
  for (const conflict of conflicts) for (const file of await retentionFiles(join(source, conflict))) {
    const hash = await digest(file, cache);
    const owner = join(ctx.main, '.local/source-replacements', collection, hash);
    const target = join(owner, relative(source, file.path));
    await safeRetentionPath(ctx.main, target);
    const result = await retainSourceTree(file.path, target, { apply: true, removeDuplicates: remove, cache });
    if (result.conflicts.length) throw new Error(`Source preservation differs: ${target}`);
  }
  if (remove) await removeEmptyDirectories(source);
}

/** Preserve successful current-revision evidence before its task checkout/archive disappears. */
export async function retainCurrentChecks(ctx, task, checks = join(task.path, '.local/checks')) {
  return withResource('promotion', async () => {
    const head = await git(['rev-parse', 'HEAD'], ctx.main);
    const { assetIndex, assetIdentity } = await import('./assets.mjs');
    let assets;
    for (const mode of ['light', 'full']) {
      const cacheName = mode === 'full' ? 'cache-full.json' : 'cache.json';
      const cache = await readJSON(join(checks, cacheName), null);
      const source = cache?.evidence ? join(checks, cache.evidence.split(sep).at(-1)) : null;
      if (!cache?.passed || !source) continue;
      await safeRetentionPath(checks, source);
      const inputs = await readJSON(join(source, 'inputs.json'), null);
      if (!inputs?.passed || inputs.head !== head || inputs.mode !== mode) continue;
      assets ??= assetIdentity(await assetIndex(join(ctx.main, 'public/vendor')));
      if (inputs.assets !== assets && !(task.candidate === head && task.mainAssetIdentity === assets && !(task.assetChangeCount ?? task.assetChanges?.length ?? 0))) continue;
      const target = join(ctx.main, '.local/checks', source.split(sep).at(-1));
      await safeRetentionPath(ctx.main, target);
      const existing = await readJSON(join(target, 'inputs.json'), null);
      if (!existing) await publishSource(source, target, new Map());
      else if (existing.signature !== inputs.signature) throw new Error('Current check destination has different inputs; preserve both copies.');
      const mainCache = await readJSON(join(ctx.main, '.local/checks', cacheName), null);
      const mainInputs = mainCache?.evidence ? await readJSON(join(mainCache.evidence, 'inputs.json'), null) : null;
      if (!mainInputs?.passed || mainInputs.head !== head || mainInputs.assets !== assets) await writeJSON(join(ctx.main, '.local/checks', cacheName), { ...cache, evidence: target });
    }
  }, { ctx });
}

async function verifiedClosedHistory(path) {
  const history = await readJSON(path, []);
  if (!Array.isArray(history)) return false;
  for (const record of history) {
    if (!record.started || !record.closed || await processIdentity(record.pid) === record.started) return false;
    for (const group of record.browserProcesses ?? []) if (!group.started || await processIdentity(group.pid) === group.started) return false;
  }
  return true;
}

/** Only known managed content is eligible. Unknown local files are inventory, never trash. */
export async function pruneRetention(ctx, { apply = false, sources = false, managedOnly = false, progress = () => {} } = {}) {
  const ownership = await acquire('retention', { ctx, tryOnly: managedOnly });
  if (!ownership) return { deferred: true, reason: 'Another retention operation owns cleanup.' };
  try {
    const before = await freeSpace(ctx.main);
    const report = { apply, policy: retentionPolicy, beforeFreeBytes: before, compacted: [], removed: [], sourceReports: [], protected: [], unknown: [], errors: [] };
    const archiveRoot = join(ctx.main, '.local/agent-archives');
    await safeRetentionPath(ctx.common, ctx.store); await safeRetentionPath(ctx.main, archiveRoot);
    const names = (await readdir(join(ctx.store, 'tasks')).catch(error => { if (error.code === 'ENOENT') return []; throw error; })).filter(name => name.endsWith('.json')).sort();
    const archives = await readdir(archiveRoot).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    for (const id of archives) if (!names.includes(id + '.json')) report.unknown.push({ path: join(archiveRoot, id), reason: 'unregistered archive; preserved' });
    async function discard(path, base) {
      await safeRetentionPath(base, path);
      const files = await retentionFiles(path), bytes = files.reduce((sum, file) => sum + file.bytes, 0);
      if (apply) {
        if (JSON.stringify(await retentionFiles(path)) !== JSON.stringify(files)) throw new Error(`Evidence changed; preserved: ${path}`);
        await rm(path, { recursive: true, force: true });
      }
      report.removed.push({ path, bytes });
    }
    for (const name of names) {
      const id = name.slice(0, -5);
      if (!slug.test(id)) { report.unknown.push(join(ctx.store, 'tasks', name)); continue; }
      await safeRetentionPath(ctx.store, taskPath(ctx, id));
      const task = await readTask(ctx, id);
      if (task?.status !== 'cleaned') { report.protected.push({ path: task?.path, reason: 'unfinished task' }); continue; }
      const lease = await acquire(`task-${id}`, { ctx, tryOnly: true });
      if (!lease) { report.protected.push({ path: task.path, reason: 'task operation owns its lock' }); continue; }
      const archive = join(archiveRoot, id);
      try {
        await safeRetentionPath(archiveRoot, archive);
        const present = await info(archive), retained = await readJSON(join(archive, 'retained.json'), null);
        if (await info(task.path) || !Number.isFinite(Date.parse(task.cleanedAt ?? task.integratedAt)) || present && retained?.task !== id) {
          report.protected.push({ path: archive, reason: 'missing completion/ownership evidence or remaining worktree' }); continue;
        }
        const pin = retained?.pin || task.retentionPin;
        if (pin) { report.protected.push({ path: archive, reason: 'unresolved evidence: ' + pin }); continue; }
        if (!await verifiedClosedHistory(join(archive, 'browser-history.json'))) {
          report.protected.push({ path: archive, reason: 'browser exit not verified' }); continue;
        }
        const entries = present ? await readdir(archive) : [];
        if (apply && entries.includes('checks')) await retainCurrentChecks(ctx, task, join(archive, 'checks'));
        const metadata = new Set(['retained.json', 'browser-history.json', ...sourceNames.flatMap(name => [name + '-retained.json', name + '-references.jsonl'])]);
        let blocked = false;
        for (const entry of entries) {
          const path = join(archive, entry);
          if (sourceNames.includes(entry)) {
            blocked = true;
            if (!sources) { report.protected.push({ path, reason: 'source audit required: --sources' }); continue; }
            await withResource('source-retention', async () => {
              progress(`Verifying sources: ${id}/${entry}`);
              const result = await retainSourceTree(path, join(ctx.main, '.local', entry), { apply, removeDuplicates: apply });
              report.sourceReports.push(result);
              if (apply) {
                await preserveSourceConflicts(ctx, entry, path, result.conflicts, true);
                if (await info(path)) report.protected.push({ path, reason: 'remaining source content' });
              }
            }, { ctx });
            continue;
          }
          if (metadata.has(entry)) continue;
          if (!evidenceNames.includes(entry)) {
            blocked = true;
            report.unknown.push({ path, reason: 'unrecognized archive content; preserved' });
            continue;
          }
          try {
            if ((await readJSON(join(archive, 'retained.json'), null))?.pin || (await readTask(ctx, id))?.retentionPin) throw new Error('Evidence was pinned during cleanup; preserved.');
            await discard(path, archiveRoot);
          }
          catch (error) { blocked = true; report.protected.push({ path, reason: error.message }); }
        }
        // Source publication completes before metadata can disappear. A retry sees the
        // surviving registration even if its archive was already removed.
        if (apply && sources) blocked = (await readdir(archive).catch(error => { if (error.code === 'ENOENT') return []; throw error; })).some(entry => !metadata.has(entry));
        if (blocked) {
          const compact = compactTask(task);
          if (apply && JSON.stringify(compact) !== JSON.stringify(task)) { await saveTask(ctx, compact); report.compacted.push(id); }
          continue;
        }
        await withResource('promotion', async () => {
          const current = await readTask(ctx, id);
          if (current?.status !== 'cleaned' || current.retentionPin || (await readJSON(join(archive, 'retained.json'), null))?.pin || await info(current.path)) throw new Error('Task changed; preserve its registration.');
          const branch = current.branch;
          if (branch) {
            if (branch !== `codex/${id}`) throw new Error('Unexpected task branch; preserved.');
            const ref = await git(['rev-parse', '--verify', `refs/heads/${branch}`], ctx.main).catch(error => { if (error.cause?.code === 128) return null; throw error; });
            if (ref) {
              await git(['merge-base', '--is-ancestor', ref, 'main'], ctx.main);
              if ((await git(['worktree', 'list', '--porcelain'], ctx.main)).includes(`branch refs/heads/${branch}\n`)) throw new Error('Task branch still has a worktree.');
              if (apply) await git(['branch', '-d', branch], ctx.main);
              report.removed.push({ branch, bytes: 0 });
            }
          }
          for (const entry of entries.filter(entry => metadata.has(entry))) await discard(join(archive, entry), archiveRoot);
          if (apply && await info(archive)) await rmdir(archive);
          await discard(taskPath(ctx, id), ctx.store);
        }, { ctx });
      } catch (error) { report.errors.push({ task: id, message: error.message }); }
      finally { await lease.release(); }
      progress(`Inspected ${id}`);
    }
    const desktop = join(ctx.main, '.local/desktop');
    await safeRetentionPath(ctx.main, desktop);
    if (await info(desktop) && !(await liveLeases(ctx)).some(lease => lease.resource === 'heavy')) {
      const current = await readJSON(join(desktop, 'candidate.json'), {}), head = await git(['rev-parse', 'HEAD'], ctx.main);
      for (const entry of await readdir(desktop)) {
        const match = entry.match(/^lantern-web-([a-f0-9]{40})\.tar\.gz$/);
        if (!match || match[1] === head || match[1] === current.revision || await info(join(desktop, entry + '.pin'))) continue;
        await withResource('desktop-retention', async () => {
          if ((await liveLeases(ctx)).some(lease => lease.resource === 'heavy')) return;
          await discard(join(desktop, entry), desktop);
        }, { ctx });
      }
    }
    const managed = new Set(['agent-archives', 'agents', 'worktrees', ...sourceNames, 'checks', 'build-public', 'source-replacements']);
    if (!managedOnly) for (const name of await readdir(join(ctx.main, '.local'))) if (!managed.has(name)) {
      const path = join(ctx.main, '.local', name);
      try { const files = await retentionFiles(path); report.unknown.push({ path, bytes: files.reduce((sum, file) => sum + file.bytes, 0) }); }
      catch (error) { report.unknown.push({ path, reason: error.message }); }
    }
    report.afterFreeBytes = await freeSpace(ctx.main); report.freeSpaceChangeBytes = report.afterFreeBytes - before;
    return report;
  } finally { await ownership.release(); }
}
