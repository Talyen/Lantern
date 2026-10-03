import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { create, list, extract } from 'tar';
import { cli, isMain, parseCommand, root, run, UsageError } from '../lib/cli.mjs';
import { git } from '../agents/state.mjs';
import { withResource } from '../agents/resources.mjs';
import { privateTree } from '../agents/copy.mjs';
import { identity, createManifest, verifyContent, installContent, safeContentPath } from './content.mjs';

export async function unpack(archive, destination) {
  const paths = new Set();
  let invalid;
  await list({ file: archive, strict: true, onReadEntry(entry) {
    const path = entry.path.replace(/\/$/, '');
    if (!['File', 'Directory'].includes(entry.type) || (path !== 'candidate.json' && path !== 'dist' && !safeContentPath(path)) || paths.has(path)) invalid = `Unsupported candidate archive entry: ${path}`;
    paths.add(path);
  } });
  if (invalid) throw new Error(invalid);
  await extract({ file: archive, cwd: destination, strict: true });
  return destination;
}
if (isMain(import.meta.url)) await cli(async () => {
  const commands = {
    prepare: {}, verify: { '--archive': 'value', '--revision': 'value' }, fetch: { '--tag': 'value', '--revision': 'value' },
    publish: { '--archive': 'value', '--tag': 'value' }, dispatch: { '--tag': 'value' },
  };
  const { command, args } = parseCommand(process.argv.slice(2), commands);
  if (args['--help']) { console.log('Usage: node scripts/desktop/candidate.mjs prepare | verify --archive FILE --revision SHA | fetch --tag TAG --revision SHA | publish --archive FILE --tag TAG | dispatch --tag TAG'); return; }
  if (Object.keys(commands[command]).some(key => !args[key])) throw new UsageError('Missing candidate options; use --help.');
  const revision = args['--revision'];
  if (revision && !/^[a-f0-9]{40}$/.test(revision)) throw new UsageError('Revision must be a full commit SHA.');
  const tag = args['--tag'];
  if (tag && !/^playtest-[a-f0-9]{12}$/.test(tag)) throw new UsageError('Tag must be playtest- plus the first 12 revision characters.');
  if (command === 'dispatch') {
    await run('gh', ['workflow', 'run', 'desktop-windows.yml', '--repo', 'Talyen/Lantern', '--ref', 'main', '-f', `release_tag=${tag}`]);
    console.log('Windows packaging requested. Follow it with gh run list --repo Talyen/Lantern --workflow desktop-windows.yml');
    return;
  }
  if (command === 'prepare') return withResource('heavy', async () => {
    const build = await identity();
    if (build.dirty) throw new Error('Commit/integrate reviewed source changes before preparing a distributable candidate.');
    await run(process.execPath, [resolve(root, 'scripts/build.mjs')]);
    await run(process.execPath, [resolve(root, 'scripts/check-assets.mjs'), '--playable', '--build']);
    const temp = await mkdtemp(join(tmpdir(), 'lantern-candidate-'));
    try {
      await privateTree(resolve(root, 'dist'), resolve(temp, 'dist'));
      const manifest = await createManifest(temp, build);
      await writeFile(resolve(temp, 'candidate.json'), JSON.stringify(manifest, null, 2) + '\n');
      await verifyContent(temp, build.revision);
      const current = await identity();
      if (current.dirty || current.revision !== build.revision) throw new Error('Source changed during candidate preparation.');
      const dir = resolve(root, '.local/desktop'); await mkdir(dir, { recursive: true });
      const archive = resolve(dir, `lantern-web-${build.revision}.tar.gz`);
      await create({ gzip: true, file: archive, cwd: temp, portable: true }, ['candidate.json', 'dist']);
      await cp(resolve(temp, 'candidate.json'), resolve(dir, 'candidate.json'));
      console.log(`Prepared ${archive}\nRelease tag: playtest-${build.revision.slice(0, 12)}`);
    } finally { await rm(temp, { recursive: true, force: true }); }
  });
  const temp = await mkdtemp(join(tmpdir(), 'lantern-candidate-'));
  try {
    let archive = args['--archive'] ? resolve(args['--archive']) : null;
    if (command === 'fetch') {
      archive = resolve(temp, `lantern-web-${revision}.tar.gz`);
      await run('gh', ['release', 'download', tag, '--repo', 'Talyen/Lantern', '--pattern', `lantern-web-${revision}.tar.gz`, '--dir', temp]);
    }
    await unpack(archive, temp);
    const manifest = JSON.parse(await readFile(resolve(temp, 'candidate.json'), 'utf8'));
    await verifyContent(temp, revision ?? manifest.revision);
    if (tag && tag !== `playtest-${manifest.revision.slice(0, 12)}`) throw new Error('Release tag does not match candidate revision.');
    if (command === 'fetch') {
      if (await git(['rev-parse', 'HEAD']) !== revision) throw new Error('Checkout does not match candidate revision.');
      await installContent(temp, revision);
    }
    if (command === 'publish') {
      if (await git(['rev-parse', 'HEAD']) !== manifest.revision) throw new Error('Publish from the candidate source revision.');
      console.log('Publishing the complete playable web build publicly to Talyen/Lantern.');
      await run('gh', ['release', 'create', tag, archive, '--repo', 'Talyen/Lantern', '--target', manifest.revision, '--prerelease', '--title', `Lantern playtest ${manifest.revision.slice(0, 12)}`, '--notes', 'Complete playable Lantern web build for desktop candidate packaging. Third-party content retains its own licence terms.']);
    }
    console.log(`Verified candidate ${manifest.revision}: ${manifest.files.length} files.`);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
