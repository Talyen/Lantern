import { cli, parseArgs, blender, root } from '../../lib/cli.mjs';
import { resolve } from 'node:path';
import { packCharacter } from './pack.mjs';
await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--blender': 'value' });
  if (args['--help']) { console.log('Usage: npm run assets:export-merchant -- [--blender PATH]\nPrepares Peasant Man with one compatible neutral Mixamo idle.'); return; }
  await blender('assets/characters/merchant.py', [], args['--blender']);
  packCharacter('/vendor/characters/merchant/authored.glb', resolve(root, 'public/vendor/characters/merchant/catalog.json'), resolve(root, 'public/vendor/characters/merchant/model.glb'));
  console.log('Prepared the merchant model with its neutral Mixamo idle.');
});
