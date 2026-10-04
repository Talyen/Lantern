import { archiveUnreadable } from '../data/preferences';
import { character, type CharacterSave } from './character';
import { characterSaveKey, characterBackupKey, decodeCharacter } from './character-save';
import { isRecord, parseJson } from '../data/json';
import { RetryTimer } from '../data/retry';

export const slotIds = [1, 2, 3, 4] as const;
export type SlotId = typeof slotIds[number];
export const slotKey = (slot: SlotId) => `lantern.adventure.${slot}.v1`;
export const migrationKey = 'lantern.adventures.legacy-migrated.v1';
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Identity = { version: 1; id: string; name: string; deleted: boolean; legacy?: true };
type Record = { version: 1; id: string; name: string; character: CharacterSave };
type Slot = { state: 'unknown' | 'empty' | 'occupied'; identity?: Identity; record?: Record; dirty: boolean };
export type AdventureSlot = { slot: SlotId; state: Slot['state']; name: string; checkpoint?: string };
export type SavedAdventure = { slot: SlotId; id: string; name: string; character: CharacterSave };

export function validAdventureName(name: string): boolean {
  return name === name.trim() && name.length > 0 && Array.from(name).length <= 24 && !/[\p{Cc}\p{Cf}]/u.test(name);
}
function decodeIdentity(raw: string): Identity {
  const value = parseJson(raw);
  if (!isRecord(value) || value.version !== 1 || typeof value.id !== 'string' || !value.id
    || typeof value.name !== 'string' || !validAdventureName(value.name) || typeof value.deleted !== 'boolean'
    || value.legacy !== undefined && value.legacy !== true)
    throw new Error('Invalid adventure identity');
  return value as Identity;
}
function decodeRecord(raw: string): Record {
  const value = parseJson(raw);
  if (!isRecord(value) || value.version !== 1 || typeof value.id !== 'string' || !value.id
    || typeof value.name !== 'string' || !validAdventureName(value.name)) throw new Error('Invalid adventure');
  return { version: 1, id: value.id, name: value.name, character: decodeCharacter(JSON.stringify(value.character)) };
}

