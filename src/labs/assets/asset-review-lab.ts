import { parseJson, isRecord } from '../../data/json';
import { parseReviewSnapshot, parseReviews, effectiveReview, stateLabel, reviewCategories, reviewStates, type ReviewAsset, type ReviewAction, type ReviewSnapshot, type ReviewState } from '../../assets/asset-review';
import { ReviewStage } from './review-stage';
import '../../ui/ui-tokens.css';
import './asset-review-lab.css';

document.title = 'Lantern — Asset Review';
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `<main class="asset-review">
  <header class="review-header"><a href="/" aria-label="Return to game">← Lantern</a><button id="asset-browser-toggle" aria-controls="review-browser-panel" aria-expanded="false" hidden>Assets</button><h1>Asset Review</h1><span id="review-session"></span><button id="review-finish">Finish Review</button></header>
  <div class="review-layout"><aside class="review-browser" id="review-browser-panel"><button id="asset-browser-close" class="review-browser-dismiss">Close assets</button>
    <nav class="review-tabs" aria-label="Review mode"><button id="mode-queue" aria-pressed="true">Review Queue</button><button id="mode-browse" aria-pressed="false">Browse</button></nav>
    <label>Search<input id="review-search" type="search" placeholder="Name or asset ID"></label>
    <div class="review-filter-pair"><label>Category<select id="review-category"><option value="all">All categories</option></select></label><label>Pack<select id="review-pack"><option value="all">All packs</option></select></label></div>
    <div class="review-filter-pair"><label class="usage-filter">Usage<select id="review-usage"><option value="all">Any usage</option><option value="used">Used anywhere</option><option value="unused">Unused</option><option value="selected">Build selected</option></select></label><label id="status-filter">Status<select id="review-state"><option value="all">All decisions</option></select></label></div>
    <label class="review-checkbox"><input id="review-meshes" type="checkbox">Include component meshes</label>
    <div class="review-count"><strong id="review-count">Loading catalog…</strong><button id="review-reload" title="Reload catalog and decisions">Reload</button></div>
    <div id="review-list" class="review-list" aria-label="Assets"></div><button id="review-more" hidden>Show more</button>
  </aside>
  <section class="review-preview" aria-label="Asset preview">
    <div class="review-identity"><p id="asset-pack" class="review-eyebrow"></p><h2 id="asset-name">Loading assets…</h2><p id="asset-appearance"></p></div>
    <div id="review-stage" class="review-stage"><p id="stage-status" role="status">Preparing native WebGPU…</p></div>
    <div class="review-preview-controls"><label>View<select id="asset-view"><option value="gameplay">Gameplay angle</option><option value="front">Front</option><option value="side">Side</option><option value="back">Back</option></select></label><button id="asset-fit">Fit</button><label class="review-checkbox"><input id="asset-scale" type="checkbox">1.8 m reference</label><label id="motion-controls" hidden>Motion<select id="asset-motion"><option value="static">Static</option></select></label><button id="asset-pause" hidden>Pause</button></div>
    <p class="review-stage-caption"><span id="asset-dimensions"></span><span>Drag to orbit · scroll to zoom</span></p>
  </section>
  <aside class="review-details"><div class="review-decision"><div class="review-decision-header"><h2>Decision</h2><span id="asset-state" class="review-badge"></span></div><p id="decision-detail"></p>
    <div class="review-actions"><button id="approve-asset" class="approve-action">Approve</button><button id="deny-asset">Deny</button><button id="delete-asset" class="delete-action">Mark for deletion</button><button id="skip-asset">Skip</button></div>
    <div class="review-secondary-actions"><button id="reset-asset">Set unreviewed</button><button id="deny-family">Deny family</button></div>
    <p id="review-feedback" class="review-feedback" role="status" aria-live="polite"></p>
    </div><details class="review-info" id="review-info" open><summary>Notes & usage</summary><div class="review-info-content">
    <label>Notes<textarea id="asset-notes" rows="3" maxlength="4000" placeholder="Optional review notes"></textarea></label>
    <section><h3>Scene & gameplay usage</h3><div id="asset-uses"></div></section>
    <details id="asset-technical"><summary>Identity & dependencies</summary><code id="asset-id"></code><p id="asset-build"></p><div id="asset-dependencies"></div></details>
    <div id="asset-warnings"></div>
  </div></details></aside></div></main>`;
