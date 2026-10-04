import type { Point } from '../gameplay/area';

export type StreamChannel = { sections: { x: number; z: number; width: number; depth: number }[]; bankWidth?: number };

/** Boundary and current coordinates are normalized local X/Z, in [-1, 1]. */
export type WaterDefinition = {
  id: string; position: Point; width: number; length: number; flow: number;
  height?: number; depth?: number; shorelineWidth?: number;
  surface?: { shallowColor?: string; deepColor?: string; roughness?: number; normalStrength?: number; reflectionStrength?: number; reflection?: 'scene' | 'environment' };
  yaw?: number; shallow?: boolean; preset?: 'stream' | 'pond' | 'puddle';
  boundary?: Point[];
  currents?: { position: Point; direction: Point }[];
  channel?: StreamChannel;
  obstacles?: { position: Point; radius: number }[];
};
export type WaterShape = Pick<WaterDefinition, 'width' | 'length' | 'flow' | 'boundary' | 'preset' | 'channel' | 'obstacles' | 'depth' | 'shorelineWidth'>;
export const waterHeight = .04;
export const waterLevel = (water: Pick<WaterDefinition, 'height' | 'preset'>) => water.height ?? (water.preset === 'puddle' ? .015 : waterHeight);

/** Positive inside. Rendering bakes this same function into its edge texture. */
export function waterDistance(shape: WaterShape, x: number, z: number): number {
  const scale = Math.min(shape.width, shape.length) / 2;
  let distance = waterBoundaryDistance(shape, x, z);
  for (const obstacle of shape.obstacles ?? []) distance = Math.min(distance,
    (Math.hypot(x * shape.width / 2 - obstacle.position[0], z * shape.length / 2 - obstacle.position[1]) - obstacle.radius) / scale);
  return distance;
}
function waterBoundaryDistance(shape: WaterShape, x: number, z: number): number {
  if (shape.channel) {
    const px = x * shape.width / 2, pz = z * shape.length / 2, section = streamSection(shape.channel, px);
    const lateral = (section.width / 2 - Math.abs(pz - section.z)) / Math.hypot(1, section.slope);
    return Math.min(lateral, shape.width / 2 - Math.abs(px)) * 2 / Math.min(shape.width, shape.length);
  }
  const points = shape.boundary;
  if (!points) {
    if (shape.preset === 'stream' || shape.flow > .05) {
      const radius = Math.max(Math.abs(z + Math.sin(x * 4) * .16) / (1 + .10 * Math.sin(x * 9)), Math.abs(x) * .96);
      return 1 - radius;
    }
    return 1 - Math.hypot(x, z);
  }
  let inside = false, nearest = Infinity;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j], b = points[i], dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz)));
    nearest = Math.min(nearest, Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz));
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside ? nearest : -nearest;
}
export function waterCoverage(shape: WaterShape, x: number, z: number): number {
  return Math.max(0, Math.min(1, waterDistance(shape, x, z) * Math.min(shape.width, shape.length) / (2 * (shape.shorelineWidth ?? .14))));
}
export function waterAt(waters: readonly WaterDefinition[], x: number, z: number): WaterDefinition | undefined {
  return waters.find(water => {
    const dx = x - water.position[0], dz = z - water.position[1], yaw = water.yaw ?? 0;
    return waterCoverage(water, (dx * Math.cos(yaw) - dz * Math.sin(yaw)) * 2 / water.width,
      (dx * Math.sin(yaw) + dz * Math.cos(yaw)) * 2 / water.length) >= .1;
  });
}

/** Authored vector samples interpolate into a small static flow map, not a solver. */
export function waterCurrent(shape: Pick<WaterDefinition, 'currents' | 'preset' | 'flow' | 'channel' | 'width' | 'length' | 'obstacles'>, x: number, z: number): Point {
  if (shape.channel) {
    const px = x * shape.width / 2, pz = z * shape.length / 2, section = streamSection(shape.channel, px);
    let vx = 1, vz = section.slope;
    for (const obstacle of shape.obstacles ?? []) {
      const dx = px - obstacle.position[0], dz = pz - obstacle.position[1];
      const influence = Math.exp(-(dx * dx + dz * dz) / (obstacle.radius * obstacle.radius * 7));
      vz += (dz >= 0 ? 1 : -1) * influence * .7; vx *= 1 - influence * .25;
    }
    const length = Math.hypot(vx, vz); return [vx / length, vz / length];
  }
  if (!shape.currents?.length) return [shape.flow > 0 ? 1 : 0, 0];
  let vx = 0, vz = 0, total = 0;
  for (const sample of shape.currents) {
    const weight = 1 / Math.max(.005, (x - sample.position[0]) ** 2 + (z - sample.position[1]) ** 2);
    vx += sample.direction[0] * weight; vz += sample.direction[1] * weight; total += weight;
  }
  return [vx / total, vz / total];
}

/** Bank wetness is baked into the existing ground-coverage texture's green channel. */
export function waterBankWetness(waters: readonly WaterDefinition[], x: number, z: number): number {
  let wet = 0;
  for (const water of waters) {
    const yaw = water.yaw ?? 0, dx = x - water.position[0], dz = z - water.position[1];
    const distance = waterDistance(water, (dx * Math.cos(yaw) - dz * Math.sin(yaw)) * 2 / water.width,
      (dx * Math.sin(yaw) + dz * Math.cos(yaw)) * 2 / water.length) * Math.min(water.width, water.length) / 2;
    const edge = Math.max(0, Math.min(1, 1 + distance / .35));
    wet = Math.max(wet, edge * edge * (3 - 2 * edge) * .85);
  }
  return wet;
}

/** Metre-based authored sections form a smooth channel; interpolation is static authoring data. */
export function streamSection(channel: StreamChannel, x: number) {
  const sections = channel.sections;
  let i = 0;
  while (i < sections.length - 2 && x > sections[i + 1].x) i++;
  const a = sections[Math.max(0, i - 1)], b = sections[i], c = sections[i + 1], d = sections[Math.min(sections.length - 1, i + 2)];
  const span = c.x - b.x, t = Math.max(0, Math.min(1, (x - b.x) / span));
  const curve = (key: 'z' | 'width' | 'depth') => .5 * (2 * b[key] + (-a[key] + c[key]) * t + (2 * a[key] - 5 * b[key] + 4 * c[key] - d[key]) * t * t + (-a[key] + 3 * b[key] - 3 * c[key] + d[key]) * t * t * t);
  const slope = .5 * ((-a.z + c.z) + 2 * (2 * a.z - 5 * b.z + 4 * c.z - d.z) * t + 3 * (-a.z + 3 * b.z - 3 * c.z + d.z) * t * t) / span;
  return { z: curve('z'), width: Math.max(.4, curve('width')), depth: Math.max(.035, curve('depth')), slope };
}

/** The rendered bed and water absorption use the same cross-section depth. */
export function waterDepth(water: WaterShape, x: number, z: number): number {
  if (!water.channel) return Math.max(0, waterDistance(water, x, z)) * (water.depth ?? (water.preset === 'puddle' ? .05 : .15));
  const section = streamSection(water.channel, x * water.width / 2);
  const side = Math.abs(z * water.length / 2 - section.z) / (section.width / 2);
  const t = Math.max(0, Math.min(1, (1 - side) / .75));
  return .025 + section.depth * t * t * (3 - 2 * t);
}
