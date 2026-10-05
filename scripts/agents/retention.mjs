import { lstat, readdir, mkdir, rm, rmdir, rename, appendFile, open } from 'node:fs/promises';
import { join, resolve, relative, dirname, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hashFile } from '../lib/assets.mjs';
import { privateCopy, privateTree } from './copy.mjs';
import { readJSON, writeJSON, readTask, saveTask, freeSpace, compactTask, processIdentity, git, liveLeases } from './state.mjs';
import { acquire, withResource } from './resources.mjs';

export const retentionPolicy = Object.freeze({ days: 7, bytes: 2 * 1024 ** 3 });
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
  await mkdir(dirname(target), { recursive: true });
  if (value.isDirectory()) await privateTree(source, temporary);
  else await privateCopy(source, temporary);
  try {
    const copied = await retentionFiles(temporary);
    if (before.length !== copied.length) throw new Error(`Source copy is incomplete: ${source}`);
    for (let index = 0; index < before.length; index++) {
      if (relative(source, before[index].path) !== relative(temporary, copied[index].path)
        || await digest(before[index], cache) !== await digest(copied[index], cache)) throw new Error(`Source copy differs: ${source}`);
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
    const mine = await info(from), theirs = await info(to);
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
    if (!theirs && apply) { await publishSource(from, to, cache); report.publishedFiles++; }
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
      // Keep the worktree intact until git removes it. Only unique versions enter history.
      const canonical = join(ctx.main, '.local', name), archive = join(ctx.main, '.local/agent-archives', task.id, name);
      const baseline = await readJSON(join(task.path, '.local/agents/source-baselines', name + '.json'), {});
      const report = await retainSourceTree(source, canonical, { apply: true, baseline });
      for (const name of report.conflicts) {
        const from = join(source, name), to = join(archive, name);
        await safeRetentionPath(archive, to);
        if (!await info(to)) await publishSource(from, to, new Map());
        else {
          const retained = await retainSourceTree(from, to);
          if (retained.conflicts.length) throw new Error(`Different retained source exists: ${to}`);
        }
      }
      if (report.conflicts.length) await writeJSON(join(archive, '..', name + '-retained.json'), report);
    }
  }, { ctx });
}

