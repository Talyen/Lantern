import { waterGround } from './water-terrain';
import { generateDecoration } from './decoration.ts';
import type { AreaDefinition, AssetRef, Placement } from './types.ts';
import type { Traversal } from '../gameplay/movement.ts';
import { gathering } from '../gameplay/skills.ts';

export type TreeDefinition = { id: string; position: [number, number, number]; radius: number };

/** Standing trees are identified from canonical assets, before optional surface substitution. */
export function standingTreeAsset(asset: AssetRef | undefined): boolean {
  if (!asset) return false;
  const name = ('libraryId' in asset ? asset.libraryId : asset.url).toLowerCase();
  if (/(?:^|[-_/])(bush|stump|treestump|log|fallen|felled)(?:[-_./]|$)/.test(name)) return false;
  return /(?:^|[-_/])(tree|treedead|pine)(?:[-_./]|$)/.test(name);
}

export function harvestableTree(placement: Placement): boolean {
  return placement.harvest ? placement.harvest.kind === 'tree' : standingTreeAsset(placement.asset);
}

/** IDs remain placement-local; the session owner scopes them by area. No asset loading is needed. */
export function treeDefinitions(area: AreaDefinition, props = [...area.props, ...generateDecoration(area)]): TreeDefinition[] {
  return props.filter(harvestableTree).map(p => {
    const proxy = area.traversal?.obstacles.find(o => o.id === p.id);
    const radius = p.harvest?.radius ?? (proxy ? Math.max(proxy.size[0], proxy.size[2]) / 2 : .28 * Math.max(p.scale[0], p.scale[2]));
    return { id: p.id, position: [...p.position], radius };
  });
}

/** Every standing tree blocks movement, even when its optional model could not load. */
export function traversalWithTrees(area: AreaDefinition): Traversal {
  const props = [...area.props, ...generateDecoration(area)];
  const trees = treeDefinitions(area, props), ids = new Set(trees.map(t => t.id));
  const minerals = new Set(props.filter(p => p.harvest && p.harvest.kind !== 'tree').map(p => p.id));
  const obstacles: Traversal['obstacles'] = (area.traversal?.obstacles ?? []).map(o => ({ ...o, tree: ids.has(o.id) || undefined, depletedScale: minerals.has(o.id) ? gathering.mineralDepletedScale : undefined }));
  const existing = new Set(obstacles.map(o => o.id));
  for (const tree of trees) if (!existing.has(tree.id)) obstacles.push({ id: tree.id, position: [tree.position[0], tree.position[1] + 1, tree.position[2]], size: [tree.radius * 2, 2, tree.radius * 2], yaw: 0, tree: true });
  return { obstacles, surfaces: area.traversal?.surfaces, ground: area.traversal?.ground ?? waterGround(area) };
}
