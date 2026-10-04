import { isRecord, parseJson } from '../../data/json';
import { parseReviews, reviewStates, type AssetReviews, type ReviewAction } from '../../assets/asset-review';

export type SavedReviews = { reviews: AssetReviews; revision: string };
export type PendingReview = { action: ReviewAction; name: string };
type Journal = SavedReviews & { pending: PendingReview[] };
type QueueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Advance independently of disk saves, but send CAS writes strictly in order. */
export class ReviewSaveQueue {
  pending: PendingReview[] = [];
  error?: string;
  running = false;
  private saved: SavedReviews;
  // Tab-scoped recovery keeps a reload safe without sharing pending writes between tabs.
  static tabStorage(): QueueStorage { return sessionStorage; }
  constructor(saved: SavedReviews, private storage: QueueStorage, private key: string,
    private send: (revision: string, action: ReviewAction) => Promise<SavedReviews>,
    private changed: () => void) {
    this.saved = { reviews: saved.reviews, revision: saved.revision };
    const text = storage.getItem(key);
    if (text) {
      const journal = parseJson(text);
      if (!isRecord(journal) || typeof journal.revision !== 'string' || !Array.isArray(journal.pending)) throw new Error('Invalid pending review decisions. Preserve this tab before clearing its storage.');
      const reviews = parseReviews(journal.reviews);
      for (const row of journal.pending) {
        const action = isRecord(row) && isRecord(row.action) ? row.action : undefined;
        if (!isRecord(row) || typeof row.name !== 'string' || !action || typeof action.id !== 'string' || typeof action.notes !== 'string' || action.notes.length > 4000
          || !(action.type === 'family-deny' || action.type === 'family-clear' || action.type === 'decision' && reviewStates.some(state => state === action.state) && (action.fingerprint === null || typeof action.fingerprint === 'string'))) throw new Error('Invalid pending review action.');
      }
      this.saved = { revision: journal.revision, reviews }; this.pending = journal.pending as PendingReview[];
      this.reconcile(saved);
    }
  }
  get committed(): SavedReviews { return this.saved; }
  has(id: string): boolean { return this.pending.some(row => row.action.id === id); }
  enqueue(row: PendingReview): void {
    // Persist before removing this appearance from the visible queue.
    const pending = [...this.pending, row]; this.persist(this.saved, pending); this.pending = pending;
    this.changed(); this.drain().catch((error: unknown) => { this.error = String(error); this.changed(); });
  }
  private persist(saved = this.saved, pending = this.pending): void {
    if (pending.length) this.storage.setItem(this.key, JSON.stringify({ reviews: saved.reviews, revision: saved.revision, pending } satisfies Journal));
    else this.storage.removeItem(this.key);
  }
  /** A response can be lost after a successful write. Accept only that exact action's change. */
  reconcile(current: SavedReviews): void {
    if (current.revision === this.saved.revision) { this.error = undefined; return; }
    const action = this.pending[0]?.action;
    if (action && this.onlyActionChanged(current.reviews, action)) {
      this.persist(current, this.pending.slice(1)); this.pending.shift(); this.saved = current; this.error = undefined;
    } else this.error = 'Review records changed. Pending decisions were retained. Retry after resolving the conflict, or discard pending decisions and Reload.';
  }
  private onlyActionChanged(current: AssetReviews, action: ReviewAction): boolean {
    const expected = structuredClone(this.saved.reviews);
    if (action.type === 'decision') {
      const row = current.decisions[action.id];
      if (!row || row.state !== action.state || row.notes !== action.notes || action.state === 'approved' && row.fingerprint !== action.fingerprint) return false;
      expected.decisions[action.id] = row;
    } else {
      const family = action.id.slice(0, action.id.indexOf('@'));
      if (action.type === 'family-deny') {
        const row = current.familyDenials[family]; if (!row || row.notes !== action.notes) return false;
        expected.familyDenials[family] = row;
      } else delete expected.familyDenials[family];
    }
    return JSON.stringify(expected) === JSON.stringify(current);
  }
  async retry(current: SavedReviews): Promise<void> { this.reconcile(current); this.changed(); await this.drain(); }
  discard(): void {
    if (this.running) throw new Error('Wait for the current save before discarding pending decisions.');
    this.storage.removeItem(this.key); this.pending = []; this.error = undefined; this.changed();
  }
  async drain(): Promise<void> {
    if (this.running || this.error || !this.pending.length) return;
    this.running = true; this.changed();
    try {
      while (this.pending.length) {
        const result = await this.send(this.saved.revision, this.pending[0].action);
        // Checkpoint before acknowledging it. Reload can reconcile a lost acknowledgement.
        this.persist(result, this.pending.slice(1)); this.saved = result; this.pending.shift(); this.changed();
      }
    } catch (error) { this.error = String(error); }
    finally { this.running = false; this.changed(); }
  }
}
