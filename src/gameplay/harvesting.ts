import { renewalSeconds, type SavedResource } from './outing';
import type { TreeDefinition } from '../levels/trees';
import { resourceItem, resourceSkill, type ResourceDefinition } from '../levels/resources';
import type { Point } from './area';
import { type Encounter } from './encounter';
import type { AreaDefinition } from '../levels/types';
import { gathering, harvestQuantity, progression, skillLevel, type GatheringSkill } from './skills';
export type TreeState = { hits: number; felled: boolean };
export type TreeChange = { areaId: string; id: string; felled: boolean };
export type HarvestReward = { item: 'wood' | 'stone' | 'iron'; quantity: number; skill: GatheringSkill; xpPerUnit: number; felled: boolean };
type SessionResource = { definition: ResourceDefinition; hits: number; regrowAt?: number };
/** Gathering shares one threat rule across starting, continuing and interaction prompts. */
export function gatheringSafe(encounter: Encounter, kind: AreaDefinition['kind']): boolean {
  return kind === 'safe' || !encounter.enemyIds.some(id => {
    const enemy = encounter.enemies[id];
    return enemy.home && enemy.hp > 0 && ((enemy.engaged && !enemy.returning) || Math.hypot(enemy.x - encounter.player.x, enemy.z - encounter.player.z) <= gathering.threatRadius);
  });
}

/** Active-play depletion clock. Character resources and XP belong to Adventure. */
export class Harvesting {
  private elapsed = 0;
  private nextRegrowthAt = Infinity;
  private readonly areas = new Map<string, Map<string, SessionResource>>();
  reset(): void {
    this.elapsed = 0;
    this.nextRegrowthAt = Infinity;
    for (const nodes of this.areas.values()) for (const node of nodes.values()) {
      node.hits = 0; node.regrowAt = undefined;
    }
  }
  register(areaId: string, resources: (ResourceDefinition | TreeDefinition)[]): void {
    const previous = this.areas.get(areaId);
    this.areas.set(areaId, new Map(resources.map(node => {
      const definition: ResourceDefinition = { kind: 'tree', level: gathering.resourceLevel, baseYield: gathering.baseYield, contacts: gathering.contacts, ...node };
      return [node.id, { ...previous?.get(node.id), definition, hits: previous?.get(node.id)?.hits ?? 0 }];
    })));
    // Registration may remove or replace a depleted node. Recompute the next
    // deadline here; active frames need no scan before that deadline arrives.
    this.nextRegrowthAt = Infinity;
    for (const nodes of this.areas.values()) for (const node of nodes.values()) {
      if (node.regrowAt !== undefined) this.nextRegrowthAt = Math.min(this.nextRegrowthAt, node.regrowAt);
    }
  }
  restore(elapsed: number, saved: Record<string, Record<string, SavedResource>>): void {
    this.elapsed = elapsed;
    for (const [areaId, resources] of Object.entries(saved)) for (const [id, state] of Object.entries(resources)) {
      const node = this.areas.get(areaId)?.get(id);
      if (node) { node.hits = Math.min(state.hits, node.definition.contacts); node.regrowAt = state.regrowAt; }
    }
    this.nextRegrowthAt = elapsed;
  }
  snapshot(areaId: string): Record<string, SavedResource> {
    return Object.fromEntries([...(this.areas.get(areaId)?.entries() ?? [])].map(([id, node]) => [id, { hits: node.hits, regrowAt: node.regrowAt }]));
  }
  state(areaId: string, id: string): TreeState | undefined {
    const node = this.areas.get(areaId)?.get(id);
    return node && { hits: node.hits, felled: node.regrowAt !== undefined };
  }
  isDepleted(areaId: string, id: string): boolean { return this.areas.get(areaId)?.get(id)?.regrowAt !== undefined; }
  facing(areaId: string, point: Point, yaw: number): ResourceDefinition | undefined {
    return this.closest(areaId, point, gathering.reach, yaw);
  }
  private closest(areaId: string, point: Point, reach: number, yaw?: number): ResourceDefinition | undefined {
    let closest: ResourceDefinition | undefined, distance = reach;
    for (const node of this.areas.get(areaId)?.values() ?? []) {
      if (node.regrowAt !== undefined) continue;
      const candidate = node.definition, next = this.distance(candidate, point);
      if (!(next <= distance) || closest && next === distance) continue;
      if (yaw !== undefined && !(Math.cos(Math.atan2(candidate.position[0] - point[0], candidate.position[2] - point[1]) - yaw) >= Math.cos(gathering.facingCone))) continue;
      closest = candidate; distance = next;
    }
    return closest;
  }
  contact(areaId: string, id: string, point: Point, xp = 0): HarvestReward | undefined {
    const node = this.areas.get(areaId)?.get(id);
    if (!node || node.regrowAt !== undefined || this.distance(node.definition, point) > gathering.reach) return;
    if (++node.hits >= node.definition.contacts) {
      node.regrowAt = this.elapsed + renewalSeconds;
      this.nextRegrowthAt = Math.min(this.nextRegrowthAt, node.regrowAt);
    }
    return { item: resourceItem(node.definition.kind), quantity: harvestQuantity(skillLevel(xp),node.definition.level,node.definition.baseYield), skill: resourceSkill(node.definition.kind), xpPerUnit: progression.gatheringXp * node.definition.level, felled: node.regrowAt !== undefined };
  }
  advance(dt: number, occupants: { areaId: string; position: Point; radius?: number }[] = [], eligible: (areaId: string, node: ResourceDefinition) => boolean = () => true): TreeChange[] {
    this.elapsed += Math.max(0, dt);
    const changes: TreeChange[] = [];
    if (this.elapsed < this.nextRegrowthAt) return changes;
    this.nextRegrowthAt = Infinity;
    for (const [areaId, nodes] of this.areas) for (const [id, node] of nodes) {
      if (node.regrowAt === undefined) continue;
      if (node.regrowAt > this.elapsed || !eligible(areaId, node.definition) || occupants.some(actor => actor.areaId === areaId && this.distance(node.definition, actor.position) < (actor.radius ?? .3) + .05)) {
        this.nextRegrowthAt = Math.min(this.nextRegrowthAt, Math.max(this.elapsed + .5, node.regrowAt)); continue;
      }
      node.hits = 0; node.regrowAt = undefined; changes.push({ areaId, id, felled: false });
    }
    return changes;
  }
  distance(node: TreeDefinition, point: Point): number { return Math.max(0, Math.hypot(point[0] - node.position[0], point[1] - node.position[2]) - node.radius); }
}
