import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, posix, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { Box3 } from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { disposeSceneResources } from '../../../src/assets/resource-ownership.ts';
import { cli, isMain, parseArgs, root, UsageError } from '../../lib/cli.mjs';
import { preserveSources, sourceArchiveReader, sourceEntry } from '../../lib/asset-sources.mjs';
import { context } from '../../agents/state.mjs';
import { deletionExclusions } from '../review/exclusions.mjs';
import { inspectModel, prepareModel, yUpBounds } from './validate.mjs';

const indexName = 'RPG_Source_Asset_Handoff_Index_v1.zip';
const iconsName = 'Hearth_and_Hex_96_Icons_Refined_v2.zip';
const privateSuffix = 'animation-packs/rpg-source-handoff';
const sourceRoot = resolve(root, '.local', privateSuffix);
const outputRoot = '/vendor/rpg-source-handoff';
const catalogPath = resolve(root, 'public/vendor/synty/library/catalog.json');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const slug = value => value.toLowerCase().replace(/_v\d+(?:_\d+)*$/, '').replaceAll('_', '-');
const json = bytes => JSON.parse(bytes.toString());
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
async function exists(path) { try { await access(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function write(path, bytes) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes); }
async function readJSON(path, fallback) { return await exists(path) ? json(await readFile(path)) : fallback; }

/** Check compressed image data without resampling, stripping alpha or reducing 16-bit height. */
function inspectPNG(bytes, name) {
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error(`Invalid PNG: ${name}`);
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20), depth = bytes[24], type = bytes[25];
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[type];
  if (!width || !height || !channels || ![8, 16].includes(depth) || bytes[26] || bytes[27] || bytes[28]) throw new Error(`Unsupported PNG layout: ${name}`);
  const chunks = [];
  let end = false;
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset), kind = bytes.toString('ascii', offset + 4, offset + 8);
    if (offset + length + 12 > bytes.length) throw new Error(`Truncated PNG: ${name}`);
    if (kind === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
    if (kind === 'IEND') { end = offset === bytes.length; break; }
  }
  const rowBytes = width * channels * depth / 8;
  const decoded = inflateSync(Buffer.concat(chunks), { maxOutputLength: (rowBytes + 1) * height });
  if (!end || decoded.length !== (rowBytes + 1) * height) throw new Error(`Incomplete PNG: ${name}`);
  for (let row = 0; row < height; row++) if (decoded[row * (rowBytes + 1)] > 4) throw new Error(`Invalid PNG filter: ${name}`);
  return { width, height, bitDepth: depth, channels };
}

async function archiveFiles(path, prefix) {
  const reader = await sourceArchiveReader(path, prefix), files = new Map();
  for (const name of reader.names) files.set(name, await reader.read(name));
  return files;
}
async function retainedSources() {
  if (await exists(resolve(sourceRoot, indexName))) return sourceRoot;
  const archives = resolve((await context()).main, '.local/agent-archives');
  for (const task of (await readdir(archives)).sort().reverse()) {
    const path = resolve(archives, task, privateSuffix);
    if (await exists(resolve(path, indexName))) return path;
  }
  throw new Error('Preserved source handoff unavailable; import it in an owned task first.');
}

function checkReceipts(files, prefix) {
  const check = (name, digest) => {
    sourceEntry(name);
    if (!/^[a-f0-9]{64}$/.test(digest) || !files.has(name) || hash(files.get(name)) !== digest) throw new Error(`Source checksum mismatch: ${prefix}${name}`);
  };
  for (const [name, bytes] of files) if (name.endsWith('SHA256SUMS.txt')) {
    for (const line of bytes.toString().trim().split('\n')) {
      const match = /^([a-f0-9]{64})\s+\*?(.+)$/.exec(line);
      if (!match) throw new Error(`Invalid source receipt: ${name}`);
      check(match[2].startsWith(prefix) ? match[2].slice(prefix.length) : match[2], match[1]);
    }
  }
  // Only current-file hashes with explicit paths are receipts; geometry hashes are not.
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    const path = value.path ?? value.file;
    const digest = value.sha256 ?? value.pngSha256;
    if (typeof path === 'string' && digest && files.has(path)) check(path, digest);
    for (const child of Object.values(value)) visit(child);
  };
  for (const [name, bytes] of files) if (name.endsWith('.json')) visit(json(bytes));
}

