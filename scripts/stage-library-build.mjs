import { cp, mkdir, rm, copyFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { cli, parseArgs, root } from './lib/cli.mjs';
import { selectedLibrary, assetPath, inventory, rejectArchives } from './lib/assets.mjs';
await cli(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args['--help']) { console.log('Usage: node scripts/stage-library-build.mjs'); return; }
  const stage = resolve(root, '.local/build-public');
  const source = resolve(root, 'public');
  const library = resolve(source, 'vendor/synty/library');
  const output = resolve(stage, 'vendor/synty/library');
  const { selection, selected } = await selectedLibrary(library);
  // Validate before staging; full source archives never belong in runtime outputs.
  const files = await inventory(source, ['vendor/synty/library']);
  rejectArchives(files);
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  if (existsSync(source)) await cp(source, stage, { recursive: true, filter: (path) => path !== library && !path.startsWith(library + sep) });
  for (const asset of selected.values()) {
    const from = assetPath(library, asset.url, '/vendor/synty/library/');
    const target = resolve(output, relative(library, from));
    await mkdir(resolve(target, '..'), { recursive: true });
    await copyFile(from, target);
  }
  if (selection.length) await writeFile(resolve(output, 'catalog.json'), JSON.stringify({ version: 1, complete: true, assets: Object.fromEntries(selected) }));
  const staged = await inventory(stage);
  rejectArchives(staged);
  const vendor = staged.filter((file) => file.path.startsWith('vendor/'));
  await writeFile(resolve(root, '.local/build-inventory.json'), JSON.stringify({ selectedIds: selection, selectedClosure: selected.size, files: vendor, count: vendor.length, bytes: vendor.reduce((sum, file) => sum + file.bytes, 0) }, null, 2) + '\n');
  console.log(`Staged art: ${selection.length} explicit library selections; ${vendor.length} vendor files / ${(vendor.reduce((sum, file) => sum + file.bytes, 0) / 1048576).toFixed(1)} MiB. Other vendor directories copied wholesale. Inventory: .local/build-inventory.json`);
});
