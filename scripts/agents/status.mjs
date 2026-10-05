import { join, basename } from 'node:path';
import { UsageError } from '../lib/cli.mjs';
import { tasks, taskCapacity, freeSpace, liveLeases, lastSuccessfulCheck, readJSON } from './state.mjs';
import { livePreview } from './preview.mjs';

export function selectTasks(records, { all = false, task } = {}) {
  if (all && task) throw new UsageError('Choose --all or --task, not both.');
  if (task && !records.some(record => record.id === task)) throw new UsageError(`Unknown task: ${task}`);
  return records.filter(record => task ? record.id === task : all || record.status !== 'cleaned').sort((a, b) => a.id.localeCompare(b.id));
}

export async function statusReport(ctx, options) {
  const records = await tasks(ctx);
  const selected = selectTasks(records, options);
  const views = await Promise.all(selected.map(async task => {
    const [preview, lastCheck] = task.status === 'cleaned' ? [null, null] : await Promise.all([livePreview(task.path), lastSuccessfulCheck(task.path)]);
    return {
      id: task.id, path: task.path, branch: task.branch, status: task.status,
      base: task.base, candidate: task.candidate, setupMs: task.setupMs,
      assetChanges: task.assetChangeCount ?? task.assetChanges?.length ?? 0, assetConflicts: task.assetConflicts,
      integratedAt: task.integratedAt, cleanedAt: task.cleanedAt,
      preview: preview ? { url: preview.url, session: preview.session, browser: preview.browser, author: preview.author } : null,
      lastCheck: lastCheck ?? task.lastCheck ?? null,
    };
  }));
  const [free, leases, promotion, capacity] = await Promise.all([
    freeSpace(ctx.main), liveLeases(ctx), readJSON(join(ctx.store, 'promotion.json'), null), taskCapacity(ctx, records),
  ]);
  return {
    main: ctx.main, currentTask: records.find(task => task.path === ctx.cwd && task.status !== 'cleaned')?.id ?? null,
    freeGiB: Number((free / 1024 ** 3).toFixed(1)), capacity,
    counts: { total: records.length, active: records.filter(task => task.status !== 'cleaned').length, cleaned: records.filter(task => task.status === 'cleaned').length },
    leases, promotion, tasks: views,
  };
}

export function formatStatus(report) {
  const lines = [
    `Main: ${report.main}`,
    `Worktrees: ${report.capacity.used}/${report.capacity.limit}; ${report.freeGiB} GiB free; ${report.counts.cleaned} cleaned tasks (use --all for history)`,
    `Current task: ${report.currentTask ?? '(main checkout)'}`,
    `Resources: ${report.leases.map(lease => `${lease.resource}: ${lease.task ? basename(lease.task) : 'unknown owner'} (PID ${lease.pid})`).join('; ') || 'none'}`,
    `Promotion: ${report.promotion ? `${report.promotion.task} @ ${report.promotion.candidate?.slice(0, 12) ?? 'pending'}` : 'none'}`,
  ];
  for (const task of report.tasks) {
    const check = task.lastCheck, revision = check?.revision ?? check?.inputs?.head;
    lines.push(`${task.id}${task.id === report.currentTask ? ' [current]' : ''}: ${task.status}; ${task.path}`);
    if (task.preview) lines.push(`  Preview: ${task.preview.url}`);
    if (check) lines.push(`  Last check: ${revision?.slice(0, 12) ?? 'unknown revision'}; ${check.evidenceExpiredAt ? 'evidence expired under retention policy' : check.evidence}`);
    if (task.assetConflicts?.length) lines.push(`  Asset conflicts: ${task.assetConflicts.length}; use --task ${task.id} --json for paths`);
  }
  if (!report.tasks.length) lines.push('No tasks in this view.');
  lines.push('Details: --json; one task: --task SLUG; complete history: --all --json');
  return lines.join('\n');
}
