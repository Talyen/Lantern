import { resolve } from 'node:path';
import { cli, parseArgs, root, blender } from '../../lib/cli.mjs';
await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--blender': 'value' });
  if (args['--help']) { console.log('Usage: npm run assets:export-ground -- [--blender PATH]'); return; }
  await blender('assets/surfaces/bake-ground.py', ['--albedo', resolve(root, 'assets/textures/forest-floor-imagegen.png'),
    '--output', resolve(root, 'public/vendor/terrain/ground-painted.glb'), '--preview', resolve(root, '.local/ground-painted-albedo.png')], args['--blender']);
});
