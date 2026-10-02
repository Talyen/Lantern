import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cli, isMain, parseArgs, root } from './lib/cli.mjs';
import { readJSON, writeJSON } from './agents/state.mjs';
import { checkInputs } from './checks/inputs.mjs';
import { checkStages } from './checks/stages.mjs';
import { pruneSuccessfulEvidence, runCheckStages } from './checks/evidence.mjs';

// Retain the importable API used by existing tooling and fixtures.
export { checkInputs } from './checks/inputs.mjs';
export { checkStages } from './checks/stages.mjs';
export { diagnosticExcerpt } from './checks/evidence.mjs';

if (isMain(import.meta.url)) await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--base': 'value', '--full': 'boolean', '--assets': 'boolean', '--allow-local': 'boolean' });
  if (args['--help']) { console.log('Usage: npm run check -- [--base SHA] [--assets]\nStatic local sanity checks. Full gate: CI, or npm run check:full -- --allow-local with user authorization.'); return; }
  if (args['--full'] && !['true', '1'].includes(process.env.CI ?? '') && !args['--allow-local']) throw new Error('Full validation is CI-first. A user-requested local full gate requires --allow-local.');

  const inputs = await checkInputs(args['--base']);
  const full = !!args['--full'], files = inputs.files;
  const stages = checkStages(files, args);
  const build = full;
  const mode = full ? 'full' : 'light';
  const key = `ci-first-v3-${inputs.signature}-${mode}-${!!args['--assets']}`;
  const cachePath = resolve(root, `.local/checks/cache${full ? '-full' : ''}.json`);
  const cache = await readJSON(cachePath, null);
  if (cache?.key === key && cache.passed) {
    console.log(`${mode} checks already passed for these inputs: ${cache.evidence}`);
    if (!full) console.log('Full unit/workflow tests, build, inventory and HTTP smoke are deferred to CI.');
    return;
  }
  const dir = resolve(root, '.local/checks', new Date().toISOString().replace(/[:.]/g, '-'));
  await mkdir(dir, { recursive: true });
  const result = await runCheckStages(stages, dir);
  const { summary } = result;
  let failed = result.failed;
  const after = await checkInputs(args['--base']);
  if (after.signature !== inputs.signature) { failed = true; summary.push({ name: 'stable-inputs', status: 'failed', error: 'Inputs changed during checks.' }); }
  await writeJSON(resolve(dir, 'summary.json'), summary);
  await writeJSON(resolve(dir, 'inputs.json'), { ...inputs, full, build, mode, stages: stages.map(([name]) => name), passed: !failed });
  if (!failed) {
    await writeJSON(cachePath, { key, passed: true, evidence: dir });
    await pruneSuccessfulEvidence(dir, mode);
  }
  console.log(`${full ? 'Full gate' : 'Light sanity check'} evidence: ${dir}`);
  if (!full) console.log('Full unit/workflow tests, build, inventory and HTTP smoke are deferred to CI.');
  if (failed) process.exitCode = 1;
});
