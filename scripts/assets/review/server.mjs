import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { open } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { readReviews } from './index.mjs';
import { createReviewCache } from './cache.mjs';
import { readJSON, writeJSON } from '../../agents/state.mjs';
import { parseSettings } from '../../../src/rendering/graphics-settings.ts';
import { reviewOwner, reviewRevision, saveReview, finishReview } from './store.mjs';

export function assetReviewPlugin() {
  return { name: 'lantern-asset-review', configureServer(server) {
    const cwd = server.config.root, token = randomUUID(), cache = createReviewCache(cwd);
    let finishing = false;
    const json = (response, data, status = 200) => { response.statusCode = status; response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'no-store'); response.end(JSON.stringify(data)); };
    server.middlewares.use('/__asset-review', (request, response) => {
      void (async () => {
        const path = new URL(request.url ?? '/', 'http://localhost');
        if (request.method === 'GET' && path.pathname === '/') {
          const index = await cache.snapshot(), owner = await reviewOwner(cwd);
          json(response, { assets: index.assets, reviews: index.reviews, revision: reviewRevision(index.reviews), token,
            writable: owner.writable && !finishing, canFinish: owner.canFinish, task: owner.task?.id ?? null }); return;
        }
        if (request.method === 'GET' && path.pathname === '/asset') {
          json(response, await cache.asset(path.searchParams.get('id'))); return;
        }
        if (request.method === 'GET' && path.pathname === '/catalog') { json(response, await cache.catalog(path.searchParams.get('id'))); return; }
        if (request.method === 'GET' && path.pathname === '/graphics') { const owner = await reviewOwner(cwd); json(response, { main: cwd === owner.ctx.main, settings: await readJSON(resolve(owner.ctx.store, 'asset-review-graphics.json'), null), token }); return; }
        if (request.method === 'GET' && path.pathname === '/records') { const reviews = await readReviews(cwd); json(response, { reviews, revision: reviewRevision(reviews) }); return; }
        const address = request.socket.remoteAddress;
        if (request.method !== 'POST' || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address) || request.headers['x-lantern-review-token'] !== token
          || request.headers.origin !== `http://${request.headers.host}`) { json(response, { error: 'Review writes require the owned local session.' }, 403); return; }
        if (finishing) throw new Error('Finish Review is pending. Wait for its result.');
        if (path.pathname === '/finish') {
          finishing = true;
          try {
            const result = await finishReview(cwd); json(response, result);
            if (result.integrated) {
              const owner = await reviewOwner(cwd);
              const timer = setTimeout(() => {
                void open(resolve(cwd, '.local/agents/review-finish.log'), 'a').then(async log => {
                  const child = spawn(process.execPath, [resolve(cwd, 'scripts/assets/review/cli.mjs'), '--finish', '--task', owner.task.id], { cwd, detached: true, stdio: ['ignore', log.fd, log.fd] });
                  child.on('error', error => console.error('Review session cleanup failed:', error)); child.unref(); await log.close();
                }).catch(error => console.error('Review session cleanup failed:', error));
              }, 2500); timer.unref();
            }
          }
          finally { finishing = false; }
          return;
        }
        if (path.pathname === '/graphics') {
          const owner = await reviewOwner(cwd); if (cwd !== owner.ctx.main) throw new Error('Game graphics are published only by the main preview.');
          let body = ''; for await (const chunk of request) { body += chunk; if (body.length > 12000) throw new Error('Graphics profile too large.'); }
          await writeJSON(resolve(owner.ctx.store, 'asset-review-graphics.json'), parseSettings(JSON.parse(body), new URLSearchParams())); json(response, { saved: true }); return;
        }
        if (path.pathname !== '/decision') { json(response, { error: 'Unknown review action.' }, 404); return; }
        let body = ''; for await (const chunk of request) { body += chunk; if (body.length > 12000) throw new Error('Review action is too large.'); }
        const { revision, action } = JSON.parse(body);
        json(response, await saveReview(cwd, revision, action, cache));
      })().catch(error => json(response, { error: error.message }, error.status ?? 400));
    });
  } };
}
