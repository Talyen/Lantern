import { access, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { cli, isMain, parseArgs, root } from './cli.mjs';
import { safeRelativePath } from './assets.mjs';

export const sourceCollections = ['animation-packs', 'synty-library'];
// Conversion metadata, requests, logs and the Unity workspace remain local caches.
export const syntyOriginals = ['sources', 'Archives', 'ashen-veil-environment'];
export function assetSourceRoot(ctx = {}) {
  return resolve(ctx.assetSourceRoot ?? process.env.LANTERN_ASSET_SOURCE_ROOT
    ?? join(homedir(), 'Documents/Asset Library/3d Assets/Lantern Sources'));
}
export function sourceRelative(path) {
  if (!safeRelativePath(path) || !sourceCollections.includes(path.split('/')[0])) throw new Error(`Invalid source collection path: ${path}`);
  return path;
}
export function originalTrees(collection, base) {
  if (!sourceCollections.includes(collection)) throw new Error(`Unknown source collection: ${collection}`);
  return collection === 'animation-packs' ? [base] : syntyOriginals.map(name => join(base, name));
}
async function exists(path) {
  try { await access(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
/** Read originals without hydrating main or changing the external library. */
export async function retainedSource(path, { ctx, cwd = root } = {}) {
  sourceRelative(path);
  ctx ??= await (await import('../agents/state.mjs')).context(cwd);
  const candidates = [...(cwd !== ctx.main ? [join(cwd, '.local', path)] : []), join(assetSourceRoot(ctx), path), join(ctx.main, '.local', path)];
  const archives = join(ctx.main, '.local/agent-archives');
  const tasks = await readdir(archives).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  candidates.push(...tasks.sort().reverse().map(task => join(archives, task, path)));
  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  throw new Error(`Original source unavailable: ${path}. Restore it under ${assetSourceRoot(ctx)}, then run npm run agent:sources -- --sources ${path.split('/')[0]}.`);
}
export async function requireWorkingSource(path, cwd = root) {
  sourceRelative(path);
  const target = join(cwd, '.local', path);
  if (!await exists(target)) throw new Error(`Working source unavailable: ${path}. In the owned task, run npm run agent:sources -- --sources ${path.split('/')[0]} before preparing art.`);
  return target;
}
if (isMain(import.meta.url)) await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--path': 'value' });
  if (args['--help']) { console.log('Resolve a retained original without writing: node scripts/lib/source-location.mjs --path COLLECTION/RELATIVE_PATH'); return; }
  if (!args['--path']) throw new Error('Supply --path COLLECTION/RELATIVE_PATH.');
  console.log(await retainedSource(args['--path']));
});
