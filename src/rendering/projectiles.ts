import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { assetLibrary, type AssetInstance } from '../assets/asset-library';
import { disposeSceneInstances } from '../assets/resource-ownership';
import { arrowAsset } from '../gameplay/equipment';
import type { Projectile, Encounter } from '../gameplay/encounter';

/** Presentation reads simulation projectiles; it never resolves hits or lifetime. */
export class ProjectileVisuals {
  readonly root = new THREE.Group();
  private arrows?: AssetInstance;
  private loading?: Promise<void>;
  private disposed = false;
  private liveIds = new Set<number>();
  private objects = new Map<number, THREE.Object3D>();
  private boltGeometry = new THREE.SphereGeometry(.045, 8, 6);
  private boltMaterial = new MeshBasicNodeMaterial({color:'#ffd29a'});
  private enemyBoltMaterial = new MeshBasicNodeMaterial({color:'#91e4ef'});
  constructor(parent: THREE.Object3D) { this.root.userData.transient = true; parent.add(this.root); }
  prepareArrow(): Promise<void> {
    return this.loading ??= assetLibrary.loadAsset(arrowAsset).then(instance => {
      if (this.disposed) { instance.release(); return; }
      this.arrows = instance; instance.object.scale.setScalar(.7); instance.object.updateMatrixWorld(true);
    }).catch((error: unknown) => { this.loading = undefined; throw error; });
  }
  sync(projectiles: Projectile[]): void {
    this.liveIds.clear();
    for (const projectile of projectiles) this.liveIds.add(projectile.id);
    for (const [id, object] of this.objects) if (!this.liveIds.has(id)) { disposeSceneInstances(object); object.removeFromParent(); this.objects.delete(id); }
    for (const projectile of projectiles) {
      let object = this.objects.get(projectile.id);
      if (!object) {
        object = projectile.kind === 'arrow' ? this.arrows?.object.clone(true) : new THREE.Mesh(this.boltGeometry,projectile.owner !== 'player' ? this.enemyBoltMaterial : this.boltMaterial);
        if (!object) continue;
        if (projectile.kind === 'bolt') object.scale.set(projectile.owner !== 'player' ? 2 : 1, projectile.owner !== 'player' ? 2 : 1, projectile.owner !== 'player' ? 5 : 2.5);
        this.root.add(object); this.objects.set(projectile.id,object);
      }
      object.position.set(projectile.x,projectile.y,projectile.z); object.rotation.y=Math.atan2(projectile.dx,projectile.dz);
    }
  }
  clear(): void { disposeSceneInstances(this.root); this.root.clear(); this.objects.clear(); this.liveIds.clear(); }
  dispose(): void { this.disposed=true; this.clear(); this.root.removeFromParent(); this.arrows?.release(); this.boltGeometry.dispose(); this.boltMaterial.dispose(); this.enemyBoltMaterial.dispose(); }
}

/** A small hand charge and release flash read the cast clock without awarding or firing anything. */
export class CasterVisuals {
  private root = new THREE.Group();
  private geometry = new THREE.IcosahedronGeometry(1, 1);
  private material = new MeshBasicNodeMaterial({ color: '#b0eff4', transparent: true, opacity: .9, depthWrite: false });
  private charge = new THREE.Mesh(this.geometry, this.material);
  private flash = 0;
  private released = false;
  private hand?: THREE.Object3D;
  constructor(parent: THREE.Object3D, private actor: THREE.Object3D) { this.root.userData.transient = true; this.root.add(this.charge); parent.add(this.root); this.clear(); }
  sync(state: Encounter, release: number, dt: number, visible: boolean): void {
    const enemy = state.enemies.caster;
    if (!visible || !enemy.home || enemy.hp <= 0 || state.phase === 'lost') { this.clear(); return; }
    const casting = enemy.attackTime >= 0;
    if (!casting) this.released = false;
    else if (enemy.contactIndex > 0 && !this.released) { this.flash = .12; this.released = true; }
    this.flash = Math.max(0, this.flash - dt);
    const charging = casting && enemy.attackTime < release;
    this.root.visible = charging || this.flash > 0;
    const dx = Math.sin(enemy.yaw), dz = Math.cos(enemy.yaw);
    this.hand ??= this.actor.getObjectByName('Hand_R');
    if (charging && this.hand) this.hand.getWorldPosition(this.root.position);
    else this.root.position.set(enemy.x + dx * .35, enemy.y + 1.08, enemy.z + dz * .35);
    const progress = charging ? enemy.attackTime / Math.max(.01, release) : 0;
    this.charge.scale.setScalar(charging ? .055 + progress * .085 : .22 * this.flash / .12);
    this.charge.rotation.y += dt * 2;
    this.material.opacity = charging ? .55 + progress * .4 : this.flash / .12;
  }
  clear(): void { this.root.visible = false; this.flash = 0; this.released = false; }
  dispose(): void { this.root.removeFromParent(); this.geometry.dispose(); this.material.dispose(); }
}
