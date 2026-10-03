/** Private visual experiments: never parsed as player preferences or enabled in builds. */
export const comparisonPresets = {
  baseline: { sharpness: .5, mipOffset: 0, foliageMotion: false, reactiveCoverage: false },
  'sharpness-0': { sharpness: 0, mipOffset: 0, foliageMotion: false, reactiveCoverage: false },
  'sharpness-1': { sharpness: 1, mipOffset: 0, foliageMotion: false, reactiveCoverage: false },
  'foliage-motion': { sharpness: .5, mipOffset: 0, foliageMotion: true, reactiveCoverage: false },
  'reactive-coverage': { sharpness: .5, mipOffset: 0, foliageMotion: false, reactiveCoverage: true },
  'mip-minus-half': { sharpness: .5, mipOffset: -.5, foliageMotion: false, reactiveCoverage: false },
  'mip-minus-one': { sharpness: .5, mipOffset: -1, foliageMotion: false, reactiveCoverage: false },
} as const;
export type ComparisonPreset = keyof typeof comparisonPresets;
const query = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
const requested = query.get('fsrCompare');
export let comparisonPreset = import.meta.env.DEV && query.get('author') === 'levels' && requested && Object.hasOwn(comparisonPresets, requested) ? requested as ComparisonPreset : null;
export let fsrComparison: typeof comparisonPresets[ComparisonPreset] | null = comparisonPreset ? comparisonPresets[comparisonPreset] : null;
let randomState = 74103;
export function resetComparisonRandom(seed = 74103): void { randomState = seed; }
export function comparisonRandom(): number {
  randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
  return randomState / 4294967296;
}

export function selectComparisonPreset(name: string): void {
  if (!import.meta.env.DEV || !fsrComparison || !Object.hasOwn(comparisonPresets, name)) throw new Error('Unknown or unavailable comparison preset.');
  comparisonPreset = name as ComparisonPreset; fsrComparison = comparisonPresets[comparisonPreset];
}
