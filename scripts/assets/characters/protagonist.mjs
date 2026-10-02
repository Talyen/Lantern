import { cli, parseArgs, blender } from '../../lib/cli.mjs';
await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--blender': 'value' });
  if (args['--help']) { console.log('Usage: npm run assets:export-protagonist-draft -- [--blender PATH]\nPrepares the private male geometry study and curated sample motions; gameplay is unchanged.'); return; }
  await blender('assets/characters/protagonist.py', [], args['--blender']);
});