const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const search = el<HTMLInputElement>('review-search'), category = el<HTMLSelectElement>('review-category'), pack = el<HTMLSelectElement>('review-pack');
const usage = el<HTMLSelectElement>('review-usage'), status = el<HTMLSelectElement>('review-state'), meshes = el<HTMLInputElement>('review-meshes'), notes = el<HTMLTextAreaElement>('asset-notes');
const feedback = el('review-feedback'), stageStatus = el('stage-status');
let snapshot: ReviewSnapshot, selected: ReviewAsset | undefined, mode: 'queue' | 'browse' = 'queue';
let stage: ReviewStage | undefined, generation = 0, busy = true, previewReady = false, paused = false, limit = 100, stopped = false;
const skipped = new Set<string>();
// Compact panes retain decisions beside the preview; secondary detail opens on demand.
const compactPane = matchMedia('(max-width: 1100px)'), drawerPane = matchMedia('(max-width: 640px)');
const infoPanel = el<HTMLDetailsElement>('review-info'), assetPanel = el('review-browser-panel');
const assetToggle = el<HTMLButtonElement>('asset-browser-toggle');
function setAssetDrawer(open: boolean): void {
  if (!open && assetPanel.contains(document.activeElement)) assetToggle.focus();
  app.classList.toggle('asset-browser-open', drawerPane.matches && open);
  assetToggle.setAttribute('aria-expanded', String(drawerPane.matches && open));
  assetPanel.inert = drawerPane.matches && !open;
}
function syncReviewLayout(): void {
  if (compactPane.matches && infoPanel.contains(document.activeElement)) infoPanel.querySelector('summary')?.focus();
  infoPanel.open = !compactPane.matches;
  assetToggle.hidden = !drawerPane.matches;
  setAssetDrawer(false);
}
compactPane.addEventListener('change', syncReviewLayout); drawerPane.addEventListener('change', syncReviewLayout); syncReviewLayout();
assetToggle.addEventListener('click', () => setAssetDrawer(!app.classList.contains('asset-browser-open')));
el('asset-browser-close').addEventListener('click', () => setAssetDrawer(false));
app.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (drawerPane.matches && app.classList.contains('asset-browser-open')) setAssetDrawer(false);
  else if (compactPane.matches && infoPanel.open) { infoPanel.open = false; infoPanel.querySelector('summary')?.focus(); }
});

