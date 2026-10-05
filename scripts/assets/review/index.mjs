import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { git, readJSON } from '../../agents/state.mjs';
import { hashFile, assetPath, readGlb } from '../../lib/assets.mjs';
import { root } from '../../lib/cli.mjs';
import { itemDefinitions, arrowAsset } from '../../../src/gameplay/equipment.ts';
import { appearanceId, emptyReviews, parseReviews, effectiveReview, reviewDecision } from '../../../src/assets/asset-review.ts';

export const reviewsPath = cwd => resolve(cwd, 'assets/asset-reviews.json');
export async function readReviews(cwd = root) { return parseReviews(await readJSON(reviewsPath(cwd), emptyReviews())); }
const plainName = name => name.replace(/^(?:SM|SK)_(?:Gen_)?(?:Env_|Prop_|Wep_|Chr_)?/i, '').replaceAll('_', ' ').replaceAll('-', ' ');
function category(name, hint = '') {
  const text = `${hint} ${name}`.toLowerCase();
  if (/(?:\b|_)(?:chr|character|skeleton|goblin|humanoid)(?:\b|_)/.test(text)) return 'Characters';
  if (/(?:\b|_)(?:wep|weapon|sword|axe|bow|staff|shield|wand|hammer|mace|pickaxe|arrow|helmet|armor)(?:\b|_)/.test(text)) return 'Equipment';
  if (/(?:tree|pine|bush|fern|foliage|stump|grass|flower|plant|log)/.test(text)) return 'Trees/Foliage';
  if (/(?:rock|stone|terrain|cliff|boulder)/.test(text)) return 'Rocks/Terrain';
  if (/(?:bld|building|structure|wall|roof|archway|pillar|tent|bridge|ruin|door)/.test(text)) return 'Structures';
  if (/(?:prop|chest|crate|barrel|lantern|torch|table|bed|backpack|campfire)/.test(text)) return 'Props';
  return 'Other';
}
async function sourceData(cwd, revision) {
  const json = async name => revision ? JSON.parse(await git(['show', `${revision}:${name}`], cwd)) : readJSON(resolve(cwd, name));
  const names = revision ? (await git(['ls-tree', '-r', '--name-only', revision, 'src/levels/areas'], cwd)).split('\n').filter(name => name.endsWith('.json'))
    : (await readdir(resolve(cwd, 'src/levels/areas'))).filter(name => name.endsWith('.json')).map(name => `src/levels/areas/${name}`);
  const areas = await Promise.all(names.map(json));
  return { areas, surfaces: await json('assets/textures/environment/manifest.json'), characters: await json('assets/playable-characters.json'), selection: await json('assets/library-selection.json') };
}
/** Static ownership includes conditional fallbacks and potential player equipment, never a live save snapshot. */
export function resolveUses(data, equipment = itemDefinitions) {
  const uses = [];
  const emit = (ref, scene, owner, role, appearance = true) => {
    if (!ref) return;
    const reference = ref.libraryId ?? ref.url;
    if (appearance) {
      const base = data.surfaces.assets.find(asset => asset.id === reference);
      const local = data.surfaces.areaAssets?.[scene?.id]?.find(asset => asset.id === reference);
      const variant = local ?? base;
      if (variant) {
        emit({ url: variant.url }, scene, owner, role, false);
        emit(ref, scene, owner, `${role} · source fallback`, false);
        if (local && base && local.url !== base.url) emit({ url: base.url }, scene, owner, `${role} · prepared fallback`, false);
        return;
      }
    }
    uses.push({ reference, scene: scene?.id ?? null, sceneName: scene?.name ?? 'Shared gameplay', owner, role });
  };
  for (const area of data.areas) {
    for (const prop of area.props) { emit(prop.asset, area, prop.id, 'Placement'); emit(prop.fallback, area, prop.id, 'Fallback'); }
    for (const fire of area.effects.fires) emit(fire.asset, area, fire.id, 'Fire');
    if (area.shelter) emit({ libraryId: 'generic:model:sm-gen-prop-chest-01' }, area, 'shelter-stash', 'Stash');
    if (area.shop) emit({ url: area.shop.merchant.model }, area, area.shop.id, 'Merchant');
    emit({ url: data.characters.player.model }, area, 'player', 'Player');
    if (data.characters.player.lanternModel) emit({ url: data.characters.player.lanternModel }, area, 'player-lantern', 'Player lantern');
    const enemies = area.layout.enemies ?? ['enemy', 'caster'].flatMap(id => area.layout[id] ? [{ id, rig: 'enemy', loadout: { main: id === 'caster' ? 'staff' : 'axe', off: null } }] : []);
    for (const enemy of enemies) {
      emit({ url: data.characters[enemy.rig].model }, area, enemy.id, 'Enemy');
      for (const item of [enemy.loadout.main, enemy.loadout.off, ...(area.enemyEquipment?.[enemy.id] ?? [])]) if (equipment[item]) emit({ libraryId: equipment[item].asset }, area, enemy.id, `Equipment · ${equipment[item].name}`, false);
    }
    // Player loadouts are save-driven: every supported model may be equipped in every playable area.
    for (const [item, definition] of Object.entries(equipment)) emit({ libraryId: definition.asset }, area, `player:${item}`, 'Player equipment (potential)', false);
    emit({ libraryId: arrowAsset }, area, 'projectiles', 'Arrow (potential)', false);
    for (const tool of ['axe', 'pickaxe']) emit({ libraryId: `generic:model:sm-gen-wep-${tool}-01` }, area, `gathering:${tool}`, 'Gathering tool', false);
  }
  return uses;
}
/** Catalog adapters retain source identities; each actual prepared appearance has its own review key. */
export async function reviewIndex(cwd = root, { revision, reviewed = true } = {}) {
  const data = await sourceData(cwd, revision);
  const reviews = await readReviews(cwd);
  const catalogUrls = ['/vendor/synty/library/catalog.json', '/vendor/asterfall/catalog.json'];
  const catalogs = await Promise.all(catalogUrls.map(url => readJSON(resolve(cwd, 'public', url.slice(1)), { version: 1, assets: {} })));
  const gallery = await readJSON(resolve(cwd, 'public/vendor/character-gallery/catalog.json'), { characters: [] });
  const rows = new Map(), byLibrary = new Map(), byUrl = new Map(), catalogEntries = new Map();
  const add = (row, includeDeleted = false) => {
    const id = row.reviewId ?? appearanceId(row.familyId, row.url);
    if (rows.has(id) || (Object.hasOwn(reviews.deleted, id) && !includeDeleted)) return rows.get(id);
    const result = { id, name: row.name, appearance: 'Original', category: category(row.name), kind: 'model', available: true, warnings: [], uses: [], selected: false, dependencies: [], dependents: [], fingerprint: null, ...row };
    result.name = plainName(result.name); delete result.reviewId;
    rows.set(id, result); if (!byUrl.has(result.url)) byUrl.set(result.url, result);
    return result;
  };
  catalogs.forEach((catalog, index) => {
    for (const entry of Object.values(catalog.assets)) catalogEntries.set(entry.id, { ...entry, catalogUrl: catalogUrls[index] });
    for (const entry of Object.values(catalog.assets)) if (['model', 'assembly', 'mesh'].includes(entry.kind)) {
      const row = add({ reviewId: `${entry.id}@original`, familyId: entry.id, libraryId: entry.id, catalogUrl: catalogUrls[index], url: entry.url, name: entry.name, pack: entry.pack, kind: entry.kind,
        category: category(entry.name, entry.category), dependencies: entry.dependencies ?? [], available: entry.status === 'converted', warnings: entry.warnings ?? [] });
      if (row) byLibrary.set(entry.id, row);
    }
  });
  for (const row of rows.values()) for (const dep of row.dependencies) byLibrary.get(dep)?.dependents.push(row.id);
  const sharedUrls = new Map();
  for (const row of rows.values()) sharedUrls.set(row.url, [...(sharedUrls.get(row.url) ?? []), row]);
  for (const group of sharedUrls.values()) if (group.length > 1) for (const row of group) row.dependents.push(...group.filter(other => other.id !== row.id).map(other => other.id));
  const surface = (asset, appearance, key) => add({ reviewId: `${asset.id}@${key}`, familyId: asset.id, name: byLibrary.get(asset.id)?.name ?? asset.id.split('/').at(-1), pack: byLibrary.get(asset.id)?.pack ?? 'Prepared scenery',
    category: category(asset.kind ?? asset.id), url: asset.url, appearance, warnings: [], dependencies: [] });
  data.surfaces.assets.forEach(asset => surface(asset, 'Gameplay surfaces', 'gameplay'));
  data.surfaces.showcase.assets.forEach(asset => surface(asset, 'Surface study', 'showcase'));
  for (const [area, assets] of Object.entries(data.surfaces.areaAssets ?? {})) assets.forEach(asset => surface(asset, `${data.areas.find(a => a.id === area)?.name ?? area} surfaces`, `area:${area}`));
  const syntyCharacters = new Map([...byLibrary.values()].filter(row => row.kind === 'model').map(row => [`synty-${row.pack}-${catalogEntries.get(row.libraryId).name.toLowerCase()}`, row.familyId]));
  const characterFamily = identity => syntyCharacters.get(identity) ?? `character:${identity}`;
  for (const actor of Object.values(data.characters)) add({ reviewId: `${characterFamily(actor.sourceId)}@gameplay`, familyId: characterFamily(actor.sourceId), name: actor.name, url: actor.model, height: actor.height, pack: 'Playable characters', category: 'Characters', appearance: 'Gameplay character' });
  for (const character of gallery.characters) {
    const existing = byUrl.get(character.url);
    const row = existing ?? add({ reviewId: `${characterFamily(character.id)}@gallery`, familyId: characterFamily(character.id), name: character.name, pack: character.family, category: 'Characters', url: character.url, available: character.status === 'ready', warnings: [character.error, character.motionError].filter(Boolean), appearance: 'Character gallery', height: 1.8 });
    if (existing && character.url.startsWith('/vendor/characters/')) {
      const original = `/vendor/character-gallery/${character.id}/model.glb`;
      if (await stat(resolve(cwd, 'public', original.slice(1))).then(info => info.isFile()).catch(error => { if (error.code === 'ENOENT') return false; throw error; })) add({ reviewId: `${characterFamily(character.id)}@gallery`, familyId: characterFamily(character.id), name: character.name, pack: character.family, category: 'Characters', url: original, appearance: 'Original gallery model', height: 1.8 });
    }
    if (row) row.motions = Object.fromEntries(Object.entries(character.motions ?? {}).filter(([, clip]) => clip?.url).map(([role, clip]) => [role, clip.url]));
  }
  for (const area of data.areas) if (area.shop) {
    const url = area.shop.merchant.model, provenance = await readJSON(resolve(cwd, 'public', url.slice(1), '../provenance.json'), null);
    if (provenance?.character) add({ reviewId: `${characterFamily(provenance.character)}@merchant`, familyId: characterFamily(provenance.character), name: gallery.characters.find(row => row.id === provenance.character)?.name ?? 'Merchant', pack: 'Playable characters', category: 'Characters', url, height: area.shop.merchant.height, appearance: 'Gameplay merchant' });
  }
  const refs = resolveUses(data);
  for (const use of refs) {
    let row = byLibrary.get(use.reference) ?? byUrl.get(use.reference);
    if (!row) {
      const url = use.reference.startsWith('/') ? use.reference : catalogEntries.get(use.reference)?.url ?? `/vendor/missing/${encodeURIComponent(use.reference)}.glb`;
      const tombstone = Object.entries(reviews.deleted).find(([id, record]) => record.url === url || id === `${use.reference}@original`);
      const source = catalogEntries.get(use.reference);
      row = add({ reviewId: tombstone?.[0] ?? (source ? `${source.id}@original` : undefined), familyId: tombstone?.[1].familyId ?? use.reference, url, name: use.reference.split('/').at(-1), pack: 'Standalone', appearance: 'Scene model', category: category(use.reference), available: !tombstone && !!(source || use.reference.startsWith('/')), warnings: tombstone ? ['Deleted asset is still referenced. Replace this use.'] : [] }, true);
    }
    if (row) row.uses.push(use);
  }
  for (const id of data.selection) if (!byLibrary.has(id)) {
    const deleted = Object.entries(reviews.deleted).find(([, record]) => record.familyId === id);
    const row = add({ reviewId: deleted?.[0] ?? `${id}@original`, familyId: id, libraryId: id, url: deleted?.[1].url ?? `/vendor/missing/${encodeURIComponent(id)}.glb`, name: id, pack: 'Missing build selection', available: false, warnings: ['Build selection has no active catalog entry. Remove the selection or restore its prepared export.'] }, true);
    byLibrary.set(id, row);
  }
  for (const row of rows.values()) {
    row.selected = data.selection.includes(row.libraryId);
    if (!row.catalogUrl) row.available = row.available && await stat(resolve(cwd, 'public', row.url.slice(1))).then(info => info.isFile()).catch(error => { if (error.code === 'ENOENT') return false; throw error; });
  }
  const families = new Map();
  for (const row of rows.values()) families.set(row.familyId, [...(families.get(row.familyId) ?? []), row]);
  const baseAssets = [...families.values()].map(family => {
    const rank = row => row.id.endsWith('@original') ? 0 : row.id.endsWith('@gallery') ? 1 : row.id.endsWith('@gameplay') ? 2 : 3;
    const base = [...family].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))[0];
    for (const row of family) row.baseId = base.id;
    return base;
  });
  const index = { assets: [...rows.values()], baseAssets, families, byBaseId: new Map(baseAssets.map(base => [base.id, base])), reviews, data, catalogEntries, refs, byLibrary, byUrl, cwd };
  if (reviewed) for (const row of index.assets) if (reviewDecision(row, reviews)?.state === 'approved') await inspectReview(index, row);
  return index;
}
/** One source model per family, retaining usage and older rejection/deletion intent. */
export function baseReviewAssets(index) {
  return index.baseAssets.map(base => baseReviewAsset(index, base));
}
export function baseReviewAsset(index, base) {
  const family = index.families.get(base.familyId);
  const retained = family.find(row => index.reviews.decisions[row.id]?.state === 'delete-requested')
    ?? family.find(row => index.reviews.decisions[row.id]?.state === 'denied');
  const uses = new Map(family.flatMap(row => row.uses).map(use => [JSON.stringify(use), use]));
  return { ...base, uses: [...uses.values()], selected: family.some(row => row.selected), variants: family.length - 1,
    reviewDecisionId: index.reviews.decisions[base.id]?.scope === 'family' ? base.id : retained?.id ?? base.id };
}
/** Variant eligibility follows the source approval; its own inputs must still be available. */
async function inspectReview(index, row) {
  row.fingerprint = await fingerprint(index, row);
  if (row.baseId !== row.id) {
    const base = index.byBaseId.get(row.baseId);
    if (base.fingerprint === null) base.fingerprint = await fingerprint(index, base);
    row.baseFingerprint = base.fingerprint;
  }
}
/** Hash the actual bytes and transitive appearance inputs only on inspection or eligibility checks. */
export async function fingerprint(index, row, inputs = { readGlb, hashFile, readFile }) {
  const paths = new Set(), visited = new Set();
  const includeUrl = async url => {
    const path = assetPath(resolve(index.cwd, 'public'), url, '/');
    if (paths.has(path)) return;
    paths.add(path);
    if (path.endsWith('.glb')) {
      const data = await inputs.readGlb(path, resolve(index.cwd, 'public'));
      for (const input of [...(data.images ?? []), ...(data.buffers ?? [])]) if (input.uri && !input.uri.startsWith('data:')) await includeUrl('/' + resolve(dirname(path), decodeURIComponent(input.uri)).slice(resolve(index.cwd, 'public').length + 1));
      for (const material of data.materials ?? []) if (material.extras?.lanternSurface?.url) await includeUrl(material.extras.lanternSurface.url);
    }
  };
  const visit = async id => {
    if (visited.has(id)) return;
    visited.add(id);
    const entry = index.catalogEntries.get(id);
    if (!entry || entry.status !== 'converted') throw new Error(`Missing dependency: ${id}`);
    await includeUrl(entry.url);
    for (const dep of entry.dependencies ?? []) await visit(dep);
  };
  try {
    await includeUrl(row.url);
    for (const dep of row.dependencies) await visit(dep);
    const hash = createHash('sha256').update(row.id).update(String(row.height ?? 'authored'));
    for (const path of [...paths].sort()) hash.update(path.slice(index.cwd.length)).update(await inputs.hashFile(path));
    const recipes = JSON.parse(await inputs.readFile(resolve(index.cwd, 'assets/material-recipes.json')));
    hash.update(JSON.stringify(recipes.dryHighlights));
    if (row.url.startsWith('/vendor/synty/environment/')) hash.update(await inputs.readFile(resolve(index.cwd, 'assets/material-recipes.json')));
    return hash.digest('hex');
  } catch (error) {
    row.available = false; row.warnings.push(`Cannot inspect prepared inputs: ${error.message}`); return null;
  }
}
export async function reviewBlockers(index, assets = index.assets.filter(row => row.uses.length || row.selected)) {
  const issues = [];
  for (const row of assets) {
    await inspectReview(index, row);
    const decision = effectiveReview(row, index.reviews);
    if (['denied', 'delete-requested'].includes(decision.state)) issues.push({ id: row.id, name: row.name, state: decision.state, changed: decision.changed, uses: row.uses, selected: row.selected });
    if (!row.available) issues.push({ id: row.id, name: row.name, state: 'unavailable', uses: row.uses, selected: row.selected });
    const seen = new Set();
    const visit = id => {
      if (seen.has(id)) return; seen.add(id);
      const entry = index.catalogEntries.get(id), dep = index.byLibrary.get(id);
      if (!entry || entry.status !== 'converted') issues.push({ id, name: id, state: 'missing dependency', uses: row.uses });
      if (index.reviews.deleted[`${id}@original`]) issues.push({ id, name: id, state: 'deleted dependency', uses: row.uses });
      if (dep && ['denied','delete-requested'].includes(effectiveReview(dep, index.reviews).state)) issues.push({ id, name: dep.name, state: 'blocked dependency', uses: row.uses });
      for (const child of entry?.dependencies ?? []) visit(child);
    };
    row.dependencies.forEach(visit);
  }
  return issues;
}
/** Expand family requests for cleanup, including variants added after the decision. */
export function deletionRequests(index) {
  const active = new Set(index.assets.map(row => row.id));
  const requests = new Map(Object.entries(index.reviews.decisions).filter(([id, row]) => {
    const baseId = index.families.get(row.familyId)?.[0].baseId, base = index.reviews.decisions[baseId];
    return row.state === 'delete-requested' && !index.reviews.deleted[id] && !active.has(id) && !(base?.scope === 'family' && base.state !== 'delete-requested');
  }));
  for (const row of index.assets) if (!index.reviews.deleted[row.id] && reviewDecision(row, index.reviews)?.state === 'delete-requested') requests.set(row.id, { ...reviewDecision(row, index.reviews), ...row, state: 'delete-requested', currentUrl: row.url });
  return [...requests].map(([id, row]) => ({ ...row, id }));
}
export async function changedUses(cwd, base) {
  const current = await reviewIndex(cwd, { reviewed: false });
  const oldData = await sourceData(cwd, base);
  // Equipment is TypeScript-owned; use the same historical definitions without rewriting tracked files.
  let oldEquipment = itemDefinitions;
  const before = await git(['show', `${base}:src/gameplay/equipment.ts`], cwd);
  const now = await readFile(resolve(cwd, 'src/gameplay/equipment.ts'), 'utf8');
  if (before !== now) {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os'); const { pathToFileURL } = await import('node:url');
    const directory = await mkdtemp(resolve(tmpdir(), 'lantern-review-equipment-'));
    try { const path = resolve(directory, 'equipment.ts'); await writeFile(path, before); oldEquipment = (await import(pathToFileURL(path).href)).itemDefinitions; }
    finally { await rm(directory, { recursive: true }); }
  }
  const key = use => JSON.stringify([use.scene, use.owner, use.role, use.reference]);
  const previous = new Set(resolveUses(oldData, oldEquipment).map(key));
  const added = new Set(current.refs.filter(use => !previous.has(key(use))).map(key));
  const rows = current.assets.filter(row => row.uses.some(use => added.has(key(use))));
  const issues = await reviewBlockers(current, rows);
  return { index: current, issues, added: added.size };
}

export async function requireShippingEligibility(cwd = root) {
  const index = await reviewIndex(cwd, { reviewed: false }), issues = await reviewBlockers(index);
  if (issues.length) throw new Error(`Shipping contains blocked or unavailable visual assets (${issues.length} blockers).\n${issues.map(issue => `${issue.name}: ${issue.state} — ${issue.id}${issue.selected && !issue.uses.length ? ' (unused build selection: remove or clear its exclusion)' : ''}`).join('\n')}\nInspect with npm run assets:review:report.`);
}
