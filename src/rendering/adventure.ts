import * as THREE from 'three';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import { Portal } from './portal';
import type { Point } from '../gameplay/area';
import type { GroundDrop } from '../gameplay/adventure';
import { itemDefinitions, type ItemId } from '../gameplay/equipment';
import { assetLibrary, type AssetInstance } from '../assets/asset-library';
import { LootSound } from './loot-sound';

type DropVisual = { root: THREE.Group; model: THREE.Group; instance?: AssetInstance; quantity: number; landed: boolean };
/** Area-owned presentation; object motion follows simulation-owned landing clocks. */
export class AdventureVisuals {
  private portal: Portal | null = null;
  private portalKey = '';
  private drops = new Map<string, DropVisual>();
  private geometry = new THREE.CylinderGeometry(.07, .07, .36, 8);
  private box = new THREE.BoxGeometry(1, 1, 1);
  private arc = new THREE.TorusGeometry(.3, .025, 5, 16, Math.PI);
  private paper = new MeshStandardNodeMaterial({ color: '#eadbb4', roughness: .9 });
  private ribbon = new MeshStandardNodeMaterial({ color: '#a75830', roughness: .7 });
  private bark = new MeshStandardNodeMaterial({ color: '#866446', roughness: 1 });
  private metal = new MeshStandardNodeMaterial({ color: '#b5aca0', roughness: .6, metalness: .4 });
  private markerGeometry = new THREE.RingGeometry(.24, .29, 24);
  private markerMaterial = new MeshBasicNodeMaterial({ color: '#bda474', transparent: true, opacity: .5, side: THREE.DoubleSide });
  private highlight = new THREE.Mesh(this.markerGeometry, this.markerMaterial);
  private disposed = false;
  private sound = new LootSound();
  constructor(private parent: THREE.Object3D) { this.highlight.rotation.x = -Math.PI / 2; this.highlight.visible = false; parent.add(this.highlight); }
  sync(drops: GroundDrop[], portal: Point | null, hovered: string | null): void {
    const key = portal?.join(',') ?? '';
    if (key !== this.portalKey) { this.portal?.dispose(); this.portal = portal ? new Portal({ id: 'return-portal', position: [portal[0], .02, portal[1]], yaw: Math.PI / 4, width: 1.4, height: 2.3 }, this.parent) : null; this.portalKey = key; }
    for (const [id, visual] of this.drops) if (!drops.some(drop => drop.id === id)) { if (visual.landed) this.sound.play(true); visual.instance?.release(); visual.root.removeFromParent(); this.drops.delete(id); }
    for (const drop of drops) {
      let visual = this.drops.get(drop.id);
      if (!visual) {
        const root = new THREE.Group(), model = new THREE.Group(); root.add(model); root.userData.dropId = drop.id; this.parent.add(root);
        visual = { root, model, quantity: drop.quantity, landed: drop.age >= .55 }; this.drops.set(drop.id, visual);
        if (drop.item === 'scroll') {
          const scroll = new THREE.Mesh(this.geometry, this.paper), band = new THREE.Mesh(this.geometry, this.ribbon);
          scroll.rotation.z = band.rotation.z = Math.PI / 2; band.scale.set(1.03, .15, 1.03); model.add(scroll, band); model.position.y = .08;
        } else if (drop.item === 'wood') {
          for (let i = 0; i < 3; i++) { const log = new THREE.Mesh(this.geometry, this.bark); log.rotation.z = Math.PI / 2; log.scale.set(.8, 1.2, .8); log.position.set(0, i === 2 ? .14 : .06, i === 2 ? 0 : (i - .5) * .12); model.add(log); }
        } else {
          // A compact silhouette remains collectible if optional prepared scenery is absent.
          const shaft = new THREE.Mesh(this.box, drop.item === 'sword' || drop.item === 'shield' ? this.metal : this.bark);
          shaft.scale.set(drop.item === 'shield' ? .4 : .045, .04, drop.item === 'staff' ? 1 : .65); model.add(shaft);
          if (drop.item === 'axe' || drop.item === 'sword') { const head = new THREE.Mesh(this.box, this.metal); head.scale.set(drop.item === 'axe' ? .25 : .2, .05, drop.item === 'axe' ? .2 : .025); head.position.z = drop.item === 'axe' ? -.2 : .18; model.add(head); }
          if (drop.item === 'bow') { const arc = new THREE.Mesh(this.arc, this.bark); arc.rotation.x = -Math.PI / 2; arc.rotation.z = -Math.PI / 2; model.add(arc); shaft.scale.set(.01, .01, .6); }

          void this.loadGear(drop, visual);
        }
      }
      const t = Math.min(1, drop.age / .55), travel = 1 - (1 - t) ** 2;
      visual.root.position.set(THREE.MathUtils.lerp(drop.origin[0], drop.position[0], travel), drop.height + Math.sin(t * Math.PI) * .65 + .02, THREE.MathUtils.lerp(drop.origin[1], drop.position[1], travel));
      const seed = Number(drop.id.match(/\d+/)?.[0] ?? 0);
      visual.root.rotation.set((1 - t) * Math.PI * 1.3, seed * 2.4 + (1 - t) * 1.5, (1 - t) * .7);
      if (!visual.landed && t === 1) { visual.landed = true; this.sound.play(false); }
      if (drop.quantity < visual.quantity) this.sound.play(true); visual.quantity = drop.quantity;
    }
    const selected = drops.find(d => d.id === hovered); this.highlight.visible = !!selected;
    if (selected) this.highlight.position.set(selected.position[0], selected.height + .035, selected.position[1]);
  }
  private async loadGear(drop: GroundDrop, visual: DropVisual): Promise<void> {
    let instance: AssetInstance | undefined;
    try {
      instance = await assetLibrary.loadAsset(itemDefinitions[drop.item as ItemId].asset);
      if (this.disposed || this.drops.get(drop.id) !== visual) { instance.release(); return; }
      const object = instance.object, bounds = new THREE.Box3().setFromObject(object), size = bounds.getSize(new THREE.Vector3());
      object.scale.multiplyScalar(itemDefinitions[drop.item as ItemId].length / Math.max(size.x, size.y, size.z));
      object.rotation.x = Math.PI / 2; object.updateMatrixWorld(true);
      bounds.setFromObject(object); const center = bounds.getCenter(new THREE.Vector3()); object.position.add(new THREE.Vector3(-center.x, .03 - bounds.min.y, -center.z));
      visual.model.clear(); visual.model.add(object); visual.instance = instance;
    } catch { instance?.release(); /* The name and category silhouette remain available. */ }
  }
  pick(ray: THREE.Raycaster): string | null {
    for (const hit of ray.intersectObjects([...this.drops.values()].map(v => v.root), true)) {
      let object: THREE.Object3D | null = hit.object;
      while (object) { if (object.userData.dropId) return object.userData.dropId; object = object.parent; }
    }
    return null;
  }
  update(dt: number): void { this.portal?.update(dt); }
  dispose(): void {
    this.disposed = true; this.portal?.dispose(); this.sound.dispose(); this.highlight.removeFromParent();
    this.drops.forEach(v => { v.instance?.release(); v.root.removeFromParent(); }); this.drops.clear();
    for (const resource of [this.geometry, this.box, this.arc, this.paper, this.ribbon, this.bark, this.metal, this.markerGeometry, this.markerMaterial]) resource.dispose();
  }
}
