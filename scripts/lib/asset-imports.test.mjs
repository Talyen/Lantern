import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Group, Mesh, BoxGeometry, MeshStandardMaterial } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { assetPath } from './assets.mjs';
import { sourceArchiveReader } from './asset-sources.mjs';
import { embeddedGlb, encodeGlb } from './glb.mjs';
import { inspectModel } from '../assets/generated-packs/validate.mjs';

// Prevent wrong source bytes or escaped output paths from entering preserved art/builds.
test('archive reads are literal and unsafe, duplicate or foreign entries cannot be imported', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'lantern-import-')), archive = resolve(directory, 'fixture.zip');
  try {
    const zip = entries => execFileSync('python3', ['-c', 'import json,sys,zipfile,warnings\nwarnings.simplefilter("ignore", UserWarning)\nwith zipfile.ZipFile(sys.argv[1],"w") as z:\n for name,body in json.loads(sys.argv[2]): z.writestr(name,body)', archive, JSON.stringify(entries)]);
    zip([['pack/model[1].glb', 'literal'], ['pack/model1.glb', 'neighbour']]);
    const reader = await sourceArchiveReader(archive, 'pack/');
    assert.equal((await reader.read('model[1].glb')).toString(), 'literal');
    for (const entries of [[['pack/../escaped', 'x']], [['other/file', 'x']], [['pack/file', 'a'], ['pack/file', 'b']]]) {
      zip(entries); await assert.rejects(sourceArchiveReader(archive, 'pack/'), /Unsafe|Unexpected|Duplicate/);
    }
    for (const url of ['/vendor/%2e%2e/file', '/vendor/folder%5cfile', '/vendor/%2Fabsolute', '/vendor/file%00.glb'])
      assert.throws(() => assetPath(directory, url), /Invalid/);
    assert.equal(assetPath(directory, '/vendor/folder/model.glb'), resolve(directory, 'folder/model.glb'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

// Malformed embedded buffers must fail before character animation assembly or private output writes.
test('embedded GLBs retain bytes and reject invalid buffer extents', () => {
  const tail = Buffer.alloc(12); tail.writeUInt32LE(4); tail.writeUInt32LE(0x004e4942, 4); tail.writeUInt32LE(123, 8);
  const model = length => encodeGlb({ asset: { version: '2.0' }, buffers: [{ byteLength: length }] }, tail);
  assert.equal(embeddedGlb(model(4), 'fixture').bin.readUInt32LE(0), 123);
  for (const length of [-1, 1.5, 5, null]) assert.throws(() => embeddedGlb(model(length), 'fixture'), /embedded buffer/);
  assert.equal(embeddedGlb(model(1), 'padded').bin.length, 1);
});

// A rejected mesh must not strand later resources; otherwise repeated import attempts leak native art.
test('failed decoded-model inspection releases every mesh resource, including unvisited siblings', async () => {
  const root = new Group().add(new Mesh(new BoxGeometry(), new MeshStandardMaterial()), new Mesh(new BoxGeometry(), new MeshStandardMaterial()));
  const releases = root.children.flatMap(mesh => [mock.method(mesh.geometry, 'dispose'), mock.method(mesh.material, 'dispose')]);
  root.children[0].geometry.deleteAttribute('normal');
  const loader = mock.method(GLTFLoader.prototype, 'parseAsync', async () => ({ scene: root, animations: [] }));
  try {
    await assert.rejects(inspectModel(Buffer.alloc(0), 'broken'), /Missing positions or normals/);
    for (const release of releases) assert.equal(release.mock.callCount(), 1);
  } finally { loader.mock.restore(); }
});
