import { cli, parseArgs, run, UsageError, root, defaultBlender } from './lib/cli.mjs';
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
await cli(async () => {
  const options = parseArgs(process.argv.slice(2), Object.fromEntries(['--blender', '--jobs', '--topaz', '--sources', '--output', '--pack', '--limit', '--shards', '--shard'].map((flag) => [flag, 'value'])));
  if (options['--help']) { console.log('Usage: npm run assets:export-animation-lab -- [--blender PATH] [--jobs 1-4] [--topaz PATH] [--sources PATH] [--output PATH] [--pack mixamo] [--limit N] [--shards N] [--shard N]'); return; }
  const executable = options['--blender'] ?? defaultBlender;
  const jobs = Number(options['--jobs'] ?? '1');
  if (!Number.isInteger(jobs) || jobs < 1 || jobs > 4) throw new UsageError('--jobs must be 1–4');
  for (const key of ['--limit', '--shards', '--shard']) if (options[key] !== undefined && (!Number.isInteger(Number(options[key])) || Number(options[key]) < (key === '--shard' ? 0 : 1))) throw new UsageError(`${key} has an invalid value`);
  if (options['--pack'] && options['--pack'] !== 'mixamo') throw new UsageError('--pack must be mixamo');
  if (jobs > 1 && (options['--shards'] || options['--shard'])) throw new UsageError('--jobs cannot be combined with --shards/--shard');
  if (Number(options['--shard'] ?? 0) >= Number(options['--shards'] ?? 1)) throw new UsageError('--shard must be below --shards');
  for (const key of ['--topaz', '--sources', '--output']) if (options[key]) options[key] = resolve(options[key]);
  const args = Object.entries(options).filter(([key]) => !['--blender', '--jobs'].includes(key)).flatMap(([key, value]) => [key, value]);
  const output = resolve(root, options['--output'] ?? 'public/vendor/animations');
  if (jobs > 1 && !existsSync(resolve(output, 'synty-warrior.glb'))) throw new Error('Export the character once with --jobs 1 before parallel motion baking.');
  const workers = await Promise.allSettled(Array.from({ length: jobs }, (_, shard) => run(executable,
    ['-b', '--factory-startup', '--python-exit-code', '1', '--python', resolve(root, 'scripts/export-animation-lab.py'), '--', ...args,
    ...(jobs > 1 ? ['--shards', String(jobs), '--shard', String(shard)] : [])])));
  const failed = workers.find((result) => result.status === 'rejected');
  if (failed) throw failed.reason;
  if (jobs > 1) {
    const clips = new Map(); let pack;
    for (let shard = 0; shard < jobs; shard++) {
      const value = JSON.parse(readFileSync(resolve(output, `mixamo/pack.shard-${shard}.json`), 'utf8'));
      pack = value; for (const clip of value.clips) clips.set(clip.id, clip);
    }
    pack.clips = [...clips.values()];
    const commit = (path, value) => { writeFileSync(path + '.partial', JSON.stringify(value, null, 2) + '\n'); renameSync(path + '.partial', path); };
    commit(resolve(output, 'mixamo/pack.json'), pack);
    commit(resolve(output, 'catalog.json'), { version: 1, character: '/vendor/animations/synty-warrior.glb', characterLabel: 'Synty Viking Realm · Warrior Male 01', motion: 'In place · 30 fps · retargeted to the same Synty rig', packs: [pack] });
    console.log(`Merged ${pack.clips.length} Mixamo previews from ${jobs} workers.`);
  }

});
