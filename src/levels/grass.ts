import { waterAt, waterDistance } from './water.ts';
import { boundaryDistance } from '../gameplay/area.ts';
import { inReserved } from './decoration.ts';
import { groundPathDistance } from './ground-paths.ts';
import type { AreaDefinition, Placement } from './types.ts';

/** Authored growing regions in metres; density counts whole asset clumps. */
export type GrassPatch = { id: string; center: [number, number]; radii: [number, number]; yaw: number; clumpsPerM2: number; excludedIds?: string[] };
export type GrassVariant = { asset: { libraryId: string }; weight: number; height: [number, number] };
/** Radius of the bottom-centred source bounds divided by its height. */
export type GrassFootprints = ReadonlyMap<string, { radiusPerHeight: number; height: number }>;
export const grassBudget = 1_000;
export const grassCellSize = 4;
const candidateStep = .5;
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function sample(seed: number, x: number, z: number, salt: number): number {
  let h = (seed ^ Math.imul(x, 0x45d9f3b) ^ Math.imul(z, 0x27d4eb2d) ^ salt) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function grassField(seed: number, x: number, z: number, salt: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), fx = smooth(0, 1, x - ix), fz = smooth(0, 1, z - iz);
  const a = sample(seed, ix, iz, salt) * (1 - fx) + sample(seed, ix + 1, iz, salt) * fx;
  const b = sample(seed, ix, iz + 1, salt) * (1 - fx) + sample(seed, ix + 1, iz + 1, salt) * fx;
  return a * (1 - fz) + b * fz;
}
function grassGroundArea(area: AreaDefinition): AreaDefinition {
  return { ...area, props: area.props.filter(p => p.primitive?.paths?.length || p.primitive?.patches?.some(patch => patch.strength >= .25 && patch.layer !== 'litter')) };
}
export function isGrassPlacement(area: Pick<AreaDefinition, 'grassVariants'>, placement: Placement): boolean {
  const asset = placement.asset;
  return !!asset && 'libraryId' in asset && !!area.grassVariants?.some(v => v.asset.libraryId === asset.libraryId);
}
/** Conservative circle clearance protects paths even when a clump's leaves overhang its root. */
export function grassClearance(area: AreaDefinition, x: number, z: number, radius = 0): number {
  if (boundaryDistance(area.layout.boundary, [x, z]) < .2 + radius || inReserved(area, [x, z], .35 + radius)) return 0;
  for (const obstacle of area.traversal?.obstacles ?? []) {
    const dx = x - obstacle.position[0], dz = z - obstacle.position[2], c = Math.cos(obstacle.yaw), s = Math.sin(obstacle.yaw);
    const ox = Math.max(0, Math.abs(dx * c - dz * s) - obstacle.size[0] / 2);
    const oz = Math.max(0, Math.abs(dx * s + dz * c) - obstacle.size[2] / 2);
    if (Math.hypot(ox, oz) < radius + .12) return 0;
  }
  for (const water of area.effects.water) {
    const dx = x - water.position[0], dz = z - water.position[1], c = Math.cos(water.yaw ?? 0), s = Math.sin(water.yaw ?? 0);
    const distance = waterDistance(water, (dx * c - dz * s) * 2 / water.width, (dx * s + dz * c) * 2 / water.length) * Math.min(water.width, water.length) / 2;
    if (distance > -radius - .05) return 0;
  }
  let clearance = 1;
  for (const prop of area.props) {
    for (const path of prop.primitive?.paths ?? []) if (path.strength >= .25) {
      clearance = Math.min(clearance, smooth(path.width * .4 + radius, path.width * .75 + radius, groundPathDistance(path, [x, z])));
    }
    for (const patch of prop.primitive?.patches ?? []) {
      if (patch.strength < .25 || patch.layer === 'litter') continue;
      clearance = Math.min(clearance, smooth(patch.radius * .8 + radius, patch.radius * 1.15 + radius, Math.hypot(x - patch.center[0], z - patch.center[1])));
    }
  }
  return clearance;
}
export function grassCoverage(area: AreaDefinition, patches: GrassPatch[], x: number, z: number, radius = 0): number {
  let coverage = 0;
  for (const patch of patches) {
    const dx = x - patch.center[0], dz = z - patch.center[1], c = Math.cos(patch.yaw), s = Math.sin(patch.yaw);
    const edge = Math.sin(x * 1.13 + z * .71) * .06 + Math.sin(z * 1.81 - x * .37) * .035;
    const extent = Math.hypot((dx * c - dz * s) / patch.radii[0], (dx * s + dz * c) / patch.radii[1]);
    coverage = Math.max(coverage, (1 - smooth(.72, 1, extent + edge)) * patch.clumpsPerM2);
  }
  return coverage * grassClearance(area, x, z, radius) * (.38 + .62 * smooth(.15, .8, grassField(area.seed, x * .65, z * .65, 0x31ab)));
}

