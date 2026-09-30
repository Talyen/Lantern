import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const value = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
if (args.includes('--help')) {
  console.log('Usage: npm run assets:import -- --topaz /path/to/Topaz [--blender /path/to/Blender]');
  process.exit(0);
}
const topazRoot = resolve(value('--topaz') ?? resolve(repoRoot, '../Topaz'));
const blender = value('--blender') ?? '/Applications/Blender.app/Contents/MacOS/Blender';
const script = resolve(repoRoot, 'scripts/convert-synty.py');
const output = resolve(repoRoot, 'public/vendor/synty');
const albedo = resolve(repoRoot, 'assets/textures/rock-albedo-imagegen.png');
if (!existsSync(resolve(topazRoot, 'Assets/Synty/PolygonVikingRealm'))) {
  console.error(`Synty Viking Realm assets were not found under ${topazRoot}`);
  process.exit(1);
}
const runBlender = (pythonScript, extraArgs) => {
  const result = spawnSync(blender, ['-b', '--factory-startup', '--python', pythonScript, '--', '--topaz-root', topazRoot, '--output', output, ...extraArgs], { stdio: 'inherit' });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
};
runBlender(script, []);
if (existsSync(albedo)) {
  runBlender(resolve(repoRoot, 'scripts/bake-rock.py'), ['--albedo', albedo, '--preview', resolve(repoRoot, '.local/rock-painted-albedo.png')]);
}
