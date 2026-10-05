import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { cli, parseArgs, root } from '../../lib/cli.mjs';
import { readReviews } from '../review/index.mjs';

// Original geometry; no licensed model or texture inputs.
await cli(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args['--help']) { console.log('Usage: node scripts/assets/original/smithing-anvil.mjs\nPrepare an original iron anvil in the private library. Does not approve it.'); return; }
  const id = 'lantern-original:model:iron-anvil', url = '/vendor/original/iron-anvil.glb';
  const reviews = await readReviews(root);
  if (Object.values(reviews.deleted).some(row => row.familyId === id)) throw new Error('This anvil was deleted. Restore its exclusion explicitly before preparation.');
  const scene = new THREE.Group(); scene.name = 'Iron anvil';
  const iron = new THREE.MeshStandardMaterial({ color: '#514d46', metalness: .75, roughness: .65 });
  const face = new THREE.MeshStandardMaterial({ color: '#8a8375', metalness: .85, roughness: .42 });
  const profile = (name, points, depth, material) => {
    const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
    const geometry = new THREE.ExtrudeGeometry(shape, { depth, steps: 1, bevelEnabled: true, bevelSegments: 1, bevelSize: .015, bevelThickness: .015, curveSegments: 1 });
    geometry.translate(0, 0, -depth / 2);
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name; scene.add(mesh);
  };
  profile('Splayed base', [[-.36,.015],[.36,.015],[.3,.13],[-.3,.13]], .42, iron);
  profile('Waist', [[-.24,.12],[.24,.12],[.16,.36],[.26,.49],[-.26,.49],[-.16,.36]], .3, iron);
  profile('Horn and heel', [[-.57,.52],[-.35,.5],[.33,.49],[.33,.61],[-.3,.61],[-.57,.56]], .3, iron);
  profile('Hammering face', [[-.29,.6],[.33,.6],[.33,.635],[-.29,.635]], .32, face);
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); }); }
  };
  const output = await new GLTFExporter().parseAsync(scene, { binary: true });
  const path = resolve(root, 'public', url.slice(1)); await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(path, Buffer.from(output));
  scene.updateMatrixWorld(true); const bounds = new THREE.Box3().setFromObject(scene);
  const catalogPath = resolve(root, 'public/vendor/synty/library/catalog.json');
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  catalog.assets[id] = { id, pack: 'lantern-original', name: 'Iron anvil', kind: 'model', url,
    sourceHash: createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),
    dependencies: [], status: 'converted', warnings: [], bounds: [bounds.min.toArray(), bounds.max.toArray()] };
  await writeFile(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
  console.log(`Prepared unreviewed Iron anvil: ${url}`);
});
