import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { migrateSourceTree, retrieveSources } from './source-storage.mjs';
import { retainTaskSources, retainSourceTree } from './retention.mjs';
import { writeJSON } from './state.mjs';
import { assetIndex, assetIdentity, prepareAssets } from './assets.mjs';

// These fixtures protect original files from loss during corruption, interruption
// and task cleanup; static checks cannot establish those filesystem outcomes.
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'lantern-source-storage-'));
  const main = join(directory, 'main'), assetSourceRoot = join(directory, 'library');
  await mkdir(main); await mkdir(assetSourceRoot);
  const task = { id: 'asset-task', path: join(main, '.local/worktrees/asset-task') };
  await mkdir(task.path, { recursive: true });
  return { main, common: join(main, '.git'), store: join(main, '.git/lantern'), assetSourceRoot, task,
    journal: join(assetSourceRoot, 'migration-inventory.jsonl'), dispose: () => rm(directory, { recursive: true, force: true }) };
}
async function write(path, text) { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, text); }

test('validation retries preserve an unchanged art snapshot and still incorporate changed main art', async () => {
  const ctx = await fixture();
  try {
    const main = join(ctx.main, 'public/vendor'), local = join(ctx.task.path, 'public/vendor');
    const baseline = join(ctx.task.path, '.local/agents/base-vendor');
    for (const path of [main, local, baseline]) await write(join(path, 'model.glb'), 'prepared art');
    ctx.task.assetIndex = await assetIndex(local); ctx.task.assetChanges = [];
    ctx.task.mainAssetIdentity = assetIdentity(await assetIndex(main));
    await chmod(join(local, 'model.glb'), 0o600);
    const settled = await assetIndex(local);
    assert.equal(await prepareAssets(ctx, ctx.task, 'fixture'), assetIdentity(settled));
    assert.deepEqual(await assetIndex(local), settled);
    assert.deepEqual(ctx.task.assetChanges, []);
    await writeFile(join(main, 'model.glb'), 'incoming art');
    await prepareAssets(ctx, ctx.task, 'fixture');
    assert.equal(await readFile(join(local, 'model.glb'), 'utf8'), 'incoming art');
    await writeFile(join(local, 'model.glb'), 'task art');
    await prepareAssets(ctx, ctx.task, 'fixture');
    assert.equal(await readFile(join(local, 'model.glb'), 'utf8'), 'task art');
    assert.deepEqual(ctx.task.assetChanges, ['model.glb']);
    assert.equal(await readFile(join(main, 'model.glb'), 'utf8'), 'incoming art');
  } finally { await ctx.dispose(); }
});

test('publication recovers a verified pending copy and preserves a differing interrupted copy', async () => {
  const ctx = await fixture();
  try {
    const source = join(ctx.main, '.local/animation-packs'), target = join(ctx.assetSourceRoot, 'animation-packs');
    await write(join(source, 'master.blend'), 'master');
    const differing = target + '.retaining-first', matching = target + '.retaining-second';
    await write(join(differing, 'master.blend'), 'earlier interrupted master');
    await write(join(matching, 'master.blend'), 'master');
    await retainSourceTree(source, target, { apply: true });
    assert.equal(await readFile(join(target, 'master.blend'), 'utf8'), 'master');
    assert.equal(await readFile(join(differing, 'master.blend'), 'utf8'), 'earlier interrupted master');
    await assert.rejects(readFile(join(matching, 'master.blend')), { code: 'ENOENT' });
    assert.equal(await readFile(join(source, 'master.blend'), 'utf8'), 'master');
  } finally { await ctx.dispose(); }
});

