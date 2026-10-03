import { deletionExclusions } from '../review/exclusions.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { Box3, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { cli, isMain, parseArgs, root } from '../../lib/cli.mjs';
import { preserveSources, sourceEntry } from '../../lib/asset-sources.mjs';
import { parseGlb, encodeGlb } from '../../lib/glb.mjs';
const exec = promisify(execFile);
const prefix = 'Ashen_Veil_Essentials/';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

/** r186 treats node extras.pivot as a numeric exporter pivot, including child offsets. */
function prepareGlb(bytes, name) {
  const { json, tail } = parseGlb(bytes, name);
  if (json.buffers?.some(buffer => buffer.uri) || json.images?.some(image => image.uri) || json.extensionsRequired?.some(extension => extension !== 'KHR_materials_emissive_strength')) throw new Error(`Unsupported GLB dependency: ${name}`);
  let renamed = 0;
  for (const node of json.nodes ?? []) {
    if (typeof node.extras?.pivot === 'string') {
      node.extras.placement_pivot_description = node.extras.pivot; delete node.extras.pivot; renamed++;
    }
  }
  return { bytes: encodeGlb(json, tail), renamed };
}
async function inspectGlb(bytes, name, entry) {
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  try {
    const bounds = new Box3().setFromObject(gltf.scene), size = bounds.getSize(new Vector3());
    if (!bounds.min.toArray().concat(bounds.max.toArray()).every(Number.isFinite) || size.length() <= 0) throw new Error(`Invalid loaded bounds: ${name}`);
    let triangles = 0;
    gltf.scene.traverse(node => {
      if (!node.matrixWorld.elements.every(Number.isFinite)) throw new Error(`Invalid node transform: ${name}/${node.name}`);
      if (!node.isMesh) return;
      const positions = node.geometry.attributes.position, indices = node.geometry.index;
      if (!positions || !Array.from(positions.array).every(Number.isFinite)) throw new Error(`Invalid positions: ${name}`);
      if (indices && Array.from(indices.array).some(index => index >= positions.count)) throw new Error(`Invalid triangle index: ${name}`);
      triangles += (indices?.count ?? positions.count) / 3;
    });
    if (entry) {
      if (triangles !== entry.triangles) throw new Error(`Triangle count differs from manifest: ${name}`);
      const { min, max } = entry.bounds_blender_m;
      const expected = [[min[0], min[2], -max[1]], [max[0], max[2], -min[1]]];
      const actual = [bounds.min.toArray(), bounds.max.toArray()];
      if (actual.some((point, side) => point.some((value, axis) => Math.abs(value - expected[side][axis]) > .001))) throw new Error(`Placement bounds differ from manifest: ${name}`);
      for (const pivot of entry.pivots) {
        const object = gltf.scene.getObjectByName(pivot.name);
        if (!object) throw new Error(`Missing articulation/placement node: ${name}/${pivot.name}`);
        const position = object.getWorldPosition(new Vector3()).toArray(), [x, y, z] = pivot.blender_m;
        if (position.some((value, axis) => Math.abs(value - [x, z, -y][axis]) > .001)) throw new Error(`Changed pivot: ${name}/${pivot.name}`);
      }
    }
    return { bounds: [bounds.min.toArray(), bounds.max.toArray()], triangles };
  } finally {
    const geometries = new Set(), materials = new Set();
    gltf.scene.traverse(node => { if (node.isMesh) { geometries.add(node.geometry); for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material); } });
    geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
  }
}
/** Register placeable originals in the shared scene catalog; no scene placements or build selections. */
export async function importEnvironment(archive) {
  const read = async name => (await exec('unzip', ['-p', archive, prefix + name], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 })).stdout;
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
    const output = prepareGlb(source, name), entry = entries.get(name);
    const checked = await inspectGlb(output.bytes, name, entry);
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
