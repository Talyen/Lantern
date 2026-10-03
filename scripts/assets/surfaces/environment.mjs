import { surfaceAssets } from './jobs.mjs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { cli, parseArgs, root, blender } from '../../lib/cli.mjs';
import { validateGlb } from './validate.mjs';
import { assetPath } from '../../lib/assets.mjs';
await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--blender': 'value', '--output': 'value', '--only': 'value', '--area': 'value', '--showcase': 'boolean', '--ground-fields': 'boolean' });
  if (args['--help']) { console.log('Usage: node scripts/assets/surfaces/environment.mjs [--blender PATH] [--output PATH] [--only pine,rock,log,crate] [--area clearing | --showcase] [--ground-fields]'); return; }
  if (args['--area'] && (args['--showcase'] || args['--ground-fields'])) throw new Error('--area cannot be combined with --showcase or --ground-fields.');
  if (args['--ground-fields']) { await blender('assets/surfaces/ground_fields.py', [root], args['--blender']); return; }
  const manifest = JSON.parse(await readFile(resolve(root, 'assets/textures/environment/manifest.json'), 'utf8'));
  const catalog = JSON.parse(await readFile(resolve(root, 'public/vendor/synty/library/catalog.json'), 'utf8'));
  const jobs = surfaceAssets(manifest, args).map(asset => {
    const url = asset.sourceUrl ?? (asset.id.startsWith('/') ? asset.id : catalog.assets[asset.id]?.url);
    const source = assetPath(resolve(root, 'public/vendor/synty'), url, '/vendor/synty/');
    if (!existsSync(source)) throw new Error(`Missing local model: ${asset.id}`);
    return { ...(args['--area'] ? manifest.areaPreparation?.[args['--area']] : {}), ...asset, projection: manifest.projection, bakeSize: asset.bakeSize ?? manifest.bakeSize, source, filename: asset.url.split('/').pop() };
  });
  const suffix = args['--area'] ? `/${args['--area']}` : args['--showcase'] ? '/showcase' : '';
  const jobsPath = resolve(root, `.local/environment-art/${args['--area'] ? args['--area'] + '-' : args['--showcase'] ? 'showcase-' : ''}jobs.json`); await mkdir(resolve(root, '.local/environment-art'), { recursive: true });
  await writeFile(jobsPath, JSON.stringify(jobs, null, 2));
  const output = resolve(args['--output'] ?? resolve(root, `public/vendor/synty/environment${suffix}`));
  await blender('assets/surfaces/environment.py', ['--jobs', jobsPath, '--textures', resolve(root, 'assets/textures/environment'), '--output', output], args['--blender']);
  for (const job of jobs) { const failures = await validateGlb(resolve(output, job.filename)); if (failures.length) throw new Error(`Incomplete prepared material ${job.id}: ${failures.join('; ')}`); }
});
