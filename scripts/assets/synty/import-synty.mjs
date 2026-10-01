import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { cli, parseArgs, root, blender, defaultBlender } from '../../lib/cli.mjs';
await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--source': 'value', '--blender': 'value' });
  if (args['--help']) { console.log('Usage: npm run assets:import -- [--source PATH] [--blender PATH]'); return; }
  const source = resolve(args['--source'] ?? resolve(root, '.local/synty-library/sources/POLYGON_Viking_Realm_Unity_2022_3_v1_1_1/Assets/Synty/PolygonVikingRealm'));
  if (!existsSync(source)) throw new Error(`Synty Viking Realm source not found at ${source}`);
  const common = ['--source-root', source, '--output', resolve(root, 'public/vendor/synty')];
  const executable = args['--blender'] ?? defaultBlender;
  await blender('assets/synty/convert-synty.py', common, executable);
  const albedo = resolve(root, 'assets/textures/rock-albedo-imagegen.png');
  if (existsSync(albedo)) await blender('assets/surfaces/bake-rock.py', [...common, '--albedo', albedo, '--preview', resolve(root, '.local/rock-painted-albedo.png')], executable);
});
