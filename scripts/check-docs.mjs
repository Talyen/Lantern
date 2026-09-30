import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { cli, parseArgs, root } from './lib/cli.mjs';
await cli(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args['--help']) { console.log('Usage: npm run docs:check'); return; }
  const files = (await readdir(root)).filter((file) => file.endsWith('.md')).map((file) => resolve(root, file));
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith('.md')) files.push(path);
    }
  }
  if (existsSync(resolve(root, 'Docs'))) await walk(resolve(root, 'Docs'));
  const scripts = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).scripts;
  const errors = [];
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    for (const match of text.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      const link = match[1];
      if (/^(?:[a-z]+:|#)/i.test(link)) continue;
      const path = resolve(dirname(file), decodeURIComponent(link.split('#')[0]));
      if (!existsSync(path)) errors.push(`${file}: missing link ${link}`);
    }
    for (const match of text.matchAll(/npm run ([a-z][\w:-]*)/g)) if (!(match[1] in scripts)) errors.push(`${file}: unknown npm command ${match[1]}`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`Documentation passed: ${files.length} maintained documents.`);
});
