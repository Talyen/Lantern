import { cli, parseArgs, run, root } from './lib/cli.mjs';
import { resolve } from 'node:path';
await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--skip-typecheck': 'boolean' });
  if (args['--help']) { console.log('Usage: npm run build -- [--skip-typecheck] (internal handoff option)'); return; }
  await run(process.execPath, [resolve(root, 'scripts/stage-library-build.mjs')]);
  if (!args['--skip-typecheck']) await run(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '--noEmit']);
  await run(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), 'build']);
});
