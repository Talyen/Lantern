import { cli, parseArgs, blender, root } from '../../lib/cli.mjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { packCharacter } from './pack.mjs';
await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--blender': 'value', '--skip-projection': 'boolean', '--player-only': 'boolean', '--motions-only': 'boolean', '--surfaces-only': 'boolean' });
  if (args['--help']) { console.log('Usage: node scripts/assets/characters/playable.mjs [--blender PATH] [--skip-projection] [--player-only] [--motions-only] [--surfaces-only]\nPrepares curated Paladin and Goblin motions plus locally projected Paladin variants.'); return; }
  if (!args['--surfaces-only']) await blender('assets/characters/playable.py', ['--player-only', '--motions-only'].filter(flag => args[flag]), args['--blender']);
  if (!args['--skip-projection'] && !args['--motions-only']) await blender('assets/characters/project-paladin.py', [], args['--blender']);
  const config = JSON.parse(readFileSync(resolve(root, 'assets/playable-characters.json'), 'utf8'));
  for (const name of args['--player-only'] ? ['paladin'] : ['paladin', 'goblin']) {
    const catalogPath = resolve(root, `public/vendor/characters/${name}/catalog.json`);
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
    const models = name === 'paladin' ? config.player.variants : { authored: config.enemy.model };
    for (const [id, url] of Object.entries(models)) packCharacter(`/vendor/characters/${name}/${id}.glb`, catalogPath, resolve(root, 'public', url.slice(1)));
    if (name === 'paladin') {
      catalog.character = config.player.variants[config.player.defaultVariant];
      writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
    }
  }
  if (args['--motions-only']) { console.log('Prepared compatible motions and repacked retained surfaces.'); return; }
  // Register comparisons without replacing the full private gallery roster.
  const galleryPath = resolve(root, 'public/vendor/character-gallery/catalog.json');
  const gallery = existsSync(galleryPath) ? JSON.parse(readFileSync(galleryPath, 'utf8')) : { version: 1, complete: true, expectedCount: 0, characters: [] };
  const labels = { 'dark-brass': 'Dark steel / brass / crimson', 'silver-gold': 'Silver / gold / blue', 'ivory-gold': 'Ivory / gold / teal', 'grim-gold': 'Charcoal iron / worn gold', 'grim-crimson': 'Charcoal iron / crimson', 'iron-gold-crimson': 'Iron / gold / crimson', 'iron-copper-teal': 'Iron / copper / teal', 'slate-bronze-blue': 'Slate / bronze / blue' };
  const paladin = JSON.parse(readFileSync(resolve(root, 'public/vendor/characters/paladin/catalog.json'), 'utf8'));
  const sampleMotions = catalog => Object.fromEntries(['idle', 'run', 'attack'].map(role => [role, catalog.packs[0].clips.find(clip => clip.name === catalog.defaults[role])]));
  for (const [id, label] of Object.entries(labels)) {
    const row = { id: `paladin-${id}`, name: `Paladin · ${label}`, family: 'Paladin variants', url: config.player.variants[id], motions: sampleMotions(paladin), status: 'ready' };
    const existing = gallery.characters.findIndex(character => character.id === row.id);
    if (existing >= 0) gallery.characters[existing] = row;
    else { gallery.characters.push(row); gallery.expectedCount++; }
  }
  for (const [name, identity] of [['paladin', 'mixamo-eface83a-acc0-4036-a15e-3c650df1510d'], ['goblin', 'mixamo-130a335c-bbdb-492f-971f-8faab0616b6e']]) {
    const catalog = JSON.parse(readFileSync(resolve(root, `public/vendor/characters/${name}/catalog.json`), 'utf8'));
    const row = { id: identity, name: catalog.characterLabel, family: 'Mixamo', url: `/vendor/characters/${name}/authored-playable.glb`, motions: sampleMotions(catalog), status: 'ready' };
    const index = gallery.characters.findIndex(character => character.id === identity);
    if (index >= 0) gallery.characters[index] = { ...gallery.characters[index], ...row };
    else { gallery.characters.push(row); gallery.expectedCount++; }
  }
  mkdirSync(dirname(galleryPath), { recursive: true });
  writeFileSync(galleryPath, JSON.stringify(gallery, null, 2) + '\n');
  console.log(args['--player-only'] ? 'Prepared Paladin variants.' : 'Prepared Paladin variants and Goblin gameplay art.');
});
