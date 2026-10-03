import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { context, git, writeJSON, saveTask } from '../../agents/state.mjs';
import { startTask } from '../../agents/workflow.mjs';
import { reviewRevision, saveReview, finishReview } from './store.mjs';
import { createReviewCache } from './cache.mjs';
import { readReviews, reviewIndex, fingerprint } from './index.mjs';
import { emptyReviews, effectiveReview } from '../../../src/assets/asset-review.ts';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'lantern-asset-review-'));
  await git(['init', '-b', 'main', directory]); await git(['config', 'user.name', 'Review fixture'], directory); await git(['config', 'user.email', 'review@example.invalid'], directory);
  for (const name of ['assets/textures/environment', 'src/levels/areas', 'scripts', 'node_modules', 'public/vendor/synty/library/assemblies']) await mkdir(join(directory, name), { recursive: true });
  await writeFile(join(directory, 'src/levels/areas/.gitkeep'), '');
  await writeFile(join(directory, '.gitignore'), '.local/\nnode_modules/\npublic/vendor/\n');
  await writeJSON(join(directory, 'package.json'), { name: 'review-fixture', version: '0.0.0', private: true });
  await writeJSON(join(directory, 'package-lock.json'), { name: 'review-fixture', version: '0.0.0', lockfileVersion: 3, packages: { '': { name: 'review-fixture', version: '0.0.0' } } });
  await writeJSON(join(directory, 'assets/asset-reviews.json'), emptyReviews());
  await writeJSON(join(directory, 'assets/library-selection.json'), []);
  await writeJSON(join(directory, 'assets/playable-characters.json'), {});
  await writeJSON(join(directory, 'assets/textures/environment/manifest.json'), { assets: [], showcase: { assets: [] }, areaAssets: {} });
  await writeFile(join(directory, 'scripts/check.mjs'), "if(process.env.LANTERN_REVIEW_FIXTURE_FAIL==='1')process.exit(1);\n");
  const model = { id: 'fixture:assembly:tree', name: 'Tree', pack: 'fixture', kind: 'assembly', status: 'converted', url: '/vendor/synty/library/assemblies/tree.json', dependencies: [], warnings: [] };
  await writeJSON(join(directory, 'public/vendor/synty/library/catalog.json'), { version: 1, assets: { [model.id]: model } });
  await writeFile(join(directory, 'public/vendor/synty/library/assemblies/tree.json'), '{"nodes":[]}');
  await git(['add', '.'], directory); await git(['commit', '-m', 'fixture'], directory);
  const ctx = await context(directory), task = await startTask(ctx, 'review'); task.reviewSession = true; await saveTask(ctx, task);
  return { ctx, task, dispose: () => rm(directory, { recursive: true, force: true }) };
}
test('stale tabs cannot overwrite a saved deletion request or touch prepared files', async () => {
  const f = await fixture();
  try {
    const initial = await readReviews(f.task.path), revision = reviewRevision(initial), index = await reviewIndex(f.task.path), asset = index.assets[0];
    const path = join(f.task.path, 'public', asset.url.slice(1)), before = await readFile(path);
    const result = await saveReview(f.task.path, revision, { type: 'decision', id: asset.id, state: 'delete-requested', notes: 'Retire this tree', fingerprint: null });
    await assert.rejects(saveReview(f.task.path, revision, { type: 'decision', id: asset.id, state: 'approved', notes: 'Stale tab', fingerprint: await fingerprint(index, asset) }), /changed in another tab/);
    assert.deepEqual(await readReviews(f.task.path), result.reviews); assert.deepEqual(await readFile(path), before);
    assert.equal((await readReviews(f.ctx.main)).decisions[asset.id], undefined);
  } finally { await f.dispose(); }
});
test('failed Finish Review retains decisions for retry and never integrates unrelated work', async () => {
  const f = await fixture(), oldEnvironment = process.env.LANTERN_REVIEW_FIXTURE_FAIL;
  try {
    const initial = await readReviews(f.task.path), asset = (await reviewIndex(f.task.path)).assets[0];
    await saveReview(f.task.path, reviewRevision(initial), { type: 'decision', id: asset.id, state: 'denied', notes: 'Wrong silhouette', fingerprint: null });
    process.env.LANTERN_REVIEW_FIXTURE_FAIL = '1'; await assert.rejects(finishReview(f.task.path), /failed/);
    assert.equal((await readReviews(f.task.path)).decisions[asset.id].state, 'denied'); assert.equal((await readReviews(f.ctx.main)).decisions[asset.id], undefined);
    delete process.env.LANTERN_REVIEW_FIXTURE_FAIL;
    await writeFile(join(f.task.path, 'unrelated.txt'), 'Preserve this work'); await assert.rejects(finishReview(f.task.path), /Other task changes/);
    assert.equal(await readFile(join(f.task.path, 'unrelated.txt'), 'utf8'), 'Preserve this work');
    await rm(join(f.task.path, 'unrelated.txt'));
    assert.equal((await finishReview(f.task.path)).integrated, true); assert.equal((await readReviews(f.ctx.main)).decisions[asset.id].state, 'denied');
  } finally { if (oldEnvironment === undefined) delete process.env.LANTERN_REVIEW_FIXTURE_FAIL; else process.env.LANTERN_REVIEW_FIXTURE_FAIL = oldEnvironment; await f.dispose(); }
});
test('changed appearances need fresh approval while family denial and deletion requests survive reexports', async () => {
  const f = await fixture();
  try {
    const index = await reviewIndex(f.task.path), asset = index.assets[0], initial = await readReviews(f.task.path);
    const approved = await saveReview(f.task.path, reviewRevision(initial), { type: 'decision', id: asset.id, state: 'approved', notes: '', fingerprint: await fingerprint(index, asset) });
    await writeFile(join(f.task.path, 'public', asset.url.slice(1)), '{"nodes":[{"name":"changed"}]}');
    const changed = (await reviewIndex(f.task.path)).assets[0]; assert.equal(effectiveReview(changed, approved.reviews).changed, true);
    const denied = await saveReview(f.task.path, approved.revision, { type: 'family-deny', id: asset.id, notes: 'Retire all appearances' });
    assert.equal(effectiveReview(changed, denied.reviews).state, 'denied');
    const marked = await saveReview(f.task.path, denied.revision, { type: 'decision', id: asset.id, state: 'delete-requested', notes: '', fingerprint: null });
    delete marked.reviews.familyDenials[asset.familyId]; assert.equal(effectiveReview(changed, marked.reviews).state, 'delete-requested');
  } finally { await f.dispose(); }
});

