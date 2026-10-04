import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { root, UsageError } from '../../lib/cli.mjs';
import { assetPath } from '../../lib/assets.mjs';

export function surfaceAssets(manifest, args) {
  if (args['--ground-fields'] && (args['--only'] || args['--showcase'])) throw new UsageError('--ground-fields cannot be combined with model filters.');
  if (args['--area'] && (args['--showcase'] || args['--ground-fields'])) throw new UsageError('--area cannot be combined with --showcase or --ground-fields.');
  if (args['--area'] && !Object.hasOwn(manifest.areaAssets ?? {}, args['--area'])) throw new UsageError('Unknown prepared surface area.');
  const assets = args['--area'] ? manifest.areaAssets[args['--area']] : args['--showcase'] ? manifest.showcase.assets : manifest.assets;
  const kinds = args['--only']?.split(',');
  if (kinds?.some(kind => !assets.some(asset => asset.kind === kind))) throw new UsageError('Unknown prepared surface family.');
  return assets.filter(asset => !kinds || kinds.includes(asset.kind));
}
export function preparedSurfacePath(publicRoot, asset) {
  return assetPath(resolve(publicRoot, 'vendor/synty/environment'), asset.url, '/vendor/synty/environment/');
}

/** Packing and compression consume the same selected paths and private job layout. */
export async function writeSurfaceJobs(name, args) {
  const manifest = JSON.parse(await readFile(resolve(root, 'assets/textures/environment/manifest.json'), 'utf8'));
  const jobs = surfaceAssets(manifest, args).map(asset => preparedSurfacePath(resolve(root, 'public'), asset));
  const directory = resolve(root, '.local', name), archive = resolve(root, '.local/synty-library/Archives', name);
  await mkdir(directory, { recursive: true }); await mkdir(archive, { recursive: true });
  const jobsPath = resolve(directory, 'jobs.json'); await writeFile(jobsPath, JSON.stringify(jobs));
  return { jobsPath, archive };
}
