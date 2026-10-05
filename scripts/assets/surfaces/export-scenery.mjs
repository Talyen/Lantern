import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { cli, parseArgs, root, blender } from '../../lib/cli.mjs';
await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--source': 'value', '--blender': 'value' });
  if (args['--help']) { console.log('Usage: npm run assets:import -- [--source PATH] [--blender PATH]'); return; }
  const source = resolve(args['--source'] ?? resolve(root, '.local/synty-library/sources/POLYGON_Viking_Realm_Unity_2022_3_v1_1_1/Assets/Synty/PolygonVikingRealm'));
  if (!existsSync(source)) throw new Error(`Synty Viking Realm source not found at ${source}. Run npm run agent:sources -- --sources synty-library in the owned task, or supply --source.`);
  // Retain current URLs: existing area definitions and lighting fingerprints use them.
  await blender('assets/surfaces/export-scenery.py', ['--source-root', source,
    '--output', resolve(root, 'public/vendor/synty'), '--textures', resolve(root, 'assets/textures')], args['--blender']);
});
