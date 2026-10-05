import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { join } from 'node:path';
import { git, context, writeJSON, readJSON, readTask, currentTask, taskPath, taskCapacity, spaceRequirement, processIdentity } from './state.mjs';
import { startTask, finishTask, cleanupTask, recover, installedDependenciesMatch } from './workflow.mjs';
import { acquire, childEnvironment, withResource, RESOURCE_LIMITS } from './resources.mjs';
import { sessionPath, stopPreview, browserHistoryPath, recoverBrowsers } from './preview.mjs';

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

// A damaged or large unrelated history must not prevent stopping an owned preview.
// Existing workflow fixtures exercise broad discovery, not isolated command lookup.
test('single-task lookup ignores unrelated history and verifies its worktree registration', async () => {
  const ctx = await fixture();
  try {
    const task = { id: 'selected', path: join(ctx.main, '.local/worktrees/selected'), status: 'working' };
    await writeJSON(taskPath(ctx, task.id), task);
    await writeFile(taskPath(ctx, 'unrelated'), 'unreadable historical JSON');
    const owned = { ...ctx, cwd: task.path };
    assert.deepEqual(await readTask(ctx, task.id), task);
    assert.deepEqual(await currentTask(owned), task);
    await assert.rejects(readTask(ctx, '../selected'), /Invalid task slug/);
    await assert.rejects(currentTask(ctx), /returned worktree/);
    await writeJSON(taskPath(ctx, task.id), { ...task, path: ctx.main });
    await assert.rejects(currentTask(owned), /registration/);
    await writeJSON(taskPath(ctx, task.id), { ...task, status: 'cleaned' });
    await assert.rejects(currentTask(owned), /returned worktree/);
  } finally { await ctx.dispose(); }
});

// Owner exit or a missing current record cannot certify cleanup. These cases
// are outside the existing guardian/history fixtures and protect other sessions.
for (const currentRecord of [false, true]) test(`stop verifies browser exit with ${currentRecord ? 'an exited owner' : 'no current preview record'}`, { timeout: 15000 }, async () => {
  const ctx = await fixture();
  const browser = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
  const exits = [once(browser, 'exit'), once(unrelated, 'exit')];
  let owner;
  try {
    const record = { pid: process.pid, started: 'exited owner', token: 'fixture', browserProcesses: [
      { pid: browser.pid, started: await processIdentity(browser.pid) },
      { pid: unrelated.pid, started: 'reused PID' },
    ] };
    await writeJSON(browserHistoryPath(ctx.main), [{ ...record, closed: true }]);
    if (currentRecord) {
      owner = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      const ownerExit = once(owner, 'exit');
      await writeJSON(sessionPath(ctx.main), { ...record, pid: owner.pid, started: await processIdentity(owner.pid), status: 'starting' });
      await stopPreview(ctx.main); await ownerExit;
    } else await stopPreview(ctx.main);
    assert.equal(await processIdentity(browser.pid), '');
    await exits[0];
    assert.ok(await processIdentity(unrelated.pid));
    assert.equal(await readJSON(sessionPath(ctx.main), null), null);
  } finally {
    for (const child of [browser, unrelated]) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    if (owner && owner.exitCode === null && owner.signalCode === null) { const exit = once(owner, 'exit'); owner.kill('SIGKILL'); await exit; }
    await Promise.all(exits); await ctx.dispose();
  }
});

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

