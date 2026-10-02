import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { inventory, rejectArchives } from '../lib/assets.mjs';
import { root } from '../lib/cli.mjs';
import { git } from '../agents/state.mjs';

export async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export async function identity() {
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  return { version: pkg.version, revision: await git(['rev-parse', 'HEAD']), dirty: !!await git(['status', '--porcelain']) };
}
export async function writeBuildMetadata() {
  const build = await identity();
  await writeFile(resolve(root, 'dist/build-identity.json'), JSON.stringify(build, null, 2) + '\n');
  const notices = resolve(root, 'dist/notices');
  await mkdir(notices, { recursive: true });
  for (const file of ['LICENSE.md', 'THIRD_PARTY_NOTICES.md']) await cp(resolve(root, file), resolve(notices, file));
  for (const file of ['LICENSE-three.txt', 'LICENSE-upscaler.txt']) await cp(resolve(root, 'src/rendering', file), resolve(notices, file));
  const visited = new Set();
  const include = async name => {
    if (visited.has(name)) return;
    visited.add(name);
    const dir = resolve(root, 'node_modules', name);
    const pkg = JSON.parse(await readFile(resolve(dir, 'package.json'), 'utf8'));
    const licenses = (await readdir(dir)).filter(file => /^(?:licen[cs]e|notice)(?:[._-]|$)/i.test(file));
    if (!licenses.length) throw new Error(`Missing dependency notice: ${name}`);
    const dest = resolve(notices, name.replaceAll('/', '_'));
    await mkdir(dest, { recursive: true });
    for (const file of licenses) await cp(resolve(dir, file), resolve(dest, file));
    for (const dependency of Object.keys(pkg.dependencies ?? {})) await include(dependency);
  };
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  for (const name of Object.keys(pkg.dependencies)) await include(name);
  return build;
}
export function safeContentPath(path) {
  return typeof path === 'string' && path.startsWith('dist/') && !path.includes('\\') && !path.includes(':') && !path.split('/').some(part => !part || part === '.' || part === '..') && !path.split('/').some(part => part.startsWith('.'));
}
export async function createManifest(base, build) {
  const files = await inventory(resolve(base, 'dist'));
  rejectArchives(files);
  return { schemaVersion: 1, ...build, files: await Promise.all(files.map(async file => ({ path: `dist/${file.path}`, bytes: file.bytes, sha256: await hashFile(resolve(base, 'dist', file.path)) }))) };
}
export async function verifyContent(base, expectedRevision, suppliedManifest) {
  const manifest = suppliedManifest ?? JSON.parse(await readFile(resolve(base, 'candidate.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || !/^[a-f0-9]{40}$/.test(manifest.revision) || manifest.revision !== expectedRevision || manifest.dirty !== false || !Array.isArray(manifest.files)) throw new Error('Candidate revision/schema mismatch or dirty source.');
  const wanted = new Map();
  for (const file of manifest.files) {
    if (!safeContentPath(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256) || wanted.has(file.path)) throw new Error('Invalid candidate file manifest.');
    wanted.set(file.path, file);
  }
  const files = await inventory(resolve(base, 'dist'));
  rejectArchives(files);
  if (files.length !== wanted.size) throw new Error('Candidate contains missing or unexpected files.');
  for (const file of files) {
    const entry = wanted.get(`dist/${file.path}`);
    if (!entry || file.bytes !== entry.bytes || await hashFile(resolve(base, 'dist', file.path)) !== entry.sha256) throw new Error(`Candidate hash mismatch: ${file.path}`);
    if (/^(?:vendor\/character-gallery\/|vendor\/characters\/paladin\/(?!authored-playable\.glb$|catalog\.json$|motions\/))/.test(file.path)) throw new Error(`Development art in candidate: ${file.path}`);
  }
  for (const path of ['dist/index.html', 'dist/build-identity.json', 'dist/notices/LICENSE.md', 'dist/notices/THIRD_PARTY_NOTICES.md', 'dist/notices/LICENSE-three.txt', 'dist/notices/LICENSE-upscaler.txt']) if (!wanted.has(path)) throw new Error(`Candidate missing required file: ${path}`);
  const build = JSON.parse(await readFile(resolve(base, 'dist/build-identity.json'), 'utf8'));
  if (build.revision !== manifest.revision || build.version !== manifest.version || build.dirty !== false) throw new Error('Candidate build identity mismatch.');
  return manifest;
}
export async function installContent(base, revision) {
  await verifyContent(base, revision);
  // Verification completes before replacing this task's prepared output.
  await rm(resolve(root, 'dist'), { recursive: true, force: true });
  await cp(resolve(base, 'dist'), resolve(root, 'dist'), { recursive: true });
  await mkdir(resolve(root, '.local/desktop'), { recursive: true });
  await cp(resolve(base, 'candidate.json'), resolve(root, '.local/desktop/candidate.json'));
}
