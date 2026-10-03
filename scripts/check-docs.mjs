import { repositoryFiles } from './agents/state.mjs';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { cli, parseArgs, root } from './lib/cli.mjs';
import { headingIds } from './lib/markdown.mjs';
import { readRoutes } from './agents/context.mjs';

await cli(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args['--help']) { console.log('Usage: npm run docs:check'); return; }
  await readRoutes();
  const files = (await repositoryFiles()).filter(file => /^(?:[^/]+|(?:Docs|\.agents)\/.*)\.md$/.test(file)).map(file => resolve(root, file)).filter(existsSync);
  const scripts = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).scripts;
  const errors = [];
  const headings = new Map();
  async function headingsFor(file) {
    if (!headings.has(file)) headings.set(file, headingIds(await readFile(file, 'utf8')));
    return headings.get(file);
  }
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    for (const match of text.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      const link = match[1];
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(link)) continue;
      const separator = link.indexOf('#');
      const target = separator < 0 ? link : link.slice(0, separator);
      const fragment = separator < 0 ? '' : decodeURIComponent(link.slice(separator + 1));
      const path = target ? resolve(dirname(file), decodeURIComponent(target)) : file;
      if (!existsSync(path)) errors.push(`${file}: missing link ${link}`);
      else if (fragment && extname(path).toLowerCase() === '.md' && !(await headingsFor(path)).has(fragment)) errors.push(`${file}: missing heading ${link}`);
    }
    for (const match of text.matchAll(/npm run ([a-z][\w:-]*)/g)) if (!(match[1] in scripts)) errors.push(`${file}: unknown npm command ${match[1]}`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`Documentation passed: ${files.length} maintained documents.`);
});
