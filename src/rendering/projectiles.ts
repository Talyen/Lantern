import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { assetLibrary, type AssetInstance } from '../assets/asset-library';
import { arrowAsset } from '../gameplay/equipment';
import type { Projectile } from '../gameplay/encounter';

/** Presentation reads simulation projectiles; it never resolves hits or lifetime. */
export class ProjectileVisuals {
  readonly root = new THREE.Group();
  private arrows?: AssetInstance;
  private loading?: Promise<void>;
  private disposed = false;
  private objects = new Map<number, THREE.Object3D>();
  private boltGeometry = new THREE.SphereGeometry(.045, 8, 6);
  private boltMaterial = new MeshBasicNodeMaterial({color:'#ffd29a'});
  constructor(parent: THREE.Object3D) { this.root.userData.transient = true; parent.add(this.root); }
  prepareArrow(): Promise<void> {
    return this.loading ??= assetLibrary.loadAsset(arrowAsset).then(instance => {
      if (this.disposed) { instance.release(); return; }
      this.arrows = instance; instance.object.scale.setScalar(.7); instance.object.updateMatrixWorld(true);
    }).catch(error => { this.loading = undefined; throw error; });
  }
  sync(projectiles: Projectile[]): void {
    for (const [id, object] of this.objects) if (!projectiles.some(projectile=>projectile.id===id)) { object.removeFromParent(); this.objects.delete(id); }
    for (const projectile of projectiles) {
      let object = this.objects.get(projectile.id);
      if (!object) {
        object = projectile.kind === 'arrow' ? this.arrows?.object.clone(true) : new THREE.Mesh(this.boltGeometry,this.boltMaterial);
        if (!object) continue;
        if (projectile.kind === 'bolt') object.scale.set(1,1,2.5);
        this.root.add(object); this.objects.set(projectile.id,object);
      }
      object.position.set(projectile.x,projectile.y,projectile.z); object.rotation.y=Math.atan2(projectile.dx,projectile.dz);
    }
  }
  clear(): void { this.root.clear(); this.objects.clear(); }
  dispose(): void { this.disposed=true; this.clear(); this.root.removeFromParent(); this.arrows?.release(); this.boltGeometry.dispose(); this.boltMaterial.dispose(); }
}
