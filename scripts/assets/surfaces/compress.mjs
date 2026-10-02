import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cli, parseArgs, root, run } from '../../lib/cli.mjs';
await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--encoder': 'value', '--only': 'value' });
  if (args['--help']) { console.log('Usage: node scripts/assets/surfaces/compress.mjs --encoder PATH [--only chest,tent,pine]'); return; }
  if (!args['--encoder']) throw new Error('Supply a local KTX-Software toktx encoder.');
  const kinds = (args['--only'] ?? 'chest,tent,pine').split(',');
  if (kinds.some(kind => !['chest', 'tent', 'pine'].includes(kind))) throw new Error('Compression trials support chest, tent and pine.');
  const manifest = JSON.parse(await readFile(resolve(root, 'assets/textures/environment/manifest.json'), 'utf8'));
  const jobs = manifest.assets.filter(asset => kinds.includes(asset.kind)).map(asset => {
    if (!asset.url.startsWith('/vendor/synty/environment/') || asset.url.includes('..')) throw new Error('Invalid prepared surface URL.');
    return resolve(root, 'public', asset.url.slice(1));
  });
  const directory = resolve(root, '.local/compressed-surfaces'), archive = resolve(root, '.local/synty-library/Archives/compressed-surfaces');
  await mkdir(directory, { recursive: true }); await mkdir(archive, { recursive: true });
  const jobsPath = resolve(directory, 'jobs.json'); await writeFile(jobsPath, JSON.stringify(jobs));
  await run('python3', [resolve(root, 'scripts/assets/surfaces/compress.py'), '--encoder', resolve(args['--encoder']), '--jobs', jobsPath, '--archive', archive]);
});
