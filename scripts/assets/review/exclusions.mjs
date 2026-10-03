import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root } from '../../lib/cli.mjs';
import { parseReviews } from '../../../src/assets/asset-review.ts';
/** Completed deletions only. A request never removes files or changes preparation. */
export function deletionExclusions(cwd = root) {
  let reviews;
  try { reviews = parseReviews(JSON.parse(readFileSync(resolve(cwd, 'assets/asset-reviews.json'), 'utf8'))); }
  catch (error) { if (error.code === 'ENOENT') return () => false; throw error; }
  const entries = Object.entries(reviews.deleted);
  return (familyId, url, appearance = 'original') => entries.some(([id, row]) => row.url === url || id === `${familyId}@${appearance}`);
}
