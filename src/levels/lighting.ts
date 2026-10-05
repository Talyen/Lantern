import type { Boundary } from '../gameplay/area.ts';
import type { AreaDefinition, AreaLighting, ProbeLighting } from './types.ts';
import { lightingPreset, type AutoProbes, type LightingOverrides } from './lighting-preset.ts';
let preset = lightingPreset;
export type LightingRecipe = { overrides?: LightingOverrides };

export function deriveProbes(boundary: Boundary, settings: AutoProbes = preset.autoProbes): ProbeLighting {
  const points = boundary.kind === 'circle' ? [[boundary.center[0] - boundary.radius, boundary.center[1] - boundary.radius], [boundary.center[0] + boundary.radius, boundary.center[1] + boundary.radius]] : boundary.points;
  const minX = Math.min(...points.map(p => p[0])) - settings.padding, maxX = Math.max(...points.map(p => p[0])) + settings.padding;
  const minZ = Math.min(...points.map(p => p[1])) - settings.padding, maxZ = Math.max(...points.map(p => p[1])) + settings.padding;
  const width = maxX - minX, depth = maxZ - minZ;
  return { position: [(minX + maxX) / 2, settings.bottom + settings.height / 2, (minZ + maxZ) / 2], size: [width, settings.height, depth],
    resolution: [Math.max(2, Math.ceil(width / settings.spacing) + 1), 3, Math.max(2, Math.ceil(depth / settings.spacing) + 1)], intensity: settings.intensity, bounces: settings.bounces };
}
function apply(base: AreaLighting, overrides: LightingOverrides, boundary?: Boundary, auto: AutoProbes = preset.autoProbes): AreaLighting {
  const { sun, probes, ...scalars } = overrides;
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
  return { ...base, ...scalars, sun: { ...base.sun, ...sun }, probes: resolvedProbes };
}
/** The approved preset plus intentional area overrides. Labs omit static scenery probes. */
export function resolveLighting(definition: LightingRecipe = {}, boundary?: Boundary): AreaLighting {
  if (Object.keys(definition).some(key => key !== 'overrides')) throw new Error('Area lighting accepts only overrides of the shared Golden preset.');
  const overrides = definition.overrides ?? {};
  if (Object.keys(overrides).some(key => !['fogNear', 'fogFar', 'sun', 'probes'].includes(key)) || Object.keys(overrides.sun ?? {}).some(key => !['shadowExtent'].includes(key))) throw new Error('Area lighting overrides support only fog distance, sun coverage and probes.');
  const look = structuredClone(preset.lighting);
  if (boundary) look.probes = deriveProbes(boundary, preset.autoProbes);
  return apply(look, overrides, boundary, preset.autoProbes);
}
export const resolveAreaLighting = (area: AreaDefinition) => resolveLighting(area.lighting, area.layout.boundary);

if (import.meta.hot) import.meta.hot.accept('./lighting-preset.ts', module => {
  if (!module) return;
  preset = module.lightingPreset as typeof lightingPreset;
  window.dispatchEvent(new Event('lightingpresetchanged'));
});