/** Application lifetime owns snapshots/retries; gameplay never knows browser storage or slot keys. */
export class AdventureStore {
  private slots = new Map<SlotId, Slot>(slotIds.map(id => [id, { state: 'unknown', dirty: false }]));
  private readonly retry = new RetryTimer();
  private readonly listeners = new Set<() => void>();
  private legacyResolved = false;
  private migrationPending = false;
  private legacyProtected = false;
  private closed = false;
  private error = '';
  constructor(private readonly source: Storage | (() => Storage), private readonly newId = () => crypto.randomUUID()) {}
  private storage(): Storage { return typeof this.source === 'function' ? this.source() : this.source; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private changed(): void { for (const listener of this.listeners) listener(); }

  initialize(): void {
    for (const slot of slotIds) if (!this.slots.get(slot)!.dirty) this.readSlot(slot);
    if (!this.legacyResolved) this.migrate();
    if (this.legacyProtected && this.slots.get(1)!.state === 'empty') this.slots.set(1, { state: 'occupied', dirty: false });
    this.flush();
    this.changed();
  }
  private readSlot(slot: SlotId): void {
    const current = this.slots.get(slot)!;
    try {
      const storage = this.storage(), key = slotKey(slot);
      const identityRaw = storage.getItem(`${key}.identity`);
      const identity = identityRaw === null ? undefined : decodeIdentity(identityRaw);
      if (identity?.deleted) { this.slots.set(slot, { state: 'empty', identity, dirty: false }); return; }
      const primary = storage.getItem(key), backup = storage.getItem(`${key}.backup`);
      const candidate = (raw: string | null): Record | undefined => {
        if (raw === null) return;
        try {
          const value = decodeRecord(raw);
          if (!identity || value.id === identity.id && value.name === identity.name) return value;
        } catch { /* Only validated snapshots may become active. */ }
      };
      // A known latest snapshot is safer than a previous backup after primary damage.
      const known = current.record && (!identity || identity.id === current.record.id) ? current.record : undefined;
      const record = candidate(primary) ?? known ?? candidate(backup);
      if (record) {
        this.slots.set(slot, { state: 'occupied', record,
          identity: identity ?? { version: 1, id: record.id, name: record.name, deleted: false },
          dirty: primary !== JSON.stringify(record) || !identity });
      } else this.slots.set(slot, { state: primary === null && backup === null && !identity ? 'empty' : 'occupied', identity, dirty: false });
    } catch (error) {
      // An unreadable identity is authoritative: never guess a previous incarnation from its backup.
      this.error = String(error);
      this.slots.set(slot, { ...current, state: current.record ? 'occupied' : 'unknown' });
    }
  }
  private migrate(): void {
    try {
      const storage = this.storage();
      const first = this.slots.get(1)!;
      if (storage.getItem(migrationKey) === 'true') { this.legacyResolved = true; return; }
      // An identity can survive a failure before either migrated snapshot exists.
      // Only an explicitly migrated identity may retry from the retained legacy save.
      const interrupted = first.identity?.legacy && !first.identity.deleted && !first.record;
      if (first.identity && !interrupted) { this.legacyResolved = true; this.migrationPending = !!first.record; return; }
      if (first.state === 'unknown') return;
      const primary = storage.getItem(characterSaveKey), backup = storage.getItem(characterBackupKey);
      if (first.state === 'occupied' && !interrupted) { this.legacyResolved = true; return; }
      if (primary === null && backup === null) { this.legacyResolved = true; return; }
      let saved: CharacterSave | undefined;
      for (const raw of [primary, backup]) {
        if (raw === null) continue;
        try { saved = decodeCharacter(raw); break; } catch { /* Keep legacy copies intact. */ }
      }
      this.legacyResolved = true;
      if (!saved) { this.legacyProtected = true; this.slots.set(1, { state: 'occupied', dirty: false }); return; }
      const identity: Identity = first.identity ?? { version: 1, id: this.newId(), name: 'Adventure 1', deleted: false, legacy: true };
      this.slots.set(1, { state: 'occupied', identity, record: { version: 1, id: identity.id, name: identity.name, character: saved }, dirty: true });
      this.migrationPending = true;
    } catch (error) { this.error = String(error); }
  }
  views(): AdventureSlot[] {
    return slotIds.map(slot => {
      const value = this.slots.get(slot)!;
      return { slot, state: !this.legacyResolved && value.state === 'empty' ? 'unknown' : value.state,
        name: value.record?.name ?? value.identity?.name ?? `Adventure ${slot}`, checkpoint: value.record?.character.outing.checkpoint };
    });
  }
  load(slot: SlotId): SavedAdventure | null {
    const value = this.slots.get(slot)!;
    if (!value.dirty) this.initialize();
    const record = this.slots.get(slot)!.record;
    return record ? { slot, id: record.id, name: record.name, character: decodeCharacter(JSON.stringify(record.character)) } : null;
  }
  create(slot: SlotId, name: string): SavedAdventure | null {
    if (!validAdventureName(name) || this.closed) return null;
    this.initialize();
    if (!this.legacyResolved || this.slots.get(slot)!.state !== 'empty') return null;
    const identity: Identity = { version: 1, id: this.newId(), name, deleted: false };
    this.slots.set(slot, { state: 'occupied', identity, record: { version: 1, id: identity.id, name, character: character() }, dirty: true });
    this.flush(); this.changed();
    return this.load(slot);
  }
  save(slot: SlotId, id: string, value: CharacterSave): void {
    const current = this.slots.get(slot)!;
    if (this.closed || current.record?.id !== id) return;
    current.record.character = decodeCharacter(JSON.stringify(value));
    current.dirty = true;
    if (!this.retry.scheduled) this.flush();
  }
  delete(slot: SlotId): void {
    if (this.closed) return;
    const current = this.slots.get(slot)!;
    if (current.state === 'empty') return;
    const identity: Identity = { version: 1, id: current.identity?.id ?? this.newId(), name: current.record?.name ?? current.identity?.name ?? `Adventure ${slot}`, deleted: true };
    this.slots.set(slot, { state: 'empty', identity, dirty: true });
    if (slot === 1) { this.legacyResolved = true; this.legacyProtected = false; }
    this.flush(); this.changed();
  }

  private writeSlot(slot: SlotId, value: Slot): void {
    const storage = this.storage(), key = slotKey(slot), identity = value.identity!;
    // Identity is written first. A failed creation/deletion cannot recover an older incarnation.
    const identityRaw = JSON.stringify(identity);
    if (storage.getItem(`${key}.identity`) !== identityRaw) storage.setItem(`${key}.identity`, identityRaw);
    if (identity.deleted) {
      storage.removeItem(key); storage.removeItem(`${key}.backup`);
    } else {
      const next = JSON.stringify(value.record), primary = storage.getItem(key), backup = storage.getItem(`${key}.backup`);
      let previous: Record | undefined;
      if (primary !== null) {
        try { previous = decodeRecord(primary); } catch { archiveUnreadable(storage, key, primary); }
      }
      if (backup !== null) {
        try { decodeRecord(backup); } catch { archiveUnreadable(storage, `${key}.backup`, backup); }
      }
      if (primary !== next) {
        storage.setItem(`${key}.backup`, previous?.id === identity.id ? primary! : next);
        storage.setItem(key, next);
      }
      if (storage.getItem(key) !== next) throw new Error('Adventure write could not be verified');
    }
    value.dirty = false;
  }
  flush(): void {
    let failed = false;
    for (const slot of slotIds) {
      const value = this.slots.get(slot)!;
      if (!value.dirty) continue;
      try { this.writeSlot(slot, value); } catch (error) { this.error = String(error); failed = true; }
    }
    if (this.migrationPending && !this.slots.get(1)!.dirty) {
      try { this.storage().setItem(migrationKey, 'true'); this.migrationPending = false; }
      catch (error) { this.error = String(error); failed = true; }
    }
    if (failed || !this.legacyResolved || [...this.slots.values()].some(slot => slot.state === 'unknown')) {
      if (!this.closed) this.retry.schedule(() => { if (!this.legacyResolved || [...this.slots.values()].some(slot => slot.state === 'unknown')) this.initialize(); else { this.flush(); this.changed(); } });
    } else { this.retry.reset(); this.error = ''; }
  }
  close(): void { this.closed = true; this.retry.cancel(); this.flush(); }
  diagnostics() { return { pending: [...this.slots.values()].some(slot => slot.dirty) || this.migrationPending, error: this.error }; }
}
