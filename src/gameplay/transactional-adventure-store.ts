import { AdventureDatabase, type AdventureCommit, type AdventureIdentity } from '../data/adventure-database';
import { archiveUnreadable } from '../data/preferences';
import { isRecord, parseJson } from '../data/json';
import { RetryTimer } from '../data/retry';
import { AdventureStore, slotIds, validAdventureName, type AdventureSlot, type SavedAdventure, type SlotId } from './adventure-store';
import { character, type CharacterSave } from './character';
import { copyCharacter } from './character-save';
import type { SavedArea } from './outing';

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Delta = { metadata: CharacterSave; areaIds: string[]; areas: Record<string, SavedArea> };
type Journal = { version: 1; baseIdentity?: string; identity: AdventureIdentity; revision: number; current?: Delta; backup?: Delta };
type Slot = { state: AdventureSlot['state']; latest?: AdventureCommit; persisted?: AdventureCommit; damaged?: unknown; journalBlocked?: boolean };
export const indexedAdventureKey = (slot: SlotId) => `lantern.adventure.${slot}.indexed.v2`;
export const pendingAdventureKey = (slot: SlotId) => `lantern.adventure.${slot}.pending.v2`;

function delta(value: CharacterSave | undefined, baseline: CharacterSave | undefined): Delta | undefined {
  if (!value) return;
  const areas = value.outing.areas;
  return { metadata: { ...value, outing: { ...value.outing, areas: {} } }, areaIds: Object.keys(areas),
    areas: Object.fromEntries(Object.entries(areas).filter(([id, area]) => area !== baseline?.outing.areas[id])) };
}
function restoreDelta(value: unknown, baseline?: CharacterSave): CharacterSave | undefined {
  if (value === undefined) return;
  if (!isRecord(value) || !isRecord(value.metadata) || !isRecord(value.metadata.outing) || !isRecord(value.areas)
    || !Array.isArray(value.areaIds) || !value.areaIds.every(id => typeof id === 'string')
    || new Set(value.areaIds).size !== value.areaIds.length) throw new Error('Invalid pending adventure');
  const changed = value.areas;
  const areas = Object.fromEntries(value.areaIds.map(id => [id, Object.hasOwn(changed, id) ? changed[id] : baseline?.outing.areas[id]]));
  return copyCharacter({ ...value.metadata, outing: { ...value.metadata.outing, areas } });
}
function identity(value: unknown): AdventureIdentity {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || typeof value.name !== 'string'
    || !validAdventureName(value.name) || typeof value.deleted !== 'boolean') throw new Error('Invalid pending identity');
  return { id: value.id, name: value.name, deleted: value.deleted };
}

