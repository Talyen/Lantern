import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cli, parseArgs, root, run, UsageError } from '../lib/cli.mjs';
import { withResource } from '../agents/resources.mjs';
import { git } from '../agents/state.mjs';
import { verifyContent } from './content.mjs';
await cli(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args['--help']) { console.log('Usage: npm run desktop:package (verified prepared content; Windows x64 or native macOS architecture)'); return; }
  if (!['win32', 'darwin'].includes(process.platform)) throw new UsageError('Desktop candidates support Windows and macOS.');
  const revision = await git(['rev-parse', 'HEAD']);
  const manifest = JSON.parse(await readFile(resolve(root, '.local/desktop/candidate.json'), 'utf8'));
  await verifyContent(root, revision, manifest);
  const arch = process.platform === 'win32' ? 'x64' : process.arch;
  const make = () => run(process.execPath, [resolve(root, 'node_modules/@electron-forge/cli/dist/electron-forge.js'), 'make', '--platform', process.platform, '--arch', arch]);
  // Hosted CI has its own isolated workspace; native local leases use macOS/Unix process identity.
  if (process.env.CI === 'true') await make(); else await withResource('heavy', make);
  console.log(`Packaged ${revision}; ZIP files: .local/desktop/out/make/zip/${process.platform}/${arch}`);
});
