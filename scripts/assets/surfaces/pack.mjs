import { writeSurfaceJobs } from './jobs.mjs';
import { resolve } from 'node:path';
import { cli, parseArgs, root, run } from '../../lib/cli.mjs';
await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--only': 'value', '--area': 'value' });
  if (args['--help']) { console.log('Usage: node scripts/assets/surfaces/pack.mjs [--only pine,rock,chest] [--area clearing]'); return; }
  const { jobsPath, archive } = await writeSurfaceJobs('packed-surfaces', args);
  await run('python3', [resolve(root, 'scripts/assets/surfaces/pack.py'), '--jobs', jobsPath, '--archive', archive, '--public', resolve(root, 'public')]);
});
