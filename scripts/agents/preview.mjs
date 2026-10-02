import { createServer as portServer } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdir, open, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { context, readJSON, writeJSON, processIdentity } from './state.mjs';
import { acquire } from './resources.mjs';
import { run, root } from '../lib/cli.mjs';
export const sessionPath = cwd => join(cwd, '.local/agents/preview.json');
export async function livePreview(cwd) {
  const record = await readJSON(sessionPath(cwd), null);
  if (!record?.url) return null;
  if (await processIdentity(record.pid) !== record.started) return null;
  try {
    const owner = await fetch(`${record.url}/__agent-owner`, { signal: AbortSignal.timeout(1500) }).then(response => response.json());
    return owner.token === record.token ? record : null;
  } catch { return null; }
}
export async function stopPreview(cwd) {
  const record = await readJSON(sessionPath(cwd), null);
  if (!record) return;
  if (await processIdentity(record.pid) !== record.started) { await rm(sessionPath(cwd)); return; }
  if (record.status !== 'starting' && !await livePreview(cwd)) throw new Error(`Preview identity could not be verified; preserve its session record: ${cwd}`);
  process.kill(record.pid, 'SIGTERM');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await processIdentity(record.pid) !== record.started) return;
    await new Promise(accept => setTimeout(accept, 100));
  }
  throw new Error('Owned preview did not stop; inspect its log.');
}
export async function startPreview(cwd, { main = false, browser = false, author = false, area = 'clearing' } = {}) {
  const existing = await livePreview(cwd);
  if (existing) {
    if (browser !== existing.browser || author !== existing.author) throw new Error('Preview mode differs; run agent:dev --stop before changing it.');
    return existing;
  }
  const previous = await readJSON(sessionPath(cwd), null);
  if (previous && await processIdentity(previous.pid) === previous.started) throw new Error('An existing preview owner is alive but unresponsive; preserve it and inspect its log.');
  const token = randomUUID(), directory = join(cwd, '.local/agents');
  await mkdir(directory, { recursive: true });
  const log = await open(join(directory, 'preview.log'), 'w');
  const child = spawn(process.execPath, [resolve(root, 'scripts/agents/preview.mjs'), '--serve'], { cwd, env: { ...process.env, LANTERN_PREVIEW: JSON.stringify({ main, browser, author, area, token }), LANTERN_LEASES: '{}', LANTERN_LEVEL_SESSION: token }, detached: true, stdio: ['ignore', log.fd, log.fd] });
  child.unref(); await log.close();
  const identity = await processIdentity(child.pid);
  let interrupted = false, reportedWaiting = false;
  const began = Date.now();
  const cancel = () => { interrupted = true; child.kill('SIGTERM'); };
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  try {
    for (;;) {
      if (interrupted) throw new Error('Preview startup interrupted.');
      const record = await livePreview(cwd);
      if (record?.token === token && record.ready) return record;
      if (!identity || await processIdentity(child.pid) !== identity) throw new Error(`Preview exited during startup; inspect ${join(directory, 'preview.log')}`);
      if (!reportedWaiting && Date.now() - began > 3000) { console.log(`Waiting for owned preview/GPU resource; log: ${join(directory, 'preview.log')}`); reportedWaiting = true; }
      await new Promise(accept => setTimeout(accept, 200));
    }
  } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }

}
async function serve() {
  const options = JSON.parse(process.env.LANTERN_PREVIEW);
  const cwd = process.cwd(), ctx = await context(cwd);
  if (options.main && cwd !== ctx.main) throw new Error('Main preview must use the main checkout.');
  const session = `lantern-level-${options.token}`;
  let lease, ownerLease, server, timer, closing = false, browserOpened = false;
  const record = { pid: process.pid, started: await processIdentity(process.pid), token: options.token,
    session, renderer: 'webgpu', browser: options.browser, author: options.author, status: 'starting', ready: false };
  const close = async () => {
    if (closing) return; closing = true;
    clearInterval(timer);
    if (browserOpened) await run('agent-browser', ['--session', session, 'close']).catch(() => {});
    await server?.close();
    if ((await readJSON(sessionPath(cwd), null))?.token === options.token) await rm(sessionPath(cwd), { force: true });
    if (options.author && (await readJSON(join(cwd, '.local/level-design/session.json'), null))?.token === options.token) await rm(join(cwd, '.local/level-design/session.json'), { force: true });
    await lease?.release(); await ownerLease?.release(); process.exit(0);
  };
  process.once('SIGTERM', close); process.once('SIGINT', close);
  try {
    // A second startup must never overwrite this task's session or leave an
    // untracked server alive. This per-checkout lease also covers GPU admission.
    const owner = `preview-${createHash('sha256').update(cwd).digest('hex').slice(0, 16)}`;
    ownerLease = await acquire(owner, { cwd, ctx, tryOnly: true });
    if (!ownerLease) throw new Error('An owned preview is already starting or running.');
    await writeJSON(sessionPath(cwd), record);
    lease = options.browser ? await acquire('gpu', { cwd, ctx }) : null;
    if (closing) { await lease?.release(); return; }
    lease?.cleanup(['agent-browser', '--session', session, 'close']);
    const port = options.main ? 5173 : await new Promise((accept, reject) => {
      const probe = portServer(); probe.once('error', reject);
      probe.listen(0, '127.0.0.1', () => { const selected = probe.address().port; probe.close(() => accept(selected)); });
    });
    const { createServer } = await import(pathToFileURL(join(cwd, 'node_modules/vite/dist/node/index.js')));
    const generation = record => record ? `${record.revision}:${record.assets}` : null;
    let revision = generation(await readJSON(join(ctx.store, 'main-revision.json'), null));
    const journal = join(ctx.store, 'promotion.json');
    server = await createServer({ root: cwd, configFile: join(cwd, 'vite.config.ts'), server: { host: '127.0.0.1', port, strictPort: true }, plugins: [{
      name: 'lantern-owned-preview', enforce: 'pre',
      configureServer(vite) {
        vite.middlewares.use('/__agent-owner', (_request, response) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ token: options.token })); });
        vite.middlewares.use('/__level-owner', (_request, response) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ token: options.token })); });
        if (options.main) vite.middlewares.use(async (_request, response, next) => {
          for (let i = 0; existsSync(journal) && i < 100; i++) await new Promise(accept => setTimeout(accept, 100));
          if (existsSync(journal)) { response.statusCode = 503; response.setHeader('Retry-After', '1'); response.end('Integration recovery is pending.'); } else next();
        });
      },
      handleHotUpdate() { if (options.main && existsSync(journal)) return []; },
    }] });
    await server.listen();
    const url = `http://127.0.0.1:${server.httpServer.address().port}`;
    Object.assign(record, { url, status: 'serving', gpuLease: lease ? { token: lease.record.token, slot: lease.record.slot } : null });
    await writeJSON(sessionPath(cwd), record);
    if (options.author) await writeJSON(join(cwd, '.local/level-design/session.json'), record);
    if (options.browser) { browserOpened = true; await run('agent-browser', ['--session', session, '--headed', 'false', '--webgpu', 'open', `${url}/?area=${encodeURIComponent(options.area)}${options.author ? '&author=levels' : ''}`]); }
    record.ready = true; await writeJSON(sessionPath(cwd), record);
    if (options.author) await writeJSON(join(cwd, '.local/level-design/session.json'), record);
    if (options.main) timer = setInterval(async () => {
      const current = generation(await readJSON(join(ctx.store, 'main-revision.json'), null));
      if (current !== revision && !existsSync(journal)) { revision = current; server.moduleGraph.invalidateAll(); server.ws.send({ type: 'full-reload' }); }
    }, 500);
    console.log(`Owned preview ${url}; session ${session}`);
  } catch (error) { console.error(error); await close(); }
}
if (process.argv[2] === '--serve') await serve();
