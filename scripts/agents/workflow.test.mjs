import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git, context, writeJSON, readJSON, taskPath, spaceRequirement } from './state.mjs';
import { startTask, finishTask, cleanupTask, recover } from './workflow.mjs';
import { privateTree } from './copy.mjs';
import { withResource } from './resources.mjs';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'lantern-workflow-'));
  await git(['init', '-b', 'main', directory]);
  await git(['config', 'user.name', 'Workflow fixture'], directory);
  await git(['config', 'user.email', 'workflow@example.invalid'], directory);
  await mkdir(join(directory, 'scripts'), { recursive: true });
  await mkdir(join(directory, 'node_modules'), { recursive: true });
  await writeFile(join(directory, '.gitignore'), '.local/\nnode_modules/\npublic/vendor/\n');
  await writeFile(join(directory, 'package.json'), '{"name":"workflow-fixture","version":"0.0.0","private":true}\n');
  await writeFile(join(directory, 'package-lock.json'), '{"name":"workflow-fixture","version":"0.0.0","lockfileVersion":3,"packages":{"":{"name":"workflow-fixture","version":"0.0.0"}}}\n');
  await writeFile(join(directory, 'scripts/check.mjs'), "import {existsSync} from 'node:fs'; if(existsSync('broken.txt'))process.exit(1);\n");
  await writeFile(join(directory, 'shared.txt'), 'baseline\n');
  await git(['add', '.'], directory); await git(['commit', '-m', 'fixture'], directory);
  return { ...await context(directory), dispose: () => rm(directory, { recursive: true, force: true }) };
}
async function edit(task, name, value) { await writeFile(join(task.path, name), value); }

test('four concurrent tasks land without lost work and completed cleanup preserves source archives', async () => {
  const ctx = await fixture();
  try {
    assert.equal(spaceRequirement(ctx.main, false), 20 * 1024 ** 3);
    assert.equal(spaceRequirement(ctx.main, true), 1024 ** 3);
    const jobs = await Promise.all(['alpha', 'bravo', 'charlie', 'delta'].map(id => startTask(ctx, id)));
    await Promise.all(jobs.map(task => edit(task, `${task.id}.txt`, `${task.id}\n`)));
    await Promise.all(jobs.map(task => finishTask(ctx, task, { paths: [`${task.id}.txt`] })));
    for (const task of jobs) assert.equal(await readFile(join(ctx.main, `${task.id}.txt`), 'utf8'), `${task.id}\n`);
    const done = await readJSON(taskPath(ctx, 'alpha'));
    await mkdir(join(done.path, '.local/animation-packs'), { recursive: true });
    await writeFile(join(done.path, '.local/animation-packs/source.fbx'), 'retained source');
    await cleanupTask(ctx, done);
    assert.equal(await readFile(join(ctx.main, '.local/agent-archives/alpha/animation-packs/source.fbx'), 'utf8'), 'retained source');
    assert.equal((await readJSON(taskPath(ctx, 'alpha'))).status, 'cleaned');
    assert.equal((await readJSON(taskPath(ctx, 'bravo'))).status, 'integrated');
  } finally { await ctx.dispose(); }
});

test('conflicts return to the owner, failed checks and dirty main cannot promote', async () => {
  const ctx = await fixture();
  try {
    const first = await startTask(ctx, 'first'), second = await startTask(ctx, 'second');
    await edit(first, 'shared.txt', 'first\n'); await edit(second, 'shared.txt', 'second\n');
    await finishTask(ctx, first, { paths: ['shared.txt'] });
    await assert.rejects(finishTask(ctx, second, { paths: ['shared.txt'] }), /Resolve the rebase/);
    assert.equal(await readFile(join(ctx.main, 'shared.txt'), 'utf8'), 'first\n');
    await edit(second, 'shared.txt', 'first and second\n'); await git(['add', 'shared.txt'], second.path);
    process.env.GIT_EDITOR = 'true'; await git(['rebase', '--continue'], second.path);
    await finishTask(ctx, await readJSON(taskPath(ctx, second.id)));
    const bad = await startTask(ctx, 'bad'); await edit(bad, 'broken.txt', 'failure\n');
    const head = await git(['rev-parse', 'HEAD'], ctx.main);
    await assert.rejects(finishTask(ctx, bad, { paths: ['broken.txt'] }), /failed/);
    assert.equal(await git(['rev-parse', 'HEAD'], ctx.main), head);
    await rm(join(bad.path, 'broken.txt')); await git(['add', 'broken.txt'], bad.path); await git(['commit', '-m', 'fix'], bad.path);
    await writeFile(join(ctx.main, 'unexpected.txt'), 'preserve me');
    await assert.rejects(finishTask(ctx, await readJSON(taskPath(ctx, bad.id))), /uncommitted/);
    assert.equal(await readFile(join(ctx.main, 'unexpected.txt'), 'utf8'), 'preserve me');
    await assert.rejects(cleanupTask(ctx, bad), /unfinished/);
    await rm(join(ctx.main, 'unexpected.txt'));
    await finishTask(ctx, await readJSON(taskPath(ctx, bad.id)));
  } finally { await ctx.dispose(); }
});

