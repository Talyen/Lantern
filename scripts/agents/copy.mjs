import { cp, lstat, readdir, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { run, root } from '../lib/cli.mjs';
/** Large copies are real private APFS clones on macOS, never hardlinks or silent full copies. */
export async function privateCopy(source, target, { filter = () => true } = {}) {
  if (!(await filter(source))) return;
  const info = await lstat(source);
  if (info.isDirectory()) {
    await mkdir(target, { recursive: true });
    for (const name of await readdir(source)) await privateCopy(join(source, name), join(target, name), { filter });
  } else if (process.platform === 'darwin') {
    await run('python3', [resolve(root, 'scripts/agents/native.py'), 'clone', source, target]);
  } else {
    // CI uses tracked sources and no private catalog. Large private snapshots must be explicit clones.
    await cp(source, target, { dereference: false, preserveTimestamps: true });
  }
}
/** One native invocation for entire directories, avoiding a process per dependency file. */
export async function privateTree(source, target, { exclude = [] } = {}) {
  await mkdir(resolve(target, '..'), { recursive: true });
  await run('python3', [resolve(root, 'scripts/agents/native.py'), 'clone', source, target, ...exclude.flatMap(path => ['--exclude', resolve(path)])]);
}
