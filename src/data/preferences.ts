import { parseJson } from './json';

/** Optional browser preferences must not prevent play. Callers validate their own schema. */
export function readPreference(key: string): unknown {
  try { return parseJson(localStorage.getItem(key) ?? 'null'); }
  catch { return null; }
}
export function savePreference(key: string, value: unknown): boolean {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}

/** Damaged save bytes must be retained before either save owner may replace them. */
export function archiveUnreadable(storage: Pick<Storage, 'getItem' | 'setItem'>, key: string, raw: string): void {
  const archive = `${key}.unreadable`;
  const previous = storage.getItem(archive);
  const values = previous === null ? [] : parseJson(previous);
  if (!Array.isArray(values) || !values.every(value => typeof value === 'string'))
    throw new Error('Unreadable-save archive unavailable');
  if (!values.includes(raw)) storage.setItem(archive, JSON.stringify([...values, raw]));
}