const message = (text: string, error = false): void => { feedback.textContent = text; feedback.dataset.error = String(error); };
async function request(path: string, action?: ReviewAction): Promise<unknown> {
  const response = await fetch(`/__asset-review${path}`, action ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-lantern-review-token': snapshot.token }, body: JSON.stringify({ revision: snapshot.revision, action }) } : undefined);
  const value = parseJson(await response.text());
  if (!response.ok) throw new Error(isRecord(value) && typeof value.error === 'string' ? value.error : `Review request failed (${response.status}).`);
  return value;
}
for (const input of [search, category, pack, usage, status, meshes, notes]) input.disabled = true;
for (const id of ['mode-queue','mode-browse','review-reload','review-finish','approve-asset','deny-asset','delete-asset','skip-asset','reset-asset','deny-family']) el<HTMLButtonElement>(id).disabled = true;
function filtered(): ReviewAsset[] {
  const query = search.value.trim().toLowerCase();
  return snapshot.assets.filter(asset => (meshes.checked || asset.kind !== 'mesh')
    && (!query || `${asset.name} ${asset.id} ${asset.appearance}`.toLowerCase().includes(query))
    && (category.value === 'all' || asset.category === category.value) && (pack.value === 'all' || asset.pack === pack.value)
    && (usage.value === 'all' || usage.value === 'used' && asset.uses.length > 0 || usage.value === 'unused' && !asset.uses.length || usage.value === 'selected' && asset.selected || asset.uses.some(use => use.scene === usage.value))
    && (mode === 'queue' ? effectiveReview(asset, snapshot.reviews).state === 'unreviewed' && !skipped.has(asset.id) : status.value === 'all' || effectiveReview(asset, snapshot.reviews).state === status.value))
    .sort((a, b) => mode === 'queue' && Boolean(a.uses.length) !== Boolean(b.uses.length) ? Number(Boolean(b.uses.length)) - Number(Boolean(a.uses.length)) : a.name.localeCompare(b.name) || a.appearance.localeCompare(b.appearance) || a.id.localeCompare(b.id));
}
function updateControls(): void {
  const writable = snapshot.writable && !busy && !stopped && !!selected;
  for (const id of ['deny-asset','delete-asset','reset-asset','deny-family']) el<HTMLButtonElement>(id).disabled = !writable;
  el<HTMLButtonElement>('approve-asset').disabled = !writable || !previewReady || !selected?.fingerprint || !!snapshot.reviews.familyDenials[selected.familyId];
  el<HTMLButtonElement>('skip-asset').disabled = busy || mode !== 'queue' || !selected;
  el<HTMLButtonElement>('review-finish').disabled = busy || !snapshot.canFinish || !snapshot.writable || stopped;
  for (const input of [search, category, pack, usage, status, meshes]) input.disabled = busy || stopped;
  notes.disabled = busy || !snapshot.writable || !selected || stopped;
  for (const id of ['mode-queue','mode-browse','review-reload','review-more']) el<HTMLButtonElement>(id).disabled = busy || stopped;
}
function drawList(): void {
  const assets = filtered(), list = el('review-list'); list.replaceChildren();
  el('review-count').textContent = `${assets.length.toLocaleString()} ${mode === 'queue' ? 'to review' : assets.length === 1 ? 'asset' : 'assets'}`;
  el('status-filter').hidden = mode === 'queue';
  for (const asset of assets.slice(0, limit)) {
    const button = document.createElement('button'); button.className = 'review-list-row'; button.dataset.selected = String(asset.id === selected?.id); button.setAttribute('aria-current', String(asset.id === selected?.id)); button.disabled = busy;
    const name = document.createElement('strong'); name.textContent = asset.name;
    const caption = document.createElement('span'); caption.textContent = `${asset.appearance} · ${asset.pack.replaceAll('-', ' ')} · ${asset.kind} · ${asset.uses.length ? 'In use' : 'Unused'}`;
    const badge = document.createElement('small'); badge.textContent = stateLabel(effectiveReview(asset, snapshot.reviews).state);
    button.append(name, caption, badge); button.addEventListener('click', () => { choose(asset).catch((error: unknown) => message(String(error), true)); if (drawerPane.matches) setAssetDrawer(false); }); list.append(button);
  }
  el('review-more').hidden = assets.length <= limit;
  if (!assets.length) { const empty = document.createElement('p'); empty.className = 'review-empty'; empty.textContent = mode === 'queue' ? 'No assets need review in this selection. Browse to revisit decisions.' : 'No matching assets.'; list.append(empty); }
}
function drawDetails(): void {
  if (!selected) return;
  const asset = selected, decision = effectiveReview(asset, snapshot.reviews), previous = snapshot.reviews.decisions[asset.id];
  el('asset-pack').textContent = `${asset.category} / ${asset.pack}`; el('asset-name').textContent = asset.name; el('asset-appearance').textContent = asset.appearance;
  el('asset-state').textContent = stateLabel(decision.state); el('asset-state').dataset.state = decision.state;
  el('decision-detail').textContent = decision.familyDenied ? 'Family denied. Clear the family denial to restore individual decisions.' : decision.changed ? 'Artwork changed since approval. Review this appearance again.' : previous ? `Saved ${new Date(previous.updatedAt).toLocaleDateString()}` : 'This appearance has not been reviewed.';
  el('asset-id').textContent = asset.id; el('asset-build').textContent = asset.selected ? 'Selected for build staging.' : 'Not explicitly selected for build staging.';
  el<HTMLButtonElement>('deny-family').textContent = decision.familyDenied ? 'Clear family denial' : 'Deny family';
  const uses = el('asset-uses'); uses.replaceChildren();
  const groups = new Map<string, typeof asset.uses>(); for (const use of asset.uses) { const key = use.sceneName; groups.set(key, [...(groups.get(key) ?? []), use]); }
  if (!groups.size) uses.textContent = 'No scene or gameplay references.';
  for (const [name, references] of groups) {
    const details = document.createElement('details'), summary = document.createElement('summary');
    const placements = new Set(references.filter(use => use.role.startsWith('Placement')).map(use => use.owner));
    summary.textContent = `${name} · ${placements.size ? `${placements.size} placements` : `${references.length} references`}`; details.append(summary);
    const list = document.createElement('ul'); for (const use of references) { const li = document.createElement('li'); li.textContent = `${use.owner} · ${use.role}`; list.append(li); } details.append(list); uses.append(details);
  }
  el('asset-dependencies').textContent = `${asset.dependencies.length} dependencies · ${asset.dependents.length} dependent assets`;
  if (asset.dependencies.length || asset.dependents.length) { const text = document.createElement('code'); text.textContent = [...asset.dependencies, ...asset.dependents].join('\n'); el('asset-dependencies').append(text); }
  const warnings = el('asset-warnings'); warnings.replaceChildren(); for (const warning of asset.warnings) { const p = document.createElement('p'); p.textContent = warning; warnings.append(p); }
  const motion = el<HTMLSelectElement>('asset-motion'); motion.replaceChildren(new Option('Static', 'static'));
  for (const role of ['idle','run','attack'] as const) if (asset.motions?.[role]) motion.add(new Option(role[0].toUpperCase() + role.slice(1), role));
  el('motion-controls').hidden = !asset.motions || !Object.keys(asset.motions).length; el('asset-pause').hidden = el('motion-controls').hidden;
  updateControls();
}
async function choose(asset: ReviewAsset): Promise<void> {
  if (busy || stopped) return;
  const current = ++generation; selected = asset; previewReady = false; paused = false;
  notes.value = snapshot.reviews.decisions[asset.id]?.notes ?? ''; el('asset-dimensions').textContent = ''; stageStatus.hidden = false; stageStatus.textContent = stage ? 'Loading prepared asset…' : stageStatus.textContent;
  el<HTMLSelectElement>('asset-view').value = 'gameplay'; el('asset-pause').textContent = 'Pause';
  drawDetails(); drawList();
  const detail = await request(`/asset?id=${encodeURIComponent(asset.id)}`);
  if (current !== generation || stopped) return;
  const parsed = parseReviewSnapshot({ ...snapshot, assets: [detail] }).assets[0]; Object.assign(asset, parsed); selected = asset; drawDetails();
  try {
    if (!stage) throw new Error('Native WebGPU preview unavailable. Reload after resolving the startup error.');
    const dimensions = await stage.show(asset);
    if (current !== generation || stopped || !dimensions) return;
    el('asset-dimensions').textContent = dimensions; stageStatus.hidden = true; previewReady = true; updateControls();
  } catch (error) { if (current === generation) { stageStatus.hidden = false; stageStatus.textContent = String(error); previewReady = false; updateControls(); } }
}
async function decide(state: ReviewState): Promise<void> {
  if (!selected || busy || !snapshot.writable) return;
  const asset = selected, currentList = filtered(), position = currentList.findIndex(row => row.id === asset.id);
  await save({ type: 'decision', id: asset.id, state, notes: notes.value, fingerprint: asset.fingerprint });
  if (mode === 'queue') {
    skipped.add(asset.id); const next = currentList.slice(position + 1).find(row => effectiveReview(row, snapshot.reviews).state === 'unreviewed' && !skipped.has(row.id)) ?? filtered()[0];
    if (next) await choose(next); else clearSelection('Review queue complete for this selection.');
  }
}
async function save(action: ReviewAction): Promise<void> {
  busy = true; updateControls(); drawList(); message('Saving decision…');
  try {
    const result = await request('/decision', action); if (!isRecord(result) || typeof result.revision !== 'string') throw new Error('Invalid save response.');
    snapshot.reviews = parseReviews(result.reviews); snapshot.revision = result.revision;
    message(action.type === 'decision' && action.state === 'delete-requested' ? 'Marked for deletion. Files and scenes are unchanged.' : 'Decision saved.');
  } finally { busy = false; updateControls(); drawDetails(); drawList(); }
}
async function reload(): Promise<void> {
  const id = selected?.id, draft = notes.value; snapshot = parseReviewSnapshot(await request('/'));
  el('review-session').textContent = snapshot.writable ? 'Review session' : 'Read-only · start npm run assets:review to save';
  el('review-session').title = el('review-session').textContent ?? '';
  el('review-finish').hidden = !snapshot.canFinish;
  const packs = [...new Set(snapshot.assets.map(row => row.pack))].sort(), oldPack = pack.value, oldUsage = usage.value;
  pack.replaceChildren(new Option('All packs', 'all')); packs.forEach(name => pack.add(new Option(name, name))); if (packs.includes(oldPack)) pack.value = oldPack;
  while (usage.options.length > 4) usage.remove(4);
  const scenes = new Map(snapshot.assets.flatMap(row => row.uses.filter(use => use.scene).map(use => [use.scene!, use.sceneName] as const)));
  for (const [scene, name] of scenes) usage.add(new Option(`Scene: ${name}`, scene)); if (scenes.has(oldUsage) || ['all','used','unused','selected'].includes(oldUsage)) usage.value = oldUsage;
  busy = false; updateControls();
  const next = filtered().find(row => row.id === id) ?? filtered()[0]; if (next) { await choose(next); if (id === next.id && draft) notes.value = draft; } else { clearSelection('No matching assets. Adjust the filters.'); drawList(); }
}
function clearSelection(text: string): void {
  generation++; selected = undefined; previewReady = false; stage?.empty(); notes.value = '';
  for (const id of ['asset-pack','asset-appearance','asset-dimensions','asset-id','asset-build','asset-dependencies','asset-warnings','asset-uses','decision-detail']) el(id).textContent = '';
  el('asset-name').textContent = 'No asset selected'; el('asset-state').textContent = '—';
  stageStatus.hidden = false; stageStatus.textContent = text; el('motion-controls').hidden = true; el('asset-pause').hidden = true; updateControls();
}
function filterChanged(): void {
  if (busy) return; limit = 100; drawList(); const assets = filtered();
  if (!assets.length) clearSelection(mode === 'queue' ? 'Review queue complete for this selection.' : 'No matching assets. Adjust the filters.');
  else if (!assets.some(row => row.id === selected?.id)) choose(assets[0]).catch((error: unknown) => message(String(error), true));
}
for (const input of [search, category, pack, usage, status, meshes]) input.addEventListener(input === search ? 'input' : 'change', filterChanged);
for (const name of reviewCategories) category.add(new Option(name, name)); for (const state of reviewStates) status.add(new Option(stateLabel(state), state));
for (const target of ['queue','browse'] as const) el(`mode-${target}`).addEventListener('click', () => { mode = target; for (const value of ['queue','browse']) el(`mode-${value}`).setAttribute('aria-pressed', String(value === mode)); filterChanged(); updateControls(); });
el('review-more').addEventListener('click', () => { limit += 100; drawList(); });
el('review-reload').addEventListener('click', () => { reload().catch((error: unknown) => message(String(error), true)); });
for (const [id, state] of [['approve-asset','approved'],['deny-asset','denied'],['delete-asset','delete-requested'],['reset-asset','unreviewed']] as const) el(id).addEventListener('click', () => { decide(state).catch((error: unknown) => message(String(error), true)); });
el('skip-asset').addEventListener('click', () => { if (!selected || busy) return; skipped.add(selected.id); const next = filtered()[0]; if (next) choose(next).catch((error: unknown) => message(String(error), true)); else { clearSelection('Review queue complete for this selection.'); drawList(); message('Queue complete for this selection.'); } });
el('deny-family').addEventListener('click', () => { if (selected) save({ type: snapshot.reviews.familyDenials[selected.familyId] ? 'family-clear' : 'family-deny', id: selected.id, notes: notes.value }).then(filterChanged).catch((error: unknown) => message(String(error), true)); });
el<HTMLSelectElement>('asset-view').addEventListener('change', () => stage?.view(el<HTMLSelectElement>('asset-view').value));
el('asset-fit').addEventListener('click', () => stage?.fit()); el<HTMLInputElement>('asset-scale').addEventListener('change', () => stage?.scaleReference(el<HTMLInputElement>('asset-scale').checked));
el<HTMLSelectElement>('asset-motion').addEventListener('change', () => { if (selected) stage?.motion(selected, el<HTMLSelectElement>('asset-motion').value).catch((error: unknown) => message(String(error), true)); });
el('asset-pause').addEventListener('click', () => { paused = !paused; stage?.pause(paused); el('asset-pause').textContent = paused ? 'Play' : 'Pause'; });
el('review-finish').addEventListener('click', () => {
  busy = true; updateControls(); drawList(); message('Integrating review decisions…');
  fetch('/__asset-review/finish', { method: 'POST', headers: { 'x-lantern-review-token': snapshot.token } }).then(async response => {
    const result = parseJson(await response.text()); if (!response.ok || !isRecord(result) || typeof result.message !== 'string') throw new Error(isRecord(result) && typeof result.error === 'string' ? result.error : 'Review integration failed.');
    if (result.integrated === true) { stopped = true; stage?.dispose(); stageStatus.hidden = false; stageStatus.textContent = result.message; message(result.message); }
    else message(result.message);
  }).catch((error: unknown) => message(String(error), true)).finally(() => { busy = false; updateControls(); drawList(); });
});
window.addEventListener('pagehide', () => { stopped = true; generation++; stage?.dispose(); }, { once: true });
try {
  stage = await ReviewStage.create(el('review-stage'), error => { previewReady = false; stageStatus.hidden = false; stageStatus.textContent = `Preview failed: ${String(error)}`; if (snapshot) updateControls(); });
  if (stopped) stage.dispose();
} catch (error) { stageStatus.textContent = `Native WebGPU startup failed: ${String(error)}`; }
if (!stopped) await reload();