test('migration retains differing masters, inventories both destinations and retries after interruption', async () => {
  const ctx = await fixture();
  try {
    const source = join(ctx.main, '.local/animation-packs'), target = join(ctx.assetSourceRoot, 'animation-packs');
    await write(join(source, 'model.blend'), 'new master'); await write(join(source, 'original.zip'), 'archive');
    await write(join(target, 'model.blend'), 'older master');
    await assert.rejects(migrateSourceTree(source, target, ctx.journal, { apply: true, beforeRemove: () => { throw new Error('interrupted'); } }), /interrupted/);
    assert.equal(await readFile(join(source, 'model.blend'), 'utf8'), 'new master');
    assert.equal(await readFile(join(target, 'model.blend'), 'utf8'), 'older master');
    const inventory = (await readFile(ctx.journal, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(inventory.length, 2);
    for (const row of inventory) assert.equal(await readFile(row.destination, 'utf8'), await readFile(row.source, 'utf8'));
    // Simulate an interrupted inventory append before any deletion authorization.
    await writeFile(ctx.journal, '{"partial":', { flag: 'a' });
    const result = await migrateSourceTree(source, target, ctx.journal, { apply: true });
    assert.equal(result.movedFiles, 2);
    await assert.rejects(readFile(join(source, 'model.blend')), { code: 'ENOENT' });
    assert.equal(await readFile(join(target, 'model.blend'), 'utf8'), 'older master');
    (await readFile(ctx.journal, 'utf8')).trim().split('\n').forEach(line => JSON.parse(line));
    assert.equal((await migrateSourceTree(source, target, ctx.journal, { apply: true })).movedFiles, 0);
  } finally { await ctx.dispose(); }
});

for (const changed of ['source', 'destination']) test(`migration preserves local originals when ${changed} changes after publication`, async () => {
  const ctx = await fixture();
  try {
    const source = join(ctx.main, '.local/animation-packs'), target = join(ctx.assetSourceRoot, 'animation-packs');
    await write(join(source, 'original.zip'), 'original');
    await assert.rejects(migrateSourceTree(source, target, ctx.journal, { apply: true,
      beforeRemove: () => writeFile(join(changed === 'source' ? source : target, 'original.zip'), 'damaged!') }), /changed|mismatch/);
    assert.equal(await readFile(join(source, 'original.zip'), 'utf8'), changed === 'source' ? 'damaged!' : 'original');
  } finally { await ctx.dispose(); }
});

test('removal tolerates metadata-only updates only after matching current bytes and identities', async () => {
  const ctx = await fixture();
  try {
    const source = join(ctx.main, '.local/animation-packs'), target = join(ctx.assetSourceRoot, 'animation-packs');
    await write(join(source, 'original.zip'), 'original');
    const result = await migrateSourceTree(source, target, ctx.journal, { apply: true,
      beforeRemove: async () => { await chmod(join(source, 'original.zip'), 0o600); await chmod(join(target, 'original.zip'), 0o600); } });
    assert.equal(result.movedFiles, 1);
    assert.equal(await readFile(join(target, 'original.zip'), 'utf8'), 'original');
    await assert.rejects(readFile(join(source, 'original.zip')), { code: 'ENOENT' });
  } finally { await ctx.dispose(); }
});

test('selective retrieval preserves edits, rebases caches and cleanup publishes unique originals externally', async () => {
  const ctx = await fixture();
  try {
    const path = 'animation-packs/generated-packs/selected', local = join(ctx.task.path, '.local', path);
    await write(join(ctx.assetSourceRoot, path, 'master.blend'), 'master');
    await write(join(ctx.assetSourceRoot, 'animation-packs/generated-packs/other/master.blend'), 'other master');
    await retrieveSources(ctx, ctx.task, ['animation-packs'], [path]);
    await writeFile(join(local, 'master.blend'), 'edited master');
    await retrieveSources(ctx, ctx.task, ['animation-packs'], [path]);
    assert.equal(await readFile(join(local, 'master.blend'), 'utf8'), 'edited master');
    assert.deepEqual(await readdir(join(ctx.task.path, '.local/animation-packs/generated-packs')), ['selected']);
    await write(join(local, 'new.zip'), 'new archive');
    await write(join(ctx.assetSourceRoot, 'synty-library/sources/pack/model.fbx'), 'FBX');
    await writeJSON(join(ctx.main, '.local/synty-library/inventory.json'), [{ localPath: '/moved/Lantern/.local/synty-library/sources/pack/model.fbx' }]);
    await retrieveSources(ctx, ctx.task, ['synty-library'], ['synty-library/sources/pack']);
    const cache = JSON.parse(await readFile(join(ctx.task.path, '.local/synty-library/inventory.json')));
    assert.equal(cache[0].localPath, join(ctx.task.path, '.local/synty-library/sources/pack/model.fbx'));
    await retainTaskSources(ctx, ctx.task);
    assert.equal(await readFile(join(ctx.assetSourceRoot, path, 'master.blend'), 'utf8'), 'master');
    assert.equal(await readFile(join(ctx.assetSourceRoot, path, 'new.zip'), 'utf8'), 'new archive');
    await assert.rejects(readFile(join(ctx.main, '.local', path, 'new.zip')), { code: 'ENOENT' });
    const versions = await readdir(join(ctx.assetSourceRoot, 'source-replacements/animation-packs'));
    assert.equal(versions.length, 1);
    assert.equal(await readFile(join(ctx.assetSourceRoot, 'source-replacements/animation-packs', versions[0], 'generated-packs/selected/master.blend'), 'utf8'), 'edited master');
  } finally { await ctx.dispose(); }
});
