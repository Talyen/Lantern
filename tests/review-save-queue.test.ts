import { describe, expect, it } from 'vitest';
import { emptyReviews, type ReviewAction } from '../src/assets/asset-review';
import { ReviewSaveQueue, type SavedReviews } from '../src/labs/assets/review-save-queue';

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
const initial = (): SavedReviews => ({ revision: 'initial', reviews: emptyReviews() });
const action = (id: string, state: 'approved' | 'denied' | 'delete-requested' = 'approved'): ReviewAction => ({ type: 'decision', id: `${id}@original`, state, fingerprint: 'a'.repeat(64), notes: `notes for ${id}` });
function applied(saved: SavedReviews, action: ReviewAction): SavedReviews {
  if (action.type !== 'decision') throw new Error('Expected an appearance decision.');
  const reviews = structuredClone(saved.reviews);
  reviews.decisions[action.id] = { familyId: action.id.split('@')[0], url: '/asset.glb', name: action.id, state: action.state, fingerprint: action.fingerprint, notes: action.notes, updatedAt: '2026-10-04' };
  return { revision: `${saved.revision}:${action.id}`, reviews };
}

// Background saves must not lose review work through a failed write, reload, or stale-tab conflict.
describe('background review decisions', () => {
  it('retains rapid decisions and their notes while a previous save is pending, then saves in order', async () => {
    let saved = initial(), release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const journal = storage();
    const catalogSnapshot = { ...saved, assets: new Array(60000).fill('catalog asset') };
    const queue = new ReviewSaveQueue(catalogSnapshot, journal, 'pending', async (revision, row) => {
      expect(revision).toBe(saved.revision); await gate; saved = applied(saved, row); return saved;
    }, () => {});
    queue.enqueue({ name: 'A', action: action('A') }); queue.enqueue({ name: 'B', action: action('B', 'denied') }); queue.enqueue({ name: 'C', action: action('C', 'delete-requested') });
    expect(Object.keys(JSON.parse(journal.getItem('pending')!) as Record<string, unknown>)).toEqual(['reviews', 'revision', 'pending']);
    expect(journal.getItem('pending')!.length).toBeLessThan(5000);
    expect(queue.pending.map(row => row.action.notes)).toEqual(['notes for A', 'notes for B', 'notes for C']);
    release(); await expect.poll(() => queue.pending.length).toBe(0);
    expect(Object.values(saved.reviews.decisions).map(row => row.state)).toEqual(['approved', 'denied', 'delete-requested']);
  });
  it('recovers failed work on reload without resending a write whose response was lost', async () => {
    const journal = storage(); let saved = initial();
    const queue = new ReviewSaveQueue(saved, journal, 'pending', async (_, row) => { saved = applied(saved, row); throw new Error('Connection lost after disk write'); }, () => {});
    queue.enqueue({ name: 'A', action: action('A') }); queue.enqueue({ name: 'B', action: action('B', 'denied') });
    await expect.poll(() => queue.error).toContain('Connection lost');
    expect(queue.pending).toHaveLength(2);
    const recovered = new ReviewSaveQueue(saved, journal, 'pending', async (revision, row) => { expect(revision).toBe(saved.revision); saved = applied(saved, row); return saved; }, () => {});
    expect(recovered.pending.map(row => row.action.id)).toEqual(['B@original']);
    await recovered.drain(); expect(Object.keys(saved.reviews.decisions)).toEqual(['A@original', 'B@original']); expect(journal.getItem('pending')).toBeNull();
  });
  it('retains unsaved work and refuses to overwrite unrelated decisions from another tab', async () => {
    const journal = storage(), base = initial();
    const queue = new ReviewSaveQueue(base, journal, 'pending', async () => { throw new Error('offline'); }, () => {});
    queue.enqueue({ name: 'A', action: action('A') }); await expect.poll(() => queue.error).toContain('offline');
    const external = applied(applied(base, action('A')), action('Other', 'denied'));
    let writes = 0;
    const recovered = new ReviewSaveQueue(external, journal, 'pending', async () => { writes++; return external; }, () => {});
    await recovered.retry(external); expect(writes).toBe(0); expect(recovered.pending[0].action.notes).toBe('notes for A'); expect(recovered.error).toContain('changed');
  });
  it('does not acknowledge or advance when browser recovery storage is unavailable', () => {
    const journal = storage(); journal.setItem = () => { throw new Error('Storage full'); };
    const queue = new ReviewSaveQueue(initial(), journal, 'pending', async () => initial(), () => {});
    expect(() => queue.enqueue({ name: 'A', action: action('A') })).toThrow('Storage full'); expect(queue.pending).toHaveLength(0);
  });
});
