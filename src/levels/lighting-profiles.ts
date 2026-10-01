import type { AreaLighting, ProbeLighting } from './types.ts';

export type LightingMode = 'golden' | 'silver' | 'moonlit' | 'dark' | 'misty';
export type AutoProbes = { spacing: number; bottom: number; height: number; padding: number; intensity: number; bounces: number };
export type LightingOverrides = {
  background?: string; fogNear?: number; fogFar?: number; saturation?: number;
  ambient?: Partial<AreaLighting['ambient']>; sun?: Partial<AreaLighting['sun']>;
  environment?: Partial<NonNullable<AreaLighting['environment']>> | false;
  grade?: Partial<NonNullable<AreaLighting['grade']>>;
  fill?: Partial<NonNullable<AreaLighting['fill']>>;
  probes?: Partial<ProbeLighting> | { auto: Partial<AutoProbes> } | false;
};
export type LightingProfile = { label: string; defaultMode?: LightingMode; entryModes?: LightingMode[]; lighting: AreaLighting; autoProbes?: AutoProbes; moods: Partial<Record<LightingMode, LightingOverrides>> };

/** Shared art recipes. Areas select a profile and override only intentional differences. */
export const lightingProfiles = {
  'woodland-dusk': {
    label: 'Woodland dusk', defaultMode: 'golden', entryModes: ['golden', 'silver'],
    lighting: {
      background: '#54534a', fogNear: 27, fogFar: 60, saturation: .86,
      ambient: { sky: '#c1cbc6', ground: '#766a54', intensity: .45 },
      sun: { color: '#ffe0ad', intensity: 2.6, position: [-24, 18, 10], shadowExtent: 27 },
      environment: { sky: '#859597', horizon: '#b3ad96', ground: '#484338', sunColor: '#ffe0ad', sunIntensity: 1.6, intensity: .85, rotation: 0 },
      grade: { shadows: '#c4cfca', highlights: '#ffecd4', strength: .12 },
    },
    autoProbes: { spacing: 6, bottom: .6, height: 3, padding: 1, intensity: .7, bounces: 1 },
    moods: {
      golden: {},
      silver: {
        background: '#343b3b', ambient: { sky: '#b8bdb4', ground: '#686a59', intensity: .2975 },
        sun: { color: '#d4d9cd', intensity: 1.65 },
        environment: { sky: '#8e9691', horizon: '#b2b8ae', ground: '#52564a', sunColor: '#d4d9cd', sunIntensity: 1.8 },
      },
    },
  },
  'woodland-night': {
    label: 'Woodland night', defaultMode: 'moonlit',
    lighting: {
      background: '#18242f', fogNear: 30, fogFar: 65, saturation: .82,
      ambient: { sky: '#71849c', ground: '#384536', intensity: .22 },
      sun: { color: '#c0d0e6', intensity: .45, position: [-18, 26, -10], shadowExtent: 27 },
      environment: { sky: '#4e627d', horizon: '#6d7f93', ground: '#28312c', sunColor: '#bbcce3', sunIntensity: .75, intensity: 1.1, rotation: 0 },
      grade: { shadows: '#b6c6ce', highlights: '#ebe3d4', strength: .1 },
    },
    autoProbes: { spacing: 6, bottom: .6, height: 3, padding: 1, intensity: .7, bounces: 1 },
    moods: {
      moonlit: {},
      dark: { background: '#111a24', ambient: { intensity: .12 }, sun: { intensity: .2 },
        environment: { sky: '#344761', horizon: '#4e6076', ground: '#18251f', intensity: .8, sunIntensity: .45 } },
      misty: { background: '#243143', fogNear: 22, fogFar: 55, ambient: { intensity: .28 }, sun: { intensity: .3 },
        environment: { sky: '#586d80', horizon: '#758697', intensity: 1.2 } },
    },
  },
  studio: {
    label: 'Studio',
    lighting: {
      background: '#202a31', fogNear: 80, fogFar: 100, saturation: .85,
      ambient: { sky: '#edf2ff', ground: '#777269', intensity: 2 },
      sun: { color: '#ffe8d3', intensity: 3, position: [-3, 6, 5], shadowExtent: 10 },
      environment: { sky: '#aab8ca', horizon: '#c6c4bd', ground: '#687174', sunColor: '#ffe5be', sunIntensity: 1.5, intensity: .8, rotation: 0 },
      fill: { color: '#cedfff', intensity: 1 },
    },
    moods: {},
  },
} satisfies Record<string, LightingProfile>;
export type LightingProfileId = keyof typeof lightingProfiles;
export const profileFor = (id: string): LightingProfile | undefined => Object.hasOwn(lightingProfiles, id) ? lightingProfiles[id as LightingProfileId] : undefined;

export const lightingModeLabels: Record<LightingMode, string> = { golden: 'Golden', silver: 'Silver', moonlit: 'Moonlit', dark: 'Deep night', misty: 'Misty night' };
