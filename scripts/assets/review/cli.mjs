import { randomUUID } from 'node:crypto';
import { cli, parseArgs, root } from '../../lib/cli.mjs';
import { context, currentTask, tasks, saveTask } from '../../agents/state.mjs';
import { startTask, ensureDependencies, cleanupTask } from '../../agents/workflow.mjs';
import { startPreview, stopPreview } from '../../agents/preview.mjs';
import { reviewIndex, reviewBlockers, changedUses } from './index.mjs';
import { finishReview } from './store.mjs';
await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--check': 'boolean', '--report': 'boolean', '--shipping': 'boolean', '--base': 'value', '--finish': 'boolean', '--stop': 'boolean', '--task': 'value', '--browser': 'boolean' });
  if (args['--help']) { console.log('Usage: npm run assets:review -- [--task SLUG] [--browser] [--finish | --stop]\nRead-only: npm run assets:review:report\nEligibility: npm run assets:review:check -- [--base SHA | --shipping]'); return; }
  if (args['--check'] || args['--report'] || args['--shipping'] || args['--base']) {
    const index = await reviewIndex(root), issues = await reviewBlockers(index);
    if (args['--report']) {
      console.log(JSON.stringify({ blockers: issues, deletionRequests: Object.entries(index.reviews.decisions).filter(([id, row]) => row.state === 'delete-requested' && !index.reviews.deleted[id]).map(([id, decision]) => ({ id, ...decision, currentUrl: index.assets.find(row => row.id === id)?.url ?? decision.url, selected: index.assets.find(row => row.id === id)?.selected ?? false, dependencies: index.assets.find(row => row.id === id)?.dependencies ?? [], motions: index.assets.find(row => row.id === id)?.motions ?? {}, uses: index.assets.find(row => row.id === id)?.uses ?? [], dependents: index.assets.find(row => row.id === id)?.dependents ?? [] })), exclusions: index.reviews.deleted }, null, 2)); return;
    }
    const fresh = args['--shipping'] ? issues : (await changedUses(root, args['--base'] ?? 'HEAD')).issues;
    if (fresh.length) throw new Error(`Asset approval required:\n${fresh.map(issue => `${issue.name}: ${issue.state}${issue.changed ? ' (changed artwork)' : ''}\n  ${issue.id}\n  ${issue.uses.map(use => `${use.sceneName}/${use.owner} (${use.role})`).slice(0, 5).join(', ')}${issue.selected ? '\n  Build selection: remove if obsolete, or approve before shipping.' : ''}`).join('\n')}`);
    console.log('Asset review eligibility passed.'); return;
  }
  const ctx = await context(root), records = await tasks(ctx);
  let task = args['--task'] ? records.find(row => row.id === args['--task']) : root !== ctx.main ? await currentTask(ctx) : records.find(row => row.reviewSession && !['cleaned','integrated'].includes(row.status));
  if (args['--task'] && !task) throw new Error('Unknown review task. Inspect npm run agent:status.');
  if (args['--finish'] || args['--stop']) {
    if (!task?.reviewSession) throw new Error('Choose an active asset review session with --task SLUG.');
    if (args['--stop']) { await stopPreview(task.path); return; }
    const result = await finishReview(task.path); console.log(result.message);
    if (result.integrated) { await stopPreview(task.path); await cleanupTask(ctx, (await tasks(ctx)).find(record => record.id === task.id)); } return;
  }
  if (!task || ['cleaned','integrated'].includes(task.status)) {
    task = await startTask(ctx, `asset-review-${randomUUID().slice(0, 8)}`); task.reviewSession = true; await saveTask(ctx, task);
  }
  if (!task.reviewSession) throw new Error('This task owns other work. Start assets:review from main for a dedicated review session.');
  await ensureDependencies(task);
  const preview = await startPreview(task.path, { browser: !!args['--browser'], lab: 'assets' });
  console.log(`Asset Review: ${preview.url}/?lab=assets\nTask: ${task.id}\nDirectory: ${task.path}\nDecisions save here until Finish Review integrates them locally.`);
});
