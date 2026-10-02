import type { TreeDefinition } from '../levels/trees';
import { resourceItem, resourceSkill, type ResourceDefinition } from '../levels/resources';
import type { Point } from './area';
import { gathering, harvestQuantity, progression, skillLevel, type GatheringSkill } from './skills';
export const chopReach = gathering.reach;
export const treeChops = gathering.contacts;
export const treeRegrowthSeconds = gathering.renewalSeconds;
export type TreeState = { hits: number; felled: boolean };
export type TreeChange = { areaId: string; id: string; felled: boolean };
export type HarvestReward = { item: 'wood' | 'stone' | 'iron'; quantity: number; skill: GatheringSkill; xpPerUnit: number; felled: boolean };
type SessionResource = { definition: ResourceDefinition; hits: number; regrowAt?: number };
/** Session-only depletion clock. Character resources and XP belong to Adventure. */
export class Harvesting {
  private elapsed = 0;
  private readonly areas = new Map<string, Map<string, SessionResource>>();
  register(areaId: string, resources: (ResourceDefinition | TreeDefinition)[]): void {
    const previous = this.areas.get(areaId);
    this.areas.set(areaId, new Map(resources.map(node => {
      const definition: ResourceDefinition = { kind: 'tree', level: gathering.resourceLevel, baseYield: gathering.baseYield, contacts: gathering.contacts, ...node };
      return [node.id, { ...previous?.get(node.id), definition, hits: previous?.get(node.id)?.hits ?? 0 }];
    })));
  }
  state(areaId: string, id: string): TreeState | undefined {
    const node = this.areas.get(areaId)?.get(id);
    return node && { hits: node.hits, felled: node.regrowAt !== undefined };
  }
  available(areaId: string): ResourceDefinition[] { return [...(this.areas.get(areaId)?.values() ?? [])].filter(n => n.regrowAt === undefined).map(n => n.definition); }
  nearest(areaId: string, point: Point, reach = chopReach): ResourceDefinition | undefined {
    return this.available(areaId).filter(n => this.distance(n, point) <= reach).sort((a,b) => this.distance(a,point) - this.distance(b,point))[0];
  }
  facing(areaId: string, point: Point, yaw: number): ResourceDefinition | undefined {
    return this.available(areaId).filter(n => this.distance(n,point) <= gathering.reach && Math.cos(Math.atan2(n.position[0]-point[0],n.position[2]-point[1])-yaw) >= Math.cos(gathering.facingCone))
      .sort((a,b) => this.distance(a,point)-this.distance(b,point))[0];
  }
  contact(areaId: string, id: string, point: Point, xp = 0): HarvestReward | undefined {
    const node = this.areas.get(areaId)?.get(id);
    if (!node || node.regrowAt !== undefined || this.distance(node.definition, point) > chopReach) return;
    if (++node.hits >= node.definition.contacts) node.regrowAt = this.elapsed + gathering.renewalSeconds;
    return { item: resourceItem(node.definition.kind), quantity: harvestQuantity(skillLevel(xp),node.definition.level,node.definition.baseYield), skill: resourceSkill(node.definition.kind), xpPerUnit: progression.gatheringXp * node.definition.level, felled: node.regrowAt !== undefined };
  }
  advance(dt: number, occupants: { areaId: string; position: Point; radius?: number }[] = []): TreeChange[] {
    this.elapsed += Math.max(0, dt);
    const changes: TreeChange[] = [];
    for (const [areaId, nodes] of this.areas) for (const [id, node] of nodes) {
      if (node.regrowAt === undefined || node.regrowAt > this.elapsed) continue;
      if (occupants.some(actor => actor.areaId === areaId && this.distance(node.definition, actor.position) < (actor.radius ?? .3) + .05)) continue;
      node.hits = 0; node.regrowAt = undefined; changes.push({ areaId, id, felled: false });
    }
    return changes;
  }
  distance(node: TreeDefinition, point: Point): number { return Math.max(0, Math.hypot(point[0] - node.position[0], point[1] - node.position[2]) - node.radius); }
}