test('interrupted promotion is resumed and an unrelated main revision is never overwritten', async () => {
  const ctx = await fixture();
  try {
    const task = await startTask(ctx, 'recovery'); await edit(task, 'recovered.txt', 'recovered\n');
    await git(['add', 'recovered.txt'], task.path); await git(['commit', '-m', 'candidate'], task.path);
    const candidate = await git(['rev-parse', 'HEAD'], task.path), base = await git(['rev-parse', 'HEAD'], ctx.main);
    const transaction = join(ctx.store, 'transactions', 'recovery'); await mkdir(transaction, { recursive: true });
    await writeJSON(join(ctx.store, 'promotion.json'), { task: task.id, base, candidate, transaction, assets: false });
    await withResource('promotion', () => recover(ctx), { ctx });
    assert.equal(await git(['rev-parse', 'HEAD'], ctx.main), candidate);
    assert.equal((await readJSON(taskPath(ctx, task.id))).status, 'integrated');
    await withResource('promotion', () => recover(ctx), { ctx });
    await writeJSON(join(ctx.store, 'promotion.json'), { task: task.id, base, candidate: base, transaction, assets: false });
    await assert.rejects(recover(ctx), /main changed unexpectedly/);
    assert.equal(await git(['rev-parse', 'HEAD'], ctx.main), candidate);
  } finally { await ctx.dispose(); }
});

test('native APFS clones are independent and overlapping asset changes require explicit repair', { skip: process.platform !== 'darwin' }, async () => {
  const ctx = await fixture();
  try {
    await mkdir(join(ctx.main, 'public/vendor'), { recursive: true });
    await writeFile(join(ctx.main, 'public/vendor/model.glb'), 'original model');
    assert.equal(spaceRequirement(ctx.main, true), 20 * 1024 ** 3);
    const first = await startTask(ctx, 'asset-first'), second = await startTask(ctx, 'asset-second');
    await writeFile(join(first.path, 'public/vendor/model.glb'), 'first model');
    assert.equal(await readFile(join(ctx.main, 'public/vendor/model.glb'), 'utf8'), 'original model');
    await finishTask(ctx, first);
    await writeFile(join(second.path, 'public/vendor/model.glb'), 'second combined model');
    await assert.rejects(finishTask(ctx, second), /Asset conflicts/);
    assert.equal(await readFile(join(ctx.main, 'public/vendor/model.glb'), 'utf8'), 'first model');
    // Asset-only changes can advance without a new source commit; old acknowledgements cannot overwrite them.
    await writeFile(join(ctx.main, 'public/vendor/model.glb'), 'newer main model');
    await assert.rejects(finishTask(ctx, await readJSON(taskPath(ctx, second.id)), { resolvedAssets: ['model.glb'] }), /Asset conflicts/);
    assert.equal(await readFile(join(ctx.main, 'public/vendor/model.glb'), 'utf8'), 'newer main model');
    await finishTask(ctx, await readJSON(taskPath(ctx, second.id)), { resolvedAssets: ['model.glb'] });
    assert.equal(await readFile(join(ctx.main, 'public/vendor/model.glb'), 'utf8'), 'second combined model');
  } finally { await ctx.dispose(); }
});
