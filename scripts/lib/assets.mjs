import { open, readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, relative, sep, extname, dirname } from 'node:path';
import { root } from './cli.mjs';
export const sourceArchive = /\.(?:fbx|blend|blend1|zip|unitypackage|7z|rar|tar|gz)$/i;
export function inside(base, path) {
  const result = resolve(base, path);
  const rel = relative(base, result);
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || rel.startsWith(sep)) throw new Error(`Path outside asset root: ${path}`);
  return result;
}
export function assetPath(base, url, prefix = '/vendor/') {
  if (typeof url !== 'string' || !url.startsWith(prefix)) throw new Error(`Invalid asset URL: ${url}`);
  return inside(base, decodeURIComponent(url.slice(prefix.length)));
}
export async function inventory(base, skip = []) {
  const files = [];
  if (!existsSync(base)) return files;
  const visit = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
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
    if (bytesRead !== 20 || header.readUInt32LE(0) !== 0x46546c67 || header.readUInt32LE(4) !== 2 || header.readUInt32LE(8) !== size || header.readUInt32LE(16) !== 0x4e4f534a) throw new Error(`Malformed GLB: ${path}`);
    const length = header.readUInt32LE(12);
    if (length > size - 20 || length > 32 * 1024 * 1024) throw new Error(`Invalid GLB JSON length: ${path}`);
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
export async function checkAssets(playable = false) {
  const vendor = resolve(root, 'public/vendor');
  const { selection, selected } = await selectedLibrary();
  const characters = JSON.parse(await readFile(resolve(root, 'assets/playable-characters.json'), 'utf8'));
  const combatStates = ['idle', 'run', 'attack', 'hit', 'death'];
  let motionCount = 0, characterCount = 0;
  for (const [who, config] of Object.entries(characters)) {
    const states = who === 'player' ? [...combatStates, 'dodge'] : combatStates;
    const urls = config.variants ? Object.values(config.variants) : [config.model];
    const models = [];
    for (const url of urls) {
      const path = assetPath(vendor, url);
      if (!existsSync(path)) { if (playable) throw new Error(`${config.name} unavailable; run assets:export-character`); continue; }
      const character = await readGlb(path);
      if (!character.skins?.length || states.some(name => !character.animations?.some(clip => clip.name === name))) throw new Error(`${config.name} needs a skin and its retained motions`);
      if (character.animations.some(clip => clip.channels.some(channel => !character.nodes[channel.target.node]))) throw new Error(`Invalid embedded animation binding: ${config.name}`);
      models.push(character);
    }
    if (models.length) characterCount++;
    const catalogPath = assetPath(vendor, config.catalog);
    if (!existsSync(catalogPath)) { if (playable) throw new Error(`${config.name} motion catalog unavailable; run assets:export-character`); continue; }
    const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
    if (catalog.version !== 1 || !Array.isArray(catalog.packs) || !catalog.defaults) throw new Error(`Invalid ${who} animation catalog`);
    const pack = catalog.packs.find(item => item.id === 'mixamo');
    if (!pack || states.some(state => !pack.clips.some(clip => clip.name === catalog.defaults[state] && clip.category === state))) throw new Error(`${config.name} default motion set unavailable`);
    for (const pack of catalog.packs) {
      if (pack.id !== 'mixamo') throw new Error(`Unsupported animation provider: ${pack.id}`);
      for (const clip of pack.clips) {
        const data = await readGlb(assetPath(vendor, clip.url));
        if (data.animations?.length !== 1 || data.animations[0].channels.some(channel => !data.nodes[channel.target.node]?.name)) throw new Error(`Invalid motion: ${clip.name}`);
        for (const model of models) if (data.animations[0].channels.some(channel => !model.nodes.some(node => node.name === data.nodes[channel.target.node].name))) throw new Error(`${config.name} rig mismatch: ${clip.name}`);
        motionCount++;
      }
    }
  }
  for (const dir of ['synty', 'terrain']) {
    const base = resolve(vendor, dir);
    if (!existsSync(base)) continue;
    for (const entry of await readdir(base, { withFileTypes: true })) if (entry.isFile() && entry.name.endsWith('.glb')) await readGlb(resolve(base, entry.name));
  }
  console.log(`Assets: ${selection.length} selected IDs / ${selected.size} closure entries; ${motionCount} catalog motions; playable character ${characterCount}/2 characters present${characterCount ? '' : ' (asset-free build only)'}.`);
}
