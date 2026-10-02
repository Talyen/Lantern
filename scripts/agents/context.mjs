import { readFile } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cli, parseArgs, root, UsageError } from '../lib/cli.mjs';
import { git } from './state.mjs';

// The human-readable table is the single owner map; no generated copy or cache.
export async function readRoutes() {
  const document = resolve(root, 'Docs/ARCHITECTURE.md');
  const text = await readFile(document, 'utf8');
  const section = text.split('## Task routing\n')[1]?.split(/^## /m)[0];
  if (!section) throw new Error('Missing Task routing table in Docs/ARCHITECTURE.md.');
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

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--topic': 'value', '--json': 'boolean' });
  if (args['--help']) { console.log('Usage: npm run agent:context -- [--topic TOPIC] [--json]\nWithout a topic, list available topics. Read-only; no previews, preparation or checks.'); return; }
  const routes = await readRoutes();
  const route = args['--topic'] ? routes.find(item => item.topic === args['--topic']) : null;
  if (args['--topic'] && !route) throw new UsageError(`Unknown topic ${args['--topic']}. Choose: ${routes.map(item => item.topic).join(', ')}.`);
  const [branch, head, status] = await Promise.all([git(['branch', '--show-current']), git(['rev-parse', 'HEAD']), git(['status', '--short'])]);
  const dirty = status ? status.split('\n') : [];
  const report = {
    directory: root, branch: branch || '(detached)', head,
    dirty: { total: dirty.length, paths: dirty.slice(0, 20), omitted: Math.max(0, dirty.length - 20) },
    rules: 'AGENTS.md', workflow: 'Docs/DEVELOPMENT.md#working-alongside-other-agents',
    ...(route ? { ...route, check: 'npm run check' } : { topics: routes.map(({ topic, task }) => ({ topic, task })) }),
  };
  if (args['--json']) { console.log(JSON.stringify(report, null, 2)); return; }
  console.log(`Directory: ${report.directory}\nGit: ${report.branch} @ ${head.slice(0, 12)}; ${dirty.length} changed paths`);
  for (const path of report.dirty.paths) console.log(path);
  if (report.dirty.omitted) console.log(`${report.dirty.omitted} more paths; use git status --short for the complete inventory.`);
  console.log(`Rules: ${report.rules}\nWorkflow: ${report.workflow}`);
  if (!route) { for (const item of report.topics) console.log(`${item.topic}: ${item.task}`); return; }
  console.log(`Topic: ${route.topic} — ${route.task}\nOwners: ${route.owners.join(', ')}\nRead: ${route.read.join(', ')}\nCheck: npm run check\nAcceptance: ${route.acceptance}`);
  for (const command of route.inspect) console.log(`Inspect: ${command}`);
});
