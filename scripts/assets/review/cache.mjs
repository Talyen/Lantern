import { stat, readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { reviewIndex, fingerprint, readReviews } from './index.mjs';
import { hashFile, readGlb } from '../../lib/assets.mjs';

async function identity(path) {
  try { const s = await stat(path, { bigint: true }); return `${s.size}:${s.mtimeNs}:${s.ctimeNs}:${s.ino}`; }
  catch (error) { if (error.code === 'ENOENT') return 'missing'; throw error; }
}
/** Cache content only while every observed input has the same filesystem identity. */
export function createReviewCache(cwd) {
  let signature, prepared, building;
  const files = new Map(), appearances = new Map();
  const memo = async (path, kind, load) => {
    const stamp = await identity(path), key = `${kind}:${path}`, previous = files.get(key);
    if (previous?.stamp === stamp) return previous.value;
    const value = Promise.resolve().then(load).then(async result => { if (await identity(path) !== stamp) throw new Error('Prepared input changed during inspection. Retry this asset.'); return result; });
    files.delete(key); files.set(key, { stamp, value });
    value.catch(() => { if (files.get(key)?.value === value) files.delete(key); });
    if (files.size > 512) files.delete(files.keys().next().value);
    return value;
  };
  const get = async () => {
    const reviews = await readReviews(cwd);
    const areas = (await readdir(resolve(cwd, 'src/levels/areas'))).filter(name => name.endsWith('.json')).sort();
    const inputs = ['assets/library-selection.json', 'assets/playable-characters.json', 'assets/textures/environment/manifest.json',
      'public/vendor/synty/library/catalog.json', 'public/vendor/asterfall/catalog.json', 'public/vendor/character-gallery/catalog.json',
      'public/vendor/characters/merchant/provenance.json', ...areas.map(name => `src/levels/areas/${name}`)];
    const current = JSON.stringify([await Promise.all(inputs.map(async path => [path, await identity(resolve(cwd, path))])), reviews.deleted]);
    if (!prepared || current !== signature) {
      if (!building || building.signature !== current) {
        const promise = reviewIndex(cwd, { reviewed: false }); building = { signature: current, promise };
      }
      let result;
      try { result = await building.promise; } catch (error) { building = undefined; throw error; }
      if (current !== signature) appearances.clear();
      signature = current; prepared = result;
    }
    return { ...prepared, reviews };
  };
  const inspect = async (index, source) => {
    const row = { ...source, warnings: [...source.warnings] }, cached = appearances.get(row.id);
    if (cached && cached.shape === JSON.stringify([row.url, row.height, row.dependencies])) {
      const current = await Promise.all(cached.inputs.map(async ([path]) => [path, await identity(path)]));
      if (JSON.stringify(current) === JSON.stringify(cached.inputs)) return { ...row, fingerprint: cached.fingerprint, available: cached.available, warnings: [...cached.warnings] };
    }
    const inputs = new Map();
    const observe = async path => { inputs.set(path, await identity(path)); };
    const hooks = {
      readGlb: async (path, base) => { await observe(path); return memo(path, 'glb', async () => { const data = await readGlb(path, base); return { images: data.images, buffers: data.buffers, materials: data.materials?.map(material => ({ extras: { lanternSurface: { url: material.extras?.lanternSurface?.url } } })) }; }); },
      hashFile: async path => { await observe(path); return memo(path, 'hash', () => hashFile(path)); },
      readFile: async path => { await observe(path); return memo(path, 'recipe', () => readFile(path)); },
    };
    row.fingerprint = await fingerprint(index, row, hooks);
    appearances.delete(row.id); appearances.set(row.id, { shape: JSON.stringify([row.url, row.height, row.dependencies]), fingerprint: row.fingerprint, available: row.available, warnings: [...row.warnings], inputs: [...inputs] });
    if (appearances.size > 256) appearances.delete(appearances.keys().next().value);
    return row;
  };
  return {
    get, inspect,
    async asset(id) { const index = await get(), row = index.assets.find(asset => asset.id === id); if (!row) throw new Error('Asset no longer available. Reload records.'); return inspect(index, row); },
    async snapshot() { const index = await get(); return { ...index, assets: await Promise.all(index.assets.map(row => index.reviews.decisions[row.id]?.state === 'approved' ? inspect(index, row) : row)) }; },
    async catalog(id) {
      const index = await get(), row = index.assets.find(asset => asset.id === id);
      if (!row?.libraryId) throw new Error('Asset has no library catalog.');
      const entries = {}, visit = key => { if (entries[key]) return; const entry = index.catalogEntries.get(key); if (!entry) throw new Error(`Missing dependency: ${key}`); entries[key] = entry; for (const dep of entry.dependencies ?? []) visit(dep); };
      visit(row.libraryId); return { version: 1, complete: true, assets: entries };
    },
  };
}
