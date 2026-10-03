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
