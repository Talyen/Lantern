import { mkdir, open, readFile, readdir, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { cli, parseArgs, run, root } from './lib/cli.mjs';
import { git, readJSON, writeJSON } from './agents/state.mjs';
import { withResource } from './agents/resources.mjs';
import { assetIndex, assetIdentity } from './agents/assets.mjs';

export async function checkInputs(base) {
  const head = await git(['rev-parse', 'HEAD']);
  if (base) await git(['merge-base', '--is-ancestor', base, head]);
  const names = new Set();
  for (const args of [base ? ['diff', '--name-only', '-z', `${base}...HEAD`] : ['diff', '--name-only', '-z'], ['diff', '--cached', '--name-only', '-z'], ['ls-files', '--others', '--exclude-standard', '-z']]) {
    for (const name of (await git(args)).split('\0')) if (name) names.add(name);
  }
  const hash = createHash('sha256').update(head).update(base ?? '').update(process.version);
  for (const name of [...names].sort()) {
    hash.update(name);
    try { hash.update(await readFile(join(root, name))); } catch (error) { if (error.code !== 'ENOENT') throw error; hash.update('deleted'); }
  }
  const assets = assetIdentity(await assetIndex(join(root, 'public/vendor')));
  hash.update(assets);
  return { head, base, files: [...names].sort(), assets, signature: hash.digest('hex') };
}

export function checkStages(files, args = {}) {
  const node = process.execPath;
  const full = !!args['--full'];
  const docsOnly = files.length > 0 && files.every(name => name.endsWith('.md'));
  const code = !docsOnly && (files.length === 0 || files.some(name => /\.(?:[cm]?js|ts|py|json)$/.test(name)));
  const docs = full || files.some(name => name.endsWith('.md') || name === 'package.json');
  const levels = full || files.some(name => /^src\/levels\/|^assets\/(?:library-selection|lighting-bakes|environment-surfaces)/.test(name));
  return [
    ...(!docsOnly || full ? [['rendering', node, ['scripts/check-rendering.mjs']]] : []),
    ...(docs ? [['docs', node, ['scripts/check-docs.mjs']]] : []),
    ...(code || full ? [['types', node, ['node_modules/typescript/bin/tsc', '--noEmit']]] : []),
    ...(full ? [['workflow', node, ['--test', 'scripts/agents/workflow.test.mjs']]] : []),
    ...(full ? [['tests', node, ['node_modules/vitest/vitest.mjs', 'run']]] : []),
    ...(levels ? [['levels', node, ['scripts/levels/check.mjs']]] : []),
    ...(full ? [['build', node, ['scripts/build.mjs', '--skip-typecheck']], ['inventory', node, ['scripts/check-assets.mjs', '--build']], ['preview', node, ['scripts/smoke-preview.mjs']]] : []),
    ...(args['--assets'] ? [['assets', node, ['scripts/check-assets.mjs']]] : []),
    ...(args['--base'] ? [['candidate-diff', 'git', ['diff', '--check', `${args['--base']}...HEAD`]]] : []),
    ['index-diff', 'git', ['diff', '--cached', '--check']],
    ['diff', 'git', ['diff', '--check']],
  ];
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--base': 'value', '--full': 'boolean', '--assets': 'boolean', '--allow-local': 'boolean' });
  if (args['--help']) { console.log('Usage: npm run check -- [--base SHA] [--assets]\nStatic local sanity checks. Full gate: CI, or npm run check:full -- --allow-local with user authorization.'); return; }
  if (args['--full'] && !['true', '1'].includes(process.env.CI ?? '') && !args['--allow-local']) throw new Error('Full validation is CI-first. A user-requested local full gate requires --allow-local.');
  const perform = async () => {
    const inputs = await checkInputs(args['--base']);
    const full = !!args['--full'], files = inputs.files;
    const stages = checkStages(files, args);
    const build = full;
    const mode = full ? 'full' : 'light';
    const key = `ci-first-v1-${inputs.signature}-${mode}-${!!args['--assets']}`;
    const cachePath = resolve(root, `.local/checks/cache${full ? '-full' : ''}.json`);
    const cache = await readJSON(cachePath, null);
    if (cache?.key === key && cache.passed) {
      console.log(`${mode} checks already passed for these inputs: ${cache.evidence}`);
      if (!full) console.log('Full unit/workflow tests, build, inventory and HTTP smoke are deferred to CI.');
      return;
    }
    const dir = resolve(root, '.local/checks', new Date().toISOString().replace(/[:.]/g, '-'));
    await mkdir(dir, { recursive: true });
    const summary = [];
    let failed = false;
    for (const [name, command, argv] of stages) {
      if (failed) { summary.push({ name, status: 'skipped' }); continue; }
      const log = await open(resolve(dir, `${name}.log`), 'w'), queued = Date.now();
      let start = queued, waitingMs = 0;
      try {
        await withResource(name === 'build' ? 'heavy' : 'checks', async () => {
          start = Date.now(); waitingMs = start - queued;
          await run(command, argv, { timeout: 180000, stdio: ['ignore', log.fd, log.fd] });
        });
        summary.push({ name, status: 'passed', ms: Date.now() - start, waitingMs }); console.log(`PASS ${name}`);
      } catch (error) {
        failed = true; summary.push({ name, status: 'failed', error: error.message, ms: Date.now() - start, waitingMs });
        console.error(`FAIL ${name}: ${error.message}; log: ${resolve(dir, `${name}.log`)}`);
      } finally { await log.close(); }
    }
    const after = await checkInputs(args['--base']);
    if (after.signature !== inputs.signature) { failed = true; summary.push({ name: 'stable-inputs', status: 'failed', error: 'Inputs changed during checks.' }); }
    await writeJSON(resolve(dir, 'summary.json'), summary);
    await writeJSON(resolve(dir, 'inputs.json'), { ...inputs, full, build, mode, stages: stages.map(([name]) => name), passed: !failed });
    if (!failed) {
      await writeJSON(cachePath, { key, passed: true, evidence: dir });
      // Keep the last successful evidence per mode and all failures. No archive/source cleanup here.
      for (const entry of await readdir(resolve(root, '.local/checks'), { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const name = entry.name;
        const old = resolve(root, '.local/checks', name);
        const previous = await readJSON(join(old, 'inputs.json'), null);
        if (old !== dir && previous?.passed && previous.mode === mode) await rm(old, { recursive: true, force: true });
      }
    }
    console.log(`${full ? 'Full gate' : 'Light sanity check'} evidence: ${dir}`);
    if (!full) console.log('Full unit/workflow tests, build, inventory and HTTP smoke are deferred to CI.');
    if (failed) process.exitCode = 1;
  };
  await perform();
});
