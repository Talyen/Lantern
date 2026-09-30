import { resolve } from 'node:path';
import { cli, parseArgs, root, blender } from './lib/cli.mjs';
await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--topaz': 'value', '--blender': 'value' });
  if (args['--help']) { console.log('Usage: npm run assets:export-art-lab -- [--topaz PATH] [--blender PATH]'); return; }
  await blender('export-art-lab.py', ['--topaz-root', resolve(args['--topaz'] ?? resolve(root, '../Topaz')),
    '--output', resolve(root, 'public/vendor/synty/art-lab'), '--textures', resolve(root, 'assets/textures')], args['--blender']);
  await blender('bake-ground.py', ['--albedo', resolve(root, 'assets/textures/soil-painterly.png'),
    '--output', resolve(root, 'public/vendor/terrain/ground-painterly.glb'), '--preview', resolve(root, '.local/art-lab/soil-albedo.png')], args['--blender']);
});
