import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { cli, parseArgs, root, blender, defaultBlender } from './lib/cli.mjs';
await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--topaz': 'value', '--blender': 'value' });
  if (args['--help']) { console.log('Usage: npm run assets:import -- [--topaz PATH] [--blender PATH]'); return; }
  const topaz = resolve(args['--topaz'] ?? resolve(root, '../Topaz'));
  if (!existsSync(resolve(topaz, 'Assets/Synty/PolygonVikingRealm'))) throw new Error(`Synty Viking Realm not found under ${topaz}`);
  const common = ['--topaz-root', topaz, '--output', resolve(root, 'public/vendor/synty')];
  const executable = args['--blender'] ?? defaultBlender;
  await blender('convert-synty.py', common, executable);
  const albedo = resolve(root, 'assets/textures/rock-albedo-imagegen.png');
  if (existsSync(albedo)) await blender('bake-rock.py', [...common, '--albedo', albedo, '--preview', resolve(root, '.local/rock-painted-albedo.png')], executable);
});
