import { isRecord, parseJson } from '../../data/json';
import { readSettings, parseSettings, type GraphicsSettings } from '../../rendering/graphics-settings';
/** Main's browser preferences travel to private review ports without changing them. */
export async function reviewGraphics(): Promise<GraphicsSettings> {
  const response = await fetch('/__asset-review/graphics'); if (!response.ok) throw new Error('Game graphics profile unavailable. Reload the review lab.');
  const profile = parseJson(await response.text()); if (!isRecord(profile)) throw new Error('Invalid game graphics profile.');
  const local = readSettings();
  if (profile.main === true && typeof profile.token === 'string') {
    const saved = await fetch('/__asset-review/graphics', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-lantern-review-token': profile.token }, body: JSON.stringify(local) });
    if (!saved.ok) throw new Error('Unable to share game graphics with review sessions.');
    return local;
  }
  return profile.settings ? parseSettings(profile.settings) : local;
}
