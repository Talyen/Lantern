import { cli, parseArgs, root } from '../lib/cli.mjs';
import { stopPreview } from '../agents/preview.mjs';
await cli(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args['--help']) { console.log('Usage: npm run levels:stop'); return; }
  await stopPreview(root);
  console.log('Closed owned authoring browser/server and released its GPU resource.');
});
