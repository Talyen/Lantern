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