test('eight concurrent tasks land without lost work and completed cleanup preserves source archives', async () => {
  const ctx = await fixture();
  try {
    assert.equal(spaceRequirement(ctx.main, false), 20 * 1024 ** 3);
    assert.equal(spaceRequirement(ctx.main, true), 1024 ** 3);
    assert.deepEqual(await taskCapacity(ctx), { used: 0, limit: 8 });
    const jobs = await Promise.all(['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'].map(id => startTask(ctx, id)));
    assert.deepEqual(await taskCapacity(ctx), { used: 8, limit: 8 });
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

test('task capacity uses shared local configuration and full slots still allow resuming work', async () => {
  const ctx = await fixture();
  try {
    await git(['config', '--local', 'lantern.maxWorktrees', '1'], ctx.main);
    const first = await startTask(ctx, 'first');
    assert.deepEqual(await taskCapacity(await context(first.path)), { used: 1, limit: 1 });
    assert.equal((await startTask(ctx, 'first', { wait: false })).path, first.path);
    await assert.rejects(startTask(ctx, 'second', { wait: false }), /All 1 task worktree slots are occupied/);
    assert.equal(await readJSON(taskPath(ctx, 'second'), null), null);
    for (const value of ['0', '1.5']) {
      await git(['config', '--local', 'lantern.maxWorktrees', value], ctx.main);
      await assert.rejects(taskCapacity(ctx), /positive integer/);
    }
    await git(['config', '--local', '--unset', 'lantern.maxWorktrees'], ctx.main);
    assert.deepEqual(await taskCapacity(ctx), { used: 1, limit: 8 });
  } finally { await ctx.dispose(); }
});

test('queued admission permits finish and cleanup and cancellation creates no task', async () => {
  const ctx = await fixture(), canceled = new AbortController(), waiting = new AbortController();
  let queued;
  try {
    await git(['config', '--local', 'lantern.maxWorktrees', '1'], ctx.main);
    const first = await startTask(ctx, 'first');
    const interrupted = startTask(ctx, 'canceled', { signal: canceled.signal });
    const rejected = assert.rejects(interrupted, { name: 'AbortError' });
    canceled.abort(); await rejected;
    assert.equal(await readJSON(taskPath(ctx, 'canceled'), null), null);

    queued = startTask(ctx, 'second', { signal: waiting.signal });
    queued.catch(() => {}); // The original promise is awaited after capacity is released.
    // Let the admission attempt reach the occupied slot before releasing it.
    await new Promise(resolve => setTimeout(resolve, 150));
    await finishTask(ctx, first);
    await cleanupTask(ctx, await readJSON(taskPath(ctx, first.id)));
    const second = await queued;
    assert.equal(second.status, 'working');
    assert.deepEqual(await taskCapacity(ctx), { used: 1, limit: 1 });
  } finally {
    canceled.abort(); waiting.abort();
    if (queued) await Promise.allSettled([queued]);
    await ctx.dispose();
  }
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
    const previous = await readFile(join(ctx.main, 'shared.txt'), 'utf8');
    await writeFile(join(ctx.main, 'shared.txt'), 'preserve me');
    await assert.rejects(finishTask(ctx, await readJSON(taskPath(ctx, bad.id))), /uncommitted/);
    assert.equal(await readFile(join(ctx.main, 'shared.txt'), 'utf8'), 'preserve me');
    await assert.rejects(cleanupTask(ctx, bad), /unfinished/);
    await writeFile(join(ctx.main, 'shared.txt'), previous);
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
  for (const file of ['eslint.config.js', 'eslint/rules.mjs', 'eslint/rules.test.mjs', 'scripts/check-rendering.mjs', 'scripts/lint.mjs', 'ruff.config.json', 'stylelint.config.js']) assert.ok(names([file]).includes('lint-policy'), file);
  assert.ok(names(['scripts/agents/native.py']).includes('lint-python'));
  assert.ok(names(['src/ui/game.css']).includes('lint-css'));
  assert.ok(!names(['src/entry.ts']).includes('lint-policy'));
  assert.ok(names(['src/levels/lighting.ts']).includes('levels'));
  const full = names([], { '--full': true });
  for (const stage of ['lint', 'lint-policy', 'tests', 'workflow', 'build', 'inventory', 'preview']) assert.ok(full.includes(stage));
  const assets = names(['assets/playable-characters.json'], { '--assets': true });
  assert.ok(assets.includes('assets'));
  assert.ok(!assets.includes('build'));
});

// Admission rationale: protects the two-GPU cap, inherited ownership and single-check cap.
test('managed resources respect capacity, inherit leases and clean up', { timeout: 15000 }, async () => {
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
        const probe = `import {acquire} from ${JSON.stringify(new URL('./resources.mjs', import.meta.url).href)}; const lease=await acquire(${JSON.stringify(resource)}, {ctx:JSON.parse(process.env.TEST_CTX),tryOnly:true}); console.log(lease?.record.slot ?? null); await lease?.release();`;
        const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', probe], { env: { ...process.env, LANTERN_LEASES: '{}', TEST_CTX: JSON.stringify(ctx) } });
        assert.equal(result.stdout.trim(), resource === 'gpu' ? '1' : 'null');
      }, { ctx });
      const lease = await acquire(resource, { ctx, tryOnly: true });
      assert.ok(lease);
      let second;
      try {
        if (resource === 'gpu') {
          second = await acquire(resource, { ctx, slot: 1, tryOnly: true });
          assert.equal(second?.record.slot, 1);
          assert.notEqual(second.record.token, lease.record.token);
        }
        assert.equal(await acquire(resource, { ctx, tryOnly: true }), null);
      } finally { await second?.release(); }
      const marker = join(directory, `${resource}-cleanup`);
      lease.cleanup([process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'cleaned')`]);
      await lease.release();
      assert.equal(await readFile(marker, 'utf8'), 'cleaned');
      assert.equal(await readJSON(join(ctx.store, 'leases', `${resource}-0.json`), null), null);
      await assert.rejects(acquire(resource, { ctx, slots: RESOURCE_LIMITS[resource] + 1 }), /require .* slot/);
      for (const slot of [-1, 0.5, RESOURCE_LIMITS[resource]]) await assert.rejects(acquire(resource, { ctx, slot }), /valid slot index/);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('retired check slot drains, remains blocked for old worktrees and releases on interruption', { timeout: 15000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lantern-legacy-resource-'));
  const ctx = { main: directory, store: join(directory, 'state') };
  const native = new URL('./native.py', import.meta.url).pathname;
  const legacy = spawn('python3', [native, 'lease', join(ctx.store, 'leases'), 'checks', '--slots', '2', '--slot', '1', '--token', 'legacy-test'], { stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = createInterface({ input: legacy.stdout });
  let lease;
  try {
    const [line] = await once(lines, 'line');
    assert.equal(JSON.parse(line).acquired.slot, 1);
    assert.equal(await acquire('checks', { ctx, tryOnly: true }), null);
    const queued = spawn('python3', [native, 'lease', join(ctx.store, 'leases'), 'checks', '--drain-slots', '2', '--token', 'queued-test'], { stdio: ['pipe', 'pipe', 'inherit'] });
    const queuedLines = createInterface({ input: queued.stdout });
    try {
      const [waiting] = await once(queuedLines, 'line');
      assert.equal(JSON.parse(waiting).waiting, 'checks');
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
    lease = await acquire('checks', { ctx, tryOnly: true });
    assert.ok(lease);
    const { stdout } = await promisify(execFile)('python3', [native, 'lease', join(ctx.store, 'leases'), 'checks', '--slots', '2', '--slot', '1', '--try-only', '--token', 'legacy-probe']);
    assert.equal(JSON.parse(stdout).deferred, 'checks');
    const interrupted = once(lease.child, 'exit');
    lease.child.kill('SIGTERM');
    await interrupted;
    await assert.rejects(lease.release(), /guardian cleanup failed/);
    lease = undefined;
    lease = await acquire('checks', { ctx, tryOnly: true });
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

test('queued previews can be stopped and concurrent startup keeps one owner', { timeout: 15000 }, async () => {
  const ctx = await fixture(), starters = [];
  let lease, second;
  const start = () => {
    const code = `import {startPreview} from ${JSON.stringify(new URL('./preview.mjs', import.meta.url).href)}; await startPreview(process.cwd(), {browser:true});`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], { cwd: ctx.main, env: { ...process.env, LANTERN_LEASES: '{}' }, stdio: ['ignore','pipe','pipe'] });
    child.stdout.resume(); child.stderr.resume(); starters.push(child); return child;
  };
  try {
    lease = await acquire('gpu', { ctx });
    second = await acquire('gpu', { ctx });
    start(); start();
    let record;
    for (let i = 0; i < 60; i++) {
      record = await readJSON(sessionPath(ctx.main), null);
      if (record && starters.some(child => child.exitCode !== null)) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(record?.status, 'starting');
    assert.equal(starters.filter(child => child.exitCode !== null).length, 1);
    const exit = Promise.all(starters.map(child => child.exitCode === null ? once(child, 'exit') : Promise.resolve()));
    await stopPreview(ctx.main); await exit;
    assert.equal(await readJSON(sessionPath(ctx.main), null), null);
    const queuePath = join(ctx.store, 'leases/gpu.queue.json');
    for (let i = 0; i < 20 && (await readJSON(queuePath, [])).length; i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.deepEqual(await readJSON(queuePath, []), []);
  } finally {
    await stopPreview(ctx.main).catch(() => {});
    for (const child of starters) if (child.exitCode === null) { const exit = once(child, 'exit'); child.kill('SIGTERM'); await exit; }
    await second?.release(); await lease?.release(); await ctx.dispose();
  }
});

test('browser cleanup survives a failed close without touching a reused process identity', { timeout: 15000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lantern-browser-cleanup-'));
  const ctx = { store: directory, main: directory };
  const browser = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
  const browserExit = once(browser, 'exit'), unrelatedExit = once(unrelated, 'exit');
  let lease;
  try {
    lease = await acquire('gpu', { ctx });
    lease.cleanup([process.execPath, '-e', 'process.exit(7)']);
    lease.cleanupGroup({ pid: browser.pid, started: await processIdentity(browser.pid) });
    lease.cleanupGroup({ pid: unrelated.pid, started: 'different start identity' });
    await lease.release(); lease = undefined;
    await browserExit;
    assert.ok(await processIdentity(unrelated.pid));
    lease = await acquire('gpu', { ctx, tryOnly: true });
    assert.ok(lease, 'Admission resumes after owned browser cleanup');
  } finally {
    if (browser.exitCode === null && browser.signalCode === null) browser.kill('SIGKILL');
    unrelated.kill('SIGKILL'); await unrelatedExit;
    await lease?.release(); await rm(directory, { recursive: true, force: true });
  }
});

test('durable browser history recovers earlier launches while preserving live owners and reused PIDs', { timeout: 15000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lantern-browser-history-'));
  const browsers = Array.from({ length: 3 }, () => spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' }));
  const exits = browsers.map(browser => once(browser, 'exit'));
  try {
    const groups = await Promise.all(browsers.map(async browser => ({ pid: browser.pid, started: await processIdentity(browser.pid) })));
    await writeJSON(browserHistoryPath(directory), [
      { pid: process.pid, started: 'exited owner', browserProcesses: [groups[0], { ...groups[2], started: 'reused PID' }] },
      { pid: process.pid, started: await processIdentity(process.pid), browserProcesses: [groups[1]] },
    ]);
    await recoverBrowsers(directory); await exits[0];
    assert.ok(await processIdentity(browsers[1].pid));
    assert.ok(await processIdentity(browsers[2].pid));
    const history = await readJSON(browserHistoryPath(directory));
    assert.equal(history[0].closed, true); assert.equal(history[1].closed, undefined);
  } finally {
    for (const browser of browsers) if (browser.exitCode === null && browser.signalCode === null) browser.kill('SIGKILL');
    await Promise.all(exits); await rm(directory, { recursive: true, force: true });
  }
});

test('failed process queries preserve browser history and active groups', { timeout: 15000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lantern-browser-query-'));
  const browser = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
  const exit = once(browser, 'exit');
  try {
    await writeJSON(browserHistoryPath(directory), [{ pid: process.pid, started: await processIdentity(process.pid), browserProcesses: [{ pid: browser.pid, started: await processIdentity(browser.pid) }] }]);
    const code = `import assert from 'node:assert/strict'; import {recoverBrowsers} from ${JSON.stringify(new URL('./preview.mjs', import.meta.url).href)}; await assert.rejects(recoverBrowsers(${JSON.stringify(directory)}));`;
    for (const failure of ['exit 2', 'echo inspection-failed >&2\nexit 1', 'echo incomplete\nexit 1']) {
      await writeFile(join(directory, 'ps'), `#!/bin/sh\n${failure}\n`, { mode: 0o755 });
      await promisify(execFile)(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, PATH: `${directory}:${process.env.PATH}` } });
    }
    assert.ok(await processIdentity(browser.pid));
    assert.equal((await readJSON(browserHistoryPath(directory)))[0].closed, undefined);
  } finally {
    browser.kill('SIGKILL'); await exit; await rm(directory, { recursive: true, force: true });
  }
});

