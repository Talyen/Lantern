import { access, readFile, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { cli, parseArgs, UsageError } from '../lib/cli.mjs';
import { budget, integer, recordPage, recordWindow } from './read-text.mjs';

await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--evidence': 'value', '--stage': 'value', '--offset': 'value', '--limit': 'value', '--max-chars': 'value' });
  if (args['--help']) { console.log('Usage: npm run agent:diagnostics -- --evidence DIRECTORY [--stage NAME] [--offset 0] [--limit 20] [--max-chars 12000]\nRead retained check evidence without rerunning checks. Without a stage, list failed/skipped stages. With a stage, page diagnostic matches with log line numbers and preceding context. If no matches exist, page nonempty log lines. Full logs remain at the reported path.'); return; }
  const offset = integer(args['--offset'], 0, 0, Number.MAX_SAFE_INTEGER, 'Offset');
  const limit = integer(args['--limit'], 20, 1, 50, 'Limit'), maxChars = budget(args);
  if (!args['--evidence']) throw new UsageError('Choose --evidence DIRECTORY from check output or agent:status.');
  // Evidence is explicitly supplied and resolves from the caller, including retained archives.
  const directory = resolve(args['--evidence']);
  const summary = JSON.parse(await readFile(resolve(directory, 'summary.json'), 'utf8'));
  if (!Array.isArray(summary) || summary.some(item => !item || typeof item.name !== 'string' || typeof item.status !== 'string')) throw new Error('Invalid check summary.');
  if (!args['--stage']) {
    console.log(JSON.stringify({ evidence: directory, ...recordPage(summary.filter(item => item.status !== 'passed'), args) }, null, 2)); return;
  }
  const stage = summary.find(item => item.name === args['--stage']);
  if (!stage || !/^[a-z][a-z0-9-]*$/.test(stage.name)) throw new UsageError('Choose a stage name from the evidence summary.');
  if (stage.status === 'skipped') { console.log(JSON.stringify({ stage, message: 'Stage was skipped; no log was run.' }, null, 2)); return; }
  const log = resolve(directory, `${stage.name}.log`);
  try { await access(log); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    console.log(JSON.stringify({ evidence: directory, stage, message: 'No stage log was recorded; inspect the summary error above.' }, null, 2)); return;
  }
  // Count the full stream but retain only the requested window, even for large logs.
  const options = { offset, limit, maxChars,
    oversizedMessage: 'A diagnostic record exceeds the content budget; increase --max-chars or inspect the reported stage log.' };
  const matches = recordWindow(options), fallback = recordWindow(options);
  let lineNumber = 0, previous = '', location = '';
  const input = await open(log);
  try {
    const reader = input.readLines();
    for await (const raw of reader) {
      lineNumber++;
      const text = stripVTControlCharacters(raw);
      if (!text.trim()) continue;
      if (/^(?:\/|[A-Z]:[\\/]).*\.(?:[cm]?js|tsx?|py|css)$/.test(text.trim())) location = text.trim();
      const record = { logLine: lineNumber, ...(location ? { location } : {}), text };
      fallback.add(record);
      if (/\berror\b|\bfailed\b|missing|invalid|unsupported|unexpected|^\s*\d+:\d+/i.test(text)) matches.add({ ...record, ...(previous ? { preceding: previous } : {}) });
      previous = text;
    }
  } finally { await input.close(); }
  console.log(JSON.stringify({ evidence: directory, stage, log, mode: matches.total ? 'diagnostics' : 'nonempty-lines', ...(matches.total ? matches : fallback).page() }, null, 2));
});
