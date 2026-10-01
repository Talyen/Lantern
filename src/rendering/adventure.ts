import * as THREE from 'three';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import { Portal } from './portal';
import type { Point } from '../gameplay/area';
import type { ScrollDrop } from '../gameplay/adventure';

/** Area-owned presentation of simulation drops and the current return portal. */
export class AdventureVisuals {
  private portal: Portal | null = null;
  private portalKey = '';
  private drops = new Map<string, THREE.Group>();
  private geometry = new THREE.CylinderGeometry(.07, .07, .36, 8);
  private paper = new MeshStandardNodeMaterial({ color: '#eadbb4', roughness: .9 });
  private ribbon = new MeshStandardNodeMaterial({ color: '#a75830', roughness: .7 });
  private markerGeometry = new THREE.RingGeometry(.22, .28, 24);
  private markerMaterial = new MeshBasicNodeMaterial({ color: '#ffd68e', transparent: true, opacity: .7, side: THREE.DoubleSide });
  constructor(private parent: THREE.Object3D) {}
  sync(drops: ScrollDrop[], portal: Point | null): void {
    const key = portal?.join(',') ?? '';
    if (key !== this.portalKey) {
      this.portal?.dispose(); this.portal = portal ? new Portal({ id: 'return-portal', position: [portal[0], .02, portal[1]], yaw: Math.PI / 4, width: 1.4, height: 2.3 }, this.parent) : null; this.portalKey = key;
    }
    for (const [id, object] of this.drops) if (!drops.some(drop => drop.id === id)) { object.removeFromParent(); this.drops.delete(id); }
    for (const drop of drops) if (!this.drops.has(drop.id)) {
      const object = new THREE.Group(), scroll = new THREE.Mesh(this.geometry, this.paper), band = new THREE.Mesh(this.geometry, this.ribbon), marker = new THREE.Mesh(this.markerGeometry, this.markerMaterial);
      scroll.rotation.z = Math.PI / 2; scroll.position.y = .14;
      band.rotation.z = Math.PI / 2; band.scale.set(1.03, .15, 1.03); band.position.y = .14;
      marker.rotation.x = -Math.PI / 2; marker.position.y = .025;
      object.add(scroll, band, marker); object.position.set(drop.position[0], 0, drop.position[1]); this.parent.add(object); this.drops.set(drop.id, object);
    }
  }
  update(dt: number): void { this.portal?.update(dt); }
  dispose(): void { this.portal?.dispose(); this.drops.forEach(drop => drop.removeFromParent()); this.drops.clear(); this.geometry.dispose(); this.paper.dispose(); this.ribbon.dispose(); this.markerGeometry.dispose(); this.markerMaterial.dispose(); }
}
