import { cli, parseArgs, root } from '../lib/cli.mjs';
import { startPreview } from '../agents/preview.mjs';
import { readAreas, ready } from './common.mjs';
await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--area': 'value', '--renderer': 'value' });
  if (args['--help']) { console.log('Usage: npm run levels:dev -- [--area ID] [--renderer webgpu]'); return; }
  const area = args['--area'] ?? 'clearing';
  if (!(await readAreas())[area]) throw new Error(`Unknown area ${area}`);
  if (args['--renderer'] && args['--renderer'] !== 'webgpu') throw new Error('Lantern requires native WebGPU.');
  const record = await startPreview(root, { browser: true, author: true, area });
  await ready(record);
  console.log(`Authoring preview: ${record.url}/?author=levels&area=${area}\nSession: ${record.session}`);
});