/** Application persistence: immutable operation snapshots, incremental journal and atomic area writes. */
export class TransactionalAdventureStore {
  private readonly slots = Object.fromEntries(slotIds.map(id => [id, { state: 'unknown' }])) as Record<SlotId, Slot>;
  private readonly retry = new RetryTimer();
  private readonly listeners = new Set<() => void>();
  private database?: AdventureDatabase;
  private initializing?: Promise<void>;
  private writing?: Promise<void>;
  private closed = false;
  private error = '';
  constructor(private readonly source: Storage | (() => Storage), private readonly factory: () => IDBFactory,
    private readonly newId = () => crypto.randomUUID()) {}
  private storage(): Storage { return typeof this.source === 'function' ? this.source() : this.source; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private changed(): void { for (const listener of this.listeners) listener(); }
  async initialize(): Promise<void> {
    if (this.closed) return;
    if (this.initializing) return this.initializing;
    const operation = this.read(); this.initializing = operation;
    try { await operation; } finally { this.initializing = undefined; }
  }
  private async read(): Promise<void> {
    try {
      this.database ??= await AdventureDatabase.open(this.factory());
      if (this.closed) { this.database.close(); return; }
      let legacy: AdventureStore | undefined;
      try {
        for (const slot of slotIds) {
          if (this.closed) return;
          const state = this.slots[slot];
          if (state.latest && !state.journalBlocked) continue; // Never downgrade a known/pending snapshot during retry.
          try {
            if (state.latest && state.journalBlocked) {
              const raw = this.storage().getItem(pendingAdventureKey(slot));
              if (raw !== null) archiveUnreadable(this.storage(), pendingAdventureKey(slot), raw);
              state.journalBlocked = false;
              state.state = state.latest.identity.deleted ? 'empty' : 'occupied';
              this.journal(slot, state);
              continue;
            }
            const read = await this.database.read(slot);
            let commit = read.commit;
            if (commit) {
              identity(commit.identity);
              this.markMigrated(slot);
              if (commit.identity.deleted) commit = { identity: commit.identity, revision: commit.revision };
              else {
                let current: CharacterSave | undefined, backup: CharacterSave | undefined;
                try { if (commit.current) current = copyCharacter(commit.current); } catch { /* Recover the validated backup. */ }
                try { if (commit.backup) backup = copyCharacter(commit.backup); } catch { /* Archive before replacing damaged records. */ }
                state.persisted = { identity: commit.identity, revision: commit.revision, current, backup };
                if (!current || !backup) state.damaged = read.damaged;
                if (current || backup) {
                  commit = { ...commit, current: current ?? backup, backup: backup ?? current };
                  state.persisted = commit;
                }
                else { state.state = 'occupied'; continue; }
              }
              state.persisted = commit;
            } else {
              if (this.storage().getItem(indexedAdventureKey(slot)) === 'true') { state.state = 'occupied'; continue; }
              legacy ??= new AdventureStore(this.storage(), this.newId);
              legacy.initialize();
              const saved = legacy.load(slot), view = legacy.views().find(view => view.slot === slot)!;
              if (!saved && view.state !== 'empty') { state.state = view.state; continue; }
              commit = { identity: { id: saved?.id ?? this.newId(), name: saved?.name ?? `Adventure ${slot}`, deleted: !saved }, revision: 1,
                current: saved?.character, backup: saved?.character };
            }
            state.latest = commit;
            state.journalBlocked = false;
            this.restoreJournal(slot, state);
            state.state = state.latest.identity.deleted ? 'empty' : 'occupied';
            if (state.damaged) state.latest = { ...state.latest, revision: state.latest.revision + 1 };
            this.journal(slot, state);
          } catch (error) {
            this.error = String(error);
            if (!state.latest) state.state = 'unknown';
          }
        }
      } finally { legacy?.close(); }
      await this.flush();
      if (slotIds.some(slot => this.slots[slot].state === 'unknown' || this.slots[slot].journalBlocked))
        this.retry.schedule(() => { this.initialize().catch((error: unknown) => { this.error = String(error); }); });
    } catch (error) {
      this.error = String(error);
      if (!this.closed) this.retry.schedule(() => { this.initialize().catch((error: unknown) => { this.error = String(error); }); });
    }
    this.changed();
  }
  private restoreJournal(slot: SlotId, state: Slot): void {
    const raw = this.storage().getItem(pendingAdventureKey(slot));
    if (raw === null) return;
    try {
      const value = parseJson(raw);
      if (!isRecord(value) || value.version !== 1 || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1)
        throw new Error('Invalid pending adventure');
      const owner = identity(value.identity);
      // A committed newer revision wins, including a deletion/recreated slot.
      if (state.persisted && Number(value.revision) <= state.persisted.revision) { this.storage().removeItem(pendingAdventureKey(slot)); return; }
      if (state.persisted && owner.id !== state.persisted.identity.id && value.baseIdentity !== state.persisted.identity.id)
        throw new Error('Pending adventure belongs to an obsolete slot');
      const baseline = state.persisted?.identity.id === owner.id ? state.persisted.current : undefined;
      const current = restoreDelta(value.current, baseline), backup = restoreDelta(value.backup, baseline);
      if (!owner.deleted && !current) throw new Error('Pending adventure has no character');
      state.latest = { identity: owner, revision: Number(value.revision), current, backup };
    } catch (error) {
      // Preservation failure blocks replacement of the journal, rather than destroying its only bytes.
      try { archiveUnreadable(this.storage(), pendingAdventureKey(slot), raw); this.storage().removeItem(pendingAdventureKey(slot)); }
      catch { state.journalBlocked = true; throw error; }
    }
  }
  private markMigrated(slot: SlotId): void {
    const storage = this.storage();
    if (storage.getItem(indexedAdventureKey(slot)) !== 'true') storage.setItem(indexedAdventureKey(slot), 'true');
  }
  private journal(slot: SlotId, state: Slot): void {
    if (!state.latest || state.journalBlocked || state.latest === state.persisted) return;
    const next = state.latest, baseline = state.persisted?.identity.id === next.identity.id ? state.persisted.current : undefined;
    const value: Journal = { version: 1, baseIdentity: state.persisted?.identity.id, identity: next.identity, revision: next.revision, current: delta(next.current, baseline), backup: delta(next.backup, baseline) };
    this.storage().setItem(pendingAdventureKey(slot), JSON.stringify(value));
  }
  views(): AdventureSlot[] {
    return slotIds.map(slot => {
      const value = this.slots[slot];
      return { slot, state: value.state, name: value.latest?.identity.name ?? `Adventure ${slot}`, checkpoint: value.latest?.current?.outing.checkpoint };
    });
  }
  async load(slot: SlotId): Promise<SavedAdventure | null> {
    if (!this.slots[slot].latest) await this.initialize();
    const value = this.slots[slot].latest;
    return value?.current && !value.identity.deleted ? { slot, id: value.identity.id, name: value.identity.name, character: copyCharacter(value.current) } : null;
  }
  async create(slot: SlotId, name: string): Promise<SavedAdventure | null> {
    if (!validAdventureName(name) || this.closed) return null;
    await this.initialize();
    const state = this.slots[slot];
    if (this.closed || state.state !== 'empty') return null;
    const current = character();
    this.publish(slot, { identity: { id: this.newId(), name, deleted: false }, revision: (state.latest?.revision ?? 0) + 1, current, backup: current });
    return this.load(slot);
  }
  /** Only detached, immutable snapshots from Adventure's commit boundary may be published. */
  save(slot: SlotId, id: string, value: CharacterSave): void {
    const previous = this.slots[slot].latest;
    if (this.closed || previous?.identity.id !== id || previous.identity.deleted) return;
    this.publish(slot, { identity: previous.identity, revision: previous.revision + 1, current: value, backup: previous.current });
  }
  async delete(slot: SlotId): Promise<void> {
    if (this.closed) return;
    await this.initialize();
    const state = this.slots[slot];
    if (this.closed || state.state === 'empty') return;
    if (state.state === 'unknown') throw new Error('Saved progress could not be read. Try again.');
    const previous = state.latest ?? state.persisted;
    this.publish(slot, { identity: { id: previous?.identity.id ?? this.newId(), name: previous?.identity.name ?? `Adventure ${slot}`, deleted: true },
      revision: (state.latest?.revision ?? state.persisted?.revision ?? 0) + 1 });
  }
  private publish(slot: SlotId, next: AdventureCommit): void {
    const state = this.slots[slot];
    state.latest = next; state.state = next.identity.deleted ? 'empty' : 'occupied';
    try { this.journal(slot, state); } catch (error) { this.error = String(error); }
    this.flush().catch((error: unknown) => { this.error = String(error); });
    this.changed();
  }
  async flush(): Promise<void> {
    if (this.writing) return this.writing;
    if (!this.database) return;
    const operation = this.write(); this.writing = operation;
    try { await operation; } finally { this.writing = undefined; }
  }
  private async write(): Promise<void> {
    try {
      do {
        for (const slot of slotIds) {
          const state = this.slots[slot];
          while (state.latest && state.latest !== state.persisted && !state.journalBlocked) {
            const next = state.latest;
            await this.database!.write(slot, next, state.persisted, state.damaged);
            state.persisted = next; state.damaged = undefined;
            this.markMigrated(slot);
            if (state.latest === next) this.storage().removeItem(pendingAdventureKey(slot));
            else this.journal(slot, state);
          }
        }
      } while (slotIds.some(slot => this.slots[slot].latest && this.slots[slot].latest !== this.slots[slot].persisted && !this.slots[slot].journalBlocked));
      if (slotIds.every(slot => this.slots[slot].state !== 'unknown' && !this.slots[slot].journalBlocked)) { this.retry.reset(); this.error = ''; }
    } catch (error) {
      this.error = String(error);
      if (!this.closed) this.retry.schedule(() => { this.flush().catch((error: unknown) => { this.error = String(error); }); });
    }
    this.changed();
  }
  /** The incremental synchronous journal is the exit boundary; never depend on an unload IDB callback. */
  close(): void {
    if (this.closed) return;
    this.closed = true; this.retry.cancel();
    for (const slot of slotIds) {
      try { this.journal(slot, this.slots[slot]); } catch (error) { this.error = String(error); }
    }
    if (this.writing) this.writing.finally(() => this.database?.close()).catch((error: unknown) => { this.error = String(error); });
    else this.database?.close();
  }
  diagnostics() { return { loaded: slotIds.every(slot => this.slots[slot].state !== 'unknown'), failures: this.retry.attempts, pending: Object.values(this.slots).some(slot => (!!slot.latest && slot.latest !== slot.persisted) || slot.journalBlocked), error: this.error }; }
}