test('browser cleanup survives an abruptly exited preview owner', { timeout: 15000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lantern-browser-owner-'));
  const ctx = { store: directory, main: directory };
  const code = `
    import {spawn} from 'node:child_process';
    import {acquire} from ${JSON.stringify(new URL('./resources.mjs', import.meta.url).href)};
    import {processIdentity} from ${JSON.stringify(new URL('./state.mjs', import.meta.url).href)};
    const lease = await acquire('gpu', {ctx: ${JSON.stringify(ctx)}});
    const browser = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {detached:true, stdio:'ignore'});
    lease.cleanupGroup({pid:browser.pid, started:await processIdentity(browser.pid)});
    console.log(JSON.stringify({pid:browser.pid}));
    setInterval(() => {}, 1000);
  `;
  const owner = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'inherit'] });
  const lines = createInterface({ input: owner.stdout });
  let browserPid, lease;
  try {
    const [line] = await once(lines, 'line'); browserPid = JSON.parse(line).pid;
    const exited = once(owner, 'exit'); owner.kill('SIGKILL'); await exited;
    for (let attempt = 0; attempt < 50 && await processIdentity(browserPid); attempt++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await processIdentity(browserPid), '');
    lease = await acquire('gpu', { ctx, tryOnly: true });
    assert.ok(lease);
  } finally {
    lines.close();
    if (owner.exitCode === null && owner.signalCode === null) owner.kill('SIGKILL');
    if (browserPid && await processIdentity(browserPid)) process.kill(browserPid, 'SIGKILL');
    await lease?.release(); await rm(directory, { recursive: true, force: true });
  }
});

