import { isGrassPlacement } from './grass.ts';
import { resolveWorldFlame } from './local-lighting.ts';
import type { ResolvedAreaDefinition } from './types';

/** Static shader/capture changes require an explicit private re-preparation. */
export const lightingBakeVersion = 9;
export type LightingPreparation = { key: string; sources: { url: string; hash: string }[] };
export async function lightingPreparationKey(area: ResolvedAreaDefinition, surfaces: string, shelterRestored: boolean, three: string, recipes: unknown): Promise<string> {
  const { sun, environment, probes } = area.lighting;
  const props = area.props.filter(p => !isGrassPlacement(area, p)).map(({ harvest, ...prop }) => ({ ...prop, ...(harvest ? { harvest: { kind: harvest.kind } } : {}) }));
  const scatter = area.scatter.map(({ harvest, ...entry }) => ({ ...entry, ...(harvest ? { harvest: { kind: harvest.kind } } : {}) }));
  const gates = area.gates.map(({ position, yaw, width, depth, arrival }) => ({ position, yaw, width, depth, arrival }));
  const payload = { version: lightingBakeVersion, three, recipes, surfaces, shelterRestored: !!area.shelter && shelterRestored,
    sun, environment, probes, props, scatter, gates, seed: area.seed, boundary: area.layout.boundary,
    reserved: area.reserved.map(({ center, radius }) => ({ center, radius })), shelter: area.shelter,
    water: area.effects.water, fires: area.effects.fires.map(fire => ({ asset: fire.asset, height: fire.height, ...resolveWorldFlame(fire) })) };
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload))))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
