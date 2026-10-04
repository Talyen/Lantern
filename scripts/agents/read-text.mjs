import { resolve, relative, isAbsolute } from 'node:path';
import { realpathSync } from 'node:fs';
import { root, integer, UsageError } from '../lib/cli.mjs';

export function budget(args) { return integer(args['--max-chars'], 12000, 1000, 50000, 'Max characters'); }
function repositoryLocal(path, base) {
  const local = relative(base, path).replaceAll('\\', '/');
  if (!local || local === '..' || local.startsWith('../') || isAbsolute(local)
    || /^(?:\.local|node_modules|public\/vendor|dist)(?:\/|$)/.test(local))
    throw new UsageError('Choose a repository source or documentation path, excluding private/generated directories.');
  return local;
}
export function repositoryPath(name) {
  const path = resolve(root, name), local = repositoryLocal(path, root);
  const canonical = realpathSync(path);
  repositoryLocal(canonical, realpathSync(root));
  return { path: canonical, local };
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
/** Count every record while retaining only one bounded page, including streamed logs. */
export function recordWindow({ offset = 0, limit = 20, maxChars = 12000,
  oversizedMessage = 'A record exceeds the content budget; increase --max-chars.' } = {}) {
  const items = [];
  let total = 0, characters = 0, blocked = false;
  return {
    add(record) {
      const index = total++;
      if (index < offset || items.length >= limit || blocked) return;
      const size = JSON.stringify(record).length + 1;
      if (characters + size > maxChars) { blocked = true; return; }
      items.push(record);
      characters += size;
    },
    page() {
      if (offset > total) throw new UsageError(`Offset exceeds ${total} records.`);
      if (blocked && !items.length) throw new UsageError(oversizedMessage);
      return { total, offset, shown: items.length, omitted: total - offset - items.length,
        nextOffset: offset + items.length < total ? offset + items.length : null, items };
    },
    get total() { return total; },
  };
}

export function recordPage(records, args = {}, oversizedMessage) {
  const page = recordWindow({
    offset: integer(args['--offset'], 0, 0, Number.MAX_SAFE_INTEGER, 'Offset'),
    limit: integer(args['--limit'], 20, 1, 50, 'Limit'),
    maxChars: budget(args), oversizedMessage,
  });
  for (const record of records) page.add(record);
  return page.page();
}
