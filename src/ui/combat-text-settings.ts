import { isRecord, parseJson } from '../data/json';

export type CombatTextSettings = {
  outgoing: boolean;
  incoming: boolean;
  healing: boolean;
  blocks: boolean;
  size: 'normal' | 'large';
};
export const combatTextDefaults = (): CombatTextSettings => ({ outgoing: true, incoming: true, healing: true, blocks: true, size: 'normal' });
const storageKey = 'lantern.combat-text.v1';
export function readCombatTextSettings(): CombatTextSettings {
  const settings = combatTextDefaults();
  try {
    const saved = parseJson(localStorage.getItem(storageKey) ?? '{}');
    if (!isRecord(saved)) return settings;
    for (const key of ['outgoing', 'incoming', 'healing', 'blocks'] as const) if (typeof saved[key] === 'boolean') settings[key] = saved[key];
    if (saved.size === 'normal' || saved.size === 'large') settings.size = saved.size;
  } catch { /* Unavailable preferences must not prevent play. */ }
  return settings;
}
export function saveCombatTextSettings(settings: CombatTextSettings): void {
  try { localStorage.setItem(storageKey, JSON.stringify(settings)); } catch { /* Retain the session's working preferences. */ }
}
