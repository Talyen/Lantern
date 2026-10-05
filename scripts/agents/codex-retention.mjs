import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join, resolve, sep } from 'node:path';
import { readJSON } from './state.mjs';

const sourceKinds = ['cli', 'vscode', 'exec', 'appServer', 'subAgent', 'subAgentReview', 'subAgentCompact', 'subAgentThreadSpawn', 'subAgentOther', 'unknown'];
const belongs = (main, thread) => {
  if (!thread.cwd) return false;
  const cwd = resolve(thread.cwd), root = resolve(main);
  return cwd === root || cwd.startsWith(join(root, '.local/worktrees') + sep);
};
const pinned = thread => thread.isPinned || thread.extra?.isPinned || thread.section?.id === 'pinned' || thread.section?.kind === 'pinned';

/** The existing app server owns deletion and UI notifications, never a database editor. */
export async function codexConnection() {
  const args = ['app-server', 'proxy'];
  if (process.env.LANTERN_CODEX_SOCKET) args.push('--sock', process.env.LANTERN_CODEX_SOCKET);
  const child = spawn('codex', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let sequence = 0, stderr = '', closed = false;
  const fail = error => { closed = true; for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); } pending.clear(); };
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-2000); });
  child.on('error', fail);
  child.on('exit', () => fail(new Error(`Existing Codex control interface unavailable: ${stderr.trim() || 'proxy exited'}`)));
  createInterface({ input: child.stdout }).on('line', line => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
  });
  const call = (method, params = {}) => new Promise((accept, reject) => {
    if (closed) { reject(new Error(`Existing Codex control interface unavailable: ${stderr.trim()}`)); return; }
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Codex request timed out: ${method}`)); }, 10000);
    pending.set(id, { resolve: accept, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n', error => { if (error) fail(error); });
  });
  const close = () => { fail(new Error('Codex cleanup connection closed')); child.stdin.end(); child.kill(); };
  try {
    await call('initialize', { clientInfo: { name: 'lantern_retention', title: 'Lantern cleanup', version: '1' }, capabilities: { experimentalApi: true } });
    child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    return { call, close };
  } catch (error) { close(); throw error; }
}

async function list(connection, archived, filter = {}) {
  const threads = [];
  let cursor;
  do {
    const page = await connection.call('thread/list', { archived, sourceKinds, useStateDbOnly: true, limit: 100, ...filter, ...(cursor ? { cursor } : {}) });
    threads.push(...page.data.map(thread => ({ ...thread, archived })));
    if (page.nextCursor === cursor && cursor) throw new Error('Codex pagination did not advance.');
    cursor = page.nextCursor;
  } while (cursor);
  return threads;
}

/** Keep an entire deletion tree if any descendant is open, loaded, pinned or unrelated. */
export function selectCodexThreads(main, threads, loaded = [], pins = {}) {
  const records = new Map(threads.map(thread => [thread.id, thread]));
  const live = new Set(loaded), eligible = [], protectedThreads = [];
  const reason = thread => thread.ephemeral ? 'ephemeral conversation' : !belongs(main, thread) ? 'another project' : !thread.archived ? 'open conversation'
    : live.has(thread.id) || thread.status?.type === 'active' ? 'loaded or running conversation'
    : pinned(thread) ? 'pinned conversation' : pins[thread.id] ? 'unresolved evidence: ' + pins[thread.id].reason : null;
  const descendants = id => {
    const ids = new Set([id]);
    for (let changed = true; changed;) {
      changed = false;
      for (const thread of records.values()) if (ids.has(thread.parentThreadId) && !ids.has(thread.id)) { ids.add(thread.id); changed = true; }
    }
    return [...ids].map(id => records.get(id));
  };
  for (const thread of records.values()) {
    if (!belongs(main, thread)) continue;
    const tree = descendants(thread.id), blocked = tree.find(item => reason(item));
    if (blocked) protectedThreads.push({ id: thread.id, reason: reason(blocked), blockingThread: blocked.id });
    else eligible.push({ id: thread.id, title: thread.name || thread.preview || thread.id, descendants: tree.slice(1).map(item => item.id) });
  }
  const candidates = new Set(eligible.map(thread => thread.id));
  return { eligible: eligible.filter(thread => !candidates.has(records.get(thread.id).parentThreadId)), protected: protectedThreads };
}

export async function pruneCodex(ctx, { apply = false, connect = codexConnection } = {}) {
  const report = { apply, eligible: [], removed: [], protected: [], errors: [] };
  let connection;
  try {
    const pins = await readJSON(join(ctx.main, '.local/agents/codex-pins.json'), {});
    for (const value of Object.values(pins)) if (!value?.reason || !value?.owner) throw new Error('Codex evidence pins require a reason and current owner.');
    connection = await connect();
    const threads = [...await list(connection, true), ...await list(connection, false)];
    const loaded = (await connection.call('thread/loaded/list')).data;
    Object.assign(report, selectCodexThreads(ctx.main, threads, loaded, pins));
    if (apply) for (const candidate of report.eligible) {
      // Recheck the root and both archived/open descendants immediately before cascade deletion.
      const roots = await list(connection, true, { cwd: threads.find(thread => thread.id === candidate.id).cwd });
      const root = roots.find(thread => thread.id === candidate.id);
      if (!root) { report.protected.push({ id: candidate.id, reason: 'conversation is no longer archived' }); continue; }
      const tree = [root, ...await list(connection, true, { ancestorThreadId: root.id }), ...await list(connection, false, { ancestorThreadId: root.id })];
      const currentPins = await readJSON(join(ctx.main, '.local/agents/codex-pins.json'), {});
      const current = selectCodexThreads(ctx.main, tree, (await connection.call('thread/loaded/list')).data, currentPins);
      if (!current.eligible.some(thread => thread.id === root.id)) { report.protected.push(...current.protected); continue; }
      try {
        await connection.call('thread/delete', { threadId: root.id });
        report.removed.push({ id: root.id, descendants: tree.slice(1).map(thread => thread.id) });
      } catch (error) { report.errors.push({ id: root.id, message: error.message }); }
    }
  } catch (error) { report.errors.push({ message: error.message }); }
  finally { connection?.close(); }
  return report;
}