test('later resource probes cannot overtake a queued GPU waiter', { timeout: 15000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lantern-fifo-resource-'));
  const ctx = { main: directory, store: join(directory, 'state') };
  let lease, second, waiter;
  try {
    lease = await acquire('gpu', { ctx });
    second = await acquire('gpu', { ctx });
    waiter = spawn('python3', [new URL('./native.py', import.meta.url).pathname, 'lease', join(ctx.store, 'leases'), 'gpu', '--token', 'first-waiter', '--slots', '2'], { stdio: ['pipe','pipe','pipe'] });
    waiter.stderr.resume();
    const lines = createInterface({ input: waiter.stdout });
    const [waiting] = await once(lines, 'line'); assert.equal(JSON.parse(waiting).waiting, 'gpu');
    waiter.kill('SIGSTOP');
    await lease.release(); lease = undefined;
    const later = await acquire('gpu', { ctx, tryOnly: true });
    if (later) { await later.release(); assert.fail('Later request overtook the queued waiter'); }
    const admitted = once(lines, 'line'); waiter.kill('SIGCONT');
    const [line] = await admitted; assert.equal(JSON.parse(line).acquired.token, 'first-waiter');
    const exit = once(waiter, 'exit'); waiter.stdin.end(); await exit;
    lines.close();
  } finally {
    if (waiter && waiter.exitCode === null) { waiter.kill('SIGCONT'); const exit = once(waiter, 'exit'); waiter.kill('SIGTERM'); await exit; }
    await second?.release(); await lease?.release(); await rm(directory, { recursive: true, force: true });
  }
});

