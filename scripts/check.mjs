import { mkdir, open, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cli, parseArgs, run, root } from './lib/cli.mjs';
await cli(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args['--help']) { console.log('Usage: npm run check'); return; }
  const dir = resolve(root, '.local/checks', new Date().toISOString().replace(/[:.]/g, '-'));
  await mkdir(dir, { recursive: true });
  const node = process.execPath;
  const stages = [
    ['rendering', node, ['scripts/check-rendering.mjs']],
    ['docs', node, ['scripts/check-docs.mjs']],
    ['types', node, ['node_modules/typescript/bin/tsc', '--noEmit']],
    ['tests', node, ['node_modules/vitest/vitest.mjs', 'run']],
    ['levels', node, ['scripts/levels/check.mjs']],
    ['build', node, ['scripts/build.mjs', '--skip-typecheck']],
    ['inventory', node, ['scripts/check-assets.mjs', '--build']],
    ['preview', node, ['scripts/smoke-preview.mjs']],
    ['diff', 'git', ['diff', '--check']],
  ];
  const summary = [];
  let failed = false;
  for (const [name, command, argv] of stages) {
    if (failed) { summary.push({ name, status: 'skipped' }); console.log(`SKIP ${name}: earlier failure`); continue; }
    const log = await open(resolve(dir, `${name}.log`), 'w');
    const start = Date.now();
    try {
      await run(command, argv, { timeout: 180000, stdio: ['ignore', log.fd, log.fd] });
      summary.push({ name, status: 'passed', ms: Date.now() - start }); console.log(`PASS ${name}`);
    } catch (error) {
      failed = true; summary.push({ name, status: 'failed', error: error.message, ms: Date.now() - start });
      console.error(`FAIL ${name}: ${error.message}; log: ${resolve(dir, `${name}.log`)}`);
    } finally { await log.close(); }
  }
  await writeFile(resolve(dir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`Check evidence: ${dir}\nGameplay and GPU correctness require the documented local smoke pass.`);
  if (failed) process.exitCode = 1;
});
