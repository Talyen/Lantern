import { deletionExclusions } from '../review/exclusions.mjs';
import { cli, parseArgs, blender, root, UsageError } from '../../lib/cli.mjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { context } from '../../agents/state.mjs';
import { restorePlayableSource } from '../../agents/retention.mjs';
import { packCharacter } from './pack.mjs';
await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--blender': 'value', '--skeleton-only': 'boolean', '--player-only': 'boolean', '--motions-only': 'boolean' });
  if (args['--player-only'] && args['--skeleton-only']) throw new UsageError('Choose only one character filter.');
  if (args['--help']) { console.log('Usage: npm run assets:export-character -- [--blender PATH] [--player-only] [--skeleton-only] [--motions-only]\nPrepares the selected authored player, Goblin and Skeleton models with compatible Mixamo weapon motions.'); return; }
  const config = JSON.parse(readFileSync(resolve(root, 'assets/playable-characters.json'), 'utf8'));
  const roles = args['--player-only'] ? ['player'] : args['--skeleton-only'] ? ['skeleton'] : ['player', 'enemy', 'skeleton'];
  for (const role of roles) {
    const actor = config[role];
    if (!actor.source || existsSync(resolve(root, actor.source))) continue;
    await restorePlayableSource(await context(), actor, root);
  }
  await blender('assets/characters/playable.py', ['--player-only', '--skeleton-only', '--motions-only'].filter(flag => args[flag]), args['--blender']);
  const excluded = deletionExclusions();
  const galleryPath = resolve(root, 'public/vendor/character-gallery/catalog.json');
  const gallery = existsSync(galleryPath) ? JSON.parse(readFileSync(galleryPath, 'utf8')) : { version: 1, complete: true, expectedCount: 0, characters: [] };
  gallery.characters = gallery.characters.filter(row => !excluded(`character:${row.id}`, row.url));
  for (const role of roles) {
    const actor = config[role];
    if (excluded(`character:${actor.sourceId}`, actor.model, 'gameplay')) continue;
    const name = actor.model.split('/').at(-2);
    const catalogPath = resolve(root, 'public', actor.catalog.slice(1));
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
    packCharacter(`/vendor/characters/${name}/authored.glb`, catalogPath, resolve(root, 'public', actor.model.slice(1)));
    catalog.character = actor.model;
    writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
    const motions = Object.fromEntries(['idle', 'run', 'attack'].map(role => [role, catalog.packs[0].clips.find(clip => clip.id === catalog.defaults[role] || clip.name === catalog.defaults[role])]));
    const row = { id: actor.sourceId, name: actor.name, family: actor.source ? 'Owner supplied' : role === 'skeleton' ? 'Synty Generic' : 'Mixamo', url: actor.model, motions, status: 'ready' };
    const index = gallery.characters.findIndex(character => character.id === row.id);
    if (index >= 0) gallery.characters[index] = { ...gallery.characters[index], ...row };
    else { gallery.characters.push(row); gallery.expectedCount++; }
  }
  mkdirSync(dirname(galleryPath), { recursive: true });
  writeFileSync(galleryPath, JSON.stringify(gallery, null, 2) + '\n');
  console.log('Prepared authored playable art and refreshed gallery motion references.');
});
