import RAPIER from '@dimforge/rapier3d-compat';
import { constrain, type Boundary } from './area';
import type { ActorId, ActorState, MovementActor, MovementMode, MovementResult } from './encounter-model';

export const actorRadius = .3, actorHalfHeight = .55, actorCenterHeight = .87;
const clearance = .015;
type Point = { x: number; y: number; z: number };
type DodgePlan = { points: Point[]; step: number; travel: number; used: number; direction: { x: number; z: number }; invalidated: boolean; reservation: RAPIER.Collider };
type Body = { state: ActorState; collider: RAPIER.Collider; dodging: boolean };

/** Colliders are query proxies. Only the encounter can change an actor's pose. */
export class ActorMovement {
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly bodies = new Map<ActorId, Body>();
  private readonly handles = new Map<number, Body>();
  private readonly dodges = new Map<ActorId, DodgePlan>();
  private readonly landingShape = new RAPIER.Capsule(actorHalfHeight, actorRadius + clearance);
  private readonly position = { x: 0, y: 0, z: 0 };
  private readonly desired = { x: 0, y: 0, z: 0 };
  private readonly reservations = new Map<number, ActorId>();
  private queryingId: ActorId = '';
  private queryingState?: ActorState;
  private mode: MovementMode = 'walk';
  private blockReason: 'actor' | 'scenery' | 'boundary' | 'landing' | null = null;
  private readonly overlaps = new Set<number>();
  private readonly blocks = (collider: RAPIER.Collider): boolean => {
    if (this.solid(collider)) return true;
    const owner = this.reservations.get(collider.handle);
    if (owner !== undefined) return owner !== this.queryingId && this.mode !== 'dodge';
    const body = this.handles.get(collider.handle);
    if (!body || body.state === this.queryingState || body.state.hp <= 0 || body.dodging || this.mode === 'dodge') return false;
    return !this.overlaps.has(collider.handle);
  };
  private readonly occupied = (collider: RAPIER.Collider): boolean => {
    const body = this.handles.get(collider.handle);
    return !!body && body.state !== this.queryingState && body.state.hp > 0 ||
      this.reservations.has(collider.handle) && this.reservations.get(collider.handle) !== this.queryingId;
  };
  readonly records = new Map<ActorId, { mode: MovementMode; requested: Point; resolved: Point; blocked: boolean; reason: 'actor' | 'scenery' | 'boundary' | 'landing' | null }>();
  constructor(private readonly world: RAPIER.World, private readonly boundary: Boundary,
    private readonly solid: (collider: RAPIER.Collider) => boolean,
    private readonly groundSpawn: (actor: ActorState) => void, private readonly minGroundY: number) {
    this.controller = world.createCharacterController(clearance);
    this.controller.enableAutostep(.3, .15, false); this.controller.enableSnapToGround(.3);
    this.controller.setMaxSlopeClimbAngle(Math.PI / 4); this.controller.setMinSlopeSlideAngle(Math.PI / 4);
  }
  private body(id: ActorId, state: ActorState): Body {
    let body = this.bodies.get(id);
    if (!body || body.state !== state) this.groundSpawn(state);
    if (body && body.state !== state) { this.releaseDodge(id); body.state = state; }
    if (!body) {
      const collider = this.world.createCollider(RAPIER.ColliderDesc.capsule(actorHalfHeight, actorRadius).setSensor(true));
      body = { state, collider, dodging: false }; this.bodies.set(id, body); this.handles.set(collider.handle, body);
    }
    body.collider.setEnabled(state.hp > 0);
    body.collider.setTranslation({ x: state.x, y: state.y + actorCenterHeight, z: state.z });
    return body;
  }
  sync(actors: readonly MovementActor[]): void {
    const present = new Set(actors.map(actor => actor.id));
    for (const [id, body] of this.bodies) if (!present.has(id)) {
      this.releaseDodge(id); this.handles.delete(body.collider.handle); this.world.removeCollider(body.collider, true); this.bodies.delete(id); this.records.delete(id);
    }
    for (const actor of actors) {
      const body = this.body(actor.id, actor.state); body.dodging = !!actor.dodging;
      if (!body.dodging || actor.state.hp <= 0) this.releaseDodge(actor.id);
    }
    this.world.step();
  }
  private compute(id: ActorId, state: ActorState, collider: RAPIER.Collider, dx: number, dz: number, dt: number, mode: MovementMode): Point {
    this.queryingId = id; this.queryingState = state; this.mode = mode;
    this.position.x = state.x; this.position.y = state.y + actorCenterHeight; this.position.z = state.z;
    this.desired.x = dx; this.desired.y = mode === 'walk' ? -Math.max(.03, 9.81 * dt * dt) : -.0001; this.desired.z = dz;
    collider.setTranslation(this.position);
    // Native queries cannot re-enter Rapier from a filter callback. Resolve
    // permitted overlap exits before borrowing the world for controller movement.
    this.overlaps.clear();
    for (const other of this.bodies.values()) if (other.state !== state && other.state.hp > 0) {
      const separationX = state.x - other.state.x, separationZ = state.z - other.state.z;
      if (separationX * separationX + separationZ * separationZ > 1e-8 && separationX * dx + separationZ * dz <= 0) continue;
      const contact = other.collider.contactShape(this.landingShape, this.position, RAPIER.RotationOps.identity(), 0);
      if (contact && contact.distance < -clearance) this.overlaps.add(other.collider.handle);
    }
    this.controller.setSlideEnabled(true);
    this.controller.computeColliderMovement(collider, this.desired, undefined, undefined, this.blocks);
    const delta = this.controller.computedMovement();
    this.blockReason = null;
    if (Math.hypot(delta.x - dx, delta.z - dz) > .001) for (let i = 0; i < this.controller.numComputedCollisions(); i++) {
      const collision = this.controller.computedCollision(i);
      if (collision?.collider && collision.normal1.y < Math.SQRT1_2) {
        this.blockReason = this.solid(collision.collider) ? 'scenery' : this.reservations.has(collision.collider.handle) ? 'landing' : 'actor'; break;
      }
    }
    // Keep ground sliding/steps, but end a lunge at its first wall or body
    // contact rather than letting the remainder slide sideways.
    if (mode === 'lunge') for (let i = 0; i < this.controller.numComputedCollisions(); i++) {
      const collision = this.controller.computedCollision(i);
      if (collision && collision.normal1.y < Math.SQRT1_2) { Object.assign(delta, collision.translationDeltaApplied); break; }
    }
    const [x, z] = constrain(this.boundary, [state.x + delta.x, state.z + delta.z]);
    if (Math.hypot(x - state.x - delta.x, z - state.z - delta.z) > .001) this.blockReason = 'boundary';
    let y = Math.max(this.minGroundY, state.y + delta.y);
    if (mode !== 'walk') {
      // Resolve horizontal travel before ground settling. A long downward
      // diagonal can stop on a triangle seam even with an upward floor normal.
      collider.setTranslation({ x, y: y + actorCenterHeight, z });
      this.controller.computeColliderMovement(collider, { x: 0, y: -.3, z: 0 }, undefined, undefined, this.solid);
      y = Math.max(this.minGroundY, y + this.controller.computedMovement().y);
    }
    return { x, y, z };
  }
  private clear(id: ActorId, state: ActorState, point: Point): boolean {
    this.queryingId = id; this.queryingState = state;
    return this.world.intersectionWithShape({ x: point.x, y: point.y + actorCenterHeight, z: point.z },
      RAPIER.RotationOps.identity(), this.landingShape, undefined, undefined, undefined, undefined, this.occupied) === null;
  }
  private planDodge(id: ActorId, state: ActorState, dx: number, dz: number, distance: number): DodgePlan {
    const body = this.body(id, state), start = { x: state.x, y: state.y, z: state.z };
    const steps = Math.max(1, Math.ceil(distance / .05)), step = distance / steps, length = Math.hypot(dx, dz);
    const points = [start]; let lastClear = 0;
    let probe = { ...state };
    for (let i = 1; i <= steps && length > 0; i++) {
      const point = this.compute(id, probe, body.collider, dx / length * step, dz / length * step, .45 / steps, 'dodge');
      points.push(point); probe = { ...probe, ...point };
      // Compare against the real owner, not the temporary trajectory pose.
      if (this.clear(id, state, point)) lastClear = i;
    }
    points.length = lastClear + 1;
    const end = points[lastClear];
    body.collider.setTranslation({ x: state.x, y: state.y + actorCenterHeight, z: state.z });
    const reservation = this.world.createCollider(RAPIER.ColliderDesc.capsule(actorHalfHeight, actorRadius).setSensor(true)
      .setTranslation(end.x, end.y + actorCenterHeight, end.z));
    this.reservations.set(reservation.handle, id); this.world.step();
    const plan = { points, step, travel: lastClear * step, used: 0, direction: { x: length ? dx / length : 0, z: length ? dz / length : 0 }, invalidated: false, reservation };
    this.dodges.set(id, plan); return plan;
  }
  move(id: ActorId, state: ActorState, dx: number, dz: number, dt: number, mode: MovementMode = 'walk', dodgeDistance = 2.4): MovementResult {
    const body = this.body(id, state), start = { x: state.x, y: state.y, z: state.z };
    if (mode !== 'dodge') this.releaseDodge(id);
    if (mode === 'dodge') {
      let plan = this.dodges.get(id) ?? this.planDodge(id, state, dx, dz, dodgeDistance);
      if (plan.invalidated) {
        const remaining = plan.travel - plan.used;
        this.releaseDodge(id); plan = this.planDodge(id, state, plan.direction.x, plan.direction.z, remaining);
      }
      const next = Math.min(plan.travel, plan.used + Math.hypot(dx, dz));
      if (plan.travel > 0) {
        const index = Math.min(plan.points.length - 2, Math.floor(next / plan.step));
        const fraction = Math.min(1, next / plan.step - index);
        const a = plan.points[index], b = plan.points[index + 1];
        // Replay the validated terrain trajectory. Re-running tiny grounded
        // controller moves introduces seam nudges that depend on frame partition.
        Object.assign(state, { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction, z: a.z + (b.z - a.z) * fraction });
      }
      plan.used = next;
      if (plan.travel === 0) Object.assign(state, this.compute(id, state, body.collider, 0, 0, dt, mode));
    } else Object.assign(state, this.compute(id, state, body.collider, dx, dz, dt, mode));
    body.dodging = mode === 'dodge';
    body.collider.setTranslation({ x: state.x, y: state.y + actorCenterHeight, z: state.z }); this.world.step();
    const resolved = { x: state.x - start.x, y: state.y - start.y, z: state.z - start.z };
    const blocked = Math.hypot(resolved.x - dx, resolved.z - dz) > .001;
    this.records.set(id, { mode, requested: { x: dx, y: 0, z: dz }, resolved, blocked, reason: blocked ? mode === 'dodge' ? 'landing' : this.blockReason ?? 'scenery' : null });
    return { ...resolved, blocked };
  }
  sceneryChanged(): void { for (const plan of this.dodges.values()) plan.invalidated = true; }
  releaseDodge(id: ActorId): void {
    const body = this.bodies.get(id); if (body) body.dodging = false;
    const plan = this.dodges.get(id); if (!plan) return;
    this.reservations.delete(plan.reservation.handle); this.world.removeCollider(plan.reservation, true); this.dodges.delete(id);
  }
  reset(): void {
    for (const id of this.dodges.keys()) this.releaseDodge(id);
    for (const body of this.bodies.values()) this.world.removeCollider(body.collider, true);
    this.bodies.clear(); this.handles.clear(); this.records.clear();
  }
  landings(): { id: ActorId; position: Point }[] {
    return [...this.dodges].map(([id, plan]) => ({ id, position: plan.reservation.translation() }));
  }
}
