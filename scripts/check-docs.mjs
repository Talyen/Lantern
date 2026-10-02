import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { cli, parseArgs, root } from './lib/cli.mjs';

// GitHub-style heading IDs, including duplicate suffixes; fenced examples are not headings.
function headingIds(text) {
  const ids = new Set();
  let fence;
  let previous = '';
  for (const line of text.split(/\r?\n/)) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !line.slice(marker[0].length).trim()) fence = undefined;
      previous = '';
      continue;
    }
    if (marker) { fence = marker[1]; previous = ''; continue; }
    const heading = line.match(/^ {0,3}#{1,6}(?:\s+(.+?)\s*#*\s*|\s*)$/)?.[1]
      ?? (previous.trim() && /^ {0,3}(?:=+|-+)\s*$/.test(line) ? previous.trim() : undefined);
    if (heading !== undefined) {
      const base = heading.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]*>/g, '').replace(/[*`~]/g, '')
        .toLowerCase().replace(/[^\p{L}\p{M}\p{N}_\-\s]/gu, '').replace(/\s/g, '-');
      let id = base;
      for (let suffix = 1; ids.has(id); suffix++) id = `${base}-${suffix}`;
      ids.add(id);
      previous = '';
    } else previous = line;
  }
  return ids;
}

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
  for (const directory of ['Docs', '.agents']) {
    const path = resolve(root, directory);
    if (existsSync(path)) await walk(path);
  }
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
