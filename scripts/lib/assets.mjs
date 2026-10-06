import { createHash } from 'node:crypto';
import { open, readFile, readdir, stat, lstat } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import { resolve, relative, sep, extname, dirname } from 'node:path';
import { root } from './cli.mjs';
import { glbJsonLength } from './glb.mjs';
import { runtimeArtIndex, runtimeArtURLs, runtimeArtRecord } from './runtime-art.mjs';
export async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
export const sourceArchive = /\.(?:fbx|blend|blend1|zip|unitypackage|7z|rar|tar|gz)$/i;
/** Portable relative file names shared by imported sources and desktop manifests. */
export function safeRelativePath(path) {
  return typeof path === 'string' && !/[\\:\0\r\n]/.test(path) && path.split('/').every(part => part && part !== '.' && part !== '..');
}
export function inside(base, path) {
  const result = resolve(base, path);
  const rel = relative(base, result);
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || rel.startsWith(sep)) throw new Error(`Path outside asset root: ${path}`);
  return result;
}
export function assetPath(base, url, prefix = '/vendor/') {
  if (typeof url !== 'string' || !url.startsWith(prefix)) throw new Error(`Invalid asset URL: ${url}`);
  const path = decodeURIComponent(url.slice(prefix.length));
  if (!safeRelativePath(path)) throw new Error(`Invalid asset URL: ${url}`);
  return inside(base, path);
}
export async function inventory(base, skip = []) {
  const files = [];
  if (!existsSync(base)) return files;
  const visit = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === '.DS_Store') continue;
      const path = resolve(dir, entry.name);
      if (skip.includes(relative(base, path).split(sep).join('/'))) continue;
      if (entry.isSymbolicLink()) throw new Error(`Asset symlink is unsupported: ${relative(base, path)}`);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push({ path: relative(base, path).split(sep).join('/'), bytes: (await stat(path)).size });
    }
  };
  await visit(base);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
