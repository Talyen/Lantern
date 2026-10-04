import type { Point } from '../gameplay/area';

/** Boundary and current coordinates are normalized local X/Z, in [-1, 1]. */
export type WaterDefinition = {
  id: string; position: Point; width: number; length: number; flow: number;
  yaw?: number; shallow?: boolean; preset?: 'stream' | 'pond' | 'puddle';
  boundary?: Point[];
  currents?: { position: Point; direction: Point }[];
};
export type WaterShape = Pick<WaterDefinition, 'width' | 'length' | 'flow' | 'boundary' | 'preset'>;
export const waterHeight = .04;

/** Positive inside. Rendering bakes this same function into its edge texture. */
export function waterDistance(shape: WaterShape, x: number, z: number): number {
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
  return Math.max(0, Math.min(1, waterDistance(shape, x, z) * 35));
}
export function waterAt(waters: readonly WaterDefinition[], x: number, z: number): WaterDefinition | undefined {
  return waters.find(water => {
    const dx = x - water.position[0], dz = z - water.position[1], yaw = water.yaw ?? 0;
    return waterCoverage(water, (dx * Math.cos(yaw) - dz * Math.sin(yaw)) * 2 / water.width,
      (dx * Math.sin(yaw) + dz * Math.cos(yaw)) * 2 / water.length) >= .1;
  });
}

/** Authored vector samples interpolate into a small static flow map, not a solver. */
export function waterCurrent(shape: Pick<WaterDefinition, 'currents' | 'preset' | 'flow'>, x: number, z: number): Point {
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
