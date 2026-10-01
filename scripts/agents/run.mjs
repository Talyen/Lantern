import { cli, parseArgs, run, root } from '../lib/cli.mjs';
import { withResource } from './resources.mjs';
await cli(async () => {
  const separator = process.argv.indexOf('--');
  const args = parseArgs(process.argv.slice(2, separator < 0 ? undefined : separator), { '--resource': 'value', '--reuse-preview': 'boolean' });
  if (args['--help']) { console.log('Usage: node scripts/agents/run.mjs --resource heavy|gpu|checks -- COMMAND [ARGS]'); return; }
  if (!['heavy', 'gpu', 'checks'].includes(args['--resource']) || separator < 0 || !process.argv[separator + 1]) throw new Error('Specify a resource and literal command after --.');
  if (args['--reuse-preview']) {
    const { livePreview } = await import('./preview.mjs');
    const preview = await livePreview(root);
    if (!preview?.gpuLease || !preview.author) throw new Error('Start an owned authoring preview with levels:dev before this operation.');
    const inherited = JSON.parse(process.env.LANTERN_LEASES ?? '{}'); inherited.gpu = preview.gpuLease; process.env.LANTERN_LEASES = JSON.stringify(inherited);
  }
  await withResource(args['--resource'], () => run(process.argv[separator + 1], process.argv.slice(separator + 2)));
});