/** Retain source metadata verbatim beside a small URL index for future explicit adoption. */
function sourceCatalog(group) {
  const { files, id } = group, url = name => `${outputRoot}/${id}/${sourceEntry(name)}`;
  const images = new Map([...files].filter(([name]) => name.endsWith('.png')).map(([name, bytes]) => [name, inspectPNG(bytes, name)]));
  const requireImage = name => {
    sourceEntry(name);
    if (!images.has(name)) throw new Error(`Missing texture: ${id}/${name}`);
    return url(name);
  };
  const documents = [...files].filter(([name]) => /(?:^|\/)(?:manifest|asset_inventory|mesh_manifest|decal_manifest)\.json$/.test(name)).map(([path, bytes]) => ({ path, data: json(bytes) }));
  const entry = { id, sourceRoot: group.prefix, collections: group.collections, materials: [], effects: [], geometry: [], icons: [], decals: [], documents: documents.map(item => url(item.path)) };
  for (const { data } of documents) {
    for (const material of data.materials ?? []) {
      const states = Object.fromEntries(Object.entries(material.variants).map(([state, variant]) => [state,
        Object.fromEntries(Object.entries(variant.maps).map(([channel, name]) => {
          requireImage(name);
          if (channel === 'height' && images.get(name).bitDepth !== 16) throw new Error(`Height precision changed: ${name}`);
          return [channel, { url: url(name), colorSpace: channel === 'albedo' ? 'srgb' : 'linear', ...images.get(name) }];
        }))]));
      const masks = Object.fromEntries(Object.entries(material.state_masks ?? material.masks ?? {}).map(([key, name]) => [key, requireImage(name)]));
      entry.materials.push({ id: `${id}:material:${slug(material.id)}`, metadata: material, states, masks,
        normalConvention: 'OpenGL +Y', ormChannels: { r: 'ao', g: 'roughness', b: 'metallic' } });
    }
    for (const icon of [...(data.icons ?? []), ...(data.monochrome_status ?? []), ...(data.frames ?? [])]) {
      const png = Object.fromEntries(Object.entries(icon.png ?? {}).map(([size, name]) => [size, requireImage(name)]));
      if (icon.svg && !files.has(sourceEntry(icon.svg))) throw new Error(`Missing icon SVG: ${icon.svg}`);
      entry.icons.push({ metadata: icon, png, ...(icon.svg ? { svg: url(icon.svg) } : {}), colorSpace: 'srgb', alpha: 'straight' });
    }
  }
  const sequences = [...files].filter(([name]) => /Sequences\/.+\/metadata\.json$|metadata\/.+\.json$/.test(name)).map(([, bytes]) => json(bytes)).filter(data => data.fps === 60 && data.frames && data.pages);
  for (const data of sequences) {
    const frameCount = data.frame_count ?? data.frameCount;
    if (data.frames.length !== frameCount || Math.abs((data.duration_seconds ?? data.durationSeconds) - frameCount / 60) > 1e-8) throw new Error(`Invalid 60 Hz duration/frame count: ${id}`);
    const pages = data.pages.map(page => {
      const name = page.path ?? page.file;
      requireImage(name);
      const size = page.size ?? [page.width, page.height], actual = images.get(name);
      if (size[0] !== actual.width || size[1] !== actual.height || actual.channels !== 4 || actual.bitDepth !== 8) throw new Error(`Atlas layout differs: ${name}`);
      return { url: url(name), width: actual.width, height: actual.height, validFrames: page.valid_frames ?? page.frameCount };
    });
    if (pages.reduce((sum, page) => sum + page.validFrames, 0) !== frameCount) throw new Error(`Invalid atlas valid-frame total: ${id}`);
    const counts = pages.map(() => 0), cells = new Set();
    data.frames.forEach((frame, index) => {
      const pageIndex = frame.page ?? frame.pageIndex, page = pages[pageIndex];
      const rect = frame.pixel_rect_top_left ?? frame.rectPixelsTopLeft, cell = frame.cell_on_page ?? frame.cellIndex;
      if ((frame.frame ?? frame.index) !== index || !page || !rect || rect.length !== 4 || !rect.every(Number.isFinite)
        || !Number.isInteger(cell) || cell < 0 || cell >= page.validFrames || cells.has(`${pageIndex}:${cell}`)
        || rect[0] < 0 || rect[1] < 0 || rect[2] <= 0 || rect[3] <= 0 || rect[0] + rect[2] > page.width || rect[1] + rect[3] > page.height
        || Math.abs((frame.sample_time_seconds ?? frame.timeSeconds) - index / 60) > 1e-8) throw new Error(`Invalid atlas frame: ${id}/${index}`);
      counts[pageIndex]++;
      cells.add(`${pageIndex}:${cell}`);
    });
    if (counts.some((count, index) => count !== pages[index].validFrames)) throw new Error(`Atlas page frame counts differ: ${id}`);
    entry.effects.push({ id: `${id}:effect:${slug(data.name)}`, metadata: data, pages, fps: 60, frameCount,
      colorSpace: data.color_space ?? data.colorSpace, alpha: data.alpha, generateMipmaps: false, preferred: true });
  }
  for (const { data } of documents) for (const asset of data.assets ?? data.source_assets ?? []) {
    const name = asset.path ?? asset.file;
    if (typeof name !== 'string' || !name.endsWith('.png')) continue;
    requireImage(name);
    entry.effects.push({ id: `${id}:effect:${slug(asset.name ?? asset.id)}`, metadata: asset, url: url(name), preferred: !['flipbook'].includes(asset.kind ?? asset.type), generateMipmaps: false });
  }
  // Decal maps share the delivered path convention; preserve each channel's meaning.
  const decals = documents.find(item => item.path.endsWith('decal_manifest.json'))?.data ?? [];
  for (const decal of decals) {
    const maps = [...images.keys()].filter(name => name.includes(decal.id));
    if (!maps.length) throw new Error(`Missing decal maps: ${decal.id}`);
    entry.decals.push({ metadata: decal, maps: maps.map(name => ({ url: url(name), colorSpace: name.endsWith('_BaseColor.png') ? 'srgb' : 'linear', ...images.get(name) })) });
  }
  // FX exchange meshes are reusable effect sources, separate from placeable scenery.
  for (const { data } of documents) for (const asset of data.assets ?? data.source_assets ?? []) {
    const file = asset.path ?? asset.file;
    if (typeof file !== 'string' || !/\.(?:obj|gltf)$/.test(file)) continue;
    if (!files.has(sourceEntry(file))) throw new Error(`Missing effect geometry: ${file}`);
    const obj = file.endsWith('.obj') ? file : sourceEntry(asset.alternate);
    if (!files.has(obj)) throw new Error(`Missing alternate effect mesh: ${obj}`);
    const scene = new OBJLoader().parse(files.get(obj).toString());
    try {
      let triangles = 0;
      scene.traverse(node => {
        if (!node.isMesh) return;
        for (const attribute of Object.values(node.geometry.attributes)) if (!Array.from(attribute.array).every(Number.isFinite)) throw new Error(`Nonfinite effect geometry: ${obj}`);
        triangles += node.geometry.attributes.position.count / 3;
      });
      const expected = asset.triangle_count ?? asset.triangles;
      if (!triangles || !Number.isInteger(triangles) || expected !== undefined && triangles !== expected) throw new Error(`Effect triangle count differs: ${obj}`);
      const box = new Box3().setFromObject(scene, true), bounds = [box.min.toArray(), box.max.toArray()];
      if (!bounds.flat().every(Number.isFinite)) throw new Error(`Invalid effect bounds: ${obj}`);
      if (file.endsWith('.gltf')) {
        const gltf = json(files.get(file));
        if (gltf.asset?.version !== '2.0' || gltf.buffers?.length !== 1 || !gltf.buffers[0].uri?.startsWith('data:application/octet-stream;base64,')) throw new Error(`Unexpected effect glTF buffer: ${file}`);
        const buffer = Buffer.from(gltf.buffers[0].uri.split(',')[1], 'base64');
        if (buffer.length !== gltf.buffers[0].byteLength || gltf.bufferViews.some(view => view.buffer !== 0 || (view.byteOffset ?? 0) < 0 || (view.byteOffset ?? 0) + view.byteLength > buffer.length)) throw new Error(`Invalid effect glTF data: ${file}`);
        for (const image of gltf.images ?? []) requireImage(sourceEntry(posix.normalize(posix.join(posix.dirname(file), image.uri))));
      }
      entry.geometry.push({ id: `${id}:mesh:${slug(asset.name ?? asset.id)}`, url: url(file), obj: url(obj), metadata: asset, triangles, bounds });
    } finally { disposeSceneResources(scene); }
  }
  return { entry, images };
}

