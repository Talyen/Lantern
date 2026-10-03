import { writeSurfaceJobs } from './jobs.mjs';
import { resolve } from 'node:path';
import { cli, parseArgs, root, run } from '../../lib/cli.mjs';
await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--encoder': 'value', '--only': 'value' });
  if (args['--help']) { console.log('Usage: node scripts/assets/surfaces/compress.mjs --encoder PATH [--only chest,tent,pine]'); return; }
  if (!args['--encoder']) throw new Error('Supply a local KTX-Software toktx encoder.');
  const kinds = (args['--only'] ?? 'chest,tent,pine').split(',');
  if (kinds.some(kind => !['chest', 'tent', 'pine'].includes(kind))) throw new Error('Compression trials support chest, tent and pine.');
  const { jobsPath, archive } = await writeSurfaceJobs('compressed-surfaces', { '--only': kinds.join(',') });
  await run('python3', [resolve(root, 'scripts/assets/surfaces/compress.py'), '--encoder', resolve(args['--encoder']), '--jobs', jobsPath, '--archive', archive]);
});
