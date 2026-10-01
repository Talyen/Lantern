import { mkdir, open, readFile, readdir, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
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

await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--base': 'value', '--full': 'boolean', '--assets': 'boolean' });
  if (args['--help']) { console.log('Usage: npm run check -- [--base SHA] [--assets]\nFast sanity checks. npm run check:full runs the complete production gate.'); return; }
  await withResource('checks', async () => {
    const inputs = await checkInputs(args['--base']);
    const full = !!args['--full'], files = inputs.files;
    const docsOnly = files.length > 0 && files.every(name => name.endsWith('.md'));
    const code = !docsOnly && (files.length === 0 || files.some(name => /\.(?:[cm]?js|ts|py|json)$/.test(name) || /^(?:package|tsconfig|vitest)/.test(name)));
    const docs = full || files.some(name => name.endsWith('.md') || name === 'package.json');
    const levels = full || files.some(name => /^src\/levels\/|^assets\/(?:library-selection|lighting-bakes|environment-surfaces)/.test(name));
    const build = full || !!args['--assets'] || files.some(name => /^(?:package(?:-lock)?\.json|vite\.config\.ts|index\.html|electron\/|scripts\/build\.mjs|scripts\/assets\/|scripts\/lib\/assets\.mjs|assets\/(?:library-selection|lighting-bakes|playable-characters)\.json)/.test(name));
    const key = `${inputs.signature}-${full}-${!!args['--assets']}`;
    const cachePath = resolve(root, '.local/checks/cache.json');
    const cache = await readJSON(cachePath, null);
    if (cache?.key === key && cache.passed) { console.log(`Sanity checks already passed for these inputs: ${cache.evidence}`); return; }
    const dir = resolve(root, '.local/checks', new Date().toISOString().replace(/[:.]/g, '-'));
    await mkdir(dir, { recursive: true });
    const node = process.execPath;
    const stages = [
      ...(!docsOnly || full ? [['rendering', node, ['scripts/check-rendering.mjs']]] : []),
      ...(docs ? [['docs', node, ['scripts/check-docs.mjs']]] : []),
      ...(code || full ? [['types', node, ['node_modules/typescript/bin/tsc', '--noEmit']], ['tests', node, ['node_modules/vitest/vitest.mjs', 'run', '--maxWorkers', '2']]] : []),
      ...(full || files.some(name => name.startsWith('scripts/agents/')) ? [['workflow', node, ['--test', 'scripts/agents/workflow.test.mjs']]] : []),
      ...(levels ? [['levels', node, ['scripts/levels/check.mjs']]] : []),
      ...(build ? [['build', node, ['scripts/build.mjs', ...(code || full ? ['--skip-typecheck'] : [])]], ['inventory', node, ['scripts/check-assets.mjs', '--build']], ['preview', node, ['scripts/smoke-preview.mjs']]] : []),
      ...(args['--assets'] ? [['assets', node, ['scripts/check-assets.mjs']]] : []),
      ...(args['--base'] ? [['candidate-diff', 'git', ['diff', '--check', `${args['--base']}...HEAD`]]] : []),
      ['index-diff', 'git', ['diff', '--cached', '--check']],
      ['diff', 'git', ['diff', '--check']],
    ];
    const summary = [];
    let failed = false;
    for (const [name, command, argv] of stages) {
      if (failed) { summary.push({ name, status: 'skipped' }); continue; }
      const log = await open(resolve(dir, `${name}.log`), 'w'), start = Date.now();
      try {
        await run(command, argv, { timeout: 180000, stdio: ['ignore', log.fd, log.fd] });
        summary.push({ name, status: 'passed', ms: Date.now() - start }); console.log(`PASS ${name}`);
      } catch (error) {
        failed = true; summary.push({ name, status: 'failed', error: error.message, ms: Date.now() - start });
        console.error(`FAIL ${name}: ${error.message}; log: ${resolve(dir, `${name}.log`)}`);
      } finally { await log.close(); }
    }
    const after = await checkInputs(args['--base']);
    if (after.signature !== inputs.signature) { failed = true; summary.push({ name: 'stable-inputs', status: 'failed', error: 'Inputs changed during checks.' }); }
    await writeJSON(resolve(dir, 'summary.json'), summary);
    await writeJSON(resolve(dir, 'inputs.json'), { ...inputs, full, build, passed: !failed });
    if (!failed) {
      await writeJSON(cachePath, { key, passed: true, evidence: dir });
      // Keep the last successful evidence and all failures. No archive/source cleanup here.
      for (const entry of await readdir(resolve(root, '.local/checks'), { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const name = entry.name;
        const old = resolve(root, '.local/checks', name);
        if (old !== dir && name !== 'cache.json' && (await readJSON(join(old, 'inputs.json'), null))?.passed) await rm(old, { recursive: true, force: true });
      }
    }
    console.log(`${full ? 'Full gate' : 'Sanity check'} evidence: ${dir}`);
    if (failed) process.exitCode = 1;
  });
});
