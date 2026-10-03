import type { Point } from '../gameplay/area';
import type { GroundPath } from './types';

/** Distance to a continuous authored trail, shared by terrain and grass authoring. */
export function groundPathDistance(path: GroundPath, point: Point): number {
  let nearest = Infinity;
  for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1], b = path.points[i], dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / (dx * dx + dz * dz)));
    nearest = Math.min(nearest, Math.hypot(point[0] - a[0] - dx * t, point[1] - a[1] - dz * t));
  }
  return nearest;
}
