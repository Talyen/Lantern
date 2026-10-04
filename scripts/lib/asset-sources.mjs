import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { privateCopy } from '../agents/copy.mjs';
import { safeRelativePath, hashFile } from './assets.mjs';

/** Validate archive names before reading them or resolving output paths. */
export function sourceEntry(name) {
  if (!safeRelativePath(name)) throw new Error(`Unsafe archive entry: ${name}`);
  return name;
}
/** Validate one ZIP inventory before reading literal entries; unzip otherwise treats names as globs. */
export async function sourceArchiveReader(archive, prefix) {
  const execute = promisify(execFile);
  const listing = (await execute('unzip', ['-Z1', archive], { maxBuffer: 1024 * 1024 })).stdout.trimEnd().split('\n');
  if (new Set(listing).size !== listing.length) throw new Error('Duplicate archive entry');
  const names = [];
  for (const name of listing) {
    if (!name.startsWith(prefix)) throw new Error(`Unexpected archive root: ${name}`);
    const relative = name.slice(prefix.length);
    if (!relative) continue;
    sourceEntry(relative.endsWith('/') ? relative.slice(0, -1) : relative);
    if (!relative.endsWith('/')) names.push(relative);
  }
  const entries = new Set(names);
  return { names, async read(name) {
    sourceEntry(name);
    if (!entries.has(name)) throw new Error(`Missing archive entry: ${name}`);
    const pattern = (prefix + name).replace(/[\\*?[\]]/g, '\\$&');
    return (await execute('unzip', ['-p', archive, pattern], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 })).stdout;
  } };
}
/** Preflight every original before any writes; a re-import never replaces source bytes. */
export async function preserveSources(directory, files, archive, archiveName) {
  const originals = [...files].map(([name, bytes]) => [resolve(directory, sourceEntry(name)), bytes]);
  const archivePath = resolve(directory, sourceEntry(archiveName));
  if (originals.some(([path]) => path === archivePath)) throw new Error('Source entry conflicts with preserved archive name.');
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const missing = [];
  for (const [path, bytes] of [[archivePath, null], ...originals]) {
    let previous;
    try { previous = await hashFile(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (previous === undefined) missing.push([path, bytes]);
    else if (previous !== (path === archivePath ? await hashFile(archive) : hash(bytes))) throw new Error(`Preserved source differs: ${path}. Import in a fresh task to retain both versions.`);
  }
  for (const [path, bytes] of missing) {
    await mkdir(resolve(path, '..'), { recursive: true });
    if (path === archivePath) await privateCopy(archive, path);
    else await writeFile(path, bytes, { flag: 'wx' });
  }
}
