import { deletionExclusions } from '../review/exclusions.mjs';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { cli, isMain, parseArgs, root, UsageError } from '../../lib/cli.mjs';
import { preserveSources, sourceEntry, sourceArchiveReader } from '../../lib/asset-sources.mjs';
import { context } from '../../agents/state.mjs';
import { prepareModel, inspectModel } from './validate.mjs';
import { packs, defaultPacks, entriesFor, demoExpected, packWarnings } from './definitions.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const library = resolve(root, 'public/vendor/synty/library');
const sourceRoot = resolve(root, '.local/animation-packs/generated-packs');
async function preservedArchive(id) {
  const suffix = `animation-packs/generated-packs/${id}/${packs[id].archive}`;
  const paths = [resolve(sourceRoot, id, packs[id].archive)];
  // Completed-task cleanup retains source archives beside main, rather than exposing them.
  const archives = resolve((await context()).main, '.local/agent-archives');
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

/** Check portable paths before reading; retain every delivered file, including receipts. */
async function readPack(archive, pack) {
  const { names, read } = await sourceArchiveReader(archive, pack.prefix), files = new Map();
  for (const name of names) files.set(name, await read(name));
  const supplied = new Map();
  const checkHash = (name, digest) => {
    sourceEntry(name);
    if (!/^[a-f0-9]{64}$/.test(digest) || !files.has(name) || hash(files.get(name)) !== digest) throw new Error(`Source hash mismatch or missing file: ${name}`);
    if (supplied.has(name) && supplied.get(name) !== digest) throw new Error(`Conflicting source hashes: ${name}`);
    supplied.set(name, digest);
  };
  for (const [name, bytes] of files) {
    if (!name.endsWith('SHA256SUMS.txt')) continue;
    const receiptNames = new Set();
    for (const line of bytes.toString().trim().split('\n')) {
      const match = /^([a-f0-9]{64}) {2}(.+)$/.exec(line);
      if (!match) throw new Error(`Invalid hash receipt: ${name}`);
      const relative = match[2].startsWith(pack.prefix) ? match[2].slice(pack.prefix.length) : match[2];
      if (receiptNames.has(relative)) throw new Error(`Duplicate receipt entry: ${relative}`);
      receiptNames.add(relative);
      checkHash(relative, match[1]);
    }
  }
  if (files.has('file_index.json')) {
    const entries = JSON.parse(files.get('file_index.json')).files;
    if (!Array.isArray(entries) || new Set(entries.map(entry => entry.path)).size !== entries.length) throw new Error('Invalid file index');
    for (const entry of entries) {
      checkHash(entry.path, entry.sha256);
      if (entry.bytes !== files.get(entry.path).length) throw new Error(`Indexed size mismatch: ${entry.path}`);
    }
  }
  if (pack.compact && (!files.has('COMPACT_SHA256SUMS.txt') || !files.has('COMPACT_EDITION.txt')
    || names.some(name => !supplied.has(name) && !['COMPACT_SHA256SUMS.txt', 'COMPACT_EDITION.txt'].includes(name)))) throw new Error('Unreceipted compact archive entry');
  if (!files.has('manifest.json') && !pack.weapon) throw new Error('Missing pack manifest');
  const manifest = files.has('manifest.json') ? JSON.parse(files.get('manifest.json')) : {};
  if (!pack.compact) for (const entry of Array.isArray(manifest.assets) ? manifest.assets : []) {
    const digest = entry.sha256 ?? entry.glb_sha256 ?? entry.validation_sha256;
    if (digest) checkHash(entry.file ?? entry.glb ?? `glb/${entry.id}.glb`, digest);
  }
  for (const entry of manifest.provenance ?? []) if (entry.source_sha256) checkHash(entry.file, entry.source_sha256);
  // Current-file hashes in delivered QA reports are receipts too; historical
  // geometry/revision fingerprints are retained rather than treated as file hashes.
  if (!pack.compact) {
    const visit = value => {
      if (!value || typeof value !== 'object') return;
      const reference = value.file ?? (pack.weapon ? value.path : undefined);
      if (typeof reference === 'string' && value.sha256 !== undefined) {
        sourceEntry(reference);
        // Sword QA names a GLB basename; other delivery receipts use archive-relative paths.
        const name = pack.weapon && reference === basename(reference) && reference.endsWith('.glb') ? `glb/${reference}` : reference;
        checkHash(name, value.sha256);
        if (pack.weapon && value.bytes !== undefined && value.bytes !== files.get(name).length) throw new Error(`Receipt size mismatch: ${name}`);
      }
      for (const child of Object.values(value)) visit(child);
    };
    for (const [name, bytes] of files) if (name.endsWith('.json')) visit(JSON.parse(bytes));
  }
  return { files, supplied };
}

/** Import reviewed art into the existing library; keep source/support files private. */
export async function importPacks(ids, downloads, verify = false) {
  const catalogPath = resolve(library, 'catalog.json');
  const currentCatalog = () => readJSON(catalogPath, { version: 1, complete: true, assets: {} });
  const catalog = await currentCatalog();
  if (catalog.version !== 1 || !catalog.assets) throw new Error('Unsupported existing catalog');
  const staged = [], excluded = deletionExclusions();
  for (const id of ids) {
    const pack = packs[id], archive = verify ? await preservedArchive(id) : resolve(downloads, pack.archive);
    const { files, supplied } = await readPack(archive, pack), entries = entriesFor(id, files), prepared = [], supportingModels = [], assets = {};
    const archiveHash = hash(await readFile(archive));
    const sources = [...files].map(([file, bytes]) => ({ file, bytes: bytes.length, sha256: hash(bytes), suppliedChecksum: supplied.has(file) }));
    if (verify) {
      const receipt = await readJSON(resolve(dirname(archive), 'lantern-import.json'));
      if (!receipt || receipt.archiveHash !== archiveHash) throw new Error(`Missing or stale import receipt: ${id}`);
      if (!pack.compact && JSON.stringify(receipt.sources) !== JSON.stringify(sources)) throw new Error(`Source fingerprint receipt differs: ${id}`);
      for (const entry of sources) {
        if (hash(await readFile(resolve(dirname(archive), entry.file))) !== entry.sha256) throw new Error(`Preserved source differs: ${id}/${entry.file}`);
      }
    }
    const glbs = [...files.keys()].filter(name => name.endsWith('.glb'));
    const expectedFiles = [...entries.map(entry => entry.file), ...(pack.demos ?? []), ...(pack.supporting ?? [])];
    if (entries.length !== pack.count || glbs.length !== expectedFiles.length || new Set(expectedFiles).size !== expectedFiles.length
      || new Set(entries.map(entry => entry.slug)).size !== entries.length || expectedFiles.some(file => !files.has(sourceEntry(file)))
      || glbs.some(file => !expectedFiles.includes(file))) throw new Error(`Unexpected asset inventory: ${id}`);
    for (const file of glbs) {
      const source = files.get(file), output = prepareModel(source, file);
      if (pack.supporting?.includes(file)) {
        supportingModels.push({ file, sourceHash: hash(source), ...await inspectModel(output.bytes, file) });
        continue;
      }
      const entry = entries.find(entry => entry.file === file);
      const url = entry ? `/vendor/synty/library/models/${id}/${basename(file)}` : `/vendor/${id}/reference-scenes/${basename(file)}`;
      const path = resolve(root, 'public', url.slice(1));
      const bytes = verify && !excluded(entry ? `${id}:model:${entry.slug}` : '', url) ? await readFile(path) : output.bytes;
      if (hash(bytes) !== hash(output.bytes)) throw new Error(`Prepared art differs from preserved source: ${url}`);
      const checked = await inspectModel(bytes, file, entry?.expected ?? demoExpected(id, file, files));
      const assetId = entry ? `${id}:model:${entry.slug}` : undefined;
      const report = { file, url, assetId, sourceHash: hash(source), preparedHash: hash(bytes), renamedPivotDescriptions: output.renamed, ...checked };
      prepared.push({ path, bytes, report });
      if (entry) {
        assets[assetId] = JSON.parse(JSON.stringify({ id: assetId, pack: id, name: entry.name, kind: 'model', url, sourceHash: hash(source), preparedHash: hash(bytes),
          dependencies: [], status: 'converted', bounds: checked.bounds, category: entry.category, description: entry.description, ...entry.metadata, warnings: packWarnings(id) }));
        if (verify && !excluded(assetId, url) && Object.entries(assets[assetId]).some(([key, value]) => JSON.stringify(catalog.assets[assetId]?.[key]) !== JSON.stringify(value))) throw new Error(`Missing or stale library registration: ${assetId}`);
      }
    }
    const triangleTotal = prepared.reduce((sum, item) => sum + (entries.some(entry => entry.file === item.report.file) ? item.report.triangles : 0), 0);
    const manifest = files.has('manifest.json') ? JSON.parse(files.get('manifest.json')) : {};
    const expectedTotal = pack.triangleTotal ?? manifest.total_standalone_triangles
      ?? manifest.export_totals?.triangles ?? (pack.weapon ? manifest.triangles : undefined);
    if (expectedTotal !== undefined && triangleTotal !== expectedTotal) throw new Error(`Pack triangle total differs: ${id}`);
    staged.push({ id, archive, archiveHash, files, supplied, sources, prepared, supportingModels, assets });
  }
  // Validate every selected pack before exposing any new model/catalog entry.
  if (!verify) {
    for (const pack of staged) {
      if (hash(await readFile(pack.archive)) !== pack.archiveHash) throw new Error(`Archive changed during import: ${pack.id}`);
      await preserveSources(resolve(sourceRoot, pack.id), pack.files, pack.archive, packs[pack.id].archive);
    }
    for (const pack of staged) {
      for (const item of pack.prepared) if (!excluded(item.report.assetId ?? '', item.report.url)) await write(item.path, item.bytes);
      for (const [id, asset] of Object.entries(pack.assets)) if (excluded(id, asset.url)) delete pack.assets[id];
      await write(resolve(sourceRoot, pack.id, 'lantern-import.json'), jsonBytes({ pack: pack.id, archiveHash: pack.archiveHash, verifiedSourceFiles: pack.files.size,
        suppliedChecksumFiles: pack.supplied.size, sources: pack.sources,
        scope: 'Owner-supplied generated art. Bundled scripts retained without execution. No gameplay selection or placements. Unsupplied checksums are import-time fingerprints, not independent delivery verification.',
        files: pack.prepared.map(item => item.report), supportingModels: pack.supportingModels }));
    }
    // Re-read before publication so unrelated additions in this checkout survive.
    const latest = await currentCatalog();
    if (latest.version !== 1 || !latest.assets) throw new Error('Unsupported existing catalog');
    for (const [id, asset] of Object.entries(latest.assets)) if (excluded(id, asset.url)) delete latest.assets[id];
    for (const pack of staged) Object.assign(latest.assets, pack.assets);
    await write(catalogPath, jsonBytes(latest));
  }
  for (const pack of staged) console.log(`${verify ? 'Verified' : 'Imported'} ${pack.id}: ${Object.keys(pack.assets).length} library assets, ${pack.prepared.length} prepared GLBs; ${pack.supplied.size} supplied file checksums, ${pack.sources.length} retained fingerprints; decoded geometry, Y-up bounds, materials and named pivots passed.`);
  console.log(`Find assets: npm run levels:find -- --query ${ids[0]}. No scene placements or gameplay selections added.`);
}
if (isMain(import.meta.url)) await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--downloads': 'value', '--pack': 'value', '--verify': 'boolean' });
  if (args['--help']) { console.log(`Usage: npm run assets:import-generated -- [--downloads PATH] [--pack IDS] [--verify]\nPacks: ${Object.keys(packs).join(', ')}\nDefault: ${defaultPacks.join(',')}\n--verify checks preserved archives, prepared outputs and catalog references without writing.`); return; }
  const ids = args['--pack']?.split(',') ?? defaultPacks;
  if (!ids.length || ids.some(id => !Object.hasOwn(packs, id)) || new Set(ids).size !== ids.length) throw new UsageError(`Choose distinct packs: ${Object.keys(packs).join(',')}`);
  if (args['--verify'] && args['--downloads']) throw new UsageError('--verify reads preserved sources; omit --downloads');
  await importPacks(ids, resolve(args['--downloads'] ?? resolve(homedir(), 'Downloads')), Boolean(args['--verify']));
});
