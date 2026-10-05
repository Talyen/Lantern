import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { REVISION } from 'three';
import { root } from '../lib/cli.mjs';
import { hashFile } from '../lib/assets.mjs';
import { lightingPreparationKey, lightingBakeVersion } from '../../src/levels/lighting-preparation.ts';
import { resolveAreaLighting } from '../../src/levels/lighting.ts';
import { validatePreparedLighting } from './prepared-lighting.mjs';

// Admission: stale private atlases must never be certified after source or area
// changes; verification must stay read-only instead of silently regenerating art.
test('prepared lighting rejects changed source bytes and capture inputs without rewriting evidence', async () => {
  const fixture = await mkdtemp(resolve(tmpdir(), 'lantern-lighting-'));
  try {
    for (const directory of ['assets', 'src/levels/areas', 'public/vendor/lighting']) await mkdir(resolve(fixture, directory), { recursive: true });
    for (const file of ['lighting-preparation.ts', 'lighting.ts', 'lighting-preset.ts', 'local-lighting.ts']) await copyFile(resolve(root, 'src/levels', file), resolve(fixture, 'src/levels', file));
    const area = JSON.parse(await readFile(resolve(root, 'src/levels/areas/homestead.json'), 'utf8'));
    const recipes = JSON.parse(await readFile(resolve(root, 'assets/material-recipes.json'), 'utf8'));
    const areaPath = resolve(fixture, 'src/levels/areas/homestead.json'), sourcePath = resolve(fixture, 'public/vendor/source.glb');
    await writeFile(areaPath, JSON.stringify(area)); await writeFile(resolve(fixture, 'assets/material-recipes.json'), JSON.stringify(recipes)); await writeFile(sourcePath, 'initial source');
    const preparation = { key: await lightingPreparationKey({ ...area, lighting: resolveAreaLighting(area) }, 'projected', false, REVISION, recipes), sources: [{ url: '/vendor/source.glb', hash: await hashFile(sourcePath) }] };
    const signature = 'fixture', url = '/vendor/lighting/fixture.json', index = JSON.stringify({ bakes: { [signature]: { area: 'homestead', surfaces: 'projected', url, preparation } } });
    const probes = resolveAreaLighting(area).probes;
    const dimensions = [probes.resolution[0], probes.resolution[1], 7 * (probes.resolution[2] + 2)];
    const atlas = JSON.stringify({ version: lightingBakeVersion, signature, preparation, flameEmitterCount: 0,
      daylight: { dimensions, data: Array(dimensions.reduce((a,b)=>a*b,4)).fill(0) } });
    await writeFile(resolve(fixture, 'assets/lighting-bakes.json'), index); await writeFile(resolve(fixture, 'public', url.slice(1)), atlas);
    assert.equal(await validatePreparedLighting(fixture), true);
    await writeFile(sourcePath, 'changed source');
    await assert.rejects(validatePreparedLighting(fixture), /stale/);
    await writeFile(sourcePath, 'initial source');
    area.props[0].position[0] += 1; await writeFile(areaPath, JSON.stringify(area));
    await assert.rejects(validatePreparedLighting(fixture), /inputs changed/);
    assert.equal(await readFile(resolve(fixture, 'assets/lighting-bakes.json'), 'utf8'), index);
    assert.equal(await readFile(resolve(fixture, 'public', url.slice(1)), 'utf8'), atlas);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});
