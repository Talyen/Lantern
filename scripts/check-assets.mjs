import { cli, parseArgs } from './lib/cli.mjs';
import { checkAssets, gameplayAssets, inventory, rejectArchives } from './lib/assets.mjs';
import { resolve, relative } from 'node:path';
import { readFile } from 'node:fs/promises';
import { root } from './lib/cli.mjs';
await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--playable': 'boolean', '--build': 'boolean' });
  if (args['--help']) { console.log('Usage: npm run assets:check -- [--playable] [--build]'); return; }
  await checkAssets(Boolean(args['--playable']));
  if (args['--build']) {
    const files = await inventory(resolve(root, 'dist'));
    if (!files.some((file) => file.path === 'index.html')) throw new Error('Build missing');
    rejectArchives(files);
    const expected = JSON.parse(await readFile(resolve(root, '.local/build-inventory.json'), 'utf8'));
    const actual = new Map(files.filter((file) => file.path.startsWith('vendor/')).map((file) => [file.path, file.bytes]));
    if (actual.size !== expected.count || expected.files.some((file) => actual.get(file.path) !== file.bytes)) throw new Error('Built vendor files differ from the staging inventory; rebuild before checking');
    const { paths } = await gameplayAssets();
    for (const path of paths) if (!actual.has(relative(resolve(root, 'public'), path))) throw new Error(`Build is missing referenced gameplay art: ${path}`);
    const excluded = files.find(file => file.path.startsWith('vendor/character-gallery/') || /vendor\/characters\/paladin\/(?!authored-playable\.glb$|catalog\.json$|motions\/)/.test(file.path));
    if (excluded) throw new Error(`Development art entered the game build: ${excluded.path}`);
    console.log(`Build inventory verified: ${files.length} files; referenced gameplay art present, gallery and palettes excluded.`);
  }
});
