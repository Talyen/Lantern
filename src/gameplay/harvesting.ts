import type { TreeDefinition } from '../levels/trees';
import type { Point } from './area';

export const chopReach = 1.8;
export const treeChops = 3;
export const treeRegrowthSeconds = 120;
export type TreeState = { hits: number; felled: boolean };
export type TreeChange = { areaId: string; id: string; felled: boolean };
export type HarvestReward = { wood: number; xp: number; felled: boolean };
type SessionTree = { definition: TreeDefinition; hits: number; regrowAt?: number };

/** Session-only depletion clock; character Wood/XP and contact timing belong to their owners. */
export class Harvesting {
  private elapsed = 0;
  private readonly areas = new Map<string, Map<string, SessionTree>>();
  register(areaId: string, trees: TreeDefinition[]): void {
    const previous = this.areas.get(areaId);
    this.areas.set(areaId, new Map(trees.map(definition => [definition.id, { ...previous?.get(definition.id), definition, hits: previous?.get(definition.id)?.hits ?? 0 }])));
  }
  state(areaId: string, id: string): TreeState | undefined {
    const tree = this.areas.get(areaId)?.get(id);
    return tree && { hits: tree.hits, felled: tree.regrowAt !== undefined };
  }
  nearest(areaId: string, point: Point, reach = chopReach): TreeDefinition | undefined {
    let closest: TreeDefinition | undefined, distance = reach;
    for (const tree of this.areas.get(areaId)?.values() ?? []) {
      if (tree.regrowAt !== undefined) continue;
      const d = this.distance(tree.definition, point);
      if (d <= distance) { distance = d; closest = tree.definition; }
    }
    return closest;
  }
  contact(areaId: string, id: string, point: Point): HarvestReward | undefined {
    const tree = this.areas.get(areaId)?.get(id);
    if (!tree || tree.regrowAt !== undefined || this.distance(tree.definition, point) > chopReach) return;
    if (++tree.hits === treeChops) tree.regrowAt = this.elapsed + treeRegrowthSeconds;
    return { wood: 1, xp: 10, felled: tree.regrowAt !== undefined };
  }
  advance(dt: number, occupants: { areaId: string; position: Point; radius?: number }[] = []): TreeChange[] {
    this.elapsed += Math.max(0, dt);
    const changes: TreeChange[] = [];
    for (const [areaId, trees] of this.areas) for (const [id, tree] of trees) {
      if (tree.regrowAt === undefined || tree.regrowAt > this.elapsed) continue;
      if (occupants.some(actor => actor.areaId === areaId && this.distance(tree.definition, actor.position) < (actor.radius ?? .3) + .05)) continue;
      tree.hits = 0; tree.regrowAt = undefined; changes.push({ areaId, id, felled: false });
    }
    return changes;
  }
  private distance(tree: TreeDefinition, point: Point): number { return Math.max(0, Math.hypot(point[0] - tree.position[0], point[1] - tree.position[2]) - tree.radius); }
}
