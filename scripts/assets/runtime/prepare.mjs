import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { cli, parseArgs, root, run } from '../../lib/cli.mjs';
import { gameplayAssets } from '../../lib/assets.mjs';

await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--encoder': 'value' });
  if (args['--help']) { console.log('Usage: node scripts/assets/runtime/prepare.mjs --encoder /path/to/toktx'); return; }
  if (!args['--encoder']) throw new Error('Supply KTX-Software 4.4.2 toktx.');
  const { paths, selected } = await gameplayAssets(undefined, { originals: true });
  const directory = resolve(root, '.local/runtime-art'); await mkdir(directory, { recursive: true });
  const roles = new Map();
  for (const asset of selected.values()) if (asset.kind === 'material') {
    const material = JSON.parse(await readFile(resolve(root, 'public', asset.url.slice(1)), 'utf8'));
    for (const [role, mapping] of Object.entries(material.textures ?? {})) {
      const image = selected.get(mapping.id); if (!image) continue;
      const path = resolve(root, 'public', image.url.slice(1));
      const input = roles.get(path) ?? { path, color: false, data: false, flipY: false };
      input[role === 'normal' ? 'data' : 'color'] = true; roles.set(path, input);
    }
  }
  const jobs = [...paths].filter(path => /\.(glb|png)$/i.test(path)).map(path => roles.get(path) ?? { path, color: true, data: false, flipY: true, inferred: true });
  for (const file of ['src/rendering/woodland-ground.ts', 'src/rendering/stone-surface.ts']) {
    const source = await readFile(resolve(root, file), 'utf8');
    for (const match of source.matchAll(/import \w+ from '([^']+\.png)\?url'/g)) {
      const path = resolve(root, dirname(file), match[1]);
      jobs.push({ path, color: !/-(?:normal|surface)\.png$/.test(path), data: /-normal\.png$/.test(path), flipY: true, lossless: /-surface\.png$/.test(path) });
    }
  }
  const jobsPath = resolve(directory, 'jobs.json');
  await writeFile(jobsPath, JSON.stringify(jobs));
  await run('python3', [resolve(root, 'scripts/assets/runtime/prepare.py'), '--root', root, '--jobs', jobsPath, '--encoder', resolve(args['--encoder'])]);
  // The original inputs stay selected until every derivative and dependency is validated.
  const index = JSON.parse(await readFile(resolve(root, 'public/vendor/runtime-art/index.json'), 'utf8'));
  console.log(`Prepared runtime art: ${Object.keys(index.assets).length} derivatives; source exports preserved.`);
});
