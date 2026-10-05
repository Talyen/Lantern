import { cli, parseArgs, run, root } from '../lib/cli.mjs';
import { withResource } from './resources.mjs';
await cli(async () => {
  const separator = process.argv.indexOf('--');
  const args = parseArgs(process.argv.slice(2, separator < 0 ? undefined : separator), { '--resource': 'value', '--reuse-preview': 'boolean', '--require-reason': 'boolean' });
  if (args['--help']) { console.log('Usage: node scripts/agents/run.mjs --resource heavy|gpu|checks -- COMMAND [ARGS]'); return; }
  if (!['heavy', 'gpu', 'checks'].includes(args['--resource']) || separator < 0 || !process.argv[separator + 1]) throw new Error('Specify a resource and literal command after --.');
  let measurement = {};
  if (args['--require-reason']) {
    measurement = parseArgs(process.argv.slice(separator + 3), { '--area': 'value', '--reason': 'value', '--lab': 'value', '--quick': 'boolean', '--dpr': 'value', '--viewport': 'value' });
    if (measurement['--lab'] && measurement['--lab'] !== 'assets') throw new Error('Only the assets lab supports selection measurement.');
    if (measurement['--help']) { await run(process.argv[separator + 1], process.argv.slice(separator + 2)); return; }
    if (!measurement['--reason']?.trim()) throw new Error('Performance measurement requires --reason with a specific user request or evidenced performance defect.');
  }
  if (args['--reuse-preview']) {
    const { livePreview } = await import('./preview.mjs');
    const preview = await livePreview(root);
    if (!preview?.gpuLease || !(preview.author || preview.lab === 'assets' && measurement['--lab'] === 'assets')) throw new Error('Start an owned authoring preview with levels:dev before this operation.');
    const inherited = JSON.parse(process.env.LANTERN_LEASES ?? '{}'); inherited.gpu = preview.gpuLease; process.env.LANTERN_LEASES = JSON.stringify(inherited);
  }
  await withResource(args['--resource'], () => run(process.argv[separator + 1], process.argv.slice(separator + 2)));
});