/** Fixed world cells and independent hash channels keep IDs/transforms stable across authoring edits. */
export function generateGrass(area: AreaDefinition, footprints: GrassFootprints): Placement[] {
  const patches = area.grass ?? [], variants = area.grassVariants ?? [];
  if (!patches.length || !variants.length) return [];
  const coverageArea = grassGroundArea(area);
  const total = variants.reduce((sum, v) => sum + v.weight, 0), result: Placement[] = [];
  const excluded = new Set(patches.flatMap(p => p.excludedIds ?? [])), authored = new Set(area.props.map(p => p.id));
  const extent = patches.map(p => Math.max(...p.radii) * 1.15);
  const minX = Math.floor(Math.min(...patches.map((p, i) => p.center[0] - extent[i])) / candidateStep);
  const maxX = Math.ceil(Math.max(...patches.map((p, i) => p.center[0] + extent[i])) / candidateStep);
  const minZ = Math.floor(Math.min(...patches.map((p, i) => p.center[1] - extent[i])) / candidateStep);
  const maxZ = Math.ceil(Math.max(...patches.map((p, i) => p.center[1] + extent[i])) / candidateStep);
  const coordinate = (v: number) => `${v < 0 ? 'n' : 'p'}${Math.abs(v)}`;
  for (let iz = minZ; iz < maxZ; iz++) for (let ix = minX; ix < maxX; ix++) {
    const id = `grass-${coordinate(ix)}-${coordinate(iz)}`;
    if (excluded.has(id) || authored.has(id)) continue;
    const x = (ix + sample(area.seed, ix, iz, 0x12ab)) * candidateStep, z = (iz + sample(area.seed, ix, iz, 0x24ab)) * candidateStep;
    // Neighbouring clumps share a botanical type, without recolouring individual leaves.
    let choice = sample(area.seed, Math.floor(x / 3), Math.floor(z / 3), 0x7f42) * total;
    const variant = variants.find(v => (choice -= v.weight) < 0) ?? variants[variants.length - 1];
    const source = footprints.get(variant.asset.libraryId); if (!source) continue;
    const height = variant.height[0] + (variant.height[1] - variant.height[0]) * sample(area.seed, ix, iz, 0x36ab);
    if (sample(area.seed, ix, iz, 0x48ab) >= grassCoverage(coverageArea, patches, x, z, height * source.radiusPerHeight) * candidateStep ** 2) continue;
    result.push({ id, position: [x, 0, z], yaw: sample(area.seed, ix, iz, 0x9b17) * Math.PI * 2, height, scale: [1, 1, 1], asset: variant.asset, decoration: true, castShadow: false, receiveShadow: true });
  }
  // Hash priority keeps a full-area cap independent of traversal order.
  result.sort((a, b) => sample(area.seed, Math.floor(a.position[0] / candidateStep), Math.floor(a.position[2] / candidateStep), 0x6c23) - sample(area.seed, Math.floor(b.position[0] / candidateStep), Math.floor(b.position[2] / candidateStep), 0x6c23));
  return result.slice(0, Math.max(0, (area.grassLimit ?? grassBudget) - area.props.filter(p => isGrassPlacement(area, p)).length));
}

/** Terrain coverage and wet banks retain their existing shared texture binding. */
export function grassMask(area: AreaDefinition, patches: GrassPatch[], resolution = 256) {
  const boundary = area.layout.boundary;
  const min: [number, number] = boundary.kind === 'circle' ? boundary.center.map(v => v - boundary.radius) as [number, number] : [Math.min(...boundary.points.map(p => p[0])), Math.min(...boundary.points.map(p => p[1]))];
  const span: [number, number] = boundary.kind === 'circle' ? [boundary.radius * 2, boundary.radius * 2] : [Math.max(...boundary.points.map(p => p[0])) - min[0], Math.max(...boundary.points.map(p => p[1])) - min[1]];
  const coverageArea = grassGroundArea(area);
  const density = Math.max(1, ...patches.map(p => p.clumpsPerM2)), data = new Uint8Array(resolution * resolution);
  for (let z = 0; z < resolution; z++) for (let x = 0; x < resolution; x++) {
    const px = min[0] + (x + .5) / resolution * span[0], pz = min[1] + (z + .5) / resolution * span[1];
    data[z * resolution + x] = waterAt(area.effects.water, px, pz) ? 0 : Math.round(grassCoverage(coverageArea, patches, px, pz) / density * 255);
  }
  return { data, min, span, resolution };
}
