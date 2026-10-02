import { createHash } from 'node:crypto';
import { listPackage, statFile, extractFile } from '@electron/asar';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cli, parseArgs, root, run, UsageError } from '../lib/cli.mjs';
import { withResource } from '../agents/resources.mjs';
import { verifyContent, identity } from './content.mjs';
await cli(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args['--help']) { console.log('Usage: npm run desktop:package (verified prepared content; Windows x64 or native macOS architecture)'); return; }
  if (!['win32', 'darwin'].includes(process.platform)) throw new UsageError('Desktop candidates support Windows and macOS.');
  const build = await identity();
  if (build.dirty) throw new Error('Commit reviewed source before packaging a candidate.');
  const revision = build.revision;
  const manifest = JSON.parse(await readFile(resolve(root, '.local/desktop/candidate.json'), 'utf8'));
  await verifyContent(root, revision, manifest);
  const arch = process.platform === 'win32' ? 'x64' : process.arch;
  const make = async () => {
    await run(process.execPath, [resolve(root, 'node_modules/@electron-forge/cli/dist/electron-forge.js'), 'make', '--platform', process.platform, '--arch', arch]);
    const base = resolve(root, `.local/desktop/out/Lantern-${process.platform}-${arch}`);
    const archive = process.platform === 'darwin' ? resolve(base, 'Lantern.app/Contents/Resources/app.asar') : resolve(base, 'resources/app.asar');
    const expected = new Set(['package.json', 'electron/main.cjs', 'electron/preload.cjs', 'electron/reporting.cjs', ...manifest.files.map(file => file.path)]);
    const files = listPackage(archive).map(file => file.replace(/^\//, '')).filter(file => !statFile(archive, file, false).files);
    if (files.length !== expected.size || files.some(file => !expected.has(file) || statFile(archive, file, false).link)) throw new Error('Packaged application violates the file allowlist.');
    for (const file of manifest.files) {
      const content = extractFile(archive, file.path);
      if (content.length !== file.bytes || createHash('sha256').update(content).digest('hex') !== file.sha256) throw new Error(`Packaged content differs: ${file.path}`);
    }
    for (const file of ['electron/main.cjs', 'electron/preload.cjs', 'electron/reporting.cjs']) {
      if (!extractFile(archive, file).equals(await readFile(resolve(root, file)))) throw new Error(`Packaged shell differs: ${file}`);
    }
    const pkg = JSON.parse(extractFile(archive, 'package.json').toString());
    if (pkg.main !== 'electron/main.cjs' || pkg.version !== manifest.version) throw new Error('Packaged application identity differs.');
    console.log(`Verified packaged allowlist and ${manifest.files.length} content hashes.`);
  };
  // Hosted CI has its own isolated workspace; native local leases use macOS/Unix process identity.
  if (process.env.CI === 'true') await make(); else await withResource('heavy', make);
  console.log(`Packaged ${revision}; ZIP files: .local/desktop/out/make/zip/${process.platform}/${arch}`);
});
