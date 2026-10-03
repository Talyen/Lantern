import { surfaceAssets, preparedSurfacePath } from './jobs.mjs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cli, parseArgs, root, run } from '../../lib/cli.mjs';
await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--only': 'value', '--area': 'value' });
  if (args['--help']) { console.log('Usage: node scripts/assets/surfaces/pack.mjs [--only pine,rock,chest] [--area clearing]'); return; }
  const manifest = JSON.parse(await readFile(resolve(root, 'assets/textures/environment/manifest.json'), 'utf8'));
  const jobs = surfaceAssets(manifest, args).map(asset => preparedSurfacePath(resolve(root, 'public'), asset));
  const directory = resolve(root, '.local/packed-surfaces'), archive = resolve(root, '.local/synty-library/Archives/packed-surfaces');
  await mkdir(directory, { recursive: true }); await mkdir(archive, { recursive: true });
  const jobsPath = resolve(directory, 'jobs.json'); await writeFile(jobsPath, JSON.stringify(jobs));
  await run('python3', [resolve(root, 'scripts/assets/surfaces/pack.py'), '--jobs', jobsPath, '--archive', archive, '--public', resolve(root, 'public')]);
});
