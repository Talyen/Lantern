import { resolve, relative, isAbsolute } from 'node:path';
import { root, UsageError } from '../lib/cli.mjs';

export function integer(value, fallback, min, max, name) {
  const number = Number(value ?? fallback);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new UsageError(`${name} must be an integer between ${min} and ${max}.`);
  return number;
}
export function budget(args) { return integer(args['--max-chars'], 12000, 1000, 50000, 'Max characters'); }
export function repositoryPath(name) {
  const path = resolve(root, name), local = relative(root, path).replaceAll('\\', '/');
  if (!local || local.startsWith('../') || isAbsolute(local) || /^(?:\.local|node_modules|public\/vendor|dist)(?:\/|$)/.test(local)) throw new UsageError('Choose a repository source or documentation path, excluding private/generated directories.');
  return { path, local };
}
// Budgets count source characters, excluding the small report envelope. Never split a line.
export function linePage(lines, offset, maxChars, limit = 200) {
  if (offset > lines.length) throw new UsageError(`Offset exceeds ${lines.length} lines.`);
  const selected = [];
  let characters = 0;
  for (const line of lines.slice(offset, offset + limit)) {
    if (characters + line.length + 1 > maxChars) break;
    selected.push(line); characters += line.length + 1;
  }
  return { totalLines: lines.length, offset, shownLines: selected.length, characters,
    nextOffset: offset + selected.length < lines.length ? offset + selected.length : null,
    oversizedLine: !selected.length && offset < lines.length && lines[offset].length + 1 > maxChars,
    text: selected.join('\n') };
}
export function recordPage(records, args = {}) {
  const offset = integer(args['--offset'], 0, 0, Number.MAX_SAFE_INTEGER, 'Offset');
  const limit = integer(args['--limit'], 20, 1, 50, 'Limit');
  const maxChars = budget(args);
  if (offset > records.length) throw new UsageError(`Offset exceeds ${records.length} records.`);
  const items = [];
  let characters = 0;
  for (const record of records.slice(offset, offset + limit)) {
    const size = JSON.stringify(record).length + 1;
    if (characters + size > maxChars) break;
    items.push(record); characters += size;
  }
  if (!items.length && offset < records.length) throw new UsageError('A record exceeds the content budget; increase --max-chars.');
  return { total: records.length, offset, shown: items.length, omitted: records.length - offset - items.length,
    nextOffset: offset + items.length < records.length ? offset + items.length : null, items };
}
