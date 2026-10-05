import { validatePreparedLighting } from '../levels/prepared-lighting.mjs';
import { requireShippingApprovals } from './review/index.mjs';
import { mkdir, rm, writeFile, stat } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { cli, parseArgs, root } from '../lib/cli.mjs';
import { privateCopy } from '../agents/copy.mjs';
import { gameplayAssets, inventory, rejectArchives } from '../lib/assets.mjs';
await cli(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args['--help']) { console.log('Usage: node scripts/assets/stage-library-build.mjs'); return; }
  const stage = resolve(root, '.local/build-public'), source = resolve(root, 'public');
  const { selection, selected, paths } = await gameplayAssets(source);
  // Source-only CI exports no private art and cannot certify its appearance.
  // Any staged private content still requires the complete shipping review.
  if (paths.size) { await requireShippingApprovals(root); await validatePreparedLighting(root, undefined, true); }
  const files = await inventory(source, ['vendor']);
  files.push(...await Promise.all([...paths].map(async path => ({ path: relative(source, path), bytes: (await stat(path)).size }))));
  rejectArchives(files);
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  for (const file of files) {
    const target = resolve(stage, file.path);
    await mkdir(resolve(target, '..'), { recursive: true });
    await privateCopy(resolve(source, file.path), target);
  }
  if (selected.size) {
    const catalog = resolve(stage, 'vendor/synty/library/catalog.json');
    await mkdir(resolve(catalog, '..'), { recursive: true });
    await writeFile(catalog, JSON.stringify({ version: 1, complete: true, assets: Object.fromEntries(selected) }));
  }
  const staged = await inventory(stage);
  rejectArchives(staged);
  const vendor = staged.filter(file => file.path.startsWith('vendor/'));
  const bytes = vendor.reduce((sum, file) => sum + file.bytes, 0);
  await writeFile(resolve(root, '.local/build-inventory.json'), JSON.stringify({ selectedIds: selection, selectedClosure: selected.size, files: vendor, count: vendor.length, bytes }, null, 2) + '\n');
  console.log(`Staged gameplay art: ${selection.length} library selections; ${vendor.length} vendor files / ${(bytes / 1048576).toFixed(1)} MiB. Development gallery and unused exports excluded. Inventory: .local/build-inventory.json`);
});
