import type { AreaLighting, ProbeLighting } from './types.ts';

export type AutoProbes = { spacing: number; bottom: number; height: number; padding: number; intensity: number; bounces: number };
export type LightingOverrides = {
  fogNear?: number; fogFar?: number;
  sun?: Partial<Pick<AreaLighting['sun'], 'position' | 'shadowExtent'>>;
  probes?: Partial<ProbeLighting> | { auto: Partial<AutoProbes> } | false;
};

/** The sole approved lighting preset: balanced honey-gold sunlight and readable cool shade. */
export const lightingPreset: { lighting: AreaLighting; autoProbes: AutoProbes } = {
  lighting: {
    background: '#46443b', fogNear: 27, fogFar: 60, saturation: 1,
    ambient: { sky: '#b2c6d0', ground: '#6b5840', intensity: .34 },
    sun: { color: '#ffdaa0', intensity: 2.4, position: [-24, 18, 10], shadowExtent: 27 },
    environment: { sky: '#82969a', horizon: '#c7b48e', ground: '#443b2e', sunColor: '#ffdaa0', sunIntensity: 1.6, intensity: .75, rotation: 0 },
    grade: { shadows: '#bdcbd0', highlights: '#ffe6bc', strength: .06 },
  },
  autoProbes: { spacing: 6, bottom: .6, height: 3, padding: 1, intensity: 1, bounces: 1 },
};
