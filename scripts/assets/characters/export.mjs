import { cli, parseArgs, blender, UsageError } from '../../lib/cli.mjs';
await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--blender': 'value', '--limit': 'value', '--family': 'value', '--character': 'value' });
  if (args['--help']) { console.log('Usage: npm run assets:export-characters -- [--blender PATH] [--limit N] [--family NAME] [--character ID[,ID]]\nTargeted character exports retain the remaining gallery entries.'); return; }
  if (args['--character'] && (args['--limit'] || args['--family'])) throw new UsageError('Do not combine --character with family or limit filters.');
  if (args['--limit'] && (!Number.isInteger(Number(args['--limit'])) || Number(args['--limit']) < 1)) throw new UsageError('--limit must be a positive integer');
  await blender('assets/characters/export.py', Object.entries(args).filter(([key]) => key !== '--blender').flatMap(([key, value]) => [key, value]), args['--blender']);
});
