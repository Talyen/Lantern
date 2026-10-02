import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { root } from '../lib/cli.mjs';
import { git } from '../agents/state.mjs';
import { assetIndex, assetIdentity } from '../agents/assets.mjs';

// Cache identity includes both source changes and the prepared private art.
export async function checkInputs(base) {
  const head = await git(['rev-parse', 'HEAD']);
  if (base) await git(['merge-base', '--is-ancestor', base, head]);
  const names = new Set();
  for (const args of [base ? ['diff', '--name-only', '-z', `${base}...HEAD`] : ['diff', '--name-only', '-z'], ['diff', '--cached', '--name-only', '-z'], ['ls-files', '--others', '--exclude-standard', '-z']]) {
    for (const name of (await git(args)).split('\0')) if (name) names.add(name);
  }
  const hash = createHash('sha256').update(head).update(base ?? '').update(process.version);
  for (const name of [...names].sort()) {
    hash.update(name);
    try { hash.update(await readFile(join(root, name))); } catch (error) { if (error.code !== 'ENOENT') throw error; hash.update('deleted'); }
  }
  const assets = assetIdentity(await assetIndex(join(root, 'public/vendor')));
  hash.update(assets);
  return { head, base, files: [...names].sort(), assets, signature: hash.digest('hex') };
}
