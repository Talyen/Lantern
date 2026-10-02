import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { join } from 'node:path';
import { git, context, writeJSON, readJSON, taskPath, spaceRequirement } from './state.mjs';
import { startTask, finishTask, cleanupTask, recover, installedDependenciesMatch } from './workflow.mjs';
import { acquire, childEnvironment, withResource } from './resources.mjs';

import { checkStages } from '../check.mjs';

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

test('dependency clones with missing or stale required packages are not ready', async () => {
  const ctx = await fixture();
  try {
    await writeJSON(join(ctx.main, 'package.json'), {
      dependencies: { three: '0.186.1' }, devDependencies: { '@eslint/js': '^10.0.1' },
    });
    await writeJSON(join(ctx.main, 'package-lock.json'), { packages: {
      'node_modules/three': { version: '0.186.1' }, 'node_modules/@eslint/js': { version: '10.0.1' },
    } });
    await writeJSON(join(ctx.main, 'node_modules/three/package.json'), { version: '0.186.1' });
    assert.equal(await installedDependenciesMatch(ctx.main), false);
    await writeJSON(join(ctx.main, 'node_modules/@eslint/js/package.json'), { version: '9.0.0' });
    assert.equal(await installedDependenciesMatch(ctx.main), false);
    await writeJSON(join(ctx.main, 'node_modules/@eslint/js/package.json'), { version: '10.0.1' });
    assert.equal(await installedDependenciesMatch(ctx.main), true);
  } finally { await ctx.dispose(); }
});

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


test('light handoff excludes suites and builds even for packaging and workflow changes', () => {
  const names = (files, args) => checkStages(files, args).map(([name]) => name);
  for (const file of ['package.json', 'package-lock.json', 'vite.config.ts', 'scripts/build.mjs', 'scripts/agents/resources.mjs', 'assets/playable-characters.json']) {
    const light = names([file]);
    assert.ok(light.includes('types'));
    assert.ok(light.includes('lint'));
    for (const stage of ['lint-policy', 'tests', 'workflow', 'build', 'inventory', 'preview']) assert.ok(!light.includes(stage), `${file}: ${stage}`);
  }
  assert.deepEqual(names(['AGENTS.md']), ['docs', 'index-diff', 'diff']);
  for (const file of ['src/entry.ts', 'eslint.config.js', 'eslint/rules.mjs', 'eslint/rules.test.mjs']) assert.ok(names([file]).includes('lint'), file);
  assert.ok(names(['src/levels/lighting.ts']).includes('levels'));
  const full = names([], { '--full': true });
  for (const stage of ['lint', 'lint-policy', 'tests', 'workflow', 'build', 'inventory', 'preview']) assert.ok(full.includes(stage));
  const assets = names(['assets/playable-characters.json'], { '--assets': true });
  assert.ok(assets.includes('assets'));
  assert.ok(!assets.includes('build'));
});

