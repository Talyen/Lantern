import type * as THREE from 'three';
import { homeArea, type Adventure } from '../gameplay/adventure';
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
  | { type: 'portal' | 'shelter' | 'stash' | 'shop' }
);

/** Build stable descriptors once; gameplay still decides eligibility at query time. */
function areaTargets(area: AreaDefinition, active: AreaInstance): WorldInteraction[] {
  const targets: WorldInteraction[] = [];
  for (const node of active.resources) {
    const object = active.interactables.get(`resource/${node.id}`) ?? active.interactables.get(`tree/${node.id}`);
    if (object) targets.push({
      key: `resource/${node.id}`, name: node.kind === 'tree' ? 'Chop' : 'Mine', type: 'resource', resource: node,
      position: [node.position[0], node.position[2]], range: node.radius + gathering.workingReach,
      height: node.position[1], obstacleId: node.id, object,
    });
  }
  for (const chest of area.chests ?? []) {
    const object = active.interactables.get(`chest/${chest.id}`);
    if (object) targets.push({
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
  if (area.shop) for (const key of [`shop/${area.shop.id}`, `merchant/${area.shop.id}`]) {
    const object = active.interactables.get(key);
    if (object) targets.push({ key, name: 'Shop', type: 'shop', position: area.shop.position,
      range: 1.8, height: 0, obstacleId: area.shop.prop, object });
  }
  if (area.shelter) {
    const site = area.shelter;
    for (const key of ['shelter', 'stash'] as const) {
      const object = active.interactables.get(key);
      if (object) targets.push({
        key, name: key === 'stash' ? 'Stash' : 'Repair shelter', type: key,
        position: key === 'stash' ? site.stash : site.position, range: key === 'stash' ? 1.8 : progression.restedRadius,
        height: 0, obstacleId: 'shelter', object,
      });
    }
  }
  return targets;
}

/** Area-owned query storage; returned targets are consumed synchronously, never retained as a snapshot. */
export class WorldInteractions {
  private readonly candidates: WorldInteraction[];
  private readonly available: WorldInteraction[] = [];
  private readonly roots: THREE.Object3D[] = [];
  private portal: WorldInteraction | undefined;
  private readonly picker = new InteractionPicker();

  constructor(private readonly area: AreaDefinition, private readonly active: AreaInstance, private readonly actors: readonly THREE.Object3D[]) {
    this.candidates = areaTargets(area, active);
  }

  targets(adventure: Adventure, harvesting: Harvesting, portalObject?: THREE.Object3D | null): readonly WorldInteraction[] {
    const targets = this.available;
    targets.length = 0;
    for (const target of this.candidates) {
      if (target.type === 'resource' && harvesting.isDepleted(this.area.id, target.resource.id)) continue;
      if (target.type === 'chest' && adventure.chest(this.area, target.chest).opened) continue;
      if (target.type === 'shelter' && adventure.character.shelterRestored || target.type === 'stash' && !adventure.character.shelterRestored) continue;
      targets.push(target);
    }
    this.roots.length = 0;
    this.roots.push(this.active.root);
    const position = adventure.portalPosition(this.area);
    if (position && portalObject) {
      const height = adventure.portalHeight(this.area);
      if (this.portal?.object !== portalObject || this.portal.position !== position || this.portal.height !== height) this.portal = {
        key: 'portal', name: this.area.id === homeArea ? 'Return to adventure' : 'Homestead', type: 'portal',
        position, range: 1.8, height, obstacleId: 'portal', object: portalObject,
      };
      targets.push(this.portal);
      this.roots.push(portalObject);
    } else this.portal = undefined;
    this.roots.push(...this.actors);
    return targets;
  }

  pick(ray: THREE.Raycaster, targets: readonly WorldInteraction[]): WorldInteraction | null {
    return this.picker.pick(ray, this.roots, targets);
  }
}

export function interactionError(target: WorldInteraction, area: AreaDefinition, adventure: Adventure, encounter: Encounter): string {
  if (adventure.castRemaining > 0) return 'Scroll of Return is casting';
  if (target.type === 'resource' && !gatheringSafe(encounter, area.kind)) return 'Enemies nearby';
  if (target.type === 'fire' && !adventure.fireSafe(area, target.fire, encounter)) return 'Enemies nearby';
  return '';
}

function visible(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) if (!node.visible) return false;
  return true;
}

/** Keep triangle picking and first-surface occlusion, but avoid scenery queries on target misses. */
class InteractionPicker {
  private readonly objects: THREE.Object3D[] = [];
  private readonly targets = new Map<THREE.Object3D, WorldInteraction>();
  private readonly hits: THREE.Intersection[] = [];

  pick(ray: THREE.Raycaster, roots: THREE.Object3D[], targets: readonly WorldInteraction[]): WorldInteraction | null {
    const far = ray.far;
    try {
      for (const target of targets) {
        if (!this.targets.has(target.object)) {
          this.targets.set(target.object, target);
          this.objects.push(target.object);
        }
      }
      ray.intersectObjects(this.objects, true, this.hits);
      const candidate = this.hits.find(hit => visible(hit.object));
      if (!candidate) return null;
      // No surface beyond the closest target can change which visible surface wins.
      ray.far = Math.min(far, candidate.distance);
      this.hits.length = 0;
      ray.intersectObjects(roots, true, this.hits);
      for (const hit of this.hits) {
        if (!visible(hit.object)) continue;
        for (let object: THREE.Object3D | null = hit.object; object; object = object.parent) {
          const target = this.targets.get(object);
          if (target) return target;
        }
        return null;
      }
      return null;
    } finally {
      ray.far = far;
      this.hits.length = 0;
      this.objects.length = 0;
      this.targets.clear();
    }
  }
}
