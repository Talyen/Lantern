import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { root } from '../lib/cli.mjs';
import { readFile, rm } from 'node:fs/promises';

const execute = promisify(execFile);
export const viewportExpression = '({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})';

// Attach only to the verified preview; CLI evaluation resets emulated DPR between calls.
export async function ownedBrowser(state) {
  const owner = await fetch(`${state.url}/__agent-owner`, { signal: AbortSignal.timeout(3000) }).then(response => response.json());
  if (owner.token !== state.token || state.session !== `lantern-level-${state.token}`) throw new Error('Preview ownership mismatch');
  const { stdout } = await execute('agent-browser', ['--session', state.session, '--headed', 'false', 'get', 'cdp-url'], { cwd: root, timeout: 30000 });
  const url = stdout.trim();
  if (!/^ws:\/\/127\.0\.0\.1:\d+\//.test(url)) throw new Error('Invalid owned browser CDP address');
  const socket = new WebSocket(url), pending = new Map(); let id = 0;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { socket.close(); reject(new Error('Browser connection timed out')); }, 3000);
    socket.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Browser connection failed')); }, { once: true });
  });
  function fail(error) { for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); } pending.clear(); }
  socket.addEventListener('close', () => fail(new Error('Owned browser disconnected')));
  socket.addEventListener('error', () => fail(new Error('Owned browser failed')));
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data), request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.resolve(message.result);
  });
  const send = (method, params = {}, sessionId, timeout = 30000) => new Promise((resolve, reject) => {
    const next = ++id, timer = setTimeout(() => { pending.delete(next); reject(new Error(`${method} timed out`)); }, timeout);
    pending.set(next, { resolve, reject, timer });
    socket.send(JSON.stringify({ id: next, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  try {
    const { targetInfos } = await send('Target.getTargets');
    const targets = targetInfos.filter(target => target.type === 'page' && target.url.startsWith(state.url + '/'));
    if (targets.length !== 1) throw new Error('Expected one page in the owned preview');
    const { sessionId } = await send('Target.attachToTarget', { targetId: targets[0].targetId, flatten: true });
    return {
      async evaluate(expression) {
        const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
        return result.result.value;
      },
      async screenshot() {
        // Native capture retains the daemon's configured density. A fresh CDP
        // Page agent can capture at 1x despite another agent's emulation.
        const expected = await this.evaluate('location.href');
        const currentURL = async () => (await execute('agent-browser', ['--session', state.session, '--headed', 'false', 'get', 'url'], { cwd: root, timeout: 30000 })).stdout.trim();
        if (await currentURL() !== expected) throw new Error('The browser active page differs from the inspected preview.');
        const { stdout } = await execute('agent-browser', ['--session', state.session, '--headed', 'false', '--json', 'screenshot', '--screenshot-format', 'png'], { cwd: root, timeout: 30000 });
        const result = JSON.parse(stdout);
        if (!result.success || !result.data?.path) throw new Error(result.error ?? 'Native screenshot failed.');
        try {
          if (await currentURL() !== expected) throw new Error('The browser active page changed during capture.');
          return { data: (await readFile(result.data.path)).toString('base64') };
        } finally { await rm(result.data.path); }
      },
      viewport: (width, height, dpr) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: false }, sessionId),
      async close() { try { await send('Target.detachFromTarget', { sessionId }); } finally { socket.close(); } },
    };
  } catch (error) { socket.close(); throw error; }
}
