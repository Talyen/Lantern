import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hashFile, safeRelativePath } from '../lib/assets.mjs';

const hashes = new Map();
/** Verification stays on the asset host, not in the browser's startup path. */
export async function validatePreparedLighting(root, signature, fresh = false) {
  const index = JSON.parse(await readFile(resolve(root, 'assets/lighting-bakes.json'), 'utf8'));
  const { lightingPreparationKey, lightingBakeVersion } = await import(pathToFileURL(resolve(root, 'src/levels/lighting-preparation.ts')));
  const { resolveAreaLighting } = await import(pathToFileURL(resolve(root, 'src/levels/lighting.ts')));
  const { REVISION } = await import('three');
  const recipes = JSON.parse(await readFile(resolve(root, 'assets/material-recipes.json'), 'utf8'));
  const entries = signature ? [[signature, index.bakes[signature]]] : Object.entries(index.bakes);
  for (const [key, entry] of entries) {
    if (!Array.isArray(entry?.preparation?.sources)) throw new Error(`Prepared lighting metadata is missing for ${entry?.area ?? key}. Run lighting:bake.`);
    const area = JSON.parse(await readFile(resolve(root, 'src/levels/areas', `${entry.area}.json`), 'utf8'));
    const expected = await lightingPreparationKey({ ...area, lighting: resolveAreaLighting(area) }, entry.surfaces, !!entry.shelterRestored, REVISION, recipes);
    if (expected !== entry.preparation.key) throw new Error(`Prepared lighting inputs changed for ${entry.area}. Run lighting:bake.`);
    for (const source of entry.preparation.sources) {
      const relative = source.url.slice(1);
      if (!source.url.startsWith('/') || !safeRelativePath(relative)) throw new Error('Invalid lighting source URL.');
      // Vite ?url assets retain their repository URL in development.
      const path = resolve(root, relative.startsWith('vendor/') ? 'public' : '.', relative);
      const file = await stat(path), identity = `${file.size}:${file.mtimeMs}:${file.ctimeMs}`;
      let cached = hashes.get(path);
      if (fresh || cached?.identity !== identity) { cached = { identity, hash: await hashFile(path) }; hashes.set(path, cached); }
      if (cached.hash !== source.hash) throw new Error(`Prepared lighting for ${entry.area} is stale (${source.url}). Re-prepare its lighting.`);
    }
    const atlas = JSON.parse(await readFile(resolve(root, 'public', entry.url.slice(1)), 'utf8'));
    const probes = resolveAreaLighting(area).probes;
    const dimensions = probes && [probes.resolution[0], probes.resolution[1], 7 * (probes.resolution[2] + 2)];
    const valid = component => component && JSON.stringify(component.dimensions) === JSON.stringify(dimensions)
      && Array.isArray(component.data) && component.data.length === dimensions.reduce((a, b) => a * b, 4)
      && component.data.every(n => Number.isInteger(n) && n >= 0 && n <= 65535 && (n & 0x7c00) !== 0x7c00);
    if (!dimensions || !valid(atlas.daylight) || !Number.isInteger(atlas.flameEmitterCount) || atlas.flameEmitterCount < 0
      || Boolean(atlas.flame) !== (atlas.flameEmitterCount > 0) || (atlas.flame && !valid(atlas.flame))) throw new Error(`Prepared irradiance components do not match ${entry.area}.`);
    if (atlas.version !== lightingBakeVersion || atlas.signature !== key || atlas.preparation?.key !== entry.preparation.key || JSON.stringify(atlas.preparation?.sources) !== JSON.stringify(entry.preparation.sources)) throw new Error(`Prepared atlas metadata does not match ${entry.area}.`);
  }
  return true;
}
