import { isRecord } from '../data/json.ts';

export const reviewStates = ['unreviewed', 'approved', 'denied', 'delete-requested'] as const;
export type ReviewState = typeof reviewStates[number];
export const reviewCategories = ['Trees/Foliage', 'Rocks/Terrain', 'Structures', 'Props', 'Characters', 'Equipment', 'Other'] as const;
export type ReviewCategory = typeof reviewCategories[number];
export type ReviewUse = { scene: string | null; sceneName: string; owner: string; role: string; reference: string };
export type ReviewAsset = {
  id: string; familyId: string; name: string; appearance: string; pack: string; category: ReviewCategory;
  kind: 'model' | 'assembly' | 'mesh'; url: string; catalogUrl?: string; libraryId?: string;
  available: boolean; warnings: string[]; uses: ReviewUse[]; selected: boolean;
  dependencies: string[]; dependents: string[]; fingerprint: string | null;
  height?: number; motions?: Partial<Record<'idle' | 'run' | 'attack', string>>;
  baseId?: string; baseFingerprint?: string | null; reviewDecisionId?: string; variants?: number;
};
export type ReviewDecision = {
  familyId: string; url: string; name: string; state: ReviewState; fingerprint: string | null; notes: string; updatedAt: string;
  scope?: 'family';
};
export type DeletedAppearance = { familyId: string; url: string; deletedAt: string };
export type AssetReviews = {
  version: 1; decisions: Record<string, ReviewDecision>;
  familyDenials: Record<string, { notes: string; updatedAt: string }>;
  deleted: Record<string, DeletedAppearance>;
};
export type ReviewAction = { type: 'decision'; id: string; state: ReviewState; notes: string; fingerprint: string | null; scope?: 'family' }
  | { type: 'family-deny' | 'family-clear'; id: string; notes: string };
export type ReviewSnapshot = { assets: ReviewAsset[]; reviews: AssetReviews; revision: string; writable: boolean; canFinish: boolean; token: string; task: string | null };
export const appearanceId = (familyId: string, url: string): string => `${familyId}@${url}`;
export const emptyReviews = (): AssetReviews => ({ version: 1, decisions: {}, familyDenials: {}, deleted: {} });
export const stateLabel = (state: ReviewState): string => ({ unreviewed: 'Unreviewed', approved: 'Approved', denied: 'Denied', 'delete-requested': 'Marked for deletion' })[state];
export function reviewDecision(asset: ReviewAsset, reviews: AssetReviews): ReviewDecision | undefined {
  const base = reviews.decisions[asset.baseId ?? asset.id];
  const individual = reviews.decisions[asset.reviewDecisionId ?? asset.id];
  if (base?.scope === 'family') return base;
  if (individual && ['denied', 'delete-requested'].includes(individual.state)) return individual;
  return base ?? individual;
}
export function effectiveReview(asset: ReviewAsset, reviews: AssetReviews): { state: ReviewState; changed: boolean; familyDenied: boolean } {
  const decision = reviewDecision(asset, reviews);
  const fingerprint = asset.baseId && asset.baseId !== asset.id && decision === reviews.decisions[asset.baseId] ? asset.baseFingerprint : asset.fingerprint;
  const changed = decision?.state === 'approved' && (!asset.available || !fingerprint || decision.fingerprint !== fingerprint);
  const familyDenied = Object.hasOwn(reviews.familyDenials, asset.familyId);
  return { state: Object.hasOwn(reviews.deleted, asset.id) ? 'delete-requested' : familyDenied ? 'denied' : changed ? 'unreviewed' : decision?.state ?? 'unreviewed', changed, familyDenied };
}
export function parseReviews(value: unknown): AssetReviews {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.decisions) || !isRecord(value.familyDenials) || !isRecord(value.deleted)) throw new Error('Invalid asset review records (version 1 required).');
  const identity = (key: string) => key.length > 0 && !['__proto__', 'constructor', 'prototype'].includes(key);
  for (const [id, row] of Object.entries(value.decisions)) {
    if (!identity(id) || !isRecord(row) || typeof row.familyId !== 'string' || typeof row.url !== 'string' || !id.startsWith(`${row.familyId}@`)
      || typeof row.name !== 'string' || !reviewStates.some(state => state === row.state) || typeof row.notes !== 'string' || row.notes.length > 4000
      || typeof row.updatedAt !== 'string' || !(row.fingerprint === null || typeof row.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(row.fingerprint))
      || !(row.scope === undefined || row.scope === 'family')) throw new Error(`Invalid review decision: ${id}`);
  }
  for (const [id, row] of Object.entries(value.familyDenials)) if (!identity(id) || !isRecord(row) || typeof row.notes !== 'string' || row.notes.length > 4000 || typeof row.updatedAt !== 'string') throw new Error(`Invalid family denial: ${id}`);
  for (const [id, row] of Object.entries(value.deleted)) if (!identity(id) || !isRecord(row) || typeof row.familyId !== 'string' || typeof row.url !== 'string' || !id.startsWith(`${row.familyId}@`) || typeof row.deletedAt !== 'string') throw new Error(`Invalid deletion exclusion: ${id}`);
  return value as AssetReviews;
}
export function parseReviewSnapshot(value: unknown): ReviewSnapshot {
  if (!isRecord(value) || !Array.isArray(value.assets) || typeof value.revision !== 'string' || typeof value.token !== 'string' || typeof value.writable !== 'boolean' || typeof value.canFinish !== 'boolean' || !(value.task === null || typeof value.task === 'string')) throw new Error('Invalid review session.');
  parseReviews(value.reviews);
  for (const row of value.assets) {
    if (!isRecord(row) || !['id','familyId','name','appearance','pack','url'].every(key => typeof row[key] === 'string')
      || !reviewCategories.some(category => category === row.category) || !['model','assembly','mesh'].includes(String(row.kind)) || typeof row.available !== 'boolean'
      || !Array.isArray(row.uses) || !Array.isArray(row.warnings) || !Array.isArray(row.dependencies) || !Array.isArray(row.dependents)
      || typeof row.selected !== 'boolean' || !(row.fingerprint === null || typeof row.fingerprint === 'string')
      || ![row.baseId, row.reviewDecisionId].every(id => id === undefined || typeof id === 'string' && id.startsWith(`${row.familyId}@`))
      || !(row.baseFingerprint === undefined || row.baseFingerprint === null || typeof row.baseFingerprint === 'string')
      || !(row.variants === undefined || typeof row.variants === 'number' && Number.isInteger(row.variants) && row.variants >= 0)) throw new Error('Invalid review asset.');
  }
  return value as ReviewSnapshot;
}
