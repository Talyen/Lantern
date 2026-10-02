import type { EnemyRewards } from './economy';

import type { Loadout } from './equipment';
/** Ground-plane geometry and gate state; no browser or renderer dependencies. */
export type Point = [number, number];
export type Boundary = { kind: 'circle'; center: Point; radius: number } | { kind: 'polygon'; points: Point[] };
export type Spawn = { position: Point; yaw: number };
export type EnemyRig = 'enemy' | 'skeleton';
export type EnemySpawn = Spawn & EnemyRewards & { id: string; kind: 'raider' | 'caster'; rig: EnemyRig; loadout: Loadout };
export type EncounterLayout = { boundary: Boundary; player: Spawn; enemy?: Spawn & EnemyRewards; caster?: Spawn & EnemyRewards; enemies?: EnemySpawn[] };
export type Gate = { id: string; role: 'entrance' | 'exit' | 'branch'; position: Point; yaw: number; width: number; depth: number; arrival: Spawn; destination: { area: string; gate: string } };
export const legacyLayout: EncounterLayout = { boundary: { kind: 'circle', center: [0, 0], radius: 6.55 }, player: { position: [-2.3, 1.7], yaw: 0 }, enemy: { position: [2.1, -1.5], yaw: 0 } };
export function boundaryDistance(boundary: Boundary, point: Point): number {
  if (boundary.kind === 'circle') return boundary.radius - Math.hypot(point[0] - boundary.center[0], point[1] - boundary.center[1]);
  let distance = Infinity;
  for (let i = 0; i < boundary.points.length; i++) {
    const a = boundary.points[i], b = boundary.points[(i + 1) % boundary.points.length];
    distance = Math.min(distance, ((b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0])) / Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return distance;
}
export function constrain(boundary: Boundary, point: Point): Point {
  if (boundary.kind === 'circle') { const dx = point[0] - boundary.center[0], dz = point[1] - boundary.center[1], length = Math.hypot(dx, dz); const scale = length > boundary.radius ? boundary.radius / length : 1; return [boundary.center[0] + dx * scale, boundary.center[1] + dz * scale]; }
  if (boundaryDistance(boundary, point) >= 0) return point;
  let closest: Point = point, distance = Infinity;
  boundary.points.forEach((a, i) => { const b = boundary.points[(i + 1) % boundary.points.length], dx = b[0] - a[0], dz = b[1] - a[1]; const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / (dx * dx + dz * dz))); const candidate: Point = [a[0] + t * dx, a[1] + t * dz]; const d = Math.hypot(point[0] - candidate[0], point[1] - candidate[1]); if (d < distance) { distance = d; closest = candidate; } }); return closest;
}
export function insideGate(gate: Gate, point: Point): boolean {
  const dx = point[0] - gate.position[0], dz = point[1] - gate.position[1];
  return Math.abs(dx * Math.cos(gate.yaw) - dz * Math.sin(gate.yaw)) <= gate.width / 2 && Math.abs(dx * Math.sin(gate.yaw) + dz * Math.cos(gate.yaw)) <= gate.depth / 2;
}
export class GateTravel {
  private blocked: string | null = null;
  arrive(gate: string): void { this.blocked = gate; }
  check(gates: Gate[], point: Point): Gate | undefined {
    const blocked = gates.find(g => g.id === this.blocked);
    if (!blocked || !insideGate(blocked, point)) this.blocked = null;
    return gates.find(g => g.id !== this.blocked && insideGate(g, point));
  }
}
