import { boundaryDistance } from '../gameplay/area.ts';
import { inReserved } from './decoration.ts';
import { groundPathDistance } from './ground-paths';
import type { AreaDefinition } from './types.ts';

/** Authored carpet extents in metres. Grass is cosmetic and never changes navigation. */
export type GrassPatch = { id: string; center: [number, number]; radii: [number, number]; yaw: number; density: number };
export type GrassBlade = { x: number; z: number; height: number; width: number; yaw: number; shade: number; phase: number; lean: [number, number]; taper: number };
export const grassBudget = 40_000;
export const grassCellSize = 4;
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Smooth seeded growth fields group neighbouring blades without visible rows or colour speckles. */
function grassField(seed: number, x: number, z: number, salt: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), fx = smooth(0, 1, x - ix), fz = smooth(0, 1, z - iz);
  const sample = (px: number, pz: number) => {
    let h = (seed ^ Math.imul(px, 0x45d9f3b) ^ Math.imul(pz, 0x27d4eb2d) ^ salt) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const a = sample(ix, iz) * (1 - fx) + sample(ix + 1, iz) * fx;
  const b = sample(ix, iz + 1) * (1 - fx) + sample(ix + 1, iz + 1) * fx;
  return a * (1 - fz) + b * fz;
}
const grassGrowth = (seed: number, x: number, z: number) => grassField(seed, x * 1.7, z * 1.7, 0x31ab);

export function grassCoverage(area: AreaDefinition, patches: GrassPatch[], x: number, z: number): number {
  if (boundaryDistance(area.layout.boundary, [x, z]) < .2 || inReserved(area, [x, z], .35)) return 0;
  for (const obstacle of area.traversal?.obstacles ?? []) {
    const dx = x - obstacle.position[0], dz = z - obstacle.position[2], c = Math.cos(obstacle.yaw), s = Math.sin(obstacle.yaw);
    if (Math.abs(dx * c - dz * s) < obstacle.size[0] / 2 + .12 && Math.abs(dx * s + dz * c) < obstacle.size[2] / 2 + .12) return 0;
  }
  let groundClearance = 1;
  for (const prop of area.props) for (const path of prop.primitive?.paths ?? []) {
    if (path.strength >= .25) groundClearance = Math.min(groundClearance, smooth(path.width * .4, path.width * .75, groundPathDistance(path, [x, z])));
  }
  for (const prop of area.props) for (const patch of prop.primitive?.patches ?? []) {
    // Subdued tree-edge stains remain grassy; strongly worn camp/path soil stays bare.
    if (patch.strength < .25 || patch.layer === 'litter') continue;
    groundClearance = Math.min(groundClearance, smooth(.8, 1.15, Math.hypot(x - patch.center[0], z - patch.center[1]) / patch.radius));
  }
  let coverage = 0;
  for (const patch of patches) {
    const dx = x - patch.center[0], dz = z - patch.center[1], c = Math.cos(patch.yaw), s = Math.sin(patch.yaw);
    const radius = Math.hypot((dx * c - dz * s) / patch.radii[0], (dx * s + dz * c) / patch.radii[1]);
    const edge = Math.sin(x * 1.13 + z * .71) * .06 + Math.sin(z * 1.81 - x * .37) * .035;
    coverage = Math.max(coverage, (1 - smooth(.72, 1, radius + edge)) * patch.density);
  }
  // Keep a short continuous base, with fuller tufts and intervening soil. The
  // same field feeds the ground mask, so sparse growth never becomes a green stamp.
  return coverage * groundClearance * (.38 + .62 * smooth(.15, .8, grassGrowth(area.seed, x, z)));
}

/** Seeded roots and smooth growth fields form connected, irregular woodland tufts. */
export function generateGrass(area: AreaDefinition, patches: GrassPatch[]): GrassBlade[] {
  if (!patches.length) return [];
  let state = (area.seed ^ 0x6a09e667) >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const density = Math.max(...patches.map(p => p.density)), step = 1 / Math.sqrt(density);
  const extent = patches.map(p => Math.max(...p.radii) * 1.15);
  const minX = Math.min(...patches.map((p, i) => p.center[0] - extent[i])), maxX = Math.max(...patches.map((p, i) => p.center[0] + extent[i]));
  const minZ = Math.min(...patches.map((p, i) => p.center[1] - extent[i])), maxZ = Math.max(...patches.map((p, i) => p.center[1] + extent[i]));
  // Only ground patches can clear grass; skip unrelated scenery for every sampled root.
  const coverageArea = { ...area, props: area.props.filter(p => p.primitive?.paths?.length || p.primitive?.patches?.some(patch => patch.strength >= .25 && patch.layer !== 'litter')) };
  const result: GrassBlade[] = [];
  let accepted = 0;
  for (let z = minZ; z < maxZ; z += step) for (let x = minX; x < maxX; x += step) {
    const px = x + random() * step, pz = z + random() * step, chance = random();
    if (chance > grassCoverage(coverageArea, patches, px, pz) / density) continue;
    const growth = grassGrowth(area.seed, px, pz);
    const broad = grassField(area.seed, px * .24, pz * .24, 0x7f42);
    const heading = grassField(area.seed, px * 1.3, pz * 1.3, 0x9b17) * Math.PI * 4;
    const yaw = heading + (random() - .5) * 2.2;
    const height = .085 + growth * .11 + random() * .04 + smooth(.7, .9, growth) * .08;
    const blade: GrassBlade = { x: px, z: pz, height, width: .018 + random() * .012,
      yaw, shade: smooth(.2, .8, broad) * .9 + random() * .06,
      phase: grassField(area.seed, px * 1.3, pz * 1.3, 0x6c23) * Math.PI * 2,
      lean: [(random() - .5) * .35, .18 + growth * .35 + random() * .2], taper: .65 + random() * .65 };
    // Reservoir sampling keeps the hard budget uniform over the entire carpet.
    accepted++;
    if (result.length < grassBudget) result.push(blade);
    else { const replacement = Math.floor(random() * accepted); if (replacement < grassBudget) result[replacement] = blade; }
  }
  return result;
}

/** A small, static coverage mask lets soil and blades share exactly the same authored edges. */
export function grassMask(area: AreaDefinition, patches: GrassPatch[], resolution = 256) {
  const boundary = area.layout.boundary;
  const min: [number, number] = boundary.kind === 'circle' ? boundary.center.map(v => v - boundary.radius) as [number, number] : [Math.min(...boundary.points.map(p => p[0])), Math.min(...boundary.points.map(p => p[1]))];
  const span: [number, number] = boundary.kind === 'circle' ? [boundary.radius * 2, boundary.radius * 2] : [Math.max(...boundary.points.map(p => p[0])) - min[0], Math.max(...boundary.points.map(p => p[1])) - min[1]];
  const density = Math.max(1, ...patches.map(p => p.density)), data = new Uint8Array(resolution * resolution);
  // Match blade generation: unrelated scenery cannot clear the coverage mask.
  const coverageArea = { ...area, props: area.props.filter(p => p.primitive?.paths?.length || p.primitive?.patches?.some(patch => patch.strength >= .25 && patch.layer !== 'litter')) };
  for (let z = 0; z < resolution; z++) for (let x = 0; x < resolution; x++) data[z * resolution + x] = Math.round(grassCoverage(coverageArea, patches, min[0] + (x + .5) / resolution * span[0], min[1] + (z + .5) / resolution * span[1]) / density * 255);
  return { data, min, span, resolution };
}
