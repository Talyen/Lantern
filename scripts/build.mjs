import { cli, parseArgs, run, root } from './lib/cli.mjs';
import { withResource } from './agents/resources.mjs';
import { privateTree } from './agents/copy.mjs';
import { resolve } from 'node:path';
await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--skip-typecheck': 'boolean' });
  if (args['--help']) { console.log('Usage: npm run build -- [--skip-typecheck] (internal handoff option)'); return; }
  await withResource('heavy', async () => {
    await run(process.execPath, [resolve(root, 'scripts/assets/stage-library-build.mjs')]);
    if (!args['--skip-typecheck']) await run(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '--noEmit']);
    await run(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), 'build']);
    await privateTree(resolve(root, '.local/build-public'), resolve(root, 'dist'));
  });
});
