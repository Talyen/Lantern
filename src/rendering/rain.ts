import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import type { AreaDefinition } from '../levels/types';
import { boundaryDistance } from '../gameplay/area';

/** Area-owned precipitation and contact pools; static flat-ground contacts need no raycasts. */
export class RainField {
  readonly root = new THREE.Group();
  private streaks = new THREE.InstancedMesh(new THREE.PlaneGeometry(.018,.38), new MeshBasicNodeMaterial({color:'#b1aa92',transparent:true,opacity:.27,depthWrite:false,side:THREE.DoubleSide}),384);
  private rings = new THREE.InstancedMesh(new THREE.RingGeometry(.065,.078,10), new MeshBasicNodeMaterial({color:'#a49f82',transparent:true,opacity:.24,depthWrite:false,side:THREE.DoubleSide}),32);
  private drops: {x:number;y:number;z:number}[] = [];
  private contacts: {x:number;z:number;age:number;water:boolean}[] = [];
  private transform = new THREE.Object3D();
  private carry = 0;
  private anchor = new THREE.Vector3();
  private camera?: THREE.Camera;
  private area?: AreaDefinition;
  constructor() { this.root.name='rain'; this.streaks.count=this.rings.count=0; this.streaks.frustumCulled=this.rings.frustumCulled=false; this.root.add(this.streaks,this.rings); }
  configure(area: AreaDefinition | undefined): void { this.area=area; this.clear(); }
  view(camera: THREE.Camera, position: THREE.Vector3): void { this.camera=camera; this.anchor.copy(position); }
  clear(): void { this.drops.length=this.contacts.length=0; this.carry=0; this.streaks.count=this.rings.count=0; }
  update(dt:number, enabled:boolean, rate:number, wind:THREE.Vector3):void {
    const area=this.area;
    if (!enabled || !area?.effects.weather || !this.camera) { this.clear(); return; }
    const shelters=area.effects.weather.shelters ?? [];
    const exposed=(x:number,z:number)=>boundaryDistance(area.layout.boundary,[x,z])>=0 && !shelters.some(s=>Math.hypot(x-s.center[0],z-s.center[1])<s.radius);
    this.carry+=dt*rate;
    while(this.carry>=1){this.carry--;const x=this.anchor.x+(Math.random()-.5)*18,z=this.anchor.z+(Math.random()-.5)*18;if(this.drops.length<384 && exposed(x,z))this.drops.push({x,y:4+Math.random()*2,z});}
    for(let i=this.drops.length-1;i>=0;i--){const drop=this.drops[i];drop.y-=dt*7;drop.x+=dt*wind.x;drop.z+=dt*wind.z;
      if(drop.y<=.05){
        if(exposed(drop.x,drop.z) && this.contacts.length<32 && Math.random()<.35){
          const water=area.effects.water.some(w=>{const dx=drop.x-w.position[0],dz=drop.z-w.position[1],yaw=w.yaw ?? 0;const x=dx*Math.cos(yaw)-dz*Math.sin(yaw),z=dx*Math.sin(yaw)+dz*Math.cos(yaw);return Math.abs(x)<w.width*.45 && Math.abs(z)<w.length*.4;});
          this.contacts.push({x:drop.x,z:drop.z,age:0,water});
        }
        this.drops[i]=this.drops[this.drops.length-1];this.drops.pop();
      }
    }
    const t=this.transform;
    for(let i=0;i<this.drops.length;i++){const d=this.drops[i];t.position.set(d.x,d.y,d.z);t.quaternion.copy(this.camera.quaternion);t.scale.set(1,1,1);t.updateMatrix();this.streaks.setMatrixAt(i,t.matrix);}
    this.streaks.count=this.drops.length;if(this.drops.length)this.streaks.instanceMatrix.needsUpdate=true;
    for(let i=this.contacts.length-1;i>=0;i--){this.contacts[i].age+=dt;if(this.contacts[i].age>.38){this.contacts[i]=this.contacts[this.contacts.length-1];this.contacts.pop();}}
    for(let i=0;i<this.contacts.length;i++){const c=this.contacts[i],progress=c.age/.38;const size=(c.water ? 1+progress*3 : .8+progress)*Math.min(1,(1-progress)*4);t.position.set(c.x,c.water ? .085 : .018,c.z);t.rotation.set(-Math.PI/2,0,0);t.scale.setScalar(size);t.updateMatrix();this.rings.setMatrixAt(i,t.matrix);}
    this.rings.count=this.contacts.length;if(this.contacts.length)this.rings.instanceMatrix.needsUpdate=true;
  }
  dispose():void {this.clear();for(const mesh of [this.streaks,this.rings]){mesh.geometry.dispose();(mesh.material as THREE.Material).dispose();mesh.dispose();}this.root.removeFromParent();}
}
