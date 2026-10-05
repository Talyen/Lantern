import { resolve } from 'node:path';
import { cli, parseCommand, UsageError } from '../lib/cli.mjs';
import { context, currentTask, readJSON, readTask, freeSpace } from './state.mjs';
import { startTask, finishTask, cleanupTask, prepareSources, ensureDependencies, recover } from './workflow.mjs';
import { startPreview, stopPreview } from './preview.mjs';
import { withResource } from './resources.mjs';
import { statusReport, formatStatus } from './status.mjs';
import { previewViewport } from './viewport.mjs';
import { capturePreview } from './capture.mjs';
import { pruneRetention } from './retention.mjs';
await cli(async () => {
  const options = {
    start: { '--task': 'value', '--no-wait': 'boolean' },
    dev: { '--task': 'value', '--browser': 'boolean', '--author': 'boolean', '--area': 'value', '--stop': 'boolean', '--lab': 'value', '--viewport': 'value', '--dpr': 'value' },
    finish: { '--task': 'value', '--paths': 'value', '--message': 'value', '--resolved-assets': 'value' },
    sources: { '--task': 'value', '--sources': 'value' },
    status: { '--all': 'boolean', '--task': 'value', '--json': 'boolean' }, cleanup: { '--task': 'value' }, main: { '--stop': 'boolean', '--browser': 'boolean', '--viewport': 'value', '--dpr': 'value' },
    capture: { '--task': 'value', '--output': 'value' },
    prune: { '--apply': 'boolean', '--sources': 'boolean' },
  };
  const { command: operation, args } = parseCommand(process.argv.slice(2), options);
  if (args['--help']) { console.log('Agent workflow: start --task SLUG [--no-wait]; dev [--browser] [--author] [--area ID] [--lab ID] [--viewport WIDTHxHEIGHT] [--dpr NUMBER] [--stop]; finish [--paths JSON_FILE] [--message TEXT] [--resolved-assets JSON_FILE]; sources --sources animation-packs,synty-library; status [--all | --task SLUG] [--json]; cleanup [--task SLUG]; main [--browser] [--viewport WIDTHxHEIGHT] [--dpr NUMBER] [--stop]; capture --output PNG; prune [--apply] [--sources].'); return; }
  if (operation === 'start' && !args['--task']) throw new UsageError('agent:start requires --task SLUG.');
  const viewportOptions = { viewport: args['--viewport'], dpr: args['--dpr'] };
  if (operation === 'dev' || operation === 'main') {
    previewViewport(viewportOptions.viewport, viewportOptions.dpr);
    if ((viewportOptions.viewport !== undefined || viewportOptions.dpr !== undefined) && (!args['--browser'] || args['--stop'])) throw new UsageError('Viewport overrides require --browser without --stop.');
  }
  if (operation === 'capture' && !args['--output']) throw new UsageError('agent:capture requires --output PNG.');
  const ctx = await context();
  if (operation === 'prune') {
    const report = await pruneRetention(ctx, { apply: !!args['--apply'], sources: !!args['--sources'], progress: message => console.error(message) });
    console.log(JSON.stringify(report, null, 2));
    if (args['--apply'] && report.errors.length) throw new Error(`Pruning preserved ${report.errors.length} unresolved entries; inspect the report and retry after repair.`);
  } else if (operation === 'start') {
    const task = await startTask(ctx, args['--task'], { wait: !args['--no-wait'] });
    await ensureDependencies(task);
    console.log(`Task ${task.id}\nDirectory: ${task.path}\nSetup: ${task.setupMs} ms; available disk ${(await freeSpace(ctx.main) / 1024 ** 3).toFixed(1)} GiB (clone directory sizes are logical).`);
  } else if (operation === 'status') {
    const report = await statusReport(ctx, { all: !!args['--all'], task: args['--task'] });
    console.log(args['--json'] ? JSON.stringify(report, null, 2) : formatStatus(report));
  } else if (operation === 'main') {
    await withResource('promotion', async () => {
      await recover(ctx);
      if (!args['--stop']) await ensureDependencies({ path: ctx.main });
    }, { ctx });
    if (args['--stop']) await stopPreview(ctx.main);
    else console.log((await startPreview(ctx.main, { main: true, browser: !!args['--browser'], ...viewportOptions })).url);
  } else {
    const task = args['--task'] ? await readTask(ctx, args['--task']) : await currentTask(ctx);
    if (!task) throw new Error('Unknown task');
    if (operation === 'dev') {
      if (args['--stop']) await stopPreview(task.path);
      else { await ensureDependencies(task); const record = await startPreview(task.path, { browser: !!args['--browser'], author: !!args['--author'], area: args['--area'] ?? 'clearing', lab: args['--lab'] ?? null, ...viewportOptions }); console.log(`${record.url}\nBrowser session: ${record.session}`); }
    } else if (operation === 'capture') {
      console.log(await capturePreview(task.path, resolve(process.cwd(), args['--output'])));
    } else if (operation === 'finish') {
      await stopPreview(task.path);
      await finishTask(ctx, task, { paths: args['--paths'] ? await readJSON(resolve(process.cwd(), args['--paths'])) : [], message: args['--message'], resolvedAssets: args['--resolved-assets'] ? await readJSON(resolve(process.cwd(), args['--resolved-assets'])) : [] });
    } else if (operation === 'sources') {
      await prepareSources(ctx, task, (args['--sources'] ?? '').split(','));
    } else if (operation === 'cleanup') {
      await cleanupTask(ctx, task);
    } else throw new Error(`Unknown agent operation: ${operation}`);
  }
});
