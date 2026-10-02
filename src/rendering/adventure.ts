import * as THREE from 'three';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import { Portal } from './portal';
import type { Point } from '../gameplay/area';
import { dropLandingSeconds, type GroundDrop } from '../gameplay/adventure';
import { equipmentCatalog, itemDefinitions, type HandItem } from '../gameplay/equipment';
import { assetLibrary, type AssetInstance } from '../assets/asset-library';
import { disposeSceneInstances } from '../assets/resource-ownership';

type DropVisual = {
  root: THREE.Group; model: THREE.Group; instance?: AssetInstance;
  seed: number; bounds: THREE.Box3; boundsMatrix: THREE.Matrix4; boundsValid: boolean;
};
/** Area-owned presentation; object motion follows simulation-owned landing clocks. */
export class AdventureVisuals {
  private portal: Portal | null = null;
  get portalTarget(): THREE.Object3D | null {return this.portal?.root ?? null;}
  private portalKey = '';
  private drops = new Map<string, DropVisual>();
  private currentDrops = new Map<string, GroundDrop>();
  private pickRoots: THREE.Object3D[] = [];
  private pickHits: THREE.Intersection[] = [];
  private pickPoint = new THREE.Vector3();
  private geometry = new THREE.CylinderGeometry(.07, .07, .36, 8);
  private box = new THREE.BoxGeometry(1, 1, 1);
  private arc = new THREE.TorusGeometry(.3, .025, 5, 16, Math.PI);
  private paper = new MeshStandardNodeMaterial({ color: '#eadbb4', roughness: .9 });
  private ribbon = new MeshStandardNodeMaterial({ color: '#a75830', roughness: .7 });
  private bark = new MeshStandardNodeMaterial({ color: '#866446', roughness: 1 });
  private potionGlass = new MeshStandardNodeMaterial({color:'#8e3930',roughness:.35});
  private metal = new MeshStandardNodeMaterial({ color: '#b5aca0', roughness: .6, metalness: .4 });
  private oreGeometry = new THREE.DodecahedronGeometry(1,0);
  private stone = new MeshStandardNodeMaterial({color:'#898478',roughness:1});
  private iron = new MeshStandardNodeMaterial({color:'#756356',roughness:.8,metalness:.2});
  private markerGeometry = new THREE.RingGeometry(.24, .29, 24);
  private markerMaterial = new MeshBasicNodeMaterial({ color: '#bda474', transparent: true, opacity: .5, side: THREE.DoubleSide });
  private highlight = new THREE.Mesh(this.markerGeometry, this.markerMaterial);
  private ring = new THREE.TorusGeometry(.13,.026,6,16);
  private cap = new THREE.SphereGeometry(.22,10,5,0,Math.PI*2,0,Math.PI/2);
  private cloth = new MeshStandardNodeMaterial({color:'#786657',roughness:1});
  private disposed = false;
  constructor(private parent: THREE.Object3D) { this.highlight.rotation.x = -Math.PI / 2; this.highlight.visible = false; parent.add(this.highlight); }
  sync(drops: GroundDrop[], portal: Point | null, hovered: string | null, portalHeight = 0): void {
    const key = portal ? `${portal.join(',')}/${portalHeight}` : '';
    if (key !== this.portalKey) { this.portal?.dispose(); this.portal = portal ? new Portal({ id: 'return-portal', position: [portal[0], portalHeight + .02, portal[1]], yaw: Math.PI / 4, width: 1.4, height: 2.3 }, this.parent) : null; this.portalKey = key; }
    this.currentDrops.clear(); for (const drop of drops) this.currentDrops.set(drop.id, drop);
    let changed = false;
    for (const [id, visual] of this.drops) if (!this.currentDrops.has(id)) { visual.instance?.release(); disposeSceneInstances(visual.root); visual.root.removeFromParent(); this.drops.delete(id); changed = true; }
    for (const drop of drops) {
      let visual = this.drops.get(drop.id);
      if (!visual) {
        const root = new THREE.Group(), model = new THREE.Group(); root.add(model); root.userData.dropId = drop.id; this.parent.add(root);
        visual = { root, model, seed: Number(drop.id.match(/\d+/)?.[0] ?? 0), bounds: new THREE.Box3(), boundsMatrix: new THREE.Matrix4(), boundsValid: false };
        this.drops.set(drop.id, visual); changed = true;
        if (drop.item === 'scroll') {
          const scroll = new THREE.Mesh(this.geometry, this.paper), band = new THREE.Mesh(this.geometry, this.ribbon);
          scroll.rotation.z = band.rotation.z = Math.PI / 2; band.scale.set(1.03, .15, 1.03); model.add(scroll, band); model.position.y = .08;
        } else if (drop.item === 'wood') {
          for (let i = 0; i < 3; i++) { const log = new THREE.Mesh(this.geometry, this.bark); log.rotation.z = Math.PI / 2; log.scale.set(.8, 1.2, .8); log.position.set(0, i === 2 ? .14 : .06, i === 2 ? 0 : (i - .5) * .12); model.add(log); }
        } else if (drop.item === 'stone' || drop.item === 'iron') {
          const rock = new THREE.Mesh(this.oreGeometry,drop.item === 'stone' ? this.stone : this.iron);
          rock.scale.set(.21,.14,.18); rock.position.y=.10; model.add(rock);
        } else if(drop.item==='potion') {
          const bottle=new THREE.Mesh(this.geometry,this.potionGlass);bottle.scale.set(1.45,.5,1.45);model.add(bottle);
          const stopper=new THREE.Mesh(this.box,this.bark);stopper.scale.set(.08,.05,.08);stopper.position.y=.11;model.add(stopper);
          void this.loadPotion(drop,visual).catch((error: unknown) => console.warn('Unable to prepare dropped potion.', error));
        } else {
          const definition = equipmentCatalog[drop.item];
          if (!definition.weapon && definition.slot !== 'off') this.wearable(definition.slot,visual.model,drop.item === 'weathered-mail');
          else {
            const family = definition.weapon?.family ?? 'shield';
            const shaft = new THREE.Mesh(this.box, family === 'sword' || family === 'shield' ? this.metal : this.bark);
            shaft.scale.set(family === 'shield' ? .4 : .045, .04, family === 'staff' ? 1 : .65); model.add(shaft);
            if (family === 'axe' || family === 'sword') { const head = new THREE.Mesh(this.box,this.metal); head.scale.set(family === 'axe' ? .25 : .2,.05,family === 'axe' ? .2 : .025);head.position.z=family === 'axe' ? -.2 : .18;model.add(head); }
            if (family === 'bow') { const arc = new THREE.Mesh(this.arc,this.bark);arc.rotation.x=-Math.PI/2;arc.rotation.z=-Math.PI/2;model.add(arc);shaft.scale.set(.01,.01,.6); }
            void this.loadGear(drop,visual).catch((error: unknown) => console.warn('Unable to prepare dropped equipment.', error));
          }
        }
      }
      const t = Math.min(1, drop.age / dropLandingSeconds), travel = 1 - (1 - t) ** 2;
      visual.root.position.set(THREE.MathUtils.lerp(drop.origin[0], drop.position[0], travel), drop.height + Math.sin(t * Math.PI) * .65 + .02, THREE.MathUtils.lerp(drop.origin[1], drop.position[1], travel));
      visual.root.rotation.set((1 - t) * Math.PI * 1.3, visual.seed * 2.4 + (1 - t) * 1.5, (1 - t) * .7);
    }
    if (changed) { this.pickRoots.length = 0; for (const visual of this.drops.values()) this.pickRoots.push(visual.root); }
    const selected = hovered ? this.currentDrops.get(hovered) : undefined; this.highlight.visible = !!selected;
    if (selected) this.highlight.position.set(selected.position[0], selected.height + .035, selected.position[1]);
  }
  /** Compact category silhouettes stay legible without wearable character assets. */
  private wearable(slot: string, model: THREE.Group, mail: boolean): void {
    const box = (size: [number,number,number], point: [number,number,number], material = this.cloth) => {
      const mesh = new THREE.Mesh(this.box,material);mesh.scale.fromArray(size);mesh.position.fromArray(point);model.add(mesh);return mesh;
    };
    if (slot === 'helmet') {
      const dome = new THREE.Mesh(this.cap,this.metal);dome.position.y=.04;model.add(dome);
      box([.36,.06,.04],[0,.06,-.18],this.metal);
    } else if (slot === 'body') {
      box([.36,.08,.4],[0,.08,0],mail ? this.metal : this.cloth);
      for (const side of [-1,1]) {const sleeve=box([.15,.07,.23],[side*.23,.08,-.08],mail ? this.metal : this.cloth);sleeve.rotation.y=side*.35;}
      box([.08,.015,.18],[0,.13,0],this.bark);
    } else if (slot === 'boots' || slot === 'gloves') {
      for (const side of [-1,1]) {
        box([.12,.08,.23],[side*.09,.06,0],this.bark);
        box([.12,slot === 'boots' ? .15 : .04,.1],[side*.09,slot === 'boots' ? .13 : .1,-.06],this.cloth);
      }
    } else {
      const ring = new THREE.Mesh(this.ring,slot === 'belt' ? this.bark : this.metal);ring.rotation.x=-Math.PI/2;ring.position.y=.05;
      if(slot === 'belt') ring.scale.set(1.8,1.2,1.4);
      model.add(ring);
      box(slot === 'belt' ? [.1,.03,.08] : [.065,.05,.065],[0,.06,slot === 'belt' ? -.23 : -.13],slot === 'amulet' ? this.ribbon : this.metal);
    }
  }
  private async loadPotion(drop: GroundDrop, visual: DropVisual): Promise<void> {
    let instance: AssetInstance | undefined;
    try { instance=await assetLibrary.loadAsset('generic:model:sm-gen-prop-potion-01'); if(this.disposed || this.drops.get(drop.id)!==visual){instance.release();return;}
      const object=instance.object;object.updateMatrixWorld(true);const size=new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());object.scale.multiplyScalar(.28/Math.max(size.x,size.y,size.z));object.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(object),center=bounds.getCenter(new THREE.Vector3());object.position.sub(new THREE.Vector3(center.x,bounds.min.y,center.z));disposeSceneInstances(visual.model);visual.model.clear();visual.model.add(object);visual.instance=instance;visual.boundsValid=false;
    } catch { instance?.release(); }
  }
  private async loadGear(drop: GroundDrop, visual: DropVisual): Promise<void> {
    let instance: AssetInstance | undefined;
    try {
      instance = await assetLibrary.loadAsset(itemDefinitions[drop.item as HandItem].asset);
      if (this.disposed || this.drops.get(drop.id) !== visual) { instance.release(); return; }
      const object = instance.object, bounds = new THREE.Box3().setFromObject(object), size = bounds.getSize(new THREE.Vector3());
      object.scale.multiplyScalar(itemDefinitions[drop.item as HandItem].length / Math.max(size.x, size.y, size.z));
      object.rotation.x = Math.PI / 2; object.updateMatrixWorld(true);
      bounds.setFromObject(object); const center = bounds.getCenter(new THREE.Vector3()); object.position.add(new THREE.Vector3(-center.x, .03 - bounds.min.y, -center.z));
      disposeSceneInstances(visual.model); visual.model.clear(); visual.model.add(object); visual.instance = instance; visual.boundsValid = false;
    } catch { instance?.release(); /* The name and category silhouette remain available. */ }
  }
  pick(ray: THREE.Raycaster): string | null {
    if (!this.drops.size) return null;
    ray.intersectObjects(this.pickRoots, true, this.pickHits);
    let selected: string | null = null;
    hits: for (const hit of this.pickHits) {
      let object: THREE.Object3D | null = hit.object;
      while (object) { if (object.userData.dropId) { selected = object.userData.dropId as string; break hits; } object = object.parent; }
    }
    this.pickHits.length = 0;
    if (selected) return selected;
    // Thin blades and rolled papers need a little click tolerance at gameplay scale.
    let distance = Infinity;
    for (const visual of this.drops.values()) {
      const root = visual.root;
      root.updateWorldMatrix(true, false);
      // Drop children are static between prepared-model replacement callbacks.
      // Landing or parent transforms invalidate the same world-space bounds.
      if (!visual.boundsValid || !visual.boundsMatrix.equals(root.matrixWorld)) {
        visual.bounds.setFromObject(root).expandByScalar(.1);
        visual.boundsMatrix.copy(root.matrixWorld); visual.boundsValid = true;
      }
      if (!ray.ray.intersectBox(visual.bounds, this.pickPoint)) continue;
      const next = ray.ray.origin.distanceToSquared(this.pickPoint);
      if (next < distance) { distance = next; selected = root.userData.dropId as string; }
    }
    return selected;
  }
  update(dt: number): void { this.portal?.update(dt); }
  dispose(): void {
    this.disposed = true; this.portal?.dispose(); this.highlight.removeFromParent();
    this.drops.forEach(v => { v.instance?.release(); disposeSceneInstances(v.root); v.root.removeFromParent(); }); this.drops.clear();
    this.currentDrops.clear(); this.pickRoots.length = 0; this.pickHits.length = 0;
    for (const resource of [this.oreGeometry, this.stone, this.iron, this.geometry, this.box, this.arc, this.paper, this.ribbon, this.bark, this.metal, this.potionGlass, this.markerGeometry, this.markerMaterial,this.ring,this.cap,this.cloth]) resource.dispose();
  }
}
