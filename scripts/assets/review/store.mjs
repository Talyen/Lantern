import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { readReviews, reviewsPath, reviewIndex, fingerprint } from './index.mjs';
import { context, currentTask, git, writeJSON } from '../../agents/state.mjs';
import { withResource } from '../../agents/resources.mjs';
import { assetIndex, assetIdentity } from '../../agents/assets.mjs';
import { finishTask } from '../../agents/workflow.mjs';
import { reviewStates, parseReviews } from '../../../src/assets/asset-review.ts';

export const reviewRevision = reviews => createHash('sha256').update(JSON.stringify(reviews)).digest('hex');
export async function reviewOwner(cwd) {
  const ctx = await context(cwd);
  const task = await currentTask(ctx).catch(() => null);
  return { ctx, task, writable: !!task && ['working', 'needs-check-repair'].includes(task.status), canFinish: !!task?.reviewSession };
}
/** CAS and serialization prevent a stale tab overwriting another reviewer's saved decisions. */
export async function saveReview(cwd, revision, action) {
  const owner = await reviewOwner(cwd);
  if (!owner.writable) throw new Error('Read-only checkout. Start npm run assets:review for a writable session.');
  return withResource(`review-${owner.task.id}`, async () => {
    if (!(await reviewOwner(cwd)).writable) throw new Error('This review session is no longer writable.');
    const reviews = await readReviews(cwd);
    if (reviewRevision(reviews) !== revision) throw Object.assign(new Error('Review records changed in another tab. Reload records before saving; your notes are still here.'), { status: 409 });
    if (!action || typeof action.id !== 'string' || typeof action.notes !== 'string' || action.notes.length > 4000) throw new Error('Invalid review action.');
    const index = await reviewIndex(cwd, { reviewed: false }), asset = index.assets.find(row => row.id === action.id);
    if (!asset) throw new Error('Asset is no longer in the active catalog. Reload the review session.');
    const updatedAt = new Date().toISOString();
    if (action.type === 'decision') {
      if (!reviewStates.includes(action.state)) throw new Error('Invalid review decision.');
      const current = await fingerprint(index, asset);
      if (action.state === 'approved' && (!asset.available || !current || current !== action.fingerprint)) throw Object.assign(new Error('Prepared art changed or is unavailable. Reload this asset before approving.'), { status: 409 });
      if (action.state === 'approved' && reviews.familyDenials[asset.familyId]) throw new Error('Clear the family denial before approving this appearance.');
      reviews.decisions[asset.id] = { familyId: asset.familyId, url: asset.url, name: asset.name, state: action.state, fingerprint: current, notes: action.notes, updatedAt };
    } else if (action.type === 'family-deny') reviews.familyDenials[asset.familyId] = { notes: action.notes, updatedAt };
    else if (action.type === 'family-clear') delete reviews.familyDenials[asset.familyId];
    else throw new Error('Unknown review action.');
    parseReviews(reviews); await writeJSON(reviewsPath(cwd), reviews);
    return { reviews, revision: reviewRevision(reviews) };
  }, { ctx: owner.ctx, cwd });
}
/** Only a dedicated session's review records are eligible for automatic local integration. */
export async function finishReview(cwd) {
  const owner = await reviewOwner(cwd);
  if (!owner.task) throw new Error('No review task owns this checkout.');
  return withResource(`review-${owner.task.id}`, () => finishLocked(cwd), { ctx: owner.ctx, cwd });
}
async function finishLocked(cwd) {
  const { ctx, task, canFinish } = await reviewOwner(cwd);
  if (task?.status === 'integrated' && canFinish) return { integrated: true, message: 'Review decisions integrated locally. This session is complete.' };
  if (!canFinish) throw new Error('Finish Review is available only in a dedicated assets:review session.');
  const changed = (await git(['status', '--porcelain', '-z'], cwd)).split('\0').filter(Boolean);
  if (changed.some(line => line.slice(3) !== 'assets/asset-reviews.json')) throw new Error('Other task changes are present. Preserve them and ask an agent to review the handoff.');
  if (await git(['diff', '--cached', '--name-only'], cwd)) throw new Error('Staged task changes are present. Ask an agent to inspect them before handoff.');
  if (assetIdentity(await assetIndex(resolve(cwd, 'public/vendor'))) !== assetIdentity(task.assetIndex)) throw new Error('Prepared assets changed in this review session. Ask an agent to inspect them before handoff.');
  await readReviews(cwd);
  // Reject unrelated commits too, including a manually committed change with a now-clean checkout.
  const paths = (await git(['diff', '--name-only', `${task.base}...HEAD`], cwd)).split('\n').filter(Boolean);
  if (paths.some(path => path !== 'assets/asset-reviews.json')) throw new Error('The session contains other committed work. Ask an agent to inspect the handoff.');
  if (!changed.length && !paths.length) return { integrated: false, message: 'No review decisions to integrate.' };
  await finishTask(ctx, task, { paths: ['assets/asset-reviews.json'], message: 'art: save asset review decisions' });
  return { integrated: true, message: 'Review decisions integrated locally. This session is complete.' };
}
export async function exclusionRecords(cwd) { return parseReviews(JSON.parse(await readFile(reviewsPath(cwd), 'utf8'))).deleted; }
