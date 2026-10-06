import type { CharacterSnapshot, StateView } from '../gameplay/state-view';
import type { SavedArea } from '../gameplay/outing';
import type { SlotId } from '../gameplay/adventure-store';
import { isRecord } from './json';

export type AdventureIdentity = { id: string; name: string; deleted: boolean };
/** These snapshots are detached by Adventure and must never be mutated after publication. */
export type AdventureCommit = StateView<{ identity: AdventureIdentity; revision: number; current?: CharacterSnapshot; backup?: CharacterSnapshot }>;
type Header = { identity: AdventureIdentity; revision: number; current?: CharacterSnapshot; backup?: CharacterSnapshot; currentAreas: string[]; backupAreas: string[] };
type AreaRecord = { primary?: StateView<SavedArea>; backup?: StateView<SavedArea> };
export type DatabaseRead = { commit?: AdventureCommit; damaged?: unknown };
export const adventureDatabaseName = 'lantern.adventures.v2';

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error('Adventure database request failed'));
  });
}
function completed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('Adventure transaction aborted'));
    tx.onerror = () => { /* Abort owns the terminal result. */ };
  });
}
function metadata(value?: CharacterSnapshot): CharacterSnapshot | undefined {
  return value && { ...value, outing: { ...value.outing, areas: {} } };
}
export function areaChanges(next: AdventureCommit, previous?: AdventureCommit): string[] {
  const keys = new Set([...Object.keys(next.current?.outing.areas ?? {}), ...Object.keys(next.backup?.outing.areas ?? {}),
    ...Object.keys(previous?.current?.outing.areas ?? {}), ...Object.keys(previous?.backup?.outing.areas ?? {})]);
  return [...keys].filter(id => next.identity.id !== previous?.identity.id
    || next.current?.outing.areas[id] !== previous.current?.outing.areas[id]
    || next.backup?.outing.areas[id] !== previous.backup?.outing.areas[id]);
}

/** One atomic metadata/area transaction, with strict durability where the browser supports it. */
export class AdventureDatabase {
  private constructor(private readonly db: IDBDatabase) {}
  static async open(factory: IDBFactory): Promise<AdventureDatabase> {
    const opening = factory.open(adventureDatabaseName, 1);
    opening.onupgradeneeded = () => {
      for (const name of ['slots', 'areas', 'archives']) opening.result.createObjectStore(name);
    };
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      let blocked = false;
      opening.onblocked = () => { blocked = true; reject(new Error('Close another Lantern window to update saved adventures')); };
      opening.onerror = () => reject(opening.error ?? new Error('Adventure database unavailable'));
      opening.onsuccess = () => { if (blocked) opening.result.close(); else resolve(opening.result); };
    });
    db.onversionchange = () => db.close();
    return new AdventureDatabase(db);
  }
  async read(slot: SlotId): Promise<DatabaseRead> {
    const tx = this.db.transaction(['slots', 'areas'], 'readonly'), done = completed(tx);
    try {
      const raw = await request<unknown>(tx.objectStore('slots').get(slot));
      if (raw === undefined) { await done; return {}; }
      if (!isRecord(raw) || !isRecord(raw.identity) || typeof raw.identity.id !== 'string' || !raw.identity.id
        || typeof raw.identity.name !== 'string' || typeof raw.identity.deleted !== 'boolean'
        || !Number.isSafeInteger(raw.revision) || Number(raw.revision) < 1
        || !Array.isArray(raw.currentAreas) || !raw.currentAreas.every(id => typeof id === 'string')
        || !Array.isArray(raw.backupAreas) || !raw.backupAreas.every(id => typeof id === 'string')) {
        await done; throw new Error('Unreadable adventure identity');
      }
      const header = raw as Header;
      const keys = [...new Set([...header.currentAreas, ...header.backupAreas])];
      const records = await Promise.all(keys.map(id => request<unknown>(tx.objectStore('areas').get([slot, header.identity.id, id]))));
      await done;
      const assemble = (value: unknown, areaIds: string[], kind: keyof AreaRecord): unknown => {
        if (!isRecord(value) || !isRecord(value.outing)) return value;
        const areas = Object.fromEntries(areaIds.map(id => {
          const record = records[keys.indexOf(id)];
          return [id, isRecord(record) ? record[kind] : undefined];
        }));
        return { ...value, outing: { ...value.outing, areas } };
      };
      // The store validates whole candidates, retaining the exact raw transaction for archival on recovery.
      return { commit: { identity: header.identity, revision: header.revision,
        current: assemble(header.current, header.currentAreas, 'primary') as CharacterSnapshot | undefined,
        backup: assemble(header.backup, header.backupAreas, 'backup') as CharacterSnapshot | undefined }, damaged: { header: raw, keys, records } };
    } catch (error) { await done; throw error; }
  }
  async write(slot: SlotId, next: AdventureCommit, previous?: AdventureCommit, damaged?: unknown): Promise<void> {
    const tx = this.db.transaction(['slots', 'areas', 'archives'], 'readwrite', { durability: 'strict' }), done = completed(tx);
    try {
      const slots = tx.objectStore('slots'), areas = tx.objectStore('areas');
      const existing = await request<unknown>(slots.get(slot));
      if (existing !== undefined && (!isRecord(existing) || existing.revision !== previous?.revision))
        throw new Error('Adventure changed in another window; reload before saving');
      if (existing === undefined && previous) throw new Error('Adventure database was removed; reload before saving');
      if (damaged !== undefined) tx.objectStore('archives').put(damaged, [slot, previous?.revision ?? 0]);
      if (previous && previous.identity.id !== next.identity.id) {
        for (const id of new Set([...Object.keys(previous.current?.outing.areas ?? {}), ...Object.keys(previous.backup?.outing.areas ?? {})]))
          areas.delete([slot, previous.identity.id, id]);
      }
      if (damaged !== undefined && isRecord(damaged) && Array.isArray(damaged.keys)) {
        for (const id of damaged.keys) if (typeof id === 'string' && !next.current?.outing.areas[id] && !next.backup?.outing.areas[id])
          areas.delete([slot, next.identity.id, id]);
      }
      for (const id of areaChanges(next, damaged === undefined ? previous : undefined)) {
        const record: AreaRecord = { primary: next.current?.outing.areas[id], backup: next.backup?.outing.areas[id] };
        const key = [slot, next.identity.id, id];
        if (record.primary || record.backup) areas.put(record, key); else areas.delete(key);
      }
      const header: Header = { identity: next.identity, revision: next.revision, current: metadata(next.current), backup: metadata(next.backup),
        currentAreas: Object.keys(next.current?.outing.areas ?? {}), backupAreas: Object.keys(next.backup?.outing.areas ?? {}) };
      slots.put(header, slot);
      await done;
    } catch (error) {
      try { tx.abort(); } catch { /* A completed/aborted transaction cannot be aborted again. */ }
      await done.catch(() => {});
      throw error;
    }
  }
  close(): void { this.db.close(); }
}