test('cached previews reject stale approval after a reexport with the same ID and URL', async () => {
  const f = await fixture();
  try {
    const cache = createReviewCache(f.task.path), index = await cache.get(), id = index.assets[0].id;
    const first = await cache.asset(id), repeated = await cache.asset(id);
    assert.equal(repeated.fingerprint, first.fingerprint);
    const initial = await readReviews(f.task.path);
    const approved = await saveReview(f.task.path, reviewRevision(initial), { type: 'decision', id, state: 'approved', notes: '', fingerprint: first.fingerprint }, cache);
    await writeFile(join(f.task.path, 'public', first.url.slice(1)), '{"nodes":[{"name":"changed cached asset"}]}');
    const changed = await cache.asset(id); assert.notEqual(changed.fingerprint, first.fingerprint);
    await assert.rejects(saveReview(f.task.path, approved.revision, { type: 'decision', id, state: 'approved', notes: '', fingerprint: first.fingerprint }, cache), /changed or is unavailable/);
    assert.equal(effectiveReview(changed, (await cache.get()).reviews).changed, true);
    const current = await readReviews(f.task.path); current.familyDenials[first.familyId] = { notes: 'Retired family', updatedAt: new Date().toISOString() };
    await writeJSON(join(f.task.path, 'assets/asset-reviews.json'), current);
    assert.equal(effectiveReview(changed, (await cache.get()).reviews).state, 'denied');
  } finally { await f.dispose(); }
});
