import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cli, isMain, parseArgs, root, UsageError } from '../lib/cli.mjs';
import { recordPage } from './read-text.mjs';

function parts(path) {
  const keys = path.split('.');
  if (keys.some(key => !/^[\w-]+$/.test(key))) throw new UsageError(`Invalid dotted path: ${path}`);
  return keys;
}
function get(value, keys) {
  for (const key of keys) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
}
function entries(value, section) {
  if (Array.isArray(value)) return value.map((item, index) => ({ id: String(item?.id ?? index), path: `${section}.${index}`, value: item }));
  if (value !== null && typeof value === 'object') return Object.entries(value).map(([id, item]) => ({ id, path: `${section}.${id}`, value: item }));
  return [{ id: section, path: section, value }];
}

export function inspectRecords(data, source, args = {}) {
  const section = args['--section'];
  if (!section) {
    if (['--query', '--id', '--fields', '--limit', '--offset'].some(key => key in args)) throw new UsageError('Choose --section before filtering or paging records.');
    return { source, sections: Object.entries(data).map(([name, value]) => ({
      name, type: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,
      ...(value !== null && typeof value === 'object' ? { count: Object.keys(value).length } : { value }),
    })) };
  }
  const value = get(data, parts(section));
  if (value === undefined) throw new UsageError(`Unknown section ${section}. Top-level sections: ${Object.keys(data).join(', ')}.`);
  const fields = args['--fields']?.split(',').map(field => ({ name: field.trim(), keys: parts(field.trim()) }));
  const query = args['--query']?.toLowerCase();
  const matches = entries(value, section).filter(item =>
    (!args['--id'] || item.id === args['--id']) && (!query || `${item.id} ${JSON.stringify(item.value)}`.toLowerCase().includes(query)));
  const records = matches.map(record => ({ ...record, value: fields
    ? Object.fromEntries(fields.map(field => [field.name, get(record.value, field.keys)]).filter(([, value]) => value !== undefined))
    : record.value }));
  const page = recordPage(records, { '--limit': '10', ...args }, 'A record exceeds the 12,000-character content budget. Use --fields to select smaller fields, or inspect a nested section.');
  return { source, section, ...page, remaining: page.omitted };
}

if (isMain(import.meta.url)) await cli(async () => {
  const args = parseArgs(process.argv.slice(2), {
    '--area': 'value', '--source': 'value', '--section': 'value', '--query': 'value', '--id': 'value',
    '--fields': 'value', '--limit': 'value', '--offset': 'value',
  });
  if (args['--help']) { console.log('Usage: npm run agent:inspect -- (--area ID | --source motion|audio) [--section DOTTED_PATH] [--query TEXT] [--id ID] [--fields FIELD,FIELD] [--limit 10] [--offset 0]\nWithout a section, list section sizes. Pages preserve values and report nextOffset; at most 50 records and 12,000 content characters. Read-only.'); return; }
  if (!!args['--area'] === !!args['--source']) throw new UsageError('Choose exactly one of --area ID or --source motion|audio.');
  let source;
  if (args['--area']) {
    const names = (await readdir(resolve(root, 'src/levels/areas'))).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5));
    if (!names.includes(args['--area'])) throw new UsageError(`Unknown area ${args['--area']}. Choose: ${names.join(', ')}.`);
    source = `src/levels/areas/${args['--area']}.json`;
  } else {
    source = { motion: 'assets/motion-profiles.json', audio: 'assets/audio/manifest.json' }[args['--source']];
    if (typeof source !== 'string') throw new UsageError('Source must be motion or audio.');
  }
  const data = JSON.parse(await readFile(resolve(root, source), 'utf8'));
  console.log(JSON.stringify(inspectRecords(data, source, args), null, 2));
});
