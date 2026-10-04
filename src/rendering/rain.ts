import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import type { AreaDefinition } from '../levels/types';
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
  constructor(private contact: (x: number, z: number) => void) { this.root.name='rain'; this.streaks.count=0; this.streaks.frustumCulled=false; this.root.add(this.streaks); }
  configure(area: AreaDefinition | undefined): void { this.area=area; this.clear(); }
  view(camera: THREE.Camera, position: THREE.Vector3): void { this.camera=camera; this.anchor.copy(position); }
  clear(): void { this.drops.length=0; this.carry=0; this.streaks.count=0; }
  update(dt:number, enabled:boolean, rate:number, wind:THREE.Vector3):void {
    const area=this.area;
    if (!enabled || !area?.effects.weather || !this.camera) { this.clear(); return; }
    const shelters=area.effects.weather.shelters ?? [];
    const exposed=(x:number,z:number)=>boundaryDistance(area.layout.boundary,[x,z])>=0 && !shelters.some(s=>Math.hypot(x-s.center[0],z-s.center[1])<s.radius);
    this.carry+=dt*rate;
    while(this.carry>=1){this.carry--;const x=this.anchor.x+(Math.random()-.5)*18,z=this.anchor.z+(Math.random()-.5)*18;if(this.drops.length<384 && exposed(x,z))this.drops.push({x,y:4+Math.random()*2,z});}
    for(let i=this.drops.length-1;i>=0;i--){const drop=this.drops[i];drop.y-=dt*7;drop.x+=dt*wind.x;drop.z+=dt*wind.z;
      if(drop.y<=.05){
        if(exposed(drop.x,drop.z) && Math.random()<.35) this.contact(drop.x,drop.z);
        this.drops[i]=this.drops[this.drops.length-1];this.drops.pop();
      }
    }
    const t=this.transform;
    for(let i=0;i<this.drops.length;i++){const d=this.drops[i];t.position.set(d.x,d.y,d.z);t.quaternion.copy(this.camera.quaternion);t.scale.set(1,1,1);t.updateMatrix();this.streaks.setMatrixAt(i,t.matrix);}
    this.streaks.count=this.drops.length;if(this.drops.length)this.streaks.instanceMatrix.needsUpdate=true;
  }
  dispose():void {this.clear();for(const mesh of [this.streaks]){mesh.geometry.dispose();(mesh.material as THREE.Material).dispose();mesh.dispose();}this.root.removeFromParent();}
}
