import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { context, git, writeJSON, saveTask } from '../../agents/state.mjs';
import { startTask } from '../../agents/workflow.mjs';
import { reviewRevision, saveReview, finishReview } from './store.mjs';
import { createReviewCache } from './cache.mjs';
import { readReviews, reviewIndex, fingerprint, baseReviewAssets, reviewBlockers, deletionRequests } from './index.mjs';
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
  await writeJSON(join(directory, 'assets/material-recipes.json'), { dryHighlights: { roughnessStart: .45, roughnessEnd: .85, specularIntensity: .35 } });
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
    await writeJSON(join(f.task.path, 'assets/material-recipes.json'), { dryHighlights: { roughnessStart: .45, roughnessEnd: .85, specularIntensity: .4 } });
    const reshaded = (await reviewIndex(f.task.path)).assets[0];
    assert.equal(effectiveReview(reshaded, approved.reviews).changed, true, 'a shared highlight change invalidates original-asset approval');
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

test('base decisions cover current and future variants without losing deletion intent or stale-art protection', async () => {
  const f = await fixture();
  try {
    const id = 'fixture:assembly:tree', variant = { id, url: '/vendor/synty/library/assemblies/tree-painted.json' };
    const manifestPath = join(f.task.path, 'assets/textures/environment/manifest.json');
    await writeFile(join(f.task.path, 'public', variant.url.slice(1)), '{"nodes":[]}');
    await writeJSON(manifestPath, { assets: [variant], showcase: { assets: [] }, areaAssets: {} });
    const cache = createReviewCache(f.task.path), initial = await cache.snapshot(), base = await cache.asset(`${id}@original`);
    assert.equal(initial.assets.length, 1);
    assert.equal(initial.assets[0].variants, 1);
    let saved = await saveReview(f.task.path, reviewRevision(initial.reviews), { type: 'decision', id: `${id}@gameplay`, state: 'delete-requested', fingerprint: null, notes: 'Older variant request' }, cache);
    assert.equal(effectiveReview((await cache.snapshot()).assets[0], saved.reviews).state, 'delete-requested');
    const retained = saved.reviews.decisions[`${id}@gameplay`];
    saved = await saveReview(f.task.path, saved.revision, { type: 'decision', scope: 'family', id: base.id, state: 'approved', fingerprint: base.fingerprint, notes: 'Whole family' }, cache);
    assert.deepEqual(saved.reviews.decisions[`${id}@gameplay`], retained, 'the new family choice supersedes the older request without discarding its notes');
    let index = await reviewIndex(f.task.path);
    assert.deepEqual(index.assets.map(row => effectiveReview(row, saved.reviews).state), ['approved', 'approved']);
    assert.deepEqual(deletionRequests(index), []);
    const future = { id, url: '/vendor/synty/library/assemblies/tree-future.json' };
    await writeFile(join(f.task.path, 'public', future.url.slice(1)), '{"nodes":[]}');
    await writeJSON(manifestPath, { assets: [variant], showcase: { assets: [] }, areaAssets: { clearing: [future] } });
    index = await reviewIndex(f.task.path);
    assert.deepEqual(await reviewBlockers(index, index.assets), []);
    await writeFile(join(f.task.path, 'public', variant.url.slice(1)), '{"nodes":[{"name":"new material"}]}');
    index = await reviewIndex(f.task.path);
    assert.deepEqual(await reviewBlockers(index, index.assets), [], 'variant changes do not require independent approval');
    await writeFile(join(f.task.path, 'public', base.url.slice(1)), '{"nodes":[{"name":"changed source"}]}');
    index = await reviewIndex(f.task.path);
    assert.equal((await reviewBlockers(index, index.assets)).length, 3);
    await assert.rejects(saveReview(f.task.path, saved.revision, { type: 'decision', scope: 'family', id: base.id, state: 'approved', fingerprint: base.fingerprint, notes: '' }, cache), /changed or is unavailable/);
    saved = await saveReview(f.task.path, saved.revision, { type: 'decision', scope: 'family', id: base.id, state: 'denied', fingerprint: null, notes: 'Wrong shape' }, cache);
    assert.ok((await reviewIndex(f.task.path)).assets.every(row => effectiveReview(row, saved.reviews).state === 'denied'));
    saved = await saveReview(f.task.path, saved.revision, { type: 'decision', scope: 'family', id: base.id, state: 'delete-requested', fingerprint: null, notes: 'Retire family' }, cache);
    index = await reviewIndex(f.task.path);
    assert.deepEqual(deletionRequests(index).map(row => row.id).sort(), index.assets.map(row => row.id).sort());
    assert.equal(baseReviewAssets(index).length, 1);
    assert.equal(await readFile(join(f.task.path, 'public', future.url.slice(1)), 'utf8'), '{"nodes":[]}');
    saved = await saveReview(f.task.path, saved.revision, { type: 'decision', scope: 'family', id: base.id, state: 'unreviewed', fingerprint: null, notes: '' }, cache);
    assert.ok((await reviewIndex(f.task.path)).assets.every(row => effectiveReview(row, saved.reviews).state === 'unreviewed'));
  } finally { await f.dispose(); }
});

test('deleting a prepared variant retains its source while deleted originals still report broken scene uses', async () => {
  const f = await fixture();
  try {
    const source = '/vendor/synty/chest.glb', original = 'fixture:assembly:tree';
    await writeFile(join(f.task.path, 'public', source.slice(1)), 'retained source');
    await writeJSON(join(f.task.path, 'assets/playable-characters.json'), { player: { name: 'Player', model: '/vendor/player.glb', sourceId: 'fixture-player' } });
    await writeJSON(join(f.task.path, 'src/levels/areas/fixture.json'), {
      id: 'fixture', name: 'Fixture', props: [{ id: 'chest', asset: { url: source } }, { id: 'tree', asset: { libraryId: original } }],
      layout: { enemies: [] }, effects: { fires: [] },
    });
    const reviews = emptyReviews();
    reviews.deleted[`${source}@gameplay`] = { familyId: source, url: '/vendor/synty/environment/chest.glb', deletedAt: new Date().toISOString() };
    reviews.deleted[`${original}@original`] = { familyId: original, url: '/vendor/synty/library/assemblies/tree.json', deletedAt: new Date().toISOString() };
    await writeJSON(join(f.task.path, 'assets/asset-reviews.json'), reviews);
    await writeJSON(join(f.task.path, 'public/vendor/synty/library/catalog.json'), { version: 1, assets: {} });
    const index = await reviewIndex(f.task.path, { reviewed: false });
    const chest = index.assets.find(row => row.uses.some(use => use.owner === 'chest'));
    assert.equal(chest.id, `${source}@${source}`);
    assert.equal(chest.available, true);
    assert.deepEqual(chest.warnings, []);
    const tree = index.assets.find(row => row.uses.some(use => use.owner === 'tree'));
    assert.equal(tree.id, `${original}@original`);
    assert.equal(tree.available, false);
    assert.match(tree.warnings.join('\n'), /Deleted asset is still referenced/);
  } finally { await f.dispose(); }
});