export function selectExpiredEvidence(candidates, { now = Date.now(), days = retentionPolicy.days, bytes = retentionPolicy.bytes } = {}) {
  const ordered = [...candidates].sort((a, b) => a.completedAt - b.completedAt || a.path.localeCompare(b.path));
  let remaining = ordered.reduce((sum, item) => sum + item.bytes, 0);
  const selected = [];
  for (const item of ordered) if (now - item.completedAt >= days * 86400000 || remaining > bytes) {
    selected.push(item); remaining -= item.bytes;
  }
  return { selected, remaining };
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
export async function pruneRetention(ctx, { apply = false, sources = false, managedOnly = false, now = Date.now(), budget = retentionPolicy.bytes, progress = () => {} } = {}) {
  const ownership = await acquire('retention', { ctx, tryOnly: managedOnly });
  if (!ownership) return { deferred: true, reason: 'Another retention operation owns cleanup.' };
  try {
    const before = await freeSpace(ctx.main), report = { apply, policy: { ...retentionPolicy, bytes: budget }, beforeFreeBytes: before, compacted: [], removed: [], sourceReports: [], protected: [], unknown: [], errors: [] };
    const archiveRoot = join(ctx.main, '.local/agent-archives'), candidates = [], cache = new Map(), versions = new Map(), protectedSources = new Set();
    await safeRetentionPath(ctx.common, ctx.store);
    await safeRetentionPath(ctx.main, archiveRoot);
    const head = await git(['rev-parse', 'HEAD'], ctx.main);
    const names = (await readdir(join(ctx.store, 'tasks')).catch(error => { if (error.code === 'ENOENT') return []; throw error; })).filter(name => name.endsWith('.json')).sort();
    const archives = await readdir(archiveRoot).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    if (sources && apply) for (const id of archives) {
      const archive = join(archiveRoot, id); await safeRetentionPath(archiveRoot, archive);
      if (!(await info(archive))?.isDirectory()) continue;
      for (const name of await readdir(archive)) if (/^(animation-packs|synty-library)-references\.jsonl$/.test(name)) {
        const path = join(archive, name); await safeRetentionPath(archiveRoot, path);
        const handle = await open(path);
        try {
          for await (const line of handle.readLines()) {
            if (!line.trim()) continue;
            const record = JSON.parse(line); await safeRetentionPath(archiveRoot, record.retained);
            protectedSources.add(record.retained);
          }
        } finally { await handle.close(); }
      }
    }
    for (const id of archives) if (!names.includes(id + '.json')) report.unknown.push({ path: join(archiveRoot, id), reason: 'unregistered archive; preserved' });
    for (const name of names) {
      const id = name.slice(0, -5);
      if (!slug.test(id)) { report.unknown.push(join(ctx.store, 'tasks', name)); continue; }
      await safeRetentionPath(ctx.store, join(ctx.store, 'tasks', name));
      const task = await readTask(ctx, id);
      if (task?.status !== 'cleaned') { report.protected.push({ path: task?.path, reason: 'unfinished task' }); continue; }
      const lease = await acquire(`task-${id}`, { ctx, tryOnly: true });
      if (!lease) { report.protected.push({ path: task.path, reason: 'task operation owns its lock' }); continue; }
      const archive = join(archiveRoot, id);
      try {
        await safeRetentionPath(archiveRoot, archive);
        const retained = await readJSON(join(archive, 'retained.json'), null);
        const completedAt = Date.parse(task.cleanedAt ?? task.integratedAt);
        if (await info(task.path) || !Number.isFinite(completedAt) || !retained || retained.task !== id) {
          report.protected.push({ path: archive, reason: 'missing completion/ownership evidence or remaining worktree' }); continue;
        }
        if (!await verifiedClosedHistory(join(archive, 'browser-history.json'))) {
          report.protected.push({ path: archive, reason: 'browser exit not verified' }); continue;
        }
        if (sources && apply) await withResource('source-retention', async () => {
          for (const collection of sourceNames) {
            const source = join(archive, collection);
            if (!await info(source)) continue;
            progress(`Verifying sources: ${id}/${collection}`);
            report.sourceReports.push(await retainSourceTree(source, join(ctx.main, '.local', collection), { apply: true, removeDuplicates: true, cache, versions, references: join(archive, collection + '-references.jsonl'), protectedSources, progress: value => progress(`${id}/${collection}: ${value.duplicateFiles} verified files`) }));
          }
        }, { ctx });
        const compact = compactTask(task);
        if (JSON.stringify(compact) !== JSON.stringify(task)) { report.compacted.push(id); if (apply) await saveTask(ctx, compact); }
        const pinned = retained.pin || task.retentionPin;
        for (const entry of await readdir(archive)) {
          const path = join(archive, entry);
          if (managedOnly && !evidenceNames.includes(entry)) continue;
          let files;
          try { files = await retentionFiles(path); }
          catch (error) { report.protected.push({ path, reason: error.message }); continue; }
          const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
          if (!evidenceNames.includes(entry) || pinned || entry === 'checks' && task.lastCheck?.inputs?.head === head) {
            report.protected.push({ path, bytes, reason: pinned ? 'pinned: ' + pinned : entry === 'checks' ? 'current validation evidence' : 'source or durable ownership metadata' }); continue;
          }
          candidates.push({ path, bytes, completedAt, files, task: compact });
        }
      } catch (error) { report.errors.push({ task: id, message: error.message }); }
      finally { await lease.release(); }
      progress(`Inspected ${id}`);
    }
    const desktop = join(ctx.main, '.local/desktop');
    await safeRetentionPath(ctx.main, desktop);
    if (await info(desktop) && !(await liveLeases(ctx)).some(lease => lease.resource === 'heavy')) {
      const current = await readJSON(join(desktop, 'candidate.json'), {});
      for (const entry of await readdir(desktop)) {
        const match = entry.match(/^lantern-web-([a-f0-9]{40})\.tar\.gz$/);
        if (!match || match[1] === head || match[1] === current.revision || await info(join(desktop, entry + '.pin'))) continue;
        const path = join(desktop, entry), files = await retentionFiles(path);
        candidates.push({ path, files, bytes: files.reduce((sum, file) => sum + file.bytes, 0), completedAt: Number((await info(path)).mtimeMs), desktop: true });
      }
    }
    const eviction = selectExpiredEvidence(candidates, { now, bytes: budget });
    for (const item of eviction.selected) {
      const lease = await acquire(item.desktop ? 'desktop-retention' : `task-${item.task.id}`, { ctx, tryOnly: true });
      if (!lease) { report.errors.push({ path: item.path, message: 'Task operation owns its lock; preserved' }); continue; }
      try {
        if (apply) {
          if (item.desktop) {
            if ((await liveLeases(ctx)).some(lease => lease.resource === 'heavy')) { report.errors.push({ path: item.path, message: 'Heavy operation active; preserved' }); continue; }
          } else {
            const registered = await readTask(ctx, item.task.id);
            if (registered?.status !== 'cleaned' || registered.retentionPin || await info(registered.path)) throw new Error('Task is no longer safely completed or was pinned.');
          }
          await safeRetentionPath(item.desktop ? desktop : archiveRoot, item.path);
          const current = await retentionFiles(item.path);
          if (JSON.stringify(current) !== JSON.stringify(item.files)) { report.errors.push({ path: item.path, message: 'Evidence changed; preserved' }); continue; }
          // Persist expiration before removal so interruption never leaves a silent dangling reference.
          if (!item.desktop) {
            const retainedPath = join(dirname(item.path), 'retained.json'), retained = await readJSON(retainedPath);
            if (retained.pin) { report.errors.push({ path: item.path, message: 'Evidence was pinned; preserved' }); continue; }
            retained.expired ??= {}; retained.expired[item.path.split(sep).at(-1)] = new Date(now).toISOString();
            await writeJSON(retainedPath, retained);
          }
          if (item.task && (item.task.lastCheck?.evidence?.startsWith(item.path + sep) || item.task.lastCheck?.evidence === item.path)) {
            item.task.lastCheck.evidenceExpiredAt = new Date(now).toISOString(); await saveTask(ctx, item.task);
          }
          await rm(item.path, { recursive: true });
        }
        report.removed.push({ path: item.path, bytes: item.bytes });
      } finally { await lease.release(); }
    }
    report.remainingEvidenceBytes = candidates.reduce((sum, item) => sum + item.bytes, 0) - report.removed.reduce((sum, item) => sum + item.bytes, 0);
    const managed = new Set(['agent-archives', 'agents', 'worktrees', ...sourceNames, 'checks', 'build-public']);
    if (!managedOnly) for (const name of [...managed].filter(name => name !== 'agent-archives').concat('source-replacements')) {
      const path = join(ctx.main, '.local', name);
      try {
        await safeRetentionPath(ctx.main, path);
        const files = await retentionFiles(path);
        report.protected.push({ path, bytes: files.reduce((sum, file) => sum + file.bytes, 0), reason: 'canonical sources, active work, current staging or validation' });
      } catch (error) { report.protected.push({ path, reason: error.message }); }
    }
    managed.add('source-replacements');
    for (const name of managedOnly ? [] : await readdir(join(ctx.main, '.local')).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) if (!managed.has(name)) {
      const path = join(ctx.main, '.local', name);
      try { const files = await retentionFiles(path); report.unknown.push({ path, bytes: files.reduce((sum, file) => sum + file.bytes, 0) }); }
      catch (error) { report.unknown.push({ path, reason: error.message }); }
    }
    report.afterFreeBytes = await freeSpace(ctx.main); report.freeSpaceChangeBytes = report.afterFreeBytes - before;
    return report;
  } finally { await ownership.release(); }
}
