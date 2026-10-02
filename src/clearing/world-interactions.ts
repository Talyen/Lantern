import type * as THREE from 'three';
import { chestUnlocked, homeArea, type Adventure } from '../gameplay/adventure';
import type { Point } from '../gameplay/area';
import type { Encounter } from '../gameplay/encounter';
import { gatheringSafe, type Harvesting } from '../gameplay/harvesting';
import { gathering, progression } from '../gameplay/skills';
import type { AreaInstance } from '../levels/builder';
import type { ResourceDefinition } from '../levels/resources';
import type { AreaDefinition, Campfire, Chest } from '../levels/types';

type WorldTarget = {
  key: string;
  name: string;
  position: Point;
  range: number;
  height: number;
  obstacleId: string;
  object: THREE.Object3D;
};
export type WorldInteraction = WorldTarget & (
  | { type: 'resource'; resource: ResourceDefinition }
  | { type: 'chest'; chest: Chest }
  | { type: 'fire'; fire: Campfire }
  | { type: 'portal' | 'shelter' | 'stash' }
);

/** Project available gameplay objects into selectable scene targets. */
export function worldTargets(area: AreaDefinition, active: AreaInstance | undefined, adventure: Adventure, harvesting: Harvesting, portalObject?: THREE.Object3D | null): WorldInteraction[] {
  const targets: WorldInteraction[] = [];
  if (!active) return targets;
  for (const node of active.resources) {
    const object = active.interactables.get(`resource/${node.id}`) ?? active.interactables.get(`tree/${node.id}`);
    if (object && !harvesting.state(area.id, node.id)?.felled) targets.push({
      key: `resource/${node.id}`, name: node.kind === 'tree' ? 'Chop' : 'Mine', type: 'resource', resource: node,
      position: [node.position[0], node.position[2]], range: node.radius + gathering.workingReach,
      height: node.position[1], obstacleId: node.id, object,
    });
  }
  for (const chest of area.chests ?? []) {
    const object = active.interactables.get(`chest/${chest.id}`);
    if (object && !adventure.chest(area, chest).opened) targets.push({
      key: `chest/${chest.id}`, name: 'Open chest', type: 'chest', chest,
      position: chest.position, range: 1.8, height: 0, obstacleId: chest.prop, object,
    });
  }
  for (const fire of area.campfires ?? []) {
    const object = active.interactables.get(`fire/${fire.id}`);
    if (object) targets.push({
      key: `fire/${fire.id}`, name: 'Travel', type: 'fire', fire,
      position: fire.position, range: 3, height: 0, obstacleId: fire.id, object,
    });
  }
  if (area.shelter) {
    const site = area.shelter;
    const key = adventure.character.shelterRestored ? 'stash' : 'shelter';
    const object = active.interactables.get(key);
    if (object) targets.push({
      key, name: key === 'stash' ? 'Stash' : 'Repair shelter', type: key,
      position: key === 'stash' ? site.stash : site.position, range: key === 'stash' ? 1.8 : progression.restedRadius,
      height: 0, obstacleId: 'shelter', object,
    });
  }
  const portal = adventure.portalPosition(area);
  if (portal && portalObject) targets.push({
    key: 'portal', name: area.id === homeArea ? 'Return to adventure' : 'Homestead', type: 'portal',
    position: portal, range: 1.8, height: 0, obstacleId: 'portal', object: portalObject,
  });
  return targets;
}

export function interactionError(target: WorldInteraction, area: AreaDefinition, adventure: Adventure, encounter: Encounter): string {
  if (adventure.castRemaining > 0) return 'Scroll of Return is casting';
  if (target.type === 'resource' && !gatheringSafe(encounter, area.kind)) return 'Enemies nearby';
  if (target.type === 'fire' && !adventure.fireSafe(area, target.fire, encounter)) return 'Enemies nearby';
  if (target.type === 'chest' && !chestUnlocked(encounter, target.chest)) return 'Defeat the guard';
  return '';
}

/** The first visible surface occludes targets behind it, including actor bodies. */
export function pickInteraction(ray: THREE.Raycaster, roots: THREE.Object3D[], targets: WorldInteraction[]): WorldInteraction | null {
  for (const hit of ray.intersectObjects(roots, true)) {
    let visible = true;
    for (let object: THREE.Object3D | null = hit.object; object; object = object.parent) if (!object.visible) visible = false;
    if (!visible) continue;
    for (let object: THREE.Object3D | null = hit.object; object; object = object.parent) {
      const target = targets.find(target => target.object === object);
      if (target) return target;
    }
    return null;
  }
  return null;
}
