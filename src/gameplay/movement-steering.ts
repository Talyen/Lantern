import { createFindNearestPolyResult, DEFAULT_QUERY_FILTER, findNearestPoly, type NavMesh } from 'navcat';
import { crowd, localBoundary, obstacleAvoidance } from 'navcat/blocks';
import type { ActorId, ActorState, EnemyKind, MovementActor, MovementResult } from './encounter-model';

type Point = { x: number; y: number; z: number };
type Goal = { kind: EnemyKind; point: ActorState; target: Point; age: number; stalled: number };
type Agent = { state: ActorState; velocity: [number, number, number]; desired: [number, number, number]; boundary: localBoundary.LocalBoundary; goal?: Goal };
type Candidate = { position: Point; next: Point; distance: number };
const avoidanceParams = { ...crowd.DEFAULT_OBSTACLE_AVOIDANCE_PARAMS, horizTime: .6 };

/** Tactical goals and local velocities are proposals; Rapier/encounter own their resolution. */
export class MovementSteering {
  private readonly agents = new Map<ActorId, Agent>();
  private readonly query = obstacleAvoidance.createObstacleAvoidanceQuery(16, 16);
  private readonly nearest = createFindNearestPolyResult();
  private readonly output: [number, number, number] = [0, 0, 0];
  constructor(private readonly path: (from: ActorState, point: Point) => Candidate | null,
    private readonly visible: (from: ActorState, target: ActorState) => boolean) {}
  sync(actors: readonly MovementActor[]): void {
    const present = new Set(actors.filter(actor => actor.state.hp > 0).map(actor => actor.id));
    for (const id of this.agents.keys()) if (!present.has(id)) this.agents.delete(id);
    for (const actor of actors) if (actor.state.hp > 0) {
      const old = this.agents.get(actor.id);
      if (!old || old.state !== actor.state) this.agents.set(actor.id, { state: actor.state, velocity: [0, 0, 0], desired: [0, 0, 0], boundary: localBoundary.create() });
    }
  }
  approach(id: ActorId, actor: ActorState, target: ActorState, kind: EnemyKind, dt: number): ActorState {
    const agent = this.agents.get(id); if (!agent) return target;
    const reach = kind === 'caster' ? 6 : 1.6;
    if (Math.hypot(target.x - actor.x, target.z - actor.z) <= reach && Math.abs(target.y - actor.y) < .8 && this.visible(actor, target)) {
      agent.goal = undefined; return actor;
    }
    const old = agent.goal;
    if (old) {
      old.age += dt;
      if (old.age < .25 && old.stalled < .5 && Math.hypot(target.x - old.target.x, target.z - old.target.z, target.y - old.target.y) < .4) return old.point;
    }
    const claimed = (point: Point): boolean => [...this.agents].some(([otherId, other]) => {
      if (id === otherId || otherId === 'player' || Math.abs(other.state.y - point.y) >= .8) return false;
      const position = other.goal?.point ?? other.state;
      return Math.hypot(position.x - point.x, position.z - point.z) < .65;
    });
    const valid = (point: Point): boolean => !claimed(point) && Math.abs(point.y - target.y) < .8 && this.visible({ ...actor, ...point }, target);
    // Retain a valid claim across refreshes. A stall relinquishes it to try another route.
    if (old && old.stalled < .5 && Math.hypot(target.x - old.target.x, target.z - old.target.z, target.y - old.target.y) < .4 &&
      valid(old.point) && this.path(actor, old.point)) { old.age = 0; return old.point; }
    let best: Candidate | undefined;
    for (const radius of kind === 'caster' ? [4.5, 5.5] : [1.35]) for (let slot = 0; slot < 12; slot++) {
      const angle = slot * Math.PI / 6;
      const point = { x: target.x + Math.sin(angle) * radius, y: target.y, z: target.z + Math.cos(angle) * radius };
      const candidate = this.path(actor, point);
      if (!candidate || !valid(candidate.position) || old?.stalled && old.stalled >= .5 && Math.hypot(candidate.position.x - old.point.x, candidate.position.z - old.point.z) < .2) continue;
      if (!best || candidate.distance < best.distance) best = candidate;
    }
    const point = best ? { ...target, ...best.position } : kind === 'caster' ? actor : target;
    agent.goal = { kind, point, target: { x: target.x, y: target.y, z: target.z }, age: 0, stalled: 0 };
    return point;
  }
  steer(id: ActorId, actor: ActorState, dx: number, dz: number, dt: number, nav: NavMesh,
    landings: readonly { id: ActorId; position: Point }[], seeking: boolean): { x: number; z: number } {
    const agent = this.agents.get(id), speed = dt > 0 ? Math.hypot(dx, dz) / dt : 0;
    if (!agent || speed === 0) return { x: dx, z: dz };
    if (!seeking) agent.goal = undefined;
    const player = this.agents.get('player')?.state;
    if (agent.goal?.kind === 'raider' && player) {
      const angle = Math.atan2(actor.z - player.z, actor.x - player.x);
      const targetAngle = Math.atan2(agent.goal.point.z - player.z, agent.goal.point.x - player.x);
      const turn = Math.atan2(Math.sin(targetAngle - angle), Math.cos(targetAngle - angle));
      if (Math.abs(turn) > Math.PI / 9) {
        // Far-side claims need a short route around the front rank, rather than
        // a desired velocity pointing through it. Navcat still validates the route.
        const detourAngle = angle + Math.sign(turn) * Math.min(Math.abs(turn), Math.PI / 6), radius = 2.4;
        const detour = this.path(actor, { x: player.x + Math.cos(detourAngle) * radius, y: player.y, z: player.z + Math.sin(detourAngle) * radius });
        if (detour) {
          const x = detour.next.x - actor.x, z = detour.next.z - actor.z, length = Math.hypot(x, z);
          if (length > .001) { dx = x / length * speed * dt; dz = z / length * speed * dt; }
        }
      }
    }
    agent.desired[0] = dx / dt; agent.desired[1] = 0; agent.desired[2] = dz / dt;
    obstacleAvoidance.resetObstacleAvoidanceQuery(this.query);
    for (const [otherId, other] of this.agents) {
      if (otherId === id || Math.abs(other.state.y - actor.y) >= .8 || Math.hypot(other.state.x - actor.x, other.state.z - actor.z) > 2) continue;
      const planted = other.state.lock > 0 || other.state.attackTime >= 0;
      const velocity: [number, number, number] = planted ? [0, 0, 0] : other.velocity;
      obstacleAvoidance.addCircleObstacle(this.query, [other.state.x, other.state.y, other.state.z], .375, velocity, planted ? velocity : other.desired);
    }
    for (const landing of landings) if (landing.id !== id && Math.abs(landing.position.y - actor.y) < .8 && Math.hypot(landing.position.x - actor.x, landing.position.z - actor.z) < 2)
      obstacleAvoidance.addCircleObstacle(this.query, [landing.position.x, landing.position.y, landing.position.z], .375, [0, 0, 0], [0, 0, 0]);
    const nearest = findNearestPoly(this.nearest, nav, [actor.x, actor.y, actor.z], [.6, 1, .6], DEFAULT_QUERY_FILTER);
    if (nearest.nodeRef !== null) {
      localBoundary.updateLocalBoundary(agent.boundary, nearest.nodeRef, [actor.x, actor.y, actor.z], 2, nav, DEFAULT_QUERY_FILTER);
      for (const { s } of agent.boundary.segments.slice(0, 16)) obstacleAvoidance.addSegmentObstacle(this.query, [s[0], s[1], s[2]], [s[3], s[4], s[5]]);
    }
    obstacleAvoidance.sampleVelocityAdaptive(this.query, [actor.x, actor.y, actor.z], .375, speed,
      agent.velocity, agent.desired, avoidanceParams, this.output);
    return { x: this.output[0] * dt, z: this.output[2] * dt };
  }
  resolved(id: ActorId, result: MovementResult, dt: number, desiredDistance: number): void {
    const agent = this.agents.get(id); if (!agent) return;
    agent.velocity[0] = dt > 0 ? result.x / dt : 0; agent.velocity[2] = dt > 0 ? result.z / dt : 0;
    const requested = Math.max(desiredDistance, Math.hypot(agent.desired[0], agent.desired[2]) * dt);
    if (desiredDistance === 0 && Math.hypot(result.x, result.z) === 0) agent.desired.fill(0);
    if (agent.goal && requested > .001) {
      agent.goal.stalled = Math.hypot(result.x, result.z) < .001 ? agent.goal.stalled + dt : 0;
    }
  }
  reset(): void { this.agents.clear(); }
  diagnostics(): { id: ActorId; goal?: Point }[] { return [...this.agents].map(([id, agent]) => ({ id, goal: agent.goal?.point ? { x: agent.goal.point.x, y: agent.goal.point.y, z: agent.goal.point.z } : undefined })); }
}
