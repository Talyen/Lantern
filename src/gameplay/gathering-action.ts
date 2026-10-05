import type { Adventure } from './adventure';
import type { Encounter } from './encounter';
import { gatheringSafe } from './harvesting';
import { gathering } from './skills';
import { resourceSkill, type ResourceDefinition } from '../levels/resources';
import type { AreaDefinition } from '../levels/types';
import type { Point } from './area';

export type GatheringEvent =
  | { type: 'start'; resource: ResourceDefinition }
  | { type: 'stop' }
  | { type: 'regrown'; id: string }
  | { type: 'contact'; resource: ResourceDefinition; felled: boolean; origin: Point };
type GatheringTiming = { duration: number; contact: number };
type GatheringContext = {
  area(): AreaDefinition;
  paused(): boolean;
  timing(resource: ResourceDefinition): GatheringTiming | undefined;
  visible(resource: ResourceDefinition): boolean;
  setTreeFelled(id: string, felled: boolean): void;
};
type Swing = { resource: ResourceDefinition; time: number; contacted: boolean; timing: GatheringTiming };

/** Commits gathering contacts, rewards and collision state before publishing feedback. */
export class GatheringAction {
  private selected: ResourceDefinition | null = null;
  private swing: Swing | null = null;
  private events: GatheringEvent[] = [];
  constructor(private readonly encounter: Encounter, private readonly adventure: Adventure, private readonly context: GatheringContext) {}
  get target(): ResourceDefinition | null { return this.selected; }
  get choppingId(): string | null { return this.swing?.resource.id ?? null; }
  takeEvents(): GatheringEvent[] { const events = this.events; this.events = []; return events; }

  select(resource: ResourceDefinition): void { this.selected = resource; this.begin(resource); }
  cancel(releaseLock = true): void {
    this.selected = null;
    if (this.swing && releaseLock) this.encounter.player.lock = 0;
    this.swing = null;
    this.events.push({ type: 'stop' });
  }
  cancelIfInterrupted(movement: { x: number; z: number }, blocking: boolean): void {
    if (this.selected && (blocking || Math.hypot(movement.x, movement.z) > 0 ||
      this.encounter.player.hp <= 0 || !gatheringSafe(this.encounter, this.context.area().kind))) this.cancel();
  }

  private begin(resource: ResourceDefinition): void {
    const { player, attackCooldown, dodgeRemaining } = this.encounter;
    const timing = this.context.timing(resource);
    if (this.context.paused() || this.swing || !gatheringSafe(this.encounter, this.context.area().kind) ||
      player.lock > 0 || attackCooldown > 0 || dodgeRemaining > 0 || !timing) return;
    if (this.adventure.harvesting.distance(resource, [player.x, player.z]) > gathering.reach || !this.context.visible(resource)) return;
    this.encounter.pending = null;
    player.attackTime = -1;
    this.encounter.blocking = false;
    player.yaw = Math.atan2(resource.position[0] - player.x, resource.position[2] - player.z);
    player.lock = timing.duration;
    this.swing = { resource, time: 0, contacted: false, timing: { ...timing } };
    this.selected = resource;
    this.events.push({ type: 'start', resource });
  }

  advance(dt: number): void {
    const area = this.context.area(), { player } = this.encounter, harvesting = this.adventure.harvesting;
    // A newly pursuing enemy must cancel before the next resource contact.
    if (this.selected && !gatheringSafe(this.encounter, area.kind)) this.cancel();
    for (const change of this.adventure.takeResourceChanges()) {
      if (change.areaId !== area.id) continue;
      this.context.setTreeFelled(change.id, false);
      this.events.push({ type: 'regrown', id: change.id });
    }
    const swing = this.swing;
    if (!swing) { if (this.selected) this.begin(this.selected); return; }
    swing.time += dt;
    const resource = swing.resource;
    if (!swing.contacted && swing.time >= swing.timing.contact) {
      swing.contacted = true;
      if (!this.context.visible(resource)) { this.cancel(); return; }
      const reward = harvesting.contact(area.id, resource.id, [player.x, player.z], this.adventure.character.xp[resourceSkill(resource.kind)]);
      if (!reward) { this.cancel(); return; }
      this.adventure.grantHarvest(reward.item, reward.quantity, reward.skill, reward.xpPerUnit,
        [resource.position[0], resource.position[2]], { kind: 'resource', id: resource.id });
      if (reward.felled) this.context.setTreeFelled(resource.id, true);
      this.events.push({ type: 'contact', resource, felled: reward.felled, origin: [player.x, player.z] });
    }
    if (swing.time >= swing.timing.duration) {
      this.swing = null;
      player.lock = 0;
      if (harvesting.state(area.id, resource.id)?.felled) this.cancel();
      else this.begin(resource);
    }
  }
}