export function rejectArchives(files) {
  const bad = files.find((file) => sourceArchive.test(file.path));
  if (bad) throw new Error(`Source archive cannot enter a build: ${bad.path}`);
}
export async function readGlb(path, resourceRoot = dirname(path)) {
  const file = await open(path, 'r');
  try {
    const header = Buffer.alloc(20);
    const { bytesRead } = await file.read(header, 0, 20, 0);
    const size = (await file.stat()).size;
    const length = glbJsonLength(header.subarray(0, bytesRead), size, path);
    const json = Buffer.alloc(length);
    if ((await file.read(json, 0, length, 20)).bytesRead !== length) throw new Error(`Truncated GLB: ${path}`);
    const data = JSON.parse(json.toString());
    for (const entry of [...(data.images ?? []), ...(data.buffers ?? [])]) {
      if (entry.uri && !entry.uri.startsWith('data:')) {
        const referenced = inside(resourceRoot, resolve(dirname(path), decodeURIComponent(entry.uri)));
        if (!(await stat(referenced)).isFile()) throw new Error(`Missing GLB resource: ${entry.uri}`);
      }
    }
    return data;
  } finally { await file.close(); }
}
export async function selectedLibrary(base = resolve(root, 'public/vendor/synty/library')) {
  const selection = JSON.parse(await readFile(resolve(root, 'assets/library-selection.json'), 'utf8'));
  if (!Array.isArray(selection) || selection.some((id) => typeof id !== 'string')) throw new Error('Library selection must be an array of IDs');
  const selected = new Map();
  if (!selection.length) return { selection, selected };
  if (!existsSync(base)) { console.log('Private library absent; validating an asset-free build.'); return { selection, selected }; }
  const catalog = JSON.parse(await readFile(resolve(base, 'catalog.json'), 'utf8'));
  if (catalog.version !== 1) throw new Error('Unsupported library catalog');
  const visit = async (id) => {
    if (selected.has(id)) return;
    const asset = catalog.assets[id];
    if (!asset || asset.status !== 'converted' || !Array.isArray(asset.dependencies)) throw new Error(`Selected library asset unavailable: ${id}`);
    const path = assetPath(base, asset.url, '/vendor/synty/library/');
    if (!(await stat(path)).isFile()) throw new Error(`Missing selected asset: ${id}`);
    if (sourceArchive.test(path)) throw new Error(`Selected source archive: ${id}`);
    selected.set(id, asset);
    if (extname(path) === '.glb') await readGlb(path, base);
    for (const dependency of asset.dependencies) await visit(dependency);
  };
  for (const id of selection) await visit(id);
  return { selection, selected };
}
/** The build includes explicit gameplay inputs, never a copy of the development catalog. */
export async function gameplayAssets(source = resolve(root, 'public'), { originals = false } = {}) {
  const { selection, selected } = await selectedLibrary(resolve(source, 'vendor/synty/library'));
  const runtime = originals ? undefined : await runtimeArtIndex(source);
  const paths = new Set();
  async function include(path) {
    const derivative = runtimeArtRecord(runtime, source, path);
    if (derivative) { for (const url of runtimeArtURLs(derivative)) await includePrepared(resolve(source, url.slice(1))); return; }
    await includePrepared(path);
  }
  async function includePrepared(path) {
    if (paths.has(path) || !existsSync(path)) return; // Optional scenery and source-only builds remain supported.
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error(`Runtime asset must be a private file: ${path}`);
    paths.add(path);
    if (extname(path) === '.glb') {
      const glb = await readGlb(path, source);
      for (const material of glb.materials ?? []) {
        const url = material.extras?.lanternSurface?.url;
        if (url) { const field = assetPath(source, url, '/'); if (!existsSync(field)) throw new Error(`Missing prepared surface data: ${url}`); await include(field); }
      }
      for (const entry of [...(glb.images ?? []), ...(glb.buffers ?? [])]) {
        if (entry.uri && !entry.uri.startsWith('data:')) await include(inside(source, resolve(dirname(path), decodeURIComponent(entry.uri))));
      }
    }
  }
  async function references(value) {
    if (typeof value === 'string' && value.startsWith('/vendor/')) await include(assetPath(source, value, '/'));
    else if (value && typeof value === 'object') for (const child of Object.values(value)) await references(child);
  }
  for (const asset of selected.values()) await include(assetPath(source, asset.url, '/'));
  const areaRoot = resolve(root, 'src/levels/areas');
  for (const name of await readdir(areaRoot)) if (name.endsWith('.json')) {
    const area = JSON.parse(await readFile(resolve(areaRoot, name), 'utf8'));
    await references(area);
    if (area.shop) {
      const model = assetPath(source, area.shop.merchant.model, '/');
      if (existsSync(model)) {
        const data = await readGlb(model, source), idle = data.animations?.find(clip => clip.name === 'idle');
        if (data.animations?.length !== 1 || !idle || idle.channels.some(channel => !data.nodes[channel.target.node]?.name))
          throw new Error('Merchant requires one compatible packed neutral Mixamo idle; run assets:export-merchant');
      }
    }
  }
  await references(JSON.parse(await readFile(resolve(root, 'assets/textures/environment/manifest.json'), 'utf8')));
  const rainRecipe=assetPath(source,'/vendor/synty/ability-effects/arrow-rain.json','/');
  await include(rainRecipe);
  if (existsSync(rainRecipe)) await references(JSON.parse(await readFile(rainRecipe,'utf8')));
  const characters = JSON.parse(await readFile(resolve(root, 'assets/playable-characters.json'), 'utf8'));
  for (const config of Object.values(characters)) {
    await references(config.model); await references(config.catalog);
    await references(config.lanternModel);
    const catalog = assetPath(source, config.catalog, '/');
    if (existsSync(catalog)) {
      const data = JSON.parse(await readFile(catalog, 'utf8'));
      // Complete per-rig catalogs keep every prepared weapon profile valid.
      for (const pack of data.packs) for (const clip of pack.clips) await references(clip.url);
    }
  }
  const audio = JSON.parse(await readFile(resolve(root, 'assets/audio/manifest.json'), 'utf8'));
  if (audio.version !== 1 || audio.sampleRate !== 48000 || !audio.clips || !audio.cues) throw new Error('Invalid audio manifest');
  for (const [id, clip] of Object.entries(audio.clips)) {
    if (!/^[a-z0-9-]+$/.test(id) || clip.url !== `/vendor/audio/${id}.ogg` || !/^[a-f0-9]{64}$/.test(clip.sourceSha256)) throw new Error(`Invalid sound reference: ${id}`);
    if (clip.loop && (clip.loopStart !== 0 || !Number.isFinite(clip.loopEnd) || clip.loopEnd<=0)) throw new Error(`Invalid sound loop points: ${id}`);
    const path = assetPath(source,clip.url,'/');
    if (existsSync(resolve(source,'vendor/audio'))) {
      if (!existsSync(path) || (await readFile(path)).subarray(0,4).toString() !== 'OggS') throw new Error(`Missing or invalid prepared sound: ${id}; run npm run audio:prepare`);
    }
  }
  for (const [id,cue] of Object.entries(audio.cues)) if (!Array.isArray(cue.clips) || !cue.clips.length || cue.clips.some(clip=>!audio.clips[clip]) || !['effects','ambience','ui'].includes(cue.bus) || !Number.isFinite(cue.gain) || cue.gain<0 || cue.gain>1) throw new Error(`Invalid sound cue: ${id}`);
  await references(audio.clips);
  const lighting = JSON.parse(await readFile(resolve(root, 'assets/lighting-bakes.json'), 'utf8'));
  for (const [signature, entry] of Object.entries(lighting.bakes)) {
    if (!/^[a-f0-9]{64}$/.test(signature) || entry.url !== `/vendor/lighting/${signature}.json`) throw new Error('Invalid prepared lighting reference');
    await references(entry.url);
  }
  if (runtime) {
    for (const [sourceURL, record] of Object.entries(runtime.assets)) if (sourceURL.startsWith('/assets/')) for (const url of runtimeArtURLs(record)) await includePrepared(resolve(source, url.slice(1)));
  }
  return { selection, selected, paths, runtime };
}
export async function checkAssets(playable = false) {
  await runtimeArtIndex(resolve(root, 'public'), { verify: true });
  const vendor = resolve(root, 'public/vendor');
  const { selection, selected } = await selectedLibrary();
  const characters = JSON.parse(await readFile(resolve(root, 'assets/playable-characters.json'), 'utf8'));
  const combatStates = ['idle', 'run', 'attack', 'hit', 'death'];
  let motionCount = 0, characterCount = 0;
  for (const [who, config] of Object.entries(characters)) {
    const states = who === 'player' ? [...combatStates, 'dodge'] : combatStates;
    const modelPath = assetPath(vendor, config.model);
    let model;
    if (existsSync(modelPath)) {
      model = await readGlb(modelPath);
      if (!model.skins?.length || states.some(name => !model.animations?.some(clip => clip.name === name))) throw new Error(`${config.name} needs a skin and its retained motions`);
      if (model.animations.some(clip => clip.channels.some(channel => !model.nodes[channel.target.node]))) throw new Error(`Invalid embedded animation binding: ${config.name}`);
      characterCount++;
    } else if (playable) throw new Error(`${config.name} unavailable; run assets:export-character`);
    const catalogPath = assetPath(vendor, config.catalog);
    if (!existsSync(catalogPath)) { if (playable) throw new Error(`${config.name} motion catalog unavailable; run assets:export-character`); continue; }
    const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
    if (catalog.version !== 1 || !Array.isArray(catalog.packs) || !catalog.defaults) throw new Error(`Invalid ${who} animation catalog`);
    const pack = catalog.packs.find(item => item.id === 'mixamo');
    if (!pack || states.some(state => !pack.clips.some(clip => (clip.id === catalog.defaults[state] || clip.name === catalog.defaults[state]) && clip.category === state))) throw new Error(`${config.name} default motion set unavailable`);
    for (const pack of catalog.packs) {
      if (pack.id !== 'mixamo') throw new Error(`Unsupported animation provider: ${pack.id}`);
      for (const clip of pack.clips) {
        const data = await readGlb(assetPath(vendor, clip.url));
        if (data.animations?.length !== 1 || data.animations[0].channels.some(channel => !data.nodes[channel.target.node]?.name)) throw new Error(`Invalid motion: ${clip.name}`);
        if (model && data.animations[0].channels.some(channel => !model.nodes.some(node => node.name === data.nodes[channel.target.node].name))) throw new Error(`${config.name} rig mismatch: ${clip.name}`);
        motionCount++;
      }
    }
  }
  await gameplayAssets();
  console.log(`Assets: ${selection.length} selected IDs / ${selected.size} closure entries; ${motionCount} catalog motions; playable character ${characterCount}/${Object.keys(characters).length} characters present${characterCount ? '' : ' (asset-free build only)'}.`);
}