export async function importHandoff(downloads, available = false, verify = false) {
  const preserved = verify ? await retainedSources() : sourceRoot;
  const indexPath = resolve(verify ? preserved : downloads, indexName);
  const indexFiles = await archiveFiles(indexPath, 'RPG_Source_Asset_Handoff/');
  const handoff = json(indexFiles.get('RPG_Source_Asset_Catalog.json'));
  const receipts = new Map(handoff.downloads.map(item => [item.filename, item]));
  const previous = verify ? await readJSON(resolve(preserved, 'lantern-import.json')) : undefined;
  if (verify && !previous) throw new Error('Missing retained handoff import receipt');
  const selected = [], missing = [];
  if (verify) selected.push(...previous.archives.map(item => item.filename));
  else {
    for (const collection of handoff.collections) {
      const names = collection.download_files;
      const chosen = names[0].endsWith('complete.zip') ? (await exists(resolve(downloads, names[0])) ? [names[0]] : names.slice(1)) : names;
      for (const name of chosen) {
        if (await exists(resolve(downloads, name))) selected.push(name);
        else missing.push(name);
      }
    }
    if (await exists(resolve(downloads, iconsName))) selected.push(iconsName);
  }
  if (missing.length && !available) throw new Error(`Missing archives: ${missing.join(', ')}. --available imports supplied collections and records gaps.`);
  const archives = [], groups = new Map();
  for (const name of selected) {
    sourceEntry(name);
    const path = resolve(verify ? preserved : downloads, name), bytes = await readFile(path), digest = hash(bytes), supplied = receipts.get(name);
    if (supplied && (digest !== supplied.sha256 || bytes.length !== supplied.bytes)) throw new Error(`Download checksum/size mismatch: ${name}`);
    if (verify && digest !== previous.archives.find(item => item.filename === name)?.sha256) throw new Error(`Retained archive changed: ${name}`);
    const listing = await sourceArchiveReader(path, '');
    const roots = new Set(listing.names.map(file => file.split('/')[0]));
    if (roots.size !== 1) throw new Error(`Expected unique archive root: ${name}`);
    const prefix = [...roots][0] + '/', id = slug(prefix.slice(0, -1));
    if (!groups.has(id)) groups.set(id, { id, prefix, files: new Map(), collections: [] });
    const group = groups.get(id);
    if (group.prefix !== prefix) throw new Error(`Ambiguous collection ID: ${id}`);
    const collection = handoff.collections.find(item => item.download_files.includes(name))?.name ?? 'Hearth & Hex icons';
    if (!group.collections.includes(collection)) group.collections.push(collection);
    for (const [file, source] of await archiveFiles(path, prefix)) {
      if (group.files.has(file) && !group.files.get(file).equals(source)) throw new Error(`Conflicting volume contents: ${prefix}${file}`);
      group.files.set(file, source);
    }
    archives.push({ filename: name, sha256: digest, bytes: bytes.length, suppliedChecksum: !!supplied });
    console.log(`Read ${name}`);
  }
  const catalog = await readJSON(catalogPath, { version: 1, complete: true, assets: {} });
  if (catalog.version !== 1 || !catalog.assets) throw new Error('Unsupported existing library catalog');
  const excluded = deletionExclusions(), assets = {}, prepared = new Map(), collectionCatalog = [], sourceFiles = new Map();
  let modelCount = 0, referenceCount = 0;
  for (const group of groups.values()) {
    checkReceipts(group.files, group.prefix);
    const { entry } = sourceCatalog(group);
    collectionCatalog.push(entry);
    const inventory = group.files.get('metadata/asset_inventory.json') ?? group.files.get('documentation/mesh_manifest.json');
    const sourceEntries = inventory ? json(inventory) : [];
    const models = Array.isArray(sourceEntries) ? sourceEntries : sourceEntries.assets;
    const expectedFiles = new Set((models ?? []).map(model => model.glb ?? `models/glb/${model.id}.glb`));
    for (const model of models ?? []) if (!group.files.has(model.glb ?? `models/glb/${model.id}.glb`)) throw new Error(`Missing model: ${model.id}`);
    for (const [file, bytes] of group.files) {
      sourceFiles.set(group.prefix + file, bytes);
      if (file.endsWith('.glb')) {
        const model = models?.find(item => (item.glb ?? `models/glb/${item.id}.glb`) === file);
        const reference = !model;
        if (reference && !file.startsWith('examples/')) throw new Error(`Unregistered delivered model: ${group.id}/${file}`);
        const output = prepareModel(bytes, file);
        const expected = model ? { triangles: model.triangles, preciseBounds: true,
          ...(model.bounds_min ? { bounds: yUpBounds({ min: model.bounds_min, max: model.bounds_max }) } : {}) } : { preciseBounds: true };
        const checked = await inspectModel(output.bytes, file, expected);
        const assetId = `${group.id}:model:${slug(model?.id ?? basename(file, '.glb'))}`;
        const url = reference ? `/vendor/${group.id}/reference-scenes/${basename(file)}` : `/vendor/synty/library/models/${group.id}/${basename(file)}`;
        if (!excluded(reference ? '' : assetId, url)) prepared.set(url, output.bytes);
        if (reference) referenceCount++;
        else {
          if (!expectedFiles.has(file) || assets[assetId]) throw new Error(`Duplicate model ID: ${assetId}`);
          const asset = { id: assetId, pack: group.id, name: model.id.replaceAll('_', ' '), kind: 'model', url, status: 'converted', dependencies: [],
            sourceHash: hash(bytes), preparedHash: hash(output.bytes), bounds: checked.bounds, category: model.theme ?? model.category ?? 'environment',
            description: model.description, placement: { units: 'metres', up: 'Y', sourceUp: 'Z', metadata: model },
            warnings: ['Visual geometry only; author collision, navigation and interactions when adopting. Preserve authored placement pivots.'] };
          if (!excluded(assetId, url)) {
            assets[assetId] = asset;
            if (verify && JSON.stringify(catalog.assets[assetId]) !== JSON.stringify(asset)) throw new Error(`Stale model registration: ${assetId}`);
          }
          modelCount++;
        }
      } else if (/\.(?:png|svg|obj|mtl|gltf)$/.test(file) && !/^(?:previews|Previews|source|Source|sources|documentation)\//.test(file)) {
        const url = `${outputRoot}/${group.id}/${file}`;
        if (!excluded('', url)) prepared.set(url, bytes);
      } else if (file.endsWith('.json') && !/^(?:source|Source|sources)\//.test(file)) prepared.set(`${outputRoot}/${group.id}/${file}`, bytes);
    }
    console.log(`Validated ${group.id}: ${(models ?? []).length} models; ${entry.materials.length} surfaces, ${entry.effects.length} effects, ${entry.icons.length} icons, ${entry.decals.length} decals.`);
  }
  const library = { version: 1, collections: collectionCatalog, missingArchives: verify ? previous.missingArchives : missing,
    scope: 'Prepared source library; no scene placement, gameplay selection or appearance approval. FX sampling metadata is authoritative; 60 Hz versions are preferred. Bundled generators are preserved without execution.' };
  prepared.set(`${outputRoot}/catalog.json`, encode(library));
  const report = { indexHash: hash(await readFile(indexPath)), archives, missingArchives: library.missingArchives,
    models: modelCount, referenceScenes: referenceCount, materials: collectionCatalog.reduce((sum, entry) => sum + entry.materials.length, 0),
    materialStates: collectionCatalog.flatMap(entry => entry.materials).reduce((sum, material) => sum + Object.keys(material.states).length, 0),
    effectMeshes: collectionCatalog.reduce((sum, entry) => sum + entry.geometry.length, 0),
    effects60Hz: collectionCatalog.flatMap(entry => entry.effects).filter(effect => effect.fps === 60).length,
    frames60Hz: collectionCatalog.flatMap(entry => entry.effects).reduce((sum, effect) => sum + (effect.fps === 60 ? effect.frameCount : 0), 0),
    atlasPages60Hz: collectionCatalog.flatMap(entry => entry.effects).reduce((sum, effect) => sum + (effect.fps === 60 ? effect.pages.length : 0), 0),
    sources: [...sourceFiles].map(([file, bytes]) => ({ file, bytes: bytes.length, sha256: hash(bytes) })),
    outputs: [...prepared].map(([url, bytes]) => ({ url, bytes: bytes.length, sha256: hash(bytes) })) };
  if (verify) {
    if (JSON.stringify(previous) !== JSON.stringify(report)) throw new Error('Import receipt differs from preserved handoff');
    for (const [file, bytes] of indexFiles) if (hash(await readFile(resolve(preserved, file))) !== hash(bytes)) throw new Error(`Retained handoff document differs: ${file}`);
    for (const [file, bytes] of sourceFiles) if (hash(await readFile(resolve(preserved, file))) !== hash(bytes)) throw new Error(`Retained source differs: ${file}`);
    for (const [url, bytes] of prepared) if (hash(await readFile(resolve(root, 'public', url.slice(1)))) !== hash(bytes)) throw new Error(`Prepared output differs: ${url}`);
  } else {
    await preserveSources(sourceRoot, indexFiles, indexPath, indexName);
    for (const name of selected) await preserveSources(sourceRoot, new Map(), resolve(downloads, name), name);
    // Each root is already collision-checked, including shared-volume duplicates.
    await preserveSources(sourceRoot, sourceFiles, indexPath, indexName);
    for (const [url, bytes] of prepared) await write(resolve(root, 'public', url.slice(1)), bytes);
    const latest = await readJSON(catalogPath, { version: 1, complete: true, assets: {} });
    for (const [id, asset] of Object.entries(latest.assets)) if (excluded(id, asset.url)) delete latest.assets[id];
    Object.assign(latest.assets, assets);
    await write(catalogPath, encode(latest));
    await write(resolve(sourceRoot, 'lantern-import.json'), encode(report));
  }
  console.log(`${verify ? 'Verified' : 'Imported'} ${archives.length} archives: ${modelCount} model variants, ${referenceCount} reference scenes, ${report.materials} surfaces, ${report.effects60Hz} 60 Hz effects / ${report.frames60Hz} frames. Catalog: ${outputRoot}/catalog.json`);
  if (report.missingArchives.length) console.log(`Unavailable: ${report.missingArchives.join(', ')}`);
}

if (isMain(import.meta.url)) await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--downloads': 'value', '--available': 'boolean', '--verify': 'boolean' });
  if (args['--help']) { console.log('Usage: npm run assets:import-handoff -- [--downloads PATH] [--available] [--verify]\n--available records missing handoff archives while importing available collections.\n--verify reads preserved sources and validates outputs/catalogs without writing.'); return; }
  if (args['--verify'] && (args['--downloads'] || args['--available'])) throw new UsageError('--verify reads the preserved handoff; omit --downloads and --available');
  await importHandoff(resolve(args['--downloads'] ?? resolve(homedir(), 'Downloads')), !!args['--available'], !!args['--verify']);
});
