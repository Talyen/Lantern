import { cli, parseArgs, blender, root } from '../../lib/cli.mjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { packCharacter } from './pack.mjs';
await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--blender': 'value', '--skeleton-only': 'boolean', '--player-only': 'boolean', '--motions-only': 'boolean' });
  if (args['--player-only'] && args['--skeleton-only']) throw new Error('Choose only one character filter.');
  if (args['--help']) { console.log('Usage: npm run assets:export-character -- [--blender PATH] [--player-only] [--skeleton-only] [--motions-only]\nPrepares authored Paladin, Goblin and Skeleton models with compatible Mixamo weapon motions.'); return; }
  await blender('assets/characters/playable.py', ['--player-only', '--skeleton-only', '--motions-only'].filter(flag => args[flag]), args['--blender']);
  const config = JSON.parse(readFileSync(resolve(root, 'assets/playable-characters.json'), 'utf8'));
  const galleryPath = resolve(root, 'public/vendor/character-gallery/catalog.json');
  const gallery = existsSync(galleryPath) ? JSON.parse(readFileSync(galleryPath, 'utf8')) : { version: 1, complete: true, expectedCount: 0, characters: [] };
  const identities = { paladin: 'mixamo-eface83a-acc0-4036-a15e-3c650df1510d', goblin: 'mixamo-130a335c-bbdb-492f-971f-8faab0616b6e', skeleton: 'synty-generic-sm_gen_chr_skeleton_01' };
  for (const name of args['--player-only'] ? ['paladin'] : args['--skeleton-only'] ? ['skeleton'] : ['paladin', 'goblin', 'skeleton']) {
    const actor = config[name === 'paladin' ? 'player' : name === 'goblin' ? 'enemy' : 'skeleton'];
    const catalogPath = resolve(root, 'public', actor.catalog.slice(1));
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
    packCharacter(`/vendor/characters/${name}/authored.glb`, catalogPath, resolve(root, 'public', actor.model.slice(1)));
    catalog.character = actor.model;
    writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
    const motions = Object.fromEntries(['idle', 'run', 'attack'].map(role => [role, catalog.packs[0].clips.find(clip => clip.id === catalog.defaults[role] || clip.name === catalog.defaults[role])]));
    const row = { id: identities[name], name: actor.name, family: name === 'skeleton' ? 'Synty Generic' : 'Mixamo', url: actor.model, motions, status: 'ready' };
    const index = gallery.characters.findIndex(character => character.id === row.id);
    if (index >= 0) gallery.characters[index] = { ...gallery.characters[index], ...row };
    else { gallery.characters.push(row); gallery.expectedCount++; }
  }
  mkdirSync(dirname(galleryPath), { recursive: true });
  writeFileSync(galleryPath, JSON.stringify(gallery, null, 2) + '\n');
  console.log('Prepared authored playable art and refreshed gallery motion references.');
});
