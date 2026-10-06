import type { EncounterView } from '../gameplay/state-view';
import * as THREE from 'three';
import { Fn, color, mix, positionLocal, positionPrevious, sin, uniform, uv, vec3 } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { type AssetInstance, type AssetLibrary } from '../assets/asset-library';
import { disposeSceneInstances } from '../assets/resource-ownership';
import { arrowAsset } from '../gameplay/equipment';

/** Presentation reads simulation projectiles; it never resolves hits or lifetime. */
export class ProjectileVisuals {
  readonly root = new THREE.Group();
  private arrows?: AssetInstance;
  private loading?: Promise<void>;
  private disposed = false;
  private liveIds = new Set<number>();
  private objects = new Map<number, THREE.Object3D>();
  private poisonGeometry=new THREE.SphereGeometry(.045,6,4);
  private poisonMaterial=new MeshBasicNodeMaterial({color:'#a2b570'});
  private boltGeometry = new THREE.SphereGeometry(.045, 8, 6);
  private boltMaterial = new MeshBasicNodeMaterial({color:'#ffd29a'});
  private fireMaterial = new MeshBasicNodeMaterial({color:'#ffd28a'});
  private fireRibbonMaterial = new MeshBasicNodeMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide});
  private enemyBoltMaterial = new MeshBasicNodeMaterial({color:'#91e4ef'});
  private ribbonClock = uniform(0);
  private previousRibbonClock = uniform(0);
  private ribbonGeometry = new THREE.PlaneGeometry(.27, 1.05, 1, 8);
  private ribbonMaterial = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  constructor(parent: THREE.Object3D, private library: AssetLibrary) {
    this.root.userData.transient = true; parent.add(this.root);
    this.ribbonGeometry.rotateX(-Math.PI / 2); this.ribbonGeometry.translate(0, 0, -.53);
    const positions = this.ribbonGeometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) positions.setX(i, positions.getX(i) * Math.max(.08, 1 + positions.getZ(i) / 1.05));
    this.ribbonMaterial.colorNode = mix(color('#3c8eaa'), color('#c2f0e8'), uv().y.oneMinus());
    this.ribbonMaterial.opacityNode = uv().y.oneMinus().mul(.68);
    const ribbonPosition = (clock: typeof this.ribbonClock) => positionLocal.add(vec3(sin(positionLocal.z.mul(11).add(clock.mul(13))).mul(.045).mul(uv().y), 0, 0));
    this.ribbonMaterial.positionNode = Fn(() => {
      positionPrevious.assign(ribbonPosition(this.previousRibbonClock));
      return ribbonPosition(this.ribbonClock);
    })();
    this.fireRibbonMaterial.colorNode=mix(color('#bb4122'),color('#ffd18a'),uv().y.oneMinus());
    this.fireRibbonMaterial.opacityNode=uv().y.oneMinus().mul(.72);
    this.fireRibbonMaterial.positionNode=this.ribbonMaterial.positionNode;
  }
  prepareArrow(): Promise<void> {
    return this.loading ??= this.library.loadAsset(arrowAsset).then(instance => {
      if (this.disposed) { instance.release(); return; }
      this.arrows = instance; instance.object.scale.setScalar(.7); instance.object.updateMatrixWorld(true);
    }).catch((error: unknown) => { this.loading = undefined; throw error; });
  }
  sync(projectiles: EncounterView['projectiles'], dt = 0): void {
    this.previousRibbonClock.value = this.ribbonClock.value;
    this.ribbonClock.value += dt;
    this.liveIds.clear();
    for (const projectile of projectiles) this.liveIds.add(projectile.id);
    for (const [id, object] of this.objects) if (!this.liveIds.has(id)) { disposeSceneInstances(object); object.removeFromParent(); this.objects.delete(id); }
    for (const projectile of projectiles) {
      let object = this.objects.get(projectile.id);
      if (!object) {
        object = projectile.kind === 'arrow' ? this.arrows?.object.clone(true) : new THREE.Mesh(this.boltGeometry,projectile.damageType==='burn' ? this.fireMaterial : projectile.owner !== 'player' ? this.enemyBoltMaterial : this.boltMaterial);
        if (!object) continue;
        if (projectile.ability==='poison-arrow') {const tip=new THREE.Mesh(this.poisonGeometry,this.poisonMaterial); tip.position.z=.38; object.add(tip);}
        if (projectile.kind === 'bolt' && projectile.owner !== 'player') {
          const head = object; object = new THREE.Group(); object.add(head);
          if(projectile.damageType==='burn')head.scale.setScalar(3.2);else head.scale.set(2,2,5);
          const ribbon = new THREE.Mesh(this.ribbonGeometry,projectile.damageType==='burn' ? this.fireRibbonMaterial : this.ribbonMaterial); object.add(ribbon);
        } else if (projectile.kind === 'bolt') object.scale.set(projectile.owner !== 'player' ? 2 : 1, projectile.owner !== 'player' ? 2 : 1, projectile.owner !== 'player' ? 5 : 2.5);
        this.root.add(object); this.objects.set(projectile.id,object);
      }
      object.position.set(projectile.x,projectile.y,projectile.z); object.rotation.y=Math.atan2(projectile.dx,projectile.dz);
    }
  }
  clear(): void { disposeSceneInstances(this.root); this.root.clear(); this.objects.clear(); this.liveIds.clear(); this.ribbonClock.value = this.previousRibbonClock.value = 0; }
  dispose(): void { this.disposed=true; this.clear(); this.root.removeFromParent(); this.arrows?.release(); this.poisonGeometry.dispose(); this.poisonMaterial.dispose(); this.boltGeometry.dispose(); this.boltMaterial.dispose(); this.enemyBoltMaterial.dispose(); this.fireMaterial.dispose(); this.fireRibbonMaterial.dispose(); this.ribbonGeometry.dispose(); this.ribbonMaterial.dispose(); }
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
  constructor(parent: THREE.Object3D, private actor: THREE.Object3D, private id = 'caster') { this.root.userData.transient = true; this.root.add(this.charge); parent.add(this.root); this.clear(); }
  sync(state: EncounterView, release: number, dt: number, visible: boolean): void {
    const enemy = state.enemies[this.id];
    if (!visible || !enemy || !enemy.home || enemy.hp <= 0 || state.phase === 'lost') { this.clear(); return; }
    this.material.color.set(enemy.damageType==='burn' ? '#ffc477' : '#b0eff4');
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
  restore(state: EncounterView): void {
    this.clear();
    this.released = (state.enemies[this.id]?.contactIndex ?? 0) > 0;
  }
  attach(parent: THREE.Object3D): void { parent.add(this.root); }
  detach(): void { this.root.removeFromParent(); }
  clear(): void { this.root.visible = false; this.flash = 0; this.released = false; }
  dispose(): void { this.root.removeFromParent(); this.geometry.dispose(); this.material.dispose(); }
}
