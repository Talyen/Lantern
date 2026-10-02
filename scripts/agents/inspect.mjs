import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cli, isMain, parseArgs, root, UsageError } from '../lib/cli.mjs';
import { integer } from './read-text.mjs';

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
  const limit = integer(args['--limit'], 10, 1, 50, 'Limit');
  const offset = integer(args['--offset'], 0, 0, Number.MAX_SAFE_INTEGER, 'Offset');
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
  if (offset > matches.length) throw new UsageError(`Offset exceeds ${matches.length} records.`);
  const items = [];
  const page = () => ({ source, section, total: matches.length, offset, shown: items.length,
    remaining: Math.max(0, matches.length - offset - items.length),
    nextOffset: offset + items.length < matches.length ? offset + items.length : null, items });
  for (const record of matches.slice(offset, offset + limit)) {
    const selected = fields ? Object.fromEntries(fields.map(field => [field.name, get(record.value, field.keys)]).filter(([, field]) => field !== undefined)) : record.value;
    items.push({ ...record, value: selected });
    if (JSON.stringify(page(), null, 2).length > 12000) {
      items.pop();
      if (!items.length) throw new UsageError(`Record ${record.id} exceeds the 12,000-character output budget. Use --fields to select smaller fields, or inspect its nested path ${record.path}.`);
      break;
    }
  }
  return page();
}

if (isMain(import.meta.url)) await cli(async () => {
  const args = parseArgs(process.argv.slice(2), {
    '--area': 'value', '--source': 'value', '--section': 'value', '--query': 'value', '--id': 'value',
    '--fields': 'value', '--limit': 'value', '--offset': 'value',
  });
  if (args['--help']) { console.log('Usage: npm run agent:inspect -- (--area ID | --source motion|audio) [--section DOTTED_PATH] [--query TEXT] [--id ID] [--fields FIELD,FIELD] [--limit 10] [--offset 0]\nWithout a section, list section sizes. Pages preserve values and report nextOffset; at most 50 records and 12,000 characters. Read-only.'); return; }
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
