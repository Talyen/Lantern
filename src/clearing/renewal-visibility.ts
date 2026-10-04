import * as THREE from 'three';
import { renewalDistance, type RewardSource } from '../gameplay/outing';
import type { Point } from '../gameplay/area';
import type { AreaInstance } from '../levels/builder';
import type { Encounter } from '../gameplay/encounter';
import type { Actor } from './actors';

/** Cache intact authored bounds before depletion; never treat occlusion as out of view. */
export class RenewalVisibility {
  private bounds = new Map<string, THREE.Box3>();
  private readonly box = new THREE.Box3();
  private readonly frustum = new THREE.Frustum();
  private readonly projection = new THREE.Matrix4();
  private readonly matrix = new THREE.Matrix4();
  private readonly offset = new THREE.Vector3();
  register(area: AreaInstance, actors: Record<string, Actor>): void {
    this.bounds.clear();
    const cache = (source: RewardSource, object: THREE.Object3D | undefined, x: number, y: number, z: number) => {
      if (!object) return;
      object.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(object);
      if (!box.isEmpty()) this.bounds.set(`${source.kind}/${source.id}`, box.translate(new THREE.Vector3(-x, -y, -z)));
    };
    for (const node of area.resources) cache({ kind: 'resource', id: node.id }, area.interactables.get(`resource/${node.id}`) ?? area.interactables.get(`tree/${node.id}`), ...node.position);
    for (const chest of area.area.chests ?? []) cache({ kind: 'chest', id: chest.id }, area.interactables.get(`chest/${chest.id}`), chest.position[0], 0, chest.position[1]);
    for (const [id, actor] of Object.entries(actors)) if (id !== 'player') {
      cache({ kind: 'enemy', id }, actor.root, actor.root.position.x, actor.root.position.y, actor.root.position.z);
    }
  }
  eligible(camera: THREE.Camera, encounter: Encounter, source: RewardSource, position: Point, height: number, radius: number, arriving = false): boolean {
    const cached = this.bounds.get(`${source.kind}/${source.id}`);
    this.offset.set(position[0], height, position[1]);
    if (cached) this.box.copy(cached).translate(this.offset);
    else this.box.setFromCenterAndSize(this.offset, new THREE.Vector3(radius * 2, 4, radius * 2));
    const p = encounter.player;
    const dx = Math.max(this.box.min.x - p.x, 0, p.x - this.box.max.x);
    const dz = Math.max(this.box.min.z - p.z, 0, p.z - this.box.max.z);
    if (Math.hypot(dx, dz) < renewalDistance) return false;
    if (arriving) return true;
    camera.updateMatrixWorld();
    this.projection.copy(camera.projectionMatrix);
    // Expand the viewport by ten percent on every side, using the unjittered camera.
    this.projection.elements[0] /= 1.1;
    this.projection.elements[5] /= 1.1;
    this.matrix.multiplyMatrices(this.projection, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.matrix, camera.coordinateSystem);
    return !this.frustum.intersectsBox(this.box);
  }
}
