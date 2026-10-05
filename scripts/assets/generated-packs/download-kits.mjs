import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { PropertyBinding } from 'three';
import { cli, isMain, parseArgs, root, UsageError } from '../../lib/cli.mjs';
import { preserveSources, sourceArchiveReader, sourceEntry } from '../../lib/asset-sources.mjs';
import { retainedSource } from '../../lib/source-location.mjs';
import { embeddedGlb } from '../../lib/glb.mjs';
import { deletionExclusions } from '../review/exclusions.mjs';
import { yUpBounds } from './validate.mjs';
import { inspectPNG, inspectTexturedModel } from './textured-validation.mjs';

const catalogName = 'Gothic_Dungeon_Props_Catalog.json';
const privateSuffix = 'animation-packs/download-kits';
const sourceRoot = resolve(root, '.local', privateSuffix);
const libraryPath = resolve(root, 'public/vendor/synty/library/catalog.json');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = bytes => JSON.parse(bytes.toString());
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const slug = value => value.toLowerCase().replaceAll('_', '-');
const yup = ([x, y, z]) => [x, z, -y];
const kits = [
  ['gothic-crypt-funerary', '01_crypt_funerary', 16, 'inventory.json'],
  ['gothic-ruined-statuary', '02_ruined_statuary', 16, 'inventory.json'],
  ['gothic-iron-barriers', '03_iron_doors_barriers', 16, 'metadata/asset_manifest.json'],
  ['gothic-chains-restraints', '04_chains_restraints', 16, 'metadata/asset_manifest.json'],
  ['gothic-altars-ritual', '05_altars_ritual', 16, 'metadata/inventory.json'],
  ['gothic-braziers-lighting', '06_braziers_lighting', 16, 'metadata/inventory.json'],
  ['gothic-armory-displays', '07_armory_displays', 16, 'metadata/inventory.json'],
  ['gothic-loot-debris', '08_loot_debris', 16, 'metadata/inventory.json'],
  ['highland-pass', '02_mountain_pass_v2', 20, 'metadata/inventory.json', /^02_Highland_Pass_v2_\d{2}_.+\.zip$/, 5],
  ['ashen-crossroads', '03_ruined_settlement', 25, 'metadata/asset_inventory.json', /^03_Ashen_Crossroads_Ruined_Settlement_v2_Vol\d{2}_.+\.zip$/, 3],
  ['marsh-islands', '06_marsh_islands', 20, 'metadata/inventory.json', /^06_Marsh_Islands_Source_Kit_v2\.zip$/, 1],
  ['greywatch-fortress', '08_fortress_grounds', 25, 'metadata/asset_inventory.json', /^08_Greywatch_Fortress_Grounds_v2_Vol\d{2}_.+\.zip$/, 3],
].map(([id, folder, count, inventory, pattern, volumes]) => ({ id, folder, count, inventory, pattern, volumes }));
async function exists(path) { try { await access(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function write(path, bytes) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes); }
async function readJSON(path, fallback) { return await exists(path) ? json(await readFile(path)) : fallback; }
async function retainedSources() {
  return dirname(await retainedSource(`${privateSuffix}/${catalogName}`));
}

/** Complementary ZIPs merge only identical duplicates; every delivered original stays private. */
async function readKit(directory, pack, receipts) {
  const files = new Map(), archives = [];
  for (const receipt of receipts) {
    const path = resolve(directory, sourceEntry(receipt.filename)), bytes = await readFile(path);
    const digest = hash(bytes);
    if (receipt.sha256 && (digest !== receipt.sha256 || bytes.length !== receipt.bytes)) throw new Error(`Archive receipt differs: ${receipt.filename}`);
    archives.push({ filename: receipt.filename, bytes: bytes.length, sha256: digest });
    const reader = await sourceArchiveReader(path, pack.folder + '/');
    for (const name of reader.names) {
      const content = await reader.read(name);
      if (files.has(name) && !files.get(name).equals(content)) throw new Error(`Conflicting volume file: ${pack.id}/${name}`);
      files.set(name, content);
    }
  }
  const supplied = new Set();
  const check = (name, digest, bytes) => {
    sourceEntry(name);
    if (!/^[a-f0-9]{64}$/.test(digest) || !files.has(name) || hash(files.get(name)) !== digest
      || bytes !== undefined && bytes !== files.get(name).length) throw new Error(`Source receipt differs: ${pack.id}/${name}`);
    supplied.add(name);
  };
  for (const [name, bytes] of files) {
    if (/SHA256SUMS\.txt$/i.test(name)) for (const line of bytes.toString().trim().split('\n')) {
      const match = /^([a-f0-9]{64})\s+\*?(.+)$/.exec(line);
      if (!match) throw new Error(`Invalid receipt: ${pack.id}/${name}`);
      const file = match[2].startsWith(pack.folder + '/') ? match[2].slice(pack.folder.length + 1) : match[2];
      check(file, match[1]);
    }
    if (!/(?:manifest\.sha256|file_checksums|file_manifest|package_manifest|SHA256SUMS)\.json$/i.test(name)) continue;
    const data = json(bytes);
    if (Array.isArray(data.files)) for (const entry of data.files) check(entry.path, entry.sha256, entry.bytes);
    else for (const [file, entry] of Object.entries(data)) {
      if (file === 'version') continue;
      check(file, typeof entry === 'string' ? entry : entry.sha256, typeof entry === 'string' ? undefined : entry.bytes);
    }
  }
  const images = [];
  for (const [file, bytes] of files) if (file.endsWith('.png')) images.push({ file, ...inspectPNG(bytes, `${pack.id}/${file}`) });
  return { files, archives, supplied, images };
}

function modelEntries(pack, files, gothic) {
  const inventory = json(files.get(pack.inventory));
  const entries = Array.isArray(inventory) ? inventory : inventory.assets ?? inventory.modules;
  if (entries?.length !== pack.count || new Set(entries.map(entry => entry.id)).size !== pack.count) throw new Error(`Incomplete inventory: ${pack.id}`);
  const glbs = [...files.keys()].filter(name => name.endsWith('.glb'));
  const references = glbs.filter(name => name.startsWith('examples/'));
  if (references.length !== (pack.pattern ? 2 : 0) || glbs.length !== entries.length + references.length) throw new Error(`Unexpected GLB inventory: ${pack.id}`);
  const roundtrip = files.has('metadata/export_roundtrip_validation.json') ? json(files.get('metadata/export_roundtrip_validation.json')).assets : [];
  const models = entries.map(entry => {
    const delivered = gothic?.assets.find(asset => asset.id === entry.id);
    const file = delivered?.glb_file ?? entry.glb ?? glbs.find(name => !name.startsWith('examples/') && basename(name, '.glb') === entry.id);
    if (!file || !files.has(sourceEntry(file)) || !Number.isInteger(entry.triangles) || entry.triangles <= 0
      || delivered && delivered.triangles !== entry.triangles) throw new Error(`Missing or inconsistent model: ${pack.id}/${entry.id}`);
    const { json: document } = embeddedGlb(files.get(file), file);
    const roots = document.scenes[document.scene ?? 0].nodes;
    if (roots.length !== 1 && pack.id !== 'marsh-islands') throw new Error(`Expected one placement root: ${file}`);
    const rootNode = document.nodes[roots[0]];
    const bounds = entry.bounds_zup_m ?? (entry.bounds_min_m ? { min: entry.bounds_min_m, max: entry.bounds_max_m }
      : entry.bounds_min_zup_m ? { min: entry.bounds_min_zup_m, max: entry.bounds_max_zup_m }
        : entry.bounds_min ? { min: entry.bounds_min, max: entry.bounds_max }
          : (() => { const row = roundtrip.find(row => row.asset === entry.id); return row && { min: row.bounds_min, max: row.bounds_max }; })());
    if (!bounds) throw new Error(`Missing source bounds: ${file}`);
    const pivots = [];
    for (const pivot of [...(entry.sockets ?? []), ...(entry.moving_parts ?? entry.movable_parts ?? [])]) {
      const node = document.nodes.find(node => node.name === pivot.name || node.name === `SOCKET_${pivot.name}`);
      if (!node) continue; // Some connectors are mathematical authoring data rather than node helpers.
      const position = pivot.position_gltf_yup_m ?? yup(pivot.position_zup_m ?? pivot.position_m ?? pivot.position ?? pivot.pivot_m);
      pivots.push({ name: PropertyBinding.sanitizeNodeName(node.name), position });
    }
    for (const connector of entry.connectors ?? []) if (connector.position_glb_yup_m
      && connector.position_glb_yup_m.some((value, axis) => Math.abs(value - yup(connector.position_zup_m)[axis]) > .001)) throw new Error(`Connector axis mismatch: ${file}`);
    return { file, entry, delivered, roots: roots.map(index => document.nodes[index].name),
      expected: { triangles: entry.triangles, bounds: yUpBounds(bounds), ...(roots.length === 1 ? { root: PropertyBinding.sanitizeNodeName(rootNode.name) } : {}), pivots } };
  });
  if (new Set(models.map(model => model.file)).size !== pack.count || glbs.some(file => !references.includes(file) && !models.some(model => model.file === file))) throw new Error(`Ambiguous model inventory: ${pack.id}`);
  return { models, references };
}

export async function importDownloadKits(downloads, verify = false) {
  const directory = verify ? await retainedSources() : downloads;
  const gothicBytes = await readFile(resolve(directory, catalogName)), gothic = json(gothicBytes);
  if (gothic.kit_count !== 8 || gothic.asset_count !== 128 || gothic.kits?.length !== 8) throw new Error('Unexpected Gothic source catalog');
  const names = await readdir(directory), excluded = deletionExclusions();
  const sourceCatalogFiles = new Map([[catalogName, gothicBytes]]);
  const textName = 'Gothic_Dungeon_Props_Catalog.txt';
  if (await exists(resolve(directory, textName))) sourceCatalogFiles.set(textName, await readFile(resolve(directory, textName)));
  const catalogSources = [...sourceCatalogFiles].map(([file, bytes]) => ({ file, bytes: bytes.length, sha256: hash(bytes) }));
  const retained = verify ? await readJSON(resolve(directory, 'lantern-import.json')) : undefined;
  if (verify && (!retained || JSON.stringify(retained.catalogSources) !== JSON.stringify(catalogSources))) throw new Error('Missing or changed retained catalog receipt');
  const currentCatalog = () => readJSON(libraryPath, { version: 1, complete: true, assets: {} });
  const catalog = await currentCatalog();
  if (catalog.version !== 1 || !catalog.assets) throw new Error('Unsupported private library catalog');
  const staged = [];
  for (const pack of kits) {
    const sourceKit = gothic.kits.find(kit => kit.folder === pack.folder);
    const receipts = sourceKit ? sourceKit.archives.volumes : names.filter(name => pack.pattern.test(name)).sort().map(filename => ({ filename }));
    if (!receipts?.length || receipts.some(receipt => !names.includes(receipt.filename)) || pack.volumes && receipts.length !== pack.volumes) throw new Error(`Missing or incomplete volume set: ${pack.id}`);
    if (pack.volumes > 1 && receipts.some((receipt, index) => Number(/(?:_Vol|_v2_)(\d{2})/.exec(receipt.filename)?.[1]) !== index + 1)) throw new Error(`Nonsequential volume set: ${pack.id}`);
    const data = await readKit(directory, pack, receipts);
    if (sourceKit && data.files.size !== sourceKit.archive_member_count) throw new Error(`Source member count differs: ${pack.id}`);
    const fingerprints = [...data.files].map(([file, bytes]) => ({ file, bytes: bytes.length, sha256: hash(bytes), suppliedChecksum: data.supplied.has(file) }));
    const previous = retained?.packs.find(row => row.id === pack.id);
    if (verify) {
      if (!previous || JSON.stringify(previous.archives) !== JSON.stringify(data.archives) || JSON.stringify(previous.sources) !== JSON.stringify(fingerprints)) throw new Error(`Retained receipts differ: ${pack.id}`);
      for (const row of fingerprints) if (hash(await readFile(resolve(directory, pack.id, row.file))) !== row.sha256) throw new Error(`Preserved original differs: ${pack.id}/${row.file}`);
    }
    const { models, references } = modelEntries(pack, data.files, sourceKit), assets = {}, outputs = [];
    for (const file of [...models.map(model => model.file), ...references]) {
      const model = models.find(model => model.file === file), source = data.files.get(file);
      const prepared = await inspectTexturedModel(source, `${pack.id}/${file}`, model?.expected);
      const assetId = model ? `${pack.id}:model:${slug(model.entry.id)}` : undefined;
      const url = model ? `/vendor/synty/library/models/${pack.id}/${basename(file)}` : `/vendor/${pack.id}/reference-scenes/${basename(file)}`;
      const report = { file, url, assetId, sourceHash: hash(source), preparedHash: hash(prepared.bytes), renamedPivotDescriptions: prepared.renamed,
        verifiedPivots: model?.expected.pivots.length ?? 0, ...prepared.checked };
      if (verify && !excluded(assetId ?? '', url) && hash(await readFile(resolve(root, 'public', url.slice(1)))) !== report.preparedHash) throw new Error(`Prepared output differs: ${url}`);
      outputs.push({ bytes: prepared.bytes, report });
      if (model && !excluded(assetId, url)) {
        const { bounds } = prepared.checked;
        const asset = { id: assetId, pack: pack.id, name: model.delivered?.name ?? model.entry.title ?? model.entry.id.replaceAll('_', ' '), kind: 'model', url,
          sourceHash: report.sourceHash, preparedHash: report.preparedHash, dependencies: [], status: 'converted', bounds,
          category: sourceKit ? sourceKit.title : 'terrain', description: model.entry.description,
          dimensions: bounds[1].map((value, axis) => value - bounds[0][axis]),
          placement: { units: 'metres', upAxis: 'Y', roots: model.roots, pivotRole: model.delivered?.pivot_notes ?? model.entry.pivot ?? 'authored origin' },
          sourceMetadata: { coordinates: 'Blender Z-up metres; GLB (x,z,-y)', inventory: model.entry, ...(model.delivered ? { catalog: model.delivered } : {}) },
          warnings: ['Static source art; author collision, navigation and gameplay interactions when adopting. Water and fire geometry require production effects; no runtime behavior or appearance approval supplied.'] };
        const normalized = json(encode(asset));
        if (verify && Object.entries(normalized).some(([key, value]) => JSON.stringify(catalog.assets[assetId]?.[key]) !== JSON.stringify(value))) throw new Error(`Library registration differs: ${assetId}`);
        assets[assetId] = normalized;
      }
    }
    if (sourceKit && outputs.reduce((sum, output) => sum + output.report.triangles, 0) !== sourceKit.triangles_all_assemblies) throw new Error(`Gothic triangle total differs: ${pack.id}`);
    staged.push({ pack, ...data, fingerprints, outputs, assets });
    console.log(`${verify ? 'Verified' : 'Validated'} ${pack.id}: ${models.length} standalone models, ${references.length} reference assemblies; ${data.supplied.size} supplied file checksums.`);
  }
  if (!verify) {
    // All kits pass before publishing; re-import refuses to overwrite different originals.
    for (const item of staged) for (const archive of item.archives) {
      const path = resolve(downloads, archive.filename);
      if (hash(await readFile(path)) !== archive.sha256) throw new Error(`Archive changed during import: ${archive.filename}`);
      const originals = new Map([...sourceCatalogFiles, ...[...item.files].map(([name, bytes]) => [`${item.pack.id}/${name}`, bytes])]);
      await preserveSources(sourceRoot, originals, path, archive.filename);
    }
    for (const item of staged) for (const output of item.outputs) if (!excluded(output.report.assetId ?? '', output.report.url)) await write(resolve(root, 'public', output.report.url.slice(1)), output.bytes);
    const latest = await currentCatalog();
    if (latest.version !== 1 || !latest.assets) throw new Error('Unsupported private library catalog');
    for (const item of staged) Object.assign(latest.assets, item.assets);
    await write(libraryPath, encode(latest));
    await write(resolve(sourceRoot, 'lantern-import.json'), encode({ catalogSources,
      scope: 'Owner-supplied original art; scripts retained without execution. No placements, gameplay/build selections or approvals. Unsupplied hashes are retained fingerprints.',
      packs: staged.map(item => ({ id: item.pack.id, archives: item.archives, sources: item.fingerprints, images: item.images, outputs: item.outputs.map(output => output.report) })) }));
  }
  console.log(`${verify ? 'Verified' : 'Prepared'} ${staged.reduce((sum, item) => sum + Object.keys(item.assets).length, 0)} library models and eight private reference assemblies. No scene placements or build selections added.`);
}

if (isMain(import.meta.url)) await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--downloads': 'value', '--verify': 'boolean' });
  if (args['--help']) { console.log('Usage: npm run assets:import-download-kits -- [--downloads PATH] [--verify]\nImports all eight Gothic prop kits and four environment kits; --verify reads preserved sources without writing.'); return; }
  if (args['--verify'] && args['--downloads']) throw new UsageError('--verify uses preserved sources; omit --downloads');
  await importDownloadKits(resolve(args['--downloads'] ?? resolve(homedir(), 'Downloads')), Boolean(args['--verify']));
});
