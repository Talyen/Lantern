import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, resolve } from 'node:path';
import { cli, isMain, parseArgs, root, UsageError } from '../../lib/cli.mjs';
import { preserveSources, sourceEntry } from '../../lib/asset-sources.mjs';
import { prepareModel, inspectModel, yUpBounds } from './validate.mjs';

const execute = promisify(execFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const packs = {
  'autumn-atlas': { archive: 'Autumn_Atlas_Botanical_Expansion_Compact.zip', prefix: 'Autumn_Atlas_Botanical_Expansion/', count: 25 },
  hearthsteel: { archive: 'Hearthsteel_Traditional_11_Weapons_Compact.zip', prefix: 'Hearthsteel_Armory/', count: 11 },
};
const library = resolve(root, 'public/vendor/synty/library');
const sourceRoot = resolve(root, '.local/animation-packs/generated-packs');
async function preservedArchive(id) {
  const suffix = `animation-packs/generated-packs/${id}/${packs[id].archive}`;
  const paths = [resolve(sourceRoot, id, packs[id].archive)];
  // Completed-task cleanup retains source archives beside main, rather than exposing them.
  const archives = resolve(root, '.local/agent-archives');
  const tasks = await readdir(archives).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  paths.push(...tasks.sort().reverse().map(task => resolve(archives, task, suffix)));
  for (const path of paths) {
    try { await access(path); return path; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  throw new Error(`Preserved ${id} archive unavailable; import the pack in an owned task first.`);
}
async function readJSON(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
async function write(path, bytes) { await mkdir(resolve(path, '..'), { recursive: true }); await writeFile(path, bytes); }
const jsonBytes = value => JSON.stringify(value, null, 2) + '\n';

/** The compact receipt hashes every delivered file; full manifests also mention omitted PNGs. */
async function readPack(archive, pack) {
  const read = async name => (await execute('unzip', ['-p', archive, pack.prefix + sourceEntry(name)], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 })).stdout;
  const sums = await read('COMPACT_SHA256SUMS.txt'), files = new Map();
  for (const line of sums.toString().trim().split('\n')) {
    const match = /^([a-f0-9]{64}) {2}(.+)$/.exec(line);
    if (!match || !match[2].startsWith(pack.prefix)) throw new Error('Invalid compact hash receipt');
    const name = sourceEntry(match[2].slice(pack.prefix.length));
    if (files.has(name)) throw new Error(`Duplicate source entry: ${name}`);
    const bytes = await read(name);
    if (hash(bytes) !== match[1]) throw new Error(`Source hash mismatch: ${name}`);
    files.set(name, bytes);
  }
  // Delivery notes and the receipt itself cannot appear in their own hash list.
  files.set('COMPACT_EDITION.txt', await read('COMPACT_EDITION.txt'));
  const listing = (await execute('unzip', ['-Z1', archive], { maxBuffer: 1024 * 1024 })).stdout.trim().split('\n');
  if (new Set(listing).size !== listing.length || listing.some(name => !name.startsWith(pack.prefix)
    || !files.has(name.slice(pack.prefix.length)) && name !== pack.prefix + 'COMPACT_SHA256SUMS.txt')) throw new Error('Unreceipted or duplicate archive entry');
  files.set('COMPACT_SHA256SUMS.txt', sums);
  return files;
}

function entriesFor(id, files) {
  const manifest = JSON.parse(files.get('manifest.json'));
  if (id === 'autumn-atlas') {
    if (manifest.units !== 'metres' || manifest.assets?.length !== 24) throw new Error('Unexpected botanical manifest');
    return manifest.assets.map(entry => ({ file: entry.glb, name: entry.title, slug: entry.id.replaceAll('_', '-'), category: entry.category,
      description: entry.description, expected: { triangles: entry.triangles, primitives: 1, bounds: yUpBounds(entry.bounds_blender), ground: true, vertexColors: true } }));
  }
  const stats = JSON.parse(files.get('stats.json'));
  if (manifest.units !== 'metres' || manifest.asset_count !== 11 || stats.length !== 11) throw new Error('Unexpected weapon manifest');
  return stats.map(entry => ({ file: entry.file, name: entry.name, slug: entry.name.toLowerCase(), category: 'weapons',
    expected: { triangles: entry.triangles, primitives: entry.material_primitives, bounds: yUpBounds(entry.bounds_blender_m), identityMesh: true } }));
}

/** Import only reviewed art into the existing library; keep all source/support files private. */
export async function importPacks(ids, downloads, verify = false) {
  const catalogPath = resolve(library, 'catalog.json');
  const catalog = await readJSON(catalogPath, { version: 1, complete: true, assets: {} });
  if (catalog.version !== 1 || !catalog.assets) throw new Error('Unsupported existing catalog');
  const staged = [];
  for (const id of ids) {
    const pack = packs[id], archive = verify ? await preservedArchive(id) : resolve(downloads, pack.archive);
    const files = await readPack(archive, pack), entries = entriesFor(id, files), prepared = [], assets = {};
    const glbs = [...files.keys()].filter(name => name.endsWith('.glb'));
    if (glbs.length !== pack.count || new Set(entries.map(entry => entry.slug)).size !== entries.length
      || entries.some(entry => !files.has(entry.file))) throw new Error(`Unexpected asset inventory: ${id}`);
    for (const file of glbs) {
      const entry = entries.find(entry => entry.file === file);
      if (!entry && (id !== 'autumn-atlas' || file !== 'glb/demo_amber_glade.glb')) throw new Error(`Unexpected model: ${file}`);
      const source = files.get(file), output = prepareModel(source, file);
      const url = entry ? `/vendor/synty/library/models/${id}/${basename(file)}` : '/vendor/autumn-atlas/reference-scenes/demo_amber_glade.glb';
      const path = resolve(root, 'public', url.slice(1));
      const bytes = verify ? await readFile(path) : output.bytes;
      if (hash(bytes) !== hash(output.bytes)) throw new Error(`Prepared art differs from preserved source: ${url}`);
      const checked = await inspectModel(bytes, file, entry?.expected);
      const assetId = entry ? `${id}:model:${entry.slug}` : undefined;
      const report = { file, url, sourceHash: hash(source), preparedHash: hash(bytes), renamedPivotDescriptions: output.renamed, ...checked };
      prepared.push({ path, bytes, report });
      if (entry) {
        assets[assetId] = { id: assetId, pack: id, name: entry.name, kind: 'model', url, sourceHash: hash(source), preparedHash: hash(bytes), dependencies: [], status: 'converted', bounds: checked.bounds,
          category: entry.category, description: entry.description,
          warnings: id === 'hearthsteel' ? ['Static grip-centred prop; author rig-specific hand rotation, secondary grip and any bow/reload animation before equipping.']
              : ['Static visual geometry only; author collision, navigation, wind and interactions when placing.'] };
        if (verify && (catalog.assets[assetId]?.url !== url || catalog.assets[assetId]?.status !== 'converted'
          || catalog.assets[assetId]?.preparedHash !== hash(bytes))) throw new Error(`Missing or stale library registration: ${assetId}`);
      }
    }
    if (prepared.reduce((sum, item) => sum + (item.report.file.includes('demo_') ? 0 : item.report.triangles), 0)
      !== ({ 'autumn-atlas': 86902, hearthsteel: 37098 })[id]) throw new Error(`Pack triangle total differs: ${id}`);
    staged.push({ id, archive, files, prepared, assets });
  }
  // Validate every selected pack before exposing any new model/catalog entry.
  if (!verify) {
    for (const pack of staged) await preserveSources(resolve(sourceRoot, pack.id), pack.files, pack.archive, packs[pack.id].archive);
    for (const pack of staged) {
      for (const item of pack.prepared) await write(item.path, item.bytes);
      Object.assign(catalog.assets, pack.assets);
      await write(resolve(sourceRoot, pack.id, 'lantern-import.json'), jsonBytes({ pack: pack.id, archiveHash: hash(await readFile(pack.archive)), verifiedSourceFiles: pack.files.size,
        scope: 'Original owner-supplied AI-created art; no third-party geometry/textures declared by the delivered README. Bundled scripts retained without execution. No gameplay selection or placements.',
        files: pack.prepared.map(item => item.report) }));
    }
    await write(catalogPath, jsonBytes(catalog));
  }
  for (const pack of staged) console.log(`${verify ? 'Verified' : 'Imported'} ${pack.id}: ${Object.keys(pack.assets).length} library assets, ${pack.prepared.length} GLBs; hashes, decoded geometry, Y-up bounds, materials and pivots passed.`);
  console.log('Find assets: npm run levels:find -- --query autumn-atlas (or hearthsteel). No scene placements or gameplay selections added.');
}
if (isMain(import.meta.url)) await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--downloads': 'value', '--pack': 'value', '--verify': 'boolean' });
  if (args['--help']) { console.log('Usage: npm run assets:import-generated -- [--downloads PATH] [--pack autumn-atlas,hearthsteel] [--verify]\n--verify checks preserved archives, prepared outputs and catalog references without writing.'); return; }
  const ids = args['--pack']?.split(',') ?? Object.keys(packs);
  if (!ids.length || ids.some(id => !Object.hasOwn(packs, id)) || new Set(ids).size !== ids.length) throw new UsageError('Choose distinct packs: autumn-atlas,hearthsteel');
  if (args['--verify'] && args['--downloads']) throw new UsageError('--verify reads preserved sources; omit --downloads');
  await importPacks(ids, resolve(args['--downloads'] ?? resolve(homedir(), 'Downloads')), Boolean(args['--verify']));
});
