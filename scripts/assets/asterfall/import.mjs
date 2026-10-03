import { deletionExclusions } from '../review/exclusions.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { cli, isMain, parseArgs, root } from '../../lib/cli.mjs';
import { preserveSources, sourceEntry } from '../../lib/asset-sources.mjs';
import { parseGlb } from '../../lib/glb.mjs';
const exec = promisify(execFile);
const weapons = ['sword','axe','mace','pickaxe','bow','shield','greatsword','greathammer','crossbow','staff','wand'];
/** Validate the delivered pack without running any bundled generation scripts. */
export async function importArmory(archive) {
  const read = async name => (await exec('unzip', ['-p', archive, `Asterfall_Armory/${name}`], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 })).stdout;
  const manifest = JSON.parse(await read('manifest.json'));
  const files = new Map();
  for (const [name, expected] of Object.entries(manifest)) {
    sourceEntry(name);
    const bytes = await read(name);
    if (bytes.length !== expected.bytes || createHash('sha256').update(bytes).digest('hex') !== expected.sha256) throw new Error(`Archive hash mismatch: ${name}`);
    files.set(name, bytes);
  }
  const assets = {}, excluded = deletionExclusions();
  for (const weapon of weapons) {
    const bytes = files.get(`glb/${weapon}.glb`);
    if (!bytes) throw new Error(`Missing GLB: ${weapon}`);
    const { json: gltf } = parseGlb(bytes, weapon);
    if (gltf.extensionsRequired?.length || gltf.buffers.some(buffer => buffer.uri) || gltf.images?.some(image => image.uri)) throw new Error(`GLB requires external data: ${weapon}`);
    const positions = gltf.meshes.flatMap(mesh => mesh.primitives.map(primitive => gltf.accessors[primitive.attributes.POSITION]));
    const bounds = [0, 1].map(side => [0, 1, 2].map(axis => (side ? Math.max : Math.min)(...positions.map(accessor => accessor[side ? 'max' : 'min'][axis]))));
    if (!bounds.flat().every(Number.isFinite) || bounds[1].every((value, axis) => value <= bounds[0][axis])) throw new Error(`Invalid bounds: ${weapon}`);
    const id = `asterfall:${weapon}`;
    if (excluded(id, `/vendor/asterfall/glb/${weapon}.glb`)) continue;
    assets[id] = { id, pack: 'asterfall', name: weapon, kind: 'model', url: `/vendor/asterfall/glb/${weapon}.glb`, sourceHash: manifest[`glb/${weapon}.glb`].sha256, dependencies: [], status: 'converted', warnings: [], bounds };
  }
  const source = resolve(root, '.local/animation-packs/asterfall-armory'), output = resolve(root, 'public/vendor/asterfall');
  files.set('manifest.json', await read('manifest.json'));
  await preserveSources(source, files, archive, 'Asterfall_Armory_11_Weapons.zip');
  await mkdir(resolve(output, 'glb'), { recursive: true });
  for (const weapon of weapons.filter(weapon => assets[`asterfall:${weapon}`])) await writeFile(resolve(output, `glb/${weapon}.glb`), files.get(`glb/${weapon}.glb`));
  await writeFile(resolve(output, 'catalog.json'), JSON.stringify({ version: 1, complete: true, assets }, null, 2) + '\n');
  console.log(`Imported ${weapons.length} validated weapons; private source: ${source}; preview catalog: ${output}/catalog.json`);
}
if (isMain(import.meta.url)) await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--archive': 'value' });
  if (args['--help']) { console.log('Usage: npm run assets:import-asterfall -- [--archive PATH]'); return; }
  await importArmory(resolve(args['--archive'] ?? resolve(homedir(), 'Downloads/Asterfall_Armory_11_Weapons.zip')));
});