// Admission rationale: protects user art/private work against loss during local integration,
// with the exact unrelated-untracked and incoming-collision paths seen by the workflow.
test('promotion preserves unrelated untracked art', async () => {
  const ctx = await fixture();
  try {
    const task = await startTask(ctx, 'untracked-art');
    await edit(task, 'feature.txt', 'reviewed change\n');
    await writeFile(join(ctx.main, 'Concept Art.png'), 'user art bytes');
    const done = await finishTask(ctx, task, { paths: ['feature.txt'], message: 'feature' });
    assert.equal(done.status, 'integrated');
    assert.equal(await readFile(join(ctx.main, 'Concept Art.png'), 'utf8'), 'user art bytes');
    assert.equal(await readFile(join(ctx.main, 'feature.txt'), 'utf8'), 'reviewed change\n');
  } finally { await ctx.dispose(); }
});

test('promotion rejects colliding untracked art and tracked user edits', async () => {
  const ctx = await fixture();
  try {
    const task = await startTask(ctx, 'art-collision');
    await edit(task, 'Concept Art.png', 'incoming bytes');
    await writeFile(join(ctx.main, 'Concept Art.png'), 'user art bytes');
    await assert.rejects(finishTask(ctx, task, { paths: ['Concept Art.png'], message: 'incoming' }), /Checkout has uncommitted changes/);
    assert.equal(await readFile(join(ctx.main, 'Concept Art.png'), 'utf8'), 'user art bytes');
    await writeFile(join(ctx.main, 'shared.txt'), 'user tracked work');
    await assert.rejects(startTask(ctx, 'tracked-edit', { wait: false }), /Checkout has uncommitted changes/);
    assert.equal(await readFile(join(ctx.main, 'shared.txt'), 'utf8'), 'user tracked work');
  } finally { await ctx.dispose(); }
});
