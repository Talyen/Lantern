import RAPIER from '@dimforge/rapier3d-compat';
import { DEFAULT_QUERY_FILTER, findPath, type NavMesh } from 'navcat';
import { generateSoloNavMesh } from 'navcat/blocks';
import { constrain, type Boundary } from './area';
import type { ActorId, ActorState, Movement } from './encounter';

export type Surface = { positions: number[]; indices: number[] };
export type Obstacle = { id: string; position: [number, number, number]; size: [number, number, number]; yaw: number };
export type Traversal = { obstacles: Obstacle[]; surfaces?: Surface[] };
const radius = .3, halfHeight = .55, centerHeight = radius + halfHeight + .02;
let initialization: Promise<void> | undefined;

function ground(boundary: Boundary): Surface {
  const points = boundary.kind === 'polygon' ? boundary.points : Array.from({ length: 64 }, (_, i): [number, number] => [boundary.center[0] + Math.cos(i / 64 * Math.PI * 2) * boundary.radius, boundary.center[1] + Math.sin(i / 64 * Math.PI * 2) * boundary.radius]);
  const positions = points.flatMap(([x, z]) => [x, 0, z]); const indices: number[] = [];
  for (let i = 1; i < points.length - 1; i++) indices.push(0, i + 1, i);
  return { positions, indices };
}
function box(obstacle: Obstacle): Surface {
  const [w, h, d] = obstacle.size.map(v => v / 2), [x, y, z] = obstacle.position;
  const positions = [[-w,-h,-d],[w,-h,-d],[w,h,-d],[-w,h,-d],[-w,-h,d],[w,-h,d],[w,h,d],[-w,h,d]].flatMap(([a,b,c]) => [x + a*Math.cos(obstacle.yaw)+c*Math.sin(obstacle.yaw), y+b, z-a*Math.sin(obstacle.yaw)+c*Math.cos(obstacle.yaw)]);
  return { positions, indices: [0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,3,7,6,3,6,2,0,4,7,0,7,3,1,2,6,1,6,5] };
}

/** Numeric navigation/collision adapter. Simulation keeps ownership of actor transforms. */
export class MovementWorld implements Movement {
  private readonly world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  private readonly controller = this.world.createCharacterController(.015);
  private readonly actors = { player: this.world.createCollider(RAPIER.ColliderDesc.capsule(halfHeight, radius).setSensor(true)), enemy: this.world.createCollider(RAPIER.ColliderDesc.capsule(halfHeight, radius).setSensor(true)) };
  private readonly solid = new Set<number>();
  private readonly nav: NavMesh;
  private path: [number, number, number][] = [];
  private target = [Infinity, Infinity];
  private pathAge = Infinity;
  readonly generationMs: number;
  private disposed = false;
  static async create(boundary: Boundary, traversal: Traversal = { obstacles: [] }): Promise<MovementWorld> {
    await (initialization ??= RAPIER.init());
    return new MovementWorld(boundary, traversal);
  }
  private constructor(private readonly boundary: Boundary, traversal: Traversal) {
    const started = performance.now();
    this.controller.enableAutostep(.3, .15, false); this.controller.enableSnapToGround(.3);
    this.controller.setMaxSlopeClimbAngle(Math.PI / 4); this.controller.setMinSlopeSlideAngle(Math.PI / 4);
    const surfaces = [ground(boundary), ...(traversal.surfaces ?? [])];
    for (const surface of surfaces) {
      const collider = this.world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(surface.positions), new Uint32Array(surface.indices)));
      this.solid.add(collider.handle);
    }
    for (const obstacle of traversal.obstacles) {
      const collider = this.world.createCollider(RAPIER.ColliderDesc.cuboid(...obstacle.size.map(v => v / 2) as [number, number, number]).setTranslation(...obstacle.position).setRotation({ x: 0, y: Math.sin(obstacle.yaw / 2), z: 0, w: Math.cos(obstacle.yaw / 2) }));
      this.solid.add(collider.handle); surfaces.push(box(obstacle));
    }
    const positions: number[] = [], indices: number[] = [];
    for (const surface of surfaces) { const offset = positions.length / 3; positions.push(...surface.positions); indices.push(...surface.indices.map(i => i + offset)); }
    this.nav = generateSoloNavMesh({ positions, indices }, { cellSize: .1, cellHeight: .1, walkableRadiusWorld: .35, walkableRadiusVoxels: 4, walkableHeightWorld: 1.8, walkableHeightVoxels: 18, walkableClimbWorld: .3, walkableClimbVoxels: 3, walkableSlopeAngleDegrees: 45, borderSize: 0, minRegionArea: 0, mergeRegionArea: 8, maxSimplificationError: 1.1, maxEdgeLength: 12, maxVerticesPerPoly: 6, detailSampleDistance: .6, detailSampleMaxError: .1 }).navMesh;
    this.world.step();
    this.generationMs = performance.now() - started;
  }
  move(id: ActorId, actor: ActorState, dx: number, dz: number, dt: number): void {
    if (this.disposed) return;
    const collider = this.actors[id];
    collider.setTranslation({ x: actor.x, y: actor.y + centerHeight, z: actor.z });
    this.controller.computeColliderMovement(collider, { x: dx, y: -Math.max(.03, 9.81 * dt * dt), z: dz }, undefined, undefined, c => this.solid.has(c.handle));
    const delta = this.controller.computedMovement();
    [actor.x, actor.z] = constrain(this.boundary, [actor.x + delta.x, actor.z + delta.z]);
    actor.y = Math.max(0, actor.y + delta.y);
  }
  direction(from: ActorState, to: ActorState, dt: number): { x: number; z: number } {
    this.pathAge += dt;
    if (this.pathAge >= .25 || Math.hypot(to.x - this.target[0], to.z - this.target[1]) >= .4) {
      const result = findPath(this.nav, [from.x, from.y, from.z], [to.x, to.y, to.z], [.6, 1, .6], DEFAULT_QUERY_FILTER);
      this.path = result.success ? result.path.map(p => [...p.position] as [number, number, number]) : [];
      this.target = [to.x, to.z]; this.pathAge = 0;
    }
    while (this.path.length && Math.hypot(this.path[0][0] - from.x, this.path[0][2] - from.z) < .18) this.path.shift();
    const next = this.path[0];
    return next ? { x: next[0] - from.x, z: next[2] - from.z } : { x: 0, z: 0 };
  }
  lineOfSight(from: ActorState, to: ActorState): boolean {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, length = Math.hypot(dx, dy, dz);
    if (length < .001) return true;
    return !this.world.castRay(new RAPIER.Ray({ x: from.x, y: from.y + .9, z: from.z }, { x: dx / length, y: dy / length, z: dz / length }), length, true, undefined, undefined, undefined, undefined, c => this.solid.has(c.handle));
  }
  reset(): void { this.path = []; this.target = [Infinity, Infinity]; this.pathAge = Infinity; }
  dispose(): void { if (this.disposed) return; this.disposed = true; this.world.free(); }
}
