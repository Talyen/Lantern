import RAPIER from '@dimforge/rapier3d-compat';
import { DEFAULT_QUERY_FILTER, findPath, type NavMesh } from 'navcat';
import { buildNavigation, type NavigationGeometry } from './navigation';
import { constrain, type Boundary } from './area';
import type { ActorId, ActorState, Movement } from './encounter';

export type Surface = { positions: number[]; indices: number[] };
export type Obstacle = { id: string; position: [number, number, number]; size: [number, number, number]; yaw: number; tree?: boolean };
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
  private nav!: NavMesh;
  private readonly baseSurfaces: Surface[];
  private readonly obstacles = new Map<string, { definition: Obstacle; collider: RAPIER.Collider; felled: boolean }>();
  private navigationWorker?: Worker;
  private navigationRevision = 0;
  private navigationPending = false;
  private navigationPostQueued = false;
  private queuedNavigation?: NavigationGeometry;
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
    this.baseSurfaces = [ground(boundary), ...(traversal.surfaces ?? [])];
    for (const surface of this.baseSurfaces) {
      const collider = this.world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(surface.positions), new Uint32Array(surface.indices)));
      this.solid.add(collider.handle);
    }
    for (const obstacle of traversal.obstacles) {
      const collider = this.world.createCollider(RAPIER.ColliderDesc.cuboid(...obstacle.size.map(v => v / 2) as [number, number, number]).setTranslation(...obstacle.position).setRotation({ x: 0, y: Math.sin(obstacle.yaw / 2), z: 0, w: Math.cos(obstacle.yaw / 2) }));
      this.solid.add(collider.handle); this.obstacles.set(obstacle.id, { definition: obstacle, collider, felled: false });
    }
    this.rebuildNavigation();
    this.world.step();
    this.generationMs = performance.now() - started;
  }
  private rebuildNavigation(background = false): void {
    const surfaces = [...this.baseSurfaces, ...[...this.obstacles.values()].filter(o => !o.felled).map(o => box(o.definition))];
    const positions: number[] = [], indices: number[] = [];
    for (const surface of surfaces) { const offset = positions.length / 3; positions.push(...surface.positions); indices.push(...surface.indices.map(i => i + offset)); }
    this.reset();
    ++this.navigationRevision;
    if (background && typeof Worker !== 'undefined') {
      this.navigationPending = true;
      if (!this.navigationWorker) {
        this.navigationWorker = new Worker(new URL('./navigation-worker.ts', import.meta.url), { type: 'module' });
        this.navigationWorker.onmessage = (event: MessageEvent<{ revision: number; nav?: NavMesh; error?: string }>) => {
          if (this.disposed || event.data.revision !== this.navigationRevision) return;
          if (!event.data.nav) throw new Error(`Tree navigation could not update: ${event.data.error ?? 'missing navigation result'}`);
          this.nav = event.data.nav; this.navigationPending = false; this.reset();
        };
        this.navigationWorker.onerror = event => { throw new Error(`Tree navigation could not update: ${event.message}`); };
      }
      this.queuedNavigation = { positions, indices };
      if (!this.navigationPostQueued) {
        this.navigationPostQueued = true;
        // Applying session depletion on area arrival may change many trees in the same turn.
        queueMicrotask(() => {
          this.navigationPostQueued = false;
          if (!this.disposed) this.navigationWorker?.postMessage({ revision: this.navigationRevision, geometry: this.queuedNavigation });
        });
      }
    } else { this.nav = buildNavigation({ positions, indices }); this.navigationPending = false; }
  }
  /** Collision commits immediately; expensive routes refresh off the gameplay thread. */
  setTreeFelled(id: string, felled: boolean): void {
    const obstacle = this.obstacles.get(id);
    if (this.disposed || !obstacle?.definition.tree || obstacle.felled === felled) return;
    obstacle.felled = felled; obstacle.collider.setEnabled(!felled);
    if (felled) this.solid.delete(obstacle.collider.handle); else this.solid.add(obstacle.collider.handle);
    this.world.step(); this.rebuildNavigation(true);
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
    if (this.navigationPending) {
      // Until fresh routes arrive, use clear direct travel or wait; never follow a stale path into regrowth.
      return this.lineOfSight(from, to) ? { x: to.x - from.x, z: to.z - from.z } : { x: 0, z: 0 };
    }
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
  /** Earliest solid intersection along the exact projectile segment, expressed as 0–1 travel. */
  segmentHit(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }): number | null {
    if (this.disposed) return null;
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, length = Math.hypot(dx, dy, dz);
    if (length < .000001) return null;
    const hit = this.world.castRay(new RAPIER.Ray(from, { x: dx / length, y: dy / length, z: dz / length }), length, true, undefined, undefined, undefined, undefined, c => this.solid.has(c.handle));
    return hit ? hit.timeOfImpact / length : null;
  }
  get navigationReady(): boolean { return !this.navigationPending && !this.disposed; }
  reset(): void { this.path = []; this.target = [Infinity, Infinity]; this.pathAge = Infinity; }
  dispose(): void { if (this.disposed) return; this.disposed = true; this.navigationWorker?.terminate(); this.world.free(); }
}
