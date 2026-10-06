import type { EncounterView } from '../gameplay/state-view';
import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { isMesh } from '../assets/resource-ownership';
import type { AreaInstance } from '../levels/builder';
import { particlePresets, type QualityLevel } from './quality-presets';
import { ArrowRainEffects } from './arrow-rain';

/** Area-owned rain art follows simulation snapshots and the actual animated bow. */
export class AbilityEffects {
  private rain: ArrowRainEffects;
  private id=0;
  private released=false;
  private ground:THREE.Mesh;
  private point=new THREE.Vector3();
  private rest=new THREE.Vector3();
  constructor(area:AreaInstance,quality:QualityLevel,renderer:WebGPURenderer) {
    // Authored terrain can be thicker than a decorative slab (Blockout is 0.6 m).
    const definition=area.area.props.filter(p=>p.primitive?.kind==='box' && (p.terrain || p.primitive.size[1]<=.5) && p.position[1]<=.25).sort((a,b)=>b.primitive!.size[0]*b.primitive!.size[2]-a.primitive!.size[0]*a.primitive!.size[2])[0];
    const mesh=definition ? area.root.getObjectByName(definition.id) : undefined;
    if (!isMesh(mesh)) throw new Error('Rain of Arrows needs an authored ground receiver.');
    // Decals use a real world transform even when the floor is an instanced prop.
    this.ground=new THREE.Mesh(mesh.geometry,mesh.material);
    mesh.updateWorldMatrix(true,false);
    this.ground.matrixAutoUpdate=false;
    const instance=new THREE.Matrix4();
    if (mesh instanceof THREE.InstancedMesh) mesh.getMatrixAt(0,instance);
    this.ground.matrix.copy(mesh.matrixWorld).multiply(instance); this.ground.updateMatrixWorld(true);
    this.rain=new ArrowRainEffects(this.ground,new THREE.Vector3(),0,quality,renderer,area.root);
    area.root.add(this.rain.root);
  }
  async prepare(camera:THREE.Camera): Promise<void> {await this.rain.prepare(); this.rain.stageMaterials(camera);}
  sync(state:EncounterView,actor:THREE.Object3D,camera:THREE.Camera): void {
    const committed=state.rains[0];
    const preparation=state.playerAction?.ability==='arrow-rain' && state.player.attackTime>=0 ? state.playerAction : null;
    const id=committed?.id ?? preparation?.impactId;
    const target=committed ?? preparation?.aim;
    if (!id || !target || state.phase==='lost') {this.rain.enabled=false; this.rain.seek(0,camera); this.id=0; return;}
    if (this.id!==id) {
      this.id=id; this.released=false;
      const yaw=state.player.yaw;
      const origin=new THREE.Vector3(target.x-Math.sin(yaw)*4.25,target.y ?? state.player.y,target.z-Math.cos(yaw)*4.25);
      this.rain.begin(origin,yaw,this.ground);
    }
    this.rain.enabled=true;
    actor.updateMatrixWorld(true);
    const hand=actor.getObjectByName('Hand_R'),bow=actor.getObjectByName('equipment-bow');
    if (hand && bow) {
      hand.getWorldPosition(this.point); bow.getWorldPosition(this.rest); this.rest.sub(this.point).normalize();
      this.rain.setBowFrame(this.point,this.rest,!!committed && !this.released);
      if (committed) this.released=true;
    }
    this.rain.seek(committed?.age ?? state.player.attackTime*(preparation?.rate ?? 1),camera);
  }
  setQuality(quality:QualityLevel): void {this.rain.setQuality(particlePresets[quality].emission);}
  clear(): void {this.id=0; this.rain.enabled=false; this.rain.resetParticles(); this.rain.root.visible=false;}
  dispose(): void {this.rain.dispose();}
}
