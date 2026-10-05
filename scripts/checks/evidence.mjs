import { open, readdir, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { run } from '../lib/cli.mjs';
import { readJSON } from '../agents/state.mjs';
import { withResource } from '../agents/resources.mjs';

export function diagnosticExcerpt(text) {
  const lines = stripVTControlCharacters(text).split(/\r?\n/).filter(line => line.trim());
  const first = lines.findIndex(line => /\berror\b|\bfailed\b|missing|invalid|unsupported|unexpected/i.test(line));
  return lines.slice(Math.max(0, first - 1), Math.max(0, first - 1) + 6).map(line => line.slice(0, 240)).join('\n').slice(0, 1200);
}

async function failureDiagnostic(path) {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(64 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return diagnosticExcerpt(buffer.toString('utf8', 0, bytesRead));
  } finally { await handle.close(); }
}

/** Run sequentially under the existing leases, retaining logs and skipped stages. */
export async function runCheckStages(stages, directory) {
  const summary = [];
  let failed = false;
  for (const [name, command, argv] of stages) {
    if (failed) { summary.push({ name, status: 'skipped' }); continue; }
    const log = await open(resolve(directory, `${name}.log`), 'w'), queued = Date.now();
    let start = queued, waitingMs = 0;
    try {
      await withResource(name === 'build' ? 'heavy' : 'checks', async () => {
        start = Date.now(); waitingMs = start - queued;
        await run(command, argv, { timeout: 180000, stdio: ['ignore', log.fd, log.fd] });
      });
      summary.push({ name, status: 'passed', ms: Date.now() - start, waitingMs }); console.log(`PASS ${name}`);
    } catch (error) {
      failed = true; summary.push({ name, status: 'failed', error: error.message, ms: Date.now() - start, waitingMs });
      console.error(`FAIL ${name}: ${error.message}; log: ${resolve(directory, `${name}.log`)}`);
    } finally { await log.close(); }
    if (failed) {
      try {
        const diagnostic = await failureDiagnostic(resolve(directory, `${name}.log`));
        if (diagnostic) console.error(diagnostic);
      } catch (error) { console.error(`Diagnostic excerpt unavailable: ${error.message}; see the complete stage log.`); }
    }
  }
  return { summary, failed };
}

/** A successful check supersedes prior success and resolved failures in its mode. */
export async function pruneSuccessfulEvidence(directory, mode) {
  const parent = resolve(directory, '..');
  for (const entry of await readdir(parent, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const old = join(parent, entry.name);
    const previous = await readJSON(join(old, 'inputs.json'), null);
    if (old !== directory && previous?.mode === mode) await rm(old, { recursive: true, force: true });
  }
}
