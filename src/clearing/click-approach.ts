import { near, dropLandingSeconds, pickupRadius, type Adventure } from '../gameplay/adventure';
import type { Point } from '../gameplay/area';
import type { AimPoint, Encounter } from '../gameplay/encounter';
import type { MovementWorld } from '../gameplay/movement';
import type { WorldInteraction } from './world-interactions';

type Route = {
  target: { kind: 'loot'; id: string } | { kind: 'world'; key: string };
  points: Point[];
  elapsed: number;
  stalled: number;
  last: Point;
};
type ApproachCommand = { movement: { x: number; z: number }; aim: AimPoint };
type ApproachFrame = {
  movement: { x: number; z: number };
  block: boolean;
  navigation: MovementWorld | undefined;
  targets: () => readonly WorldInteraction[];
  error: (target: WorldInteraction) => string;
  interact: (target: WorldInteraction) => void;
};

/** One click destination at a time; loot landing and object eligibility stay with their owners. */
export class ClickApproach {
  private route: Route | null = null;

  constructor(private readonly adventure: Adventure, private readonly encounter: Encounter) {}

  get worldKey(): string | null {
    return this.route?.target.kind === 'world' ? this.route.target.key : null;
  }

  cancel(): void {
    this.route = null;
    this.adventure.cancelPickup();
  }

  private start(target: Route['target'], points: Point[]): void {
    this.route = { target, points, elapsed: 0, stalled: 0, last: [this.encounter.player.x, this.encounter.player.z] };
  }

  selectLoot(id: string, navigation: MovementWorld | undefined): void {
    const drop = this.adventure.session().drops.find(drop => drop.id === id);
    if (!drop) return;
    this.cancel();
    const point: Point = [this.encounter.player.x, this.encounter.player.z];
    if (near(point, drop.position, pickupRadius) && this.adventure.canCollectGround(drop)) {
      if (drop.age >= dropLandingSeconds) this.adventure.pickup(id, point, true);
      else {
        this.adventure.pickupTarget = id;
        this.start({ kind: 'loot', id }, []);
      }
      return;
    }
    const points = navigation?.pickupPath(this.encounter.player, drop.position, drop.height);
    if (!points && (!navigation || navigation.navigationReady)) { this.adventure.message('Can’t reach item'); return; }
    this.adventure.pickupTarget = id;
    this.start({ kind: 'loot', id }, points ?? []);
  }

  selectWorld(target: WorldInteraction, navigation: MovementWorld | undefined): void {
    this.cancel();
    const points = navigation?.interactionPath(this.encounter.player, target.position, target.height, target.range, target.obstacleId);
    if (!points && (!navigation || navigation.navigationReady)) { this.adventure.message('Can’t reach object'); return; }
    this.start({ kind: 'world', key: target.key }, points ?? []);
  }

  update(dt: number, frame: ApproachFrame): ApproachCommand | undefined {
    const route = this.route;
    if (!route) return;
    const { player, dodgeRemaining } = this.encounter;
    const { navigation } = frame;
    if (Math.hypot(frame.movement.x, frame.movement.z) > 0 || frame.block || player.hp <= 0) { this.cancel(); return; }
    // Tree depletion/regrowth temporarily invalidates routes; retain the click
    // without walking an old route or consuming the stuck-movement deadline.
    if (navigation && !navigation.navigationReady) {
      route.points = [];
      route.elapsed = .3;
      route.stalled = 0;
      route.last = [player.x, player.z];
      return;
    }
    const point: Point = [player.x, player.z];
    let refresh: () => Point[] | null | undefined;
    const loot = route.target.kind === 'loot';
    if (route.target.kind === 'loot') {
      const id = route.target.id;
      const drop = this.adventure.session().drops.find(drop => drop.id === id);
      if (!this.adventure.pickupTarget || !drop) { this.cancel(); return; }
      if (near(point, drop.position, pickupRadius) && this.adventure.canCollectGround(drop)) {
        if (drop.age >= dropLandingSeconds) { this.adventure.pickup(drop.id, point, true); this.cancel(); }
        return;
      }
      refresh = () => navigation?.pickupPath(player, drop.position, drop.height);
    } else {
      const key = route.target.key;
      const target = frame.targets().find(target => target.key === key);
      if (!target) { this.cancel(); return; }
      const error = frame.error(target);
      if (error) { this.adventure.message(error); this.cancel(); return; }
      if (near(point, target.position, target.range) && navigation?.interactionVisible(player, target.position, target.height, target.obstacleId)) {
        if (!player.lock && !dodgeRemaining) { this.cancel(); frame.interact(target); }
        return;
      }
      refresh = () => navigation?.interactionPath(player, target.position, target.height, target.range, target.obstacleId);
    }

    const fail = () => { this.adventure.message(loot ? 'Can’t reach item' : 'Can’t reach object'); this.cancel(); };
    route.elapsed += dt;
    if (route.elapsed >= .3) {
      const points = refresh();
      if (points) route.points = points;
      else if (navigation?.navigationReady) { fail(); return; }
      route.elapsed = 0;
    }
    // Keep the endpoint until the target's range/visibility checks above accept arrival.
    // Waypoint tolerance alone can stop short of a small object's working range.
    while (route.points.length > 1 && near(point, route.points[0], loot ? .2 : .18)) route.points.shift();
    const next = route.points[0];
    const command = next ? { movement: { x: next[0] - point[0], z: next[1] - point[1] }, aim: { x: next[0], z: next[1] } } : undefined;
    // Object routes retain their existing lock rule; loot also waits out a dodge.
    const canAdvance = !player.lock && (!loot || !dodgeRemaining);
    route.stalled = canAdvance && near(point, route.last, .01) ? route.stalled + dt : 0;
    route.last = point;
    if (route.stalled > 1 && canAdvance && navigation?.navigationReady) fail();
    return command;
  }
}
