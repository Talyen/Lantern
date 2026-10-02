import { resolve, join } from 'node:path';
import { cli, parseArgs, UsageError } from '../lib/cli.mjs';
import { context, currentTask, readJSON, tasks, freeSpace, liveLeases, lastSuccessfulCheck } from './state.mjs';
import { startTask, finishTask, cleanupTask, prepareSources, ensureDependencies, recover } from './workflow.mjs';
import { startPreview, stopPreview, livePreview } from './preview.mjs';
import { withResource } from './resources.mjs';
await cli(async () => {
  const operation = process.argv[2];
  const options = {
    start: { '--task': 'value' },
    dev: { '--task': 'value', '--browser': 'boolean', '--author': 'boolean', '--area': 'value', '--stop': 'boolean' },
    finish: { '--task': 'value', '--paths': 'value', '--message': 'value', '--resolved-assets': 'value' },
    sources: { '--task': 'value', '--sources': 'value' },
    status: {}, cleanup: { '--task': 'value' }, main: { '--stop': 'boolean', '--browser': 'boolean' },
  };
  if (!options[operation]) throw new UsageError(`Unknown agent operation: ${operation}`);
  const args = parseArgs(process.argv.slice(3), options[operation]);
  if (args['--help']) { console.log('Agent workflow: start --task SLUG; dev [--browser] [--author] [--area ID] [--stop]; finish [--paths JSON_FILE] [--message TEXT] [--resolved-assets JSON_FILE]; sources --sources animation-packs,synty-library; status; cleanup [--task SLUG]; main [--stop].'); return; }
  if (operation === 'start' && !args['--task']) throw new UsageError('agent:start requires --task SLUG.');
  const ctx = await context();
  if (operation === 'start') {
    const task = await startTask(ctx, args['--task']);
    await ensureDependencies(task);
    console.log(`Task ${task.id}\nDirectory: ${task.path}\nSetup: ${task.setupMs} ms; available disk ${(await freeSpace(ctx.main) / 1024 ** 3).toFixed(1)} GiB (clone directory sizes are logical).`);
  } else if (operation === 'status') {
    const records = await tasks(ctx);
    const views = await Promise.all(records.map(async task => {
      const [preview, lastCheck] = await Promise.all([livePreview(task.path), lastSuccessfulCheck(task.path)]);
      return {
        id: task.id, path: task.path, branch: task.branch, status: task.status,
        base: task.base, candidate: task.candidate, setupMs: task.setupMs,
        assetChanges: task.assetChanges?.length ?? 0, assetConflicts: task.assetConflicts,
        integratedAt: task.integratedAt, cleanedAt: task.cleanedAt,
        preview: preview ? { url: preview.url, session: preview.session, browser: preview.browser, author: preview.author } : null,
        lastCheck: lastCheck ?? task.lastCheck ?? null,
      };
    }));
    const [free, leases, promotion] = await Promise.all([freeSpace(ctx.main), liveLeases(ctx), readJSON(join(ctx.store, 'promotion.json'), null)]);
    console.log(JSON.stringify({ main: ctx.main, freeGiB: Number((free / 1024 ** 3).toFixed(1)), leases, promotion, tasks: views }, null, 2));
  } else if (operation === 'main') {
    await withResource('promotion', () => recover(ctx), { ctx });
    if (args['--stop']) await stopPreview(ctx.main);
    else console.log((await startPreview(ctx.main, { main: true, browser: !!args['--browser'] })).url);
  } else {
    const task = args['--task'] ? (await tasks(ctx)).find(task => task.id === args['--task']) : await currentTask(ctx);
    if (!task) throw new Error('Unknown task');
    if (operation === 'dev') {
      if (args['--stop']) await stopPreview(task.path);
      else { await ensureDependencies(task); const record = await startPreview(task.path, { browser: !!args['--browser'], author: !!args['--author'], area: args['--area'] ?? 'clearing' }); console.log(`${record.url}\nBrowser session: ${record.session}`); }
    } else if (operation === 'finish') {
      await stopPreview(task.path);
      await finishTask(ctx, task, { paths: args['--paths'] ? await readJSON(resolve(process.cwd(), args['--paths'])) : [], message: args['--message'], resolvedAssets: args['--resolved-assets'] ? await readJSON(resolve(process.cwd(), args['--resolved-assets'])) : [] });
    } else if (operation === 'sources') {
      await prepareSources(ctx, task, (args['--sources'] ?? '').split(','));
    } else if (operation === 'cleanup') {
      await stopPreview(task.path); await cleanupTask(ctx, task);
    } else throw new Error(`Unknown agent operation: ${operation}`);
  }
});
