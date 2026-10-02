import { RetryTimer, storageRetryDelays } from '../data/retry';
import {
  character,
  characterBackupKey,
  characterSaveKey,
  decodeCharacter,
  type CharacterSave,
} from './character-save';

export type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
export type StorageSource = Storage | (() => Storage);

/** One latest snapshot, one retry timer. Persistence never owns an active character. */
export class CharacterPersistence {
  private loaded = false;
  private pending: string | null = null;
  private readonly retry = new RetryTimer();
  private error = '';
  private blockedByExisting = false;
  private closed = false;
  constructor(private readonly source?: StorageSource) {}
  private storage(): Storage {
    if (!this.source) throw new Error('Storage unavailable');
    return typeof this.source === 'function' ? this.source() : this.source;
  }
  private decode(raw: string | null): CharacterSave | null {
    if (raw === null) return null;
    try {
      return decodeCharacter(raw);
    } catch {
      return null;
    }
  }
  private preserve(storage: Storage, key: string, raw: string): void {
    const archiveKey = `${key}.unreadable`,
      existing = storage.getItem(archiveKey);
    const archived: unknown = existing === null ? [] : JSON.parse(existing);
    if (!Array.isArray(archived) || !archived.every((value) => typeof value === 'string'))
      throw new Error('Unreadable-save archive unavailable');
    if (!archived.includes(raw)) storage.setItem(archiveKey, JSON.stringify([...archived, raw]));
  }
  private read(): { value: CharacterSave; existing: boolean } {
    const storage = this.storage(),
      raw = storage.getItem(characterSaveKey);
    const primary = this.decode(raw);
    if (primary) {
      this.loaded = true;
      return { value: primary, existing: true };
    }
    const backupRaw = storage.getItem(characterBackupKey),
      backup = this.decode(backupRaw);
    // Preserve every unreadable copy before a replacement is permitted.
    if (raw !== null) this.preserve(storage, characterSaveKey, raw);
    if (backupRaw !== null && !backup) this.preserve(storage, characterBackupKey, backupRaw);
    this.loaded = true;
    return { value: backup ?? character(), existing: !!backup };
  }
  load(): CharacterSave | null {
    if (!this.source || this.loaded || this.pending !== null) return null;
    try {
      const result = this.read();
      this.error = '';
      return result.value;
    } catch (error) {
      this.error = String(error);
      return null;
    }
  }
  /** Startup gets two further read attempts before falling back to in-memory play. */
  async initialize(): Promise<CharacterSave | null> {
    if (!this.source || this.loaded || this.pending !== null) return null;
    for (const delay of storageRetryDelays.slice(0, 2)) {
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
      const value = this.load();
      if (value) return value;
    }
    return null;
  }
  request(value: CharacterSave): void {
    if (!this.source || this.closed) return;
    this.pending = JSON.stringify(value);
    if (!this.retry.scheduled) this.flush();
  }
  private flush(): void {
    if (this.pending === null) return;
    try {
      if (this.blockedByExisting) throw new Error('Existing progress awaits next startup');
      if (!this.loaded) {
        const recovered = this.read();
        // A late successful read must never replace the active in-memory session
        // or overwrite progress that was unknown when that session began.
        if (recovered.existing) {
          this.blockedByExisting = true;
          throw new Error('Existing progress awaits next startup');
        }
      }
      const storage = this.storage(),
        raw = storage.getItem(characterSaveKey);
      if (raw !== this.pending) {
        decodeCharacter(this.pending);
        if (raw !== null) {
          if (this.decode(raw)) {
            const backup = storage.getItem(characterBackupKey);
            if (backup !== null && !this.decode(backup)) this.preserve(storage, characterBackupKey, backup);
            storage.setItem(characterBackupKey, raw);
          }
          else this.preserve(storage, characterSaveKey, raw);
        }
        storage.setItem(characterSaveKey, this.pending);
      }
      this.pending = null;
      this.retry.reset();
      this.error = '';
    } catch (error) {
      this.error = String(error);
      if (!this.closed && !this.blockedByExisting) {
        this.retry.schedule(() => this.flush());
      }
    }
  }
  close(value: CharacterSave): void {
    if (this.closed) return;
    this.retry.cancel();
    this.closed = true;
    if (this.source) {
      this.pending = JSON.stringify(value);
      this.flush();
    }
  }
  diagnostics() {
    return {
      pending: this.pending !== null,
      loaded: this.loaded,
      failures: this.retry.attempts,
      blockedByExisting: this.blockedByExisting,
      error: this.error,
    };
  }
}
