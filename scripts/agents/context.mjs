import { readFile } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { cli, isMain, parseArgs, root, UsageError } from '../lib/cli.mjs';
import { markdownHeadings } from '../lib/markdown.mjs';
import { budget, integer, linePage, recordPage, repositoryPath } from './read-text.mjs';
import { git } from './state.mjs';

// The human-readable table is the single owner map; no generated copy or cache.
export async function readRoutes() {
  const document = resolve(root, 'Docs/ARCHITECTURE.md');
  const text = await readFile(document, 'utf8');
  const heading = markdownHeadings(text).find(item => item.id === 'task-routing');
  if (!heading) throw new Error('Missing Task routing table in Docs/ARCHITECTURE.md.');
  const section = text.split(/\r?\n/).slice(heading.startLine, heading.endLine).join('\n');
  const links = cell => [...cell.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map(([, target]) => {
    const [path, fragment] = target.split('#');
    return relative(root, resolve(dirname(document), path)).replaceAll('\\', '/') + (fragment ? `#${fragment}` : '');
  });
  const routes = [];
  for (const line of section.split('\n').filter(line => /^\| `/.test(line))) {
    const cells = line.slice(1, -1).split('|').map(cell => cell.trim());
    const topic = cells[0].replaceAll('`', '');
    if (cells.length !== 6 || !/^[a-z]+$/.test(topic) || routes.some(route => route.topic === topic)) {
      throw new Error(`Invalid task routing row: ${line}`);
    }
    const owners = links(cells[2]), read = links(cells[3]);
    if (!owners.length || !read.length) throw new Error(`Task routing ${topic} requires owner and reference links.`);
    routes.push({ topic, task: cells[1], owners, read, inspect: [...cells[4].matchAll(/`([^`]+)`/g)].map(match => match[1]), acceptance: cells[5] });
  }
  if (!routes.length) throw new Error('Task routing table has no topics.');
  return routes;
}

export async function readDocumentation(references, maxChars, offset = 0) {
  const sections = [];
  let remaining = maxChars;
  for (const reference of [...new Set(references)]) {
    const [file, fragment] = reference.split('#');
    const { path, local } = repositoryPath(file);
    if (!local.endsWith('.md')) throw new UsageError('Documentation references must be Markdown files.');
    const text = await readFile(path, 'utf8'), lines = text.split(/\r?\n/);
    const heading = fragment ? markdownHeadings(text).find(item => item.id === decodeURIComponent(fragment)) : null;
    if (fragment && !heading) throw new UsageError(`Missing heading ${reference}.`);
    const startLine = heading?.startLine ?? 1, endLine = heading?.endLine ?? lines.length;
    const page = linePage(lines.slice(startLine - 1, endLine), offset, remaining, Number.MAX_SAFE_INTEGER);
    page.oversizedLine = page.oversizedLine && lines[startLine - 1 + offset].length + 1 > maxChars;
    remaining -= page.characters;
    sections.push({ reference, startLine, endLine, firstShownLine: startLine + offset, ...page });
  }
  return { maxChars, characters: maxChars - remaining, sections };
}

if (isMain(import.meta.url)) await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--topic': 'value', '--json': 'boolean', '--include-docs': 'boolean', '--consumers': 'boolean', '--doc': 'value', '--offset': 'value', '--limit': 'value', '--max-chars': 'value' });
  if (args['--help']) { console.log('Usage: npm run agent:context -- [--topic TOPIC] [--include-docs] [--consumers] [--json] [--max-chars 12000] [--limit 20] [--offset 0]\nRead one document section: --doc PATH#HEADING [--offset LINE_OFFSET].\nDocumentation shares a content budget; sections include source lines and nextOffset, with omitted lines explicit. Consumers are direct literal relative imports/re-exports/require, paged separately; aliases and computed imports are excluded. Without a topic, list topics. Read-only.'); return; }
  const maxChars = budget(args), offset = integer(args['--offset'], 0, 0, Number.MAX_SAFE_INTEGER, 'Offset');
  integer(args['--limit'], 20, 1, 50, 'Limit');
  if (args['--doc']) {
    if (args['--topic'] || args['--consumers'] || args['--include-docs'] || args['--limit']) throw new UsageError('--doc is a standalone section read; use --offset and --max-chars to continue.');
    console.log(JSON.stringify(await readDocumentation([args['--doc']], maxChars, offset), null, 2)); return;
  }
  if ((args['--include-docs'] || args['--consumers']) && !args['--topic']) throw new UsageError('Choose --topic before including documentation or consumers.');
  if ((args['--offset'] || args['--limit']) && !args['--consumers']) throw new UsageError('Paging requires --consumers or a standalone --doc read.');
  const routes = await readRoutes();
  const route = args['--topic'] ? routes.find(item => item.topic === args['--topic']) : null;
  if (args['--topic'] && !route) throw new UsageError(`Unknown topic ${args['--topic']}. Choose: ${routes.map(item => item.topic).join(', ')}.`);
  const [branch, head, status, documentation, consumers] = await Promise.all([
    git(['branch', '--show-current']), git(['rev-parse', 'HEAD']), git(['status', '--short']),
    args['--include-docs'] ? readDocumentation(route.read, maxChars) : null,
    args['--consumers'] ? import('./source.mjs').then(module => module.directConsumers(route.owners)).then(items => recordPage(items, args)) : null,
  ]);
  const dirty = status ? status.split('\n') : [];
  const report = {
    directory: root, branch: branch || '(detached)', head,
    dirty: { total: dirty.length, paths: dirty.slice(0, 20), omitted: Math.max(0, dirty.length - 20) },
    rules: 'AGENTS.md', workflow: 'Docs/DEVELOPMENT.md#working-alongside-other-agents',
    ...(route ? { ...route, check: 'npm run check' } : { topics: routes.map(({ topic, task }) => ({ topic, task })) }),
    ...(documentation ? { documentation } : {}), ...(consumers ? { consumers } : {}),
  };
  if (args['--json']) { console.log(JSON.stringify(report, null, 2)); return; }
  console.log(`Directory: ${report.directory}\nGit: ${report.branch} @ ${head.slice(0, 12)}; ${dirty.length} changed paths`);
  for (const path of report.dirty.paths) console.log(path);
  if (report.dirty.omitted) console.log(`${report.dirty.omitted} more paths; use git status --short for the complete inventory.`);
  console.log(`Rules: ${report.rules}\nWorkflow: ${report.workflow}`);
  if (!route) { for (const item of report.topics) console.log(`${item.topic}: ${item.task}`); return; }
  console.log(`Topic: ${route.topic} — ${route.task}\nOwners: ${route.owners.join(', ')}\nRead: ${route.read.join(', ')}\nCheck: npm run check\nAcceptance: ${route.acceptance}`);
  for (const command of route.inspect) console.log(`Inspect: ${command}`);
  if (consumers) {
    for (const item of consumers.items) console.log(`Consumer: ${item.file}:${item.line} -> ${item.owner}`);
    console.log(`Consumers: ${consumers.shown}/${consumers.total}; nextOffset: ${consumers.nextOffset ?? 'none'} (direct literal relative imports only).`);
  }
  if (documentation) for (const section of documentation.sections) {
    console.log(`\n${section.reference}:${section.firstShownLine} (${section.shownLines}/${section.totalLines} lines)\n${section.text}`);
    if (section.nextOffset !== null) console.log(`Remaining section lines: ${section.totalLines - section.offset - section.shownLines}; continue: npm run agent:context -- --doc ${section.reference} --offset ${section.nextOffset}${section.oversizedLine ? ' --max-chars 50000' : ''}`);
  }
});