test('managed resources serialize, inherit leases and clean up without a second slot', { timeout: 15000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lantern-resources-'));
  const ctx = { main: directory, store: join(directory, 'state') };
  try {
    for (const resource of ['gpu', 'checks']) {
      await withResource(resource, async () => {
        const nested = await acquire(resource, { ctx });
        assert.equal(nested.record.slot, 0);
        await nested.release();
        // A child borrows the same live token; releasing it must not release the owner.
        const code = `import {acquire} from ${JSON.stringify(new URL('./resources.mjs', import.meta.url).href)}; const lease=await acquire(${JSON.stringify(resource)}, {ctx:JSON.parse(process.env.TEST_CTX)}); console.log(lease.record.token); await lease.release();`;
        const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', code], { env: { ...childEnvironment(), TEST_CTX: JSON.stringify(ctx) } });
        assert.equal(stdout.trim(), nested.record.token);
        // Use a separate process so AsyncLocalStorage does not intentionally reuse ownership.
        const probe = `import {acquire} from ${JSON.stringify(new URL('./resources.mjs', import.meta.url).href)}; console.log(await acquire(${JSON.stringify(resource)}, {ctx:JSON.parse(process.env.TEST_CTX),tryOnly:true}));`;
        const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', probe], { env: { ...process.env, LANTERN_LEASES: '{}', TEST_CTX: JSON.stringify(ctx) } });
        assert.equal(result.stdout.trim(), 'null');
      }, { ctx });
      const lease = await acquire(resource, { ctx, tryOnly: true });
      assert.ok(lease);
      const marker = join(directory, `${resource}-cleanup`);
      lease.cleanup([process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'cleaned')`]);
      await lease.release();
      assert.equal(await readFile(marker, 'utf8'), 'cleaned');
      assert.equal(await readJSON(join(ctx.store, 'leases', `${resource}-0.json`), null), null);
      await assert.rejects(acquire(resource, { ctx, slots: 2 }), /require one slot/);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('retired GPU slot drains, remains blocked for old worktrees and releases on interruption', { timeout: 15000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lantern-legacy-resource-'));
  const ctx = { main: directory, store: join(directory, 'state') };
  const native = new URL('./native.py', import.meta.url).pathname;
  const legacy = spawn('python3', [native, 'lease', join(ctx.store, 'leases'), 'gpu', '--slots', '2', '--slot', '1', '--token', 'legacy-test'], { stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = createInterface({ input: legacy.stdout });
  let lease;
  try {
    const [line] = await once(lines, 'line');
    assert.equal(JSON.parse(line).acquired.slot, 1);
    assert.equal(await acquire('gpu', { ctx, tryOnly: true }), null);
    const queued = spawn('python3', [native, 'lease', join(ctx.store, 'leases'), 'gpu', '--drain-slots', '2', '--token', 'queued-test'], { stdio: ['pipe', 'pipe', 'inherit'] });
    const queuedLines = createInterface({ input: queued.stdout });
    try {
      const [waiting] = await once(queuedLines, 'line');
      assert.equal(JSON.parse(waiting).waiting, 'gpu');
      const admitted = once(queuedLines, 'line');
      const exited = once(legacy, 'exit');
      legacy.stdin.end();
      await exited;
      const [acquired] = await admitted;
      assert.equal(JSON.parse(acquired).acquired.slot, 0);
    } finally {
      queuedLines.close();
      const exited = once(queued, 'exit');
      queued.stdin.end();
      await exited;
    }
    lease = await acquire('gpu', { ctx, tryOnly: true });
    assert.ok(lease);
    const { stdout } = await promisify(execFile)('python3', [native, 'lease', join(ctx.store, 'leases'), 'gpu', '--slots', '2', '--slot', '1', '--try-only', '--token', 'legacy-probe']);
    assert.equal(JSON.parse(stdout).deferred, 'gpu');
    const interrupted = once(lease.child, 'exit');
    lease.child.kill('SIGTERM');
    await interrupted;
    await lease.release();
    lease = await acquire('gpu', { ctx, tryOnly: true });
    assert.ok(lease);
  } finally {
    lines.close();
    if (legacy.exitCode === null && legacy.signalCode === null) { const exited = once(legacy, 'exit'); legacy.stdin.end(); await exited; }
    if (lease) await lease.release();
    await rm(directory, { recursive: true, force: true });
  }
});


test('local full gate and unrequested measurement reject before expensive work', async () => {
  const execute = promisify(execFile);
  await assert.rejects(execute(process.execPath, [new URL('../check.mjs', import.meta.url).pathname, '--full'], { env: { ...process.env, CI: 'false' } }), error => error.code === 1 && error.stderr.includes('requires --allow-local'));
  await assert.rejects(execute(process.execPath, [new URL('./run.mjs', import.meta.url).pathname, '--resource', 'gpu', '--reuse-preview', '--require-reason', '--', process.execPath, new URL('../levels/measure.mjs', import.meta.url).pathname]), error => error.code === 1 && error.stderr.includes('requires --reason'));
});
