import { cli, parseArgs } from '../lib/cli.mjs';
import { context } from '../agents/state.mjs';
import { migrateSources } from '../agents/source-storage.mjs';
await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--apply': 'boolean' });
  if (args['--help']) { console.log('Usage: npm run assets:archive-sources -- [--apply]\nInspect original source migration; --apply verifies external copies and inventories them before removing local originals. Prepared assets and active task files stay internal.'); return; }
  const ctx = await context();
  if (ctx.cwd !== ctx.main) throw new Error('Integrate the source tooling first, then run source migration from main.');
  const report = await migrateSources(ctx, { apply: !!args['--apply'] });
  console.log(JSON.stringify({ ...report, collections: report.collections.map(({ source, canonical, movedFiles, movedLogicalBytes, conflicts, files }) =>
    ({ source, destination: canonical, movedFiles, movedLogicalBytes, preservedVersions: conflicts.length, files })) }, null, 2));
});
