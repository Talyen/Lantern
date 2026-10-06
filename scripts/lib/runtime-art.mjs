import { readFile, stat } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { hashFile, inside, safeRelativePath } from './assets.mjs';

/** Preparation is explicit. Consumers verify source/derivative identity without encoding. */
export async function runtimeArtIndex(publicRoot, { verify = false } = {}) {
  const path = resolve(publicRoot, 'vendor/runtime-art/index.json');
  if (!existsSync(path)) return undefined;
  const index = JSON.parse(await readFile(path, 'utf8'));
  if (index.version !== 1 || !index.assets || typeof index.assets !== 'object' || index.encoder !== 'toktx v4.4.2') throw new Error('Invalid prepared runtime art index.');
  for (const [url, record] of Object.entries(index.assets)) {
    if ((!url.startsWith('/vendor/') && !url.startsWith('/assets/')) || !safeRelativePath(url.slice(1)) || !/^[a-f0-9]{64}$/.test(record.sourceHash) || !/^[a-f0-9]{64}$/.test(record.contentHash)) throw new Error(`Invalid runtime art identity: ${url}`);
    for (const target of runtimeArtURLs(record)) {
      if (!target.startsWith('/vendor/runtime-art/') || !safeRelativePath(target.slice(1))) throw new Error(`Invalid runtime derivative: ${target}`);
      const file = inside(publicRoot, resolve(publicRoot, target.slice(1)));
      if (!(await stat(file)).isFile()) throw new Error(`Runtime derivative missing: ${target}`);
    }
    if (verify) {
      const source = url.startsWith('/assets/') ? resolve(publicRoot, '..', url.slice(1)) : resolve(publicRoot, url.slice(1));
      if (await hashFile(source) !== record.sourceHash || await hashFile(resolve(publicRoot, record.url.slice(1))) !== record.contentHash) throw new Error(`Runtime art is stale: ${url}. Re-prepare runtime art.`);
    }
  }
  return index;
}
export function runtimeArtURLs(record) { return [...new Set([record.url, record.colorURL, record.dataURL, record.colorFlipURL, record.dataFlipURL].filter(Boolean))]; }
export function runtimeArtRecord(index, publicRoot, path) { return index?.assets['/' + relative(publicRoot, path).replaceAll('\\', '/')]; }

/** Build URL imports select prepared art without emitting their source alternatives. */
export function runtimeArtURLPlugin() {
  let project, index;
  const selected = new Map();
  return { name: 'lantern-runtime-art-urls', apply: 'build', enforce: 'pre',
    async configResolved(config) { project = config.root; index = await runtimeArtIndex(resolve(project, 'public')); },
    resolveId(source, importer) {
      if (!index || !importer || !source.endsWith('?url')) return;
      const file = resolve(dirname(importer.split('?')[0]), source.slice(0, -4));
      const canonical = '/' + relative(project, file).replaceAll('\\', '/');
      const record = index.assets[canonical]; if (!record) return;
      const id = '\0lantern-runtime-art:' + canonical; selected.set(id, record.url);
      return { id, moduleSideEffects: false };
    },
    load(id) { const url = selected.get(id); if (url) return 'export default ' + JSON.stringify(url) + ';'; },
  };
}
