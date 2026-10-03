import { resolve } from 'node:path';
import { UsageError } from '../../lib/cli.mjs';
import { assetPath } from '../../lib/assets.mjs';

export function surfaceAssets(manifest, args) {
  if (args['--area'] && (args['--showcase'] || args['--ground-fields'])) throw new UsageError('--area cannot be combined with --showcase or --ground-fields.');
  if (args['--area'] && !Object.hasOwn(manifest.areaAssets ?? {}, args['--area'])) throw new UsageError('Unknown prepared surface area.');
  const assets = args['--area'] ? manifest.areaAssets[args['--area']] : args['--showcase'] ? manifest.showcase.assets : manifest.assets;
  const kinds = args['--only']?.split(',');
  if (kinds?.some(kind => !assets.some(asset => asset.kind === kind))) throw new UsageError('Unknown prepared surface family.');
  return assets.filter(asset => !kinds || kinds.includes(asset.kind));
}
export function preparedSurfacePath(publicRoot, asset) {
  if (!asset.url?.startsWith('/vendor/synty/environment/')) throw new Error('Invalid prepared surface URL.');
  return assetPath(resolve(publicRoot, 'vendor/synty/environment'), asset.url, '/vendor/synty/environment/');
}
