import RAPIER from '@dimforge/rapier3d-compat';
import { DEFAULT_QUERY_FILTER, findPath, type NavMesh } from 'navcat';
import { buildNavigation, type NavigationGeometry } from './navigation';
import { constrain, boundaryDistance, type Boundary } from './area';
import type { ActorId, ActorState, Movement, AimPoint } from './encounter';

export type Surface = { positions: number[]; indices: number[] };
export type Obstacle = { id: string; position: [number, number, number]; size: [number, number, number]; yaw: number; tree?: boolean; depletedScale?: number };
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
  private readonly actors = new Map<ActorId, RAPIER.Collider>();
  private readonly solid = new Set<number>();
  // Ground surfaces remain eligible for loot; active obstacle proxies do not.
  private readonly blockingObstacles = new Set<number>();
  private readonly isSolid = (collider: RAPIER.Collider): boolean => this.solid.has(collider.handle);
  // Rapier consumes these inputs synchronously. Each area owns its scratch
  // storage; query filters never call back into movement or another query.
  private readonly queryRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
  private readonly actorPosition = { x: 0, y: 0, z: 0 };
  private readonly desiredMovement = { x: 0, y: 0, z: 0 };
  private nav!: NavMesh;
  private readonly baseSurfaces: Surface[];
  private readonly obstacles = new Map<string, { definition: Obstacle; current: Obstacle; collider: RAPIER.Collider; felled: boolean }>();
  private navigationWorker?: Worker;
  private navigationRevision = 0;
  private navigationPending = false;
  private navigationPostQueued = false;
  private routes = new WeakMap<ActorState, { path: [number, number, number][]; target: number[]; age: number; next: number }>();
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
      this.solid.add(collider.handle); this.blockingObstacles.add(collider.handle); this.obstacles.set(obstacle.id, { definition: obstacle, current: obstacle, collider, felled: false });
    }
    this.rebuildNavigation();
    this.world.step();
    this.generationMs = performance.now() - started;
  }
  private navigationGeometry(): NavigationGeometry {
    const positions: number[] = [], indices: number[] = [];
    const append = (surface: Surface): void => {
      const offset = positions.length / 3;
      for (const position of surface.positions) positions.push(position);
      for (const index of surface.indices) indices.push(index + offset);
    };
    for (const surface of this.baseSurfaces) append(surface);
    for (const obstacle of this.obstacles.values()) if (!obstacle.felled || !obstacle.definition.tree) append(box(obstacle.current));
    return { positions, indices };
  }
  private rebuildNavigation(background = false): void {
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
      if (!this.navigationPostQueued) {
        this.navigationPostQueued = true;
        // Applying session depletion on area arrival may change many trees in the same turn.
        queueMicrotask(() => {
          this.navigationPostQueued = false;
          // Build only the final snapshot, rather than allocating it for every
          // tree whose retained depletion is applied during the same arrival.
          if (!this.disposed) this.navigationWorker?.postMessage({ revision: this.navigationRevision, geometry: this.navigationGeometry() });
        });
      }
    } else { this.nav = buildNavigation(this.navigationGeometry()); this.navigationPending = false; }
  }
  /** Collision commits immediately; expensive routes refresh off the gameplay thread. */
  setTreeFelled(id: string, felled: boolean): void {
    const obstacle = this.obstacles.get(id);
    if (this.disposed || !obstacle || (!obstacle.definition.tree && obstacle.definition.depletedScale === undefined) || obstacle.felled === felled) return;
    obstacle.felled = felled;
    if (obstacle.definition.tree) {
      obstacle.collider.setEnabled(!felled);
      if (felled) { this.solid.delete(obstacle.collider.handle); this.blockingObstacles.delete(obstacle.collider.handle); }
      else { this.solid.add(obstacle.collider.handle); this.blockingObstacles.add(obstacle.collider.handle); }
    } else {
      const definition = obstacle.definition, height = definition.size[1] * (felled ? definition.depletedScale! : 1);
      obstacle.current = { ...definition, size: [definition.size[0], height, definition.size[2]], position: [definition.position[0], definition.position[1] - (definition.size[1] - height) / 2, definition.position[2]] };
      obstacle.collider.setShape(new RAPIER.Cuboid(definition.size[0] / 2, height / 2, definition.size[2] / 2));
      obstacle.collider.setTranslation({ x: obstacle.current.position[0], y: obstacle.current.position[1], z: obstacle.current.position[2] });
    }
    this.world.step(); this.rebuildNavigation(true);
  }
  move(id: ActorId, actor: ActorState, dx: number, dz: number, dt: number): void {
    if (this.disposed) return;
    let collider = this.actors.get(id);
    if (!collider) { collider = this.world.createCollider(RAPIER.ColliderDesc.capsule(halfHeight, radius).setSensor(true)); this.actors.set(id, collider); }
    const position = this.actorPosition, movement = this.desiredMovement;
    position.x = actor.x; position.y = actor.y + centerHeight; position.z = actor.z;
    movement.x = dx; movement.y = -Math.max(.03, 9.81 * dt * dt); movement.z = dz;
    collider.setTranslation(position);
    this.controller.computeColliderMovement(collider, movement, undefined, undefined, this.isSolid);
    const delta = this.controller.computedMovement();
    [actor.x, actor.z] = constrain(this.boundary, [actor.x + delta.x, actor.z + delta.z]);
    actor.y = Math.max(0, actor.y + delta.y);
  }
  direction(from: ActorState, to: ActorState, dt: number): { x: number; z: number } {
    if (this.navigationPending) {
      // Until fresh routes arrive, use clear direct travel or wait; never follow a stale path into regrowth.
      return this.lineOfSight(from, to) ? { x: to.x - from.x, z: to.z - from.z } : { x: 0, z: 0 };
    }
    let route = this.routes.get(from);
    if (!route) { route = {path:[],target:[Infinity,Infinity],age:Infinity,next:0}; this.routes.set(from,route); }
    route.age += dt;
    if (route.age >= .25 || Math.hypot(to.x - route.target[0], to.z - route.target[1]) >= .4) {
      const result = findPath(this.nav, [from.x, from.y, from.z], [to.x, to.y, to.z], [.6, 1, .6], DEFAULT_QUERY_FILTER);
      route.path = result.success ? result.path.map(p => [...p.position] as [number, number, number]) : [];
      route.target[0] = to.x; route.target[1] = to.z; route.age = 0; route.next = 0;
    }
    // Consuming a waypoint need not move every remaining point in the array.
    while (route.next < route.path.length && Math.hypot(route.path[route.next][0] - from.x, route.path[route.next][2] - from.z) < .18) route.next++;
    const next = route.path[route.next];
    return next ? { x: next[0] - from.x, z: next[2] - from.z } : { x: 0, z: 0 };
  }
  /** Independent pickup paths never replace the enemy's pursuit-path cache. */
  pickupPath(from: ActorState, point: [number, number], height: number): [number, number][] | null {
    if (!this.navigationReady) return null;
    const result = findPath(this.nav, [from.x, from.y, from.z], [point[0], height, point[1]], [.6, 1, .6], DEFAULT_QUERY_FILTER);
    const end = result.path.at(-1)?.position;
    if (!result.success || !end || Math.hypot(end[0] - point[0], end[2] - point[1]) > .65) return null;
    // Nearest-poly snapping can end on the opposite side of a thin obstacle.
    if (!this.visible({ ...from, x: end[0], y: end[1], z: end[2] },
      { x: point[0], y: height, z: point[1] }, .15)) return null;
    return result.path.map(p => [p.position[0], p.position[2]]);
  }
  /** Include the final ground segment, even when navigation ends beside the drop. */
  pickupReachable(from: ActorState, point: [number, number], height: number, reach: number): boolean {
    const path = this.pickupPath(from, point, height);
    if (!path) return false;
    let length = 0, previous: [number, number] = [from.x, from.z];
    for (const waypoint of [...path, point]) {
      length += Math.hypot(waypoint[0] - previous[0], waypoint[1] - previous[1]);
      previous = waypoint;
    }
    return length <= reach;
  }
  /** Reach a free point beside an object; never path into its blocking center. */
  interactionPath(from: ActorState, point: [number,number], height: number, reach: number, obstacleId: string): [number,number][] | null {
    if (!this.navigationReady) return null;
    if (Math.hypot(from.x-point[0],from.z-point[1])<=reach && this.interactionVisible(from,point,height,obstacleId)) return [];
    const angle=Math.atan2(from.z-point[1],from.x-point[0]);
    for(let i=0;i<16;i++) {
      const offset=(i%2 ? 1 : -1)*Math.ceil(i/2)*Math.PI/8;
      const endpoint:[number,number]=[point[0]+Math.cos(angle+offset)*reach*.85,point[1]+Math.sin(angle+offset)*reach*.85];
      const target={...from,x:endpoint[0],z:endpoint[1],y:height};
      if (!this.interactionVisible(target,point,height,obstacleId)) continue;
      const path=this.pickupPath(from,endpoint,height);
      const end = path?.at(-1);
      if (end && Math.hypot(end[0]-point[0],end[1]-point[1])<=reach &&
        this.interactionVisible({...target,x:end[0],z:end[1]},point,height,obstacleId)) return path;
    }
    return null;
  }
  interactionVisible(from: ActorState, point: [number,number], height: number, obstacleId: string): boolean {
    return this.visible(from, { x: point[0], y: height, z: point[1] }, .9, this.obstacles.get(obstacleId)?.collider);
  }

  attackGround(from: ActorState, point: AimPoint): (AimPoint & {y:number}) | null {
    if (boundaryDistance(this.boundary,[point.x,point.z])<0) return null;
    const start=from.y+1.5;
    const ray=this.setQueryRay(point.x,start,point.z,0,-1,0);
    const hit=this.world.castRay(ray,4,true,undefined,undefined,undefined,undefined,this.isSolid);
    if (!hit || this.blockingObstacles.has(hit.collider.handle)) return null;
    const target={x:point.x,z:point.z,y:start-hit.timeOfImpact};
    return this.lineOfSight(from,target) ? target : null;
  }

  lootGround(origin: [number, number], index: number, player: ActorState): { position: [number, number]; height: number } {
    for (let attempt = 0; attempt < 24; attempt++) {
      const angle = index * 2.4 + attempt * 2.4, distance = .65 + (attempt % 4) * .25;
      const point = constrain(this.boundary, [origin[0] + Math.cos(angle) * distance, origin[1] + Math.sin(angle) * distance]);
      const ray = this.setQueryRay(point[0], player.y + 12, point[1], 0, -1, 0);
      const hit = this.world.castRay(ray, 30, true, undefined, undefined, undefined, undefined, this.isSolid);
      if (!hit || this.blockingObstacles.has(hit.collider.handle)) continue;
      const height = Math.max(0, player.y + 12 - hit.timeOfImpact);
      if (this.pickupPath(player, point, height)) return { position: point, height };
    }
    // The actor's collision-resolved ground is the safe final placement.
    return { position: [player.x, player.z], height: player.y };
  }
  /** Resource contacts may intersect their own proxy, but never another blocking prop. */
  resourceVisible(from: ActorState, id: string, point: {x:number;y:number;z:number}): boolean {
    return this.visible(from, point, .7, this.obstacles.get(id)?.collider);
  }
  lineOfSight(from: Pick<ActorState,'x' | 'y' | 'z'>, to: Pick<ActorState,'x' | 'y' | 'z'>): boolean {
    return this.visible(from, to, .9);
  }
  private setQueryRay(x: number, y: number, z: number, dx: number, dy: number, dz: number): RAPIER.Ray {
    const ray = this.queryRay;
    ray.origin.x = x; ray.origin.y = y; ray.origin.z = z;
    ray.dir.x = dx; ray.dir.y = dy; ray.dir.z = dz;
    return ray;
  }
  private visible(from: Pick<ActorState,'x' | 'y' | 'z'>, to: { x: number; y: number; z: number }, eyeHeight: number, ignored?: RAPIER.Collider): boolean {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, length = Math.hypot(dx, dy, dz);
    if (length < .001) return true;
    const ray = this.setQueryRay(from.x, from.y + eyeHeight, from.z, dx / length, dy / length, dz / length);
    // Native exclusion preserves self-proxy tolerance without a per-query
    // JavaScript predicate closure or candidate callback for that collider.
    return !this.world.castRay(ray, length, true, undefined, undefined, ignored, undefined, this.isSolid);
  }
  /** Earliest solid intersection along the exact projectile segment, expressed as 0–1 travel. */
  segmentHit(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }): number | null {
    if (this.disposed) return null;
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, length = Math.hypot(dx, dy, dz);
    if (length < .000001) return null;
    const ray = this.setQueryRay(from.x, from.y, from.z, dx / length, dy / length, dz / length);
    const hit = this.world.castRay(ray, length, true, undefined, undefined, undefined, undefined, this.isSolid);
    return hit ? hit.timeOfImpact / length : null;
  }
  get navigationReady(): boolean { return !this.navigationPending && !this.disposed; }
  reset(): void { this.routes = new WeakMap(); }
  dispose(): void { if (this.disposed) return; this.disposed = true; this.navigationWorker?.terminate(); this.world.free(); }
}
