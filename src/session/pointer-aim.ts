import * as THREE from 'three';
import { type ActorId, type AimPoint, type Encounter } from '../gameplay/encounter';

export type PointerPosition = { x: number; y: number };

/** Picking always uses the last displayed camera, before temporal jitter. */
export class PointerAim {
  readonly ray = new THREE.Raycaster();
  private readonly camera: THREE.OrthographicCamera;
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0));
  private readonly point = new THREE.Vector3();
  private readonly pointer = new THREE.Vector2();
  private readonly hits: THREE.Intersection[] = [];

  constructor(private readonly canvas: HTMLCanvasElement, camera: THREE.OrthographicCamera) {
    this.camera = new THREE.OrthographicCamera();
    this.capture(camera);
  }

  capture(camera: THREE.OrthographicCamera): void {
    // Picking and sprite raycasts consume these matrices only. Avoid copying
    // scene children, userData and view records on every displayed frame.
    this.camera.matrixWorld.copy(camera.matrixWorld);
    this.camera.matrixWorldInverse.copy(camera.matrixWorldInverse);
    this.camera.projectionMatrix.copy(camera.projectionMatrix);
    this.camera.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
  }

  resolve(pointer: PointerPosition | undefined, groundHeight: number): AimPoint | undefined {
    if (!pointer) return;
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height || pointer.x < rect.left || pointer.x >= rect.right || pointer.y < rect.top || pointer.y >= rect.bottom) return;
    this.pointer.set((pointer.x - rect.left) / rect.width * 2 - 1, 1 - (pointer.y - rect.top) / rect.height * 2);
    this.ray.setFromCamera(this.pointer, this.camera);
    this.plane.constant = -groundHeight;
    if (this.ray.ray.intersectPlane(this.plane, this.point)) return { x: this.point.x, z: this.point.z };
  }

  attack(pointer: PointerPosition, encounter: Encounter, safe: boolean, actors: Record<ActorId, { root: THREE.Object3D }>): AimPoint | undefined {
    const ground = this.resolve(pointer, encounter.player.y);
    // Body pixels project beyond an enemy on the ground plane; commit its centre instead.
    let picked: { x: number; z: number; distance: number } | undefined;
    if (ground && !safe) for (const id of encounter.enemyIds) {
      const state = encounter.enemies[id];
      if (!state.home || state.hp <= 0) continue;
      const hit = this.ray.intersectObject(actors[id].root, true, this.hits)[0];
      if (hit && (!picked || hit.distance < picked.distance)) picked = { x: state.x, z: state.z, distance: hit.distance };
      // Keep scratch capacity without retaining removed actors or their art.
      this.hits.length = 0;
    }
    return picked ? { x: picked.x, z: picked.z } : ground;
  }
}
