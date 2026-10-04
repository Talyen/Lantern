import { deletionExclusions } from '../review/exclusions.mjs';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { cli, isMain, parseArgs, root } from '../../lib/cli.mjs';
import { preserveSources, sourceEntry, sourceArchiveReader } from '../../lib/asset-sources.mjs';
import { prepareModel, inspectModel, yUpBounds } from '../generated-packs/validate.mjs';
const prefix = 'Ashen_Veil_Essentials/';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

/** Register placeable originals in the shared scene catalog; no scene placements or build selections. */
export async function importEnvironment(archive) {
  const { read } = await sourceArchiveReader(archive, prefix);
  const sums = await read('SHA256SUMS.txt'), files = new Map();
  for (const line of sums.toString().trim().split('\n')) {
    const match = /^([a-f0-9]{64}) {2}(.+)$/.exec(line);
    if (!match) throw new Error('Invalid SHA256SUMS entry');
    const [, expected, name] = match;
    sourceEntry(name);
    if (files.has(name)) throw new Error(`Duplicate source entry: ${name}`);
    const bytes = await read(name); if (hash(bytes) !== expected) throw new Error(`Source hash mismatch: ${name}`); files.set(name, bytes);
  }
  const manifest = JSON.parse(files.get('manifest.json'));
  if (manifest.units !== 'metres' || manifest.assets?.length !== 37) throw new Error('Unexpected Ashen Veil manifest');
  const entries = new Map(manifest.assets.map(entry => [entry.file, entry]));
  const excluded = deletionExclusions();
  const prepared = new Map(), assets = {}, report = [];
  for (const [name, source] of files) {
    if (!name.endsWith('.glb')) continue;
    const output = prepareModel(source, name), entry = entries.get(name);
    const checked = await inspectModel(output.bytes, name, entry ? {
      triangles: entry.triangles, bounds: yUpBounds(entry.bounds_blender_m),
      pivots: entry.pivots.map(pivot => ({ name: pivot.name, position: [pivot.blender_m[0], pivot.blender_m[2], -pivot.blender_m[1]] })),
    } : {});
    prepared.set(name, output.bytes);
    report.push({ file: name, sourceHash: hash(source), preparedHash: hash(output.bytes), renamedPivotDescriptions: output.renamed, ...checked });
    if (entry) {
      const id = `ashen-veil:model:${entry.id.replaceAll('_', '-')}`;
      assets[id] = { id, pack: 'ashen-veil', name: entry.id.replaceAll('_', ' '), kind: 'model', url: `/vendor/synty/library/models/ashen-veil/${entry.id}.glb`, sourceHash: hash(source), dependencies: [], status: 'converted', bounds: checked.bounds,
        warnings: ['Visual geometry only: author collision, navigation and gameplay interactions when placing.'], category: entry.category, description: entry.description, variantOf: entry.variant_of, pivots: entry.pivots, preparedHash: hash(output.bytes) };
    }
  }
  if (prepared.size !== 40 || Object.keys(assets).length !== 37) throw new Error('Missing standalone assets or reference scenes');
  const library = resolve(root, 'public/vendor/synty/library'), catalogPath = resolve(library, 'catalog.json');
  const catalog = existsSync(catalogPath) ? JSON.parse(await readFile(catalogPath, 'utf8')) : { version: 1, complete: true, assets: {} };
  if (catalog.version !== 1 || !catalog.assets) throw new Error('Unsupported shared library catalog');
  for (const [id, asset] of Object.entries(assets)) if (excluded(id, asset.url)) { delete assets[id]; delete catalog.assets[id]; }
  Object.assign(catalog.assets, assets);
  const source = resolve(root, '.local/synty-library/ashen-veil-environment');
  files.set('SHA256SUMS.txt', sums);
  await preserveSources(source, files, archive, 'Ashen_Veil_Environment_Essentials.zip');
  for (const [name, bytes] of prepared) {
    const path = entries.has(name) ? resolve(library, 'models/ashen-veil', name.slice(4)) : resolve(root, 'public/vendor/ashen-veil/reference-scenes', name.slice(4));
    if (excluded(entries.has(name) ? `ashen-veil:model:${entries.get(name).id.replaceAll('_', '-')}` : '', '/' + path.slice(resolve(root, 'public').length + 1))) continue;
    await mkdir(resolve(path, '..'), { recursive: true }); await writeFile(path, bytes);
  }
  await writeFile(resolve(source, 'lantern-import.json'), JSON.stringify({ pack: manifest.pack, files: report }, null, 2) + '\n');
  await writeFile(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
  console.log(`Imported 37 scene-library assets and 3 private reference scenes; validated hashes, bounds, triangles and ${manifest.assets.reduce((count, entry) => count + entry.pivots.length, 0)} placement/articulation pivots.`);
  console.log('Find assets: npm run levels:find -- --query ashen-veil --limit 40');
}
if (isMain(import.meta.url)) await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--archive': 'value' });
  if (args['--help']) { console.log('Usage: npm run assets:import-ashen-veil -- [--archive PATH]'); return; }
  await importEnvironment(resolve(args['--archive'] ?? resolve(homedir(), 'Downloads/Ashen_Veil_Environment_Essentials.zip')));
});
