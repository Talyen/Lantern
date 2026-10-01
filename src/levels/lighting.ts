import type { Boundary } from '../gameplay/area.ts';
import type { AreaDefinition, AreaLighting, ProbeLighting } from './types.ts';
import { lightingProfiles, profileFor, type AutoProbes, type LightingMode, type LightingOverrides, type LightingProfileId } from './lighting-profiles.ts';
let profiles = lightingProfiles, findProfile = profileFor;
export type LightingRecipe = { profile: LightingProfileId; overrides?: LightingOverrides };
const probeDefaults: AutoProbes = { spacing: 6, bottom: .6, height: 3, padding: 1, intensity: .7, bounces: 1 };

export function deriveProbes(boundary: Boundary, settings: AutoProbes = probeDefaults): ProbeLighting {
  const points = boundary.kind === 'circle' ? [[boundary.center[0] - boundary.radius, boundary.center[1] - boundary.radius], [boundary.center[0] + boundary.radius, boundary.center[1] + boundary.radius]] : boundary.points;
  const minX = Math.min(...points.map(p => p[0])) - settings.padding, maxX = Math.max(...points.map(p => p[0])) + settings.padding;
  const minZ = Math.min(...points.map(p => p[1])) - settings.padding, maxZ = Math.max(...points.map(p => p[1])) + settings.padding;
  const width = maxX - minX, depth = maxZ - minZ;
  return { position: [(minX + maxX) / 2, settings.bottom + settings.height / 2, (minZ + maxZ) / 2], size: [width, settings.height, depth],
    resolution: [Math.max(2, Math.ceil(width / settings.spacing) + 1), 3, Math.max(2, Math.ceil(depth / settings.spacing) + 1)], intensity: settings.intensity, bounces: settings.bounces };
}
function apply(base: AreaLighting, overrides: LightingOverrides, boundary?: Boundary, auto: AutoProbes = probeDefaults): AreaLighting {
  const { ambient, sun, environment, fill, probes, grade, ...scalars } = overrides;
  let resolvedProbes = base.probes;
  if (probes === false) resolvedProbes = undefined;
  else if (probes) {
    if ('auto' in probes) {
      if (!boundary) throw new Error('Automatic probes require an area boundary.');
      resolvedProbes = deriveProbes(boundary, { ...auto, ...probes.auto });
    } else {
      if (!resolvedProbes && boundary) resolvedProbes = deriveProbes(boundary, auto);
      resolvedProbes = { ...resolvedProbes, ...probes } as ProbeLighting;
    }
  }
  return { ...base, ...scalars, ambient: { ...base.ambient, ...ambient }, sun: { ...base.sun, ...sun },
    environment: environment === false ? undefined : environment ? { ...base.environment, ...environment } as AreaLighting['environment'] : base.environment,
    grade: grade ? { ...base.grade, ...grade } as AreaLighting['grade'] : base.grade,
    fill: fill ? { ...base.fill, ...fill } as AreaLighting['fill'] : base.fill, probes: resolvedProbes };
}
/** Profile -> supported mood -> area overrides. Complete legacy definitions remain valid. */
export function resolveLighting(definition: AreaLighting | LightingRecipe, mode?: LightingMode, boundary?: Boundary): AreaLighting {
  if (!('profile' in definition)) return structuredClone(definition);
  const profile = findProfile(definition.profile);
  if (!profile) throw new Error(`Unknown lighting profile: ${definition.profile}. Available: ${Object.keys(profiles).join(', ')}`);
  let look = structuredClone(profile.lighting);
  if (profile.autoProbes) {
    if (!boundary) throw new Error('Automatic probes require an area boundary.');
    look.probes = deriveProbes(boundary, profile.autoProbes);
  }
  if (mode && profile.moods[mode]) look = apply(look, profile.moods[mode]!, boundary, profile.autoProbes);
  return apply(look, definition.overrides ?? {}, boundary, profile.autoProbes);
}
export const resolveAreaLighting = (area: Omit<AreaDefinition, 'lighting'> & { lighting: AreaLighting | LightingRecipe }, mode?: LightingMode) => resolveLighting(area.lighting, mode, area.layout.boundary);
export const lightingModesFor = (definition: AreaLighting | LightingRecipe): LightingMode[] => 'profile' in definition ? Object.keys(findProfile(definition.profile)?.moods ?? {}) as LightingMode[] : [];

if (import.meta.hot) import.meta.hot.accept('./lighting-profiles.ts', module => {
  if (!module) return;
  profiles = module.lightingProfiles; findProfile = module.profileFor;
  window.dispatchEvent(new Event('lightingprofileschanged'));
});

export const lightingProfileOptions = () => Object.entries(profiles).map(([id, profile]) => ({ id: id as LightingProfileId, label: profile.label }));
export const entryLightingModesFor = (definition: AreaLighting | LightingRecipe): LightingMode[] => 'profile' in definition ? [...findProfile(definition.profile)?.entryModes ?? []] : [];
export const defaultLightingModeFor = (definition: AreaLighting | LightingRecipe): LightingMode => 'profile' in definition ? findProfile(definition.profile)?.defaultMode ?? 'golden' : 'golden';
