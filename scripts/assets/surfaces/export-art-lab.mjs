import { resolve } from 'node:path';
import { cli, parseArgs, root, blender } from '../../lib/cli.mjs';
await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--source': 'value', '--blender': 'value' });
  if (args['--help']) { console.log('Usage: npm run assets:export-art-lab -- [--source PATH] [--blender PATH]'); return; }
  await blender('assets/surfaces/export-art-lab.py', ['--source-root', resolve(args['--source'] ?? resolve(root, '.local/synty-library/sources/POLYGON_Viking_Realm_Unity_2022_3_v1_1_1/Assets/Synty/PolygonVikingRealm')),
    '--output', resolve(root, 'public/vendor/synty/art-lab'), '--textures', resolve(root, 'assets/textures')], args['--blender']);
  await blender('assets/surfaces/bake-ground.py', ['--albedo', resolve(root, 'assets/textures/soil-painterly.png'),
    '--output', resolve(root, 'public/vendor/terrain/ground-painterly.glb'), '--preview', resolve(root, '.local/art-lab/soil-albedo.png')], args['--blender']);
});
