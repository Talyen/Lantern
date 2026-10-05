import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { rainExposure } from '../levels/weather';
import type { AreaDefinition, RainShelter } from '../levels/types';
import { waterAt, waterLevel } from '../levels/water';
import { boundaryDistance } from '../gameplay/area';

/** Area-owned precipitation and contact pools; static flat-ground contacts need no raycasts. */
export class RainField {
  readonly root = new THREE.Group();
  private streaks = new THREE.InstancedMesh(new THREE.PlaneGeometry(.018,.38), new MeshBasicNodeMaterial({color:'#b1aa92',transparent:true,opacity:.27,depthWrite:false,side:THREE.DoubleSide}),384);
  private drops: {x:number;y:number;z:number}[] = [];
  private transform = new THREE.Object3D();
  private carry = 0;
  private anchor = new THREE.Vector3();
  private camera?: THREE.Camera;
  private area?: AreaDefinition;
  private groundHeight = 0;
  private shelters: RainShelter[] = [];
  private readonly exposurePoint: [number, number] = [0, 0];
  constructor(private contact: (x: number, z: number, height: number) => void) { this.root.name='rain'; this.streaks.count=0; this.streaks.frustumCulled=false; this.root.add(this.streaks); }
  configure(area: AreaDefinition | undefined, shelters: RainShelter[] = []): void { this.area=area; this.shelters=shelters; const ground=area?.props.find(p=>p.terrain && p.primitive?.kind==='box'); this.groundHeight=ground ? ground.position[1]+ground.primitive!.size[1]*ground.scale[1]/2 : 0; this.clear(); }
  view(camera: THREE.Camera, position: THREE.Vector3): void { this.camera=camera; this.anchor.copy(position); }
  clear(): void { this.drops.length=0; this.carry=0; this.streaks.count=0; }
  update(dt: number, enabled: boolean, rate: number, wind: THREE.Vector3): void {
    const area = this.area;
    if (!enabled || !area?.effects.weather || !this.camera) { this.clear(); return; }
    const shelters = this.shelters, point = this.exposurePoint;
    // Boundary queries consume the point synchronously; particles share one scratch pair.
    const exposureAt = (x: number, z: number) => {
      point[0] = x; point[1] = z;
      return boundaryDistance(area.layout.boundary, point) >= 0 ? rainExposure(shelters, x, z) : 0;
    };
    this.carry += dt * rate;
    while (this.carry >= 1) {
      this.carry--;
      const x = this.anchor.x + (Math.random() - .5) * 18, z = this.anchor.z + (Math.random() - .5) * 18;
      if (this.drops.length >= 384) continue;
      const exposure = exposureAt(x, z);
      if (exposure > 0 && Math.random() < exposure) this.drops.push({ x, y: this.anchor.y + 4 + Math.random() * 2, z });
    }
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const drop = this.drops[i];
      drop.y -= dt * 7; drop.x += dt * wind.x; drop.z += dt * wind.z;
      const surface = waterAt(area.effects.water, drop.x, drop.z), height = surface ? waterLevel(surface) : this.groundHeight;
      const exposure = exposureAt(drop.x, drop.z);
      if (!(exposure > 0) || drop.y <= height + .01) {
        if (exposure > 0 && Math.random() < .35 * exposure) this.contact(drop.x, drop.z, height);
        this.drops[i] = this.drops[this.drops.length - 1]; this.drops.pop();
      }
    }
    const t=this.transform;
    for(let i=0;i<this.drops.length;i++){const d=this.drops[i];t.position.set(d.x,d.y,d.z);t.quaternion.copy(this.camera.quaternion);t.scale.set(1,1,1);t.updateMatrix();this.streaks.setMatrixAt(i,t.matrix);}
    this.streaks.count=this.drops.length;if(this.drops.length)this.streaks.instanceMatrix.needsUpdate=true;
  }
  dispose():void {this.clear();for(const mesh of [this.streaks]){mesh.geometry.dispose();(mesh.material as THREE.Material).dispose();mesh.dispose();}this.root.removeFromParent();}
}
