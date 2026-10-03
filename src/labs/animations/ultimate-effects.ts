import motionProfiles from '../../../assets/motion-profiles.json';
import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import type { QualityLevel } from '../../rendering/quality-presets';
import { ArrowRainEffects, ultimateSequences as rainSequences } from '../../rendering/arrow-rain';
export const ultimateSequences={...rainSequences,executioner:{name:"Executioner's Strike",release:motionProfiles.clips['sword-executioner'].contact,motion:motionProfiles.clips['sword-executioner'].duration,duration:1.8},onslaught:{name:'Onslaught',release:motionProfiles.clips['sword-onslaught'].contacts[0],motion:motionProfiles.clips['sword-onslaught'].duration,duration:2}} as const;
export type UltimateKind=keyof typeof ultimateSequences;
export const ultimateTargets=[new THREE.Vector3(-1,0,3.15),new THREE.Vector3(1.1,0,4.1),new THREE.Vector3(-.2,0,5.05)];
/** Practice positions and motion comparisons belong only to the lab. */
export class UltimateEffects extends ArrowRainEffects {
  private kind: UltimateKind='arrow-rain';
  constructor(ground:THREE.Mesh,position:THREE.Vector3,yaw:number,quality:QualityLevel,renderer:WebGPURenderer,scene:THREE.Scene) {super(ground,position,yaw,quality,renderer,scene,ultimateTargets);}
  set(kind:UltimateKind): void {this.kind=kind; this.reset();}
  override hitTimes(index:number): readonly number[] {return this.kind!=='arrow-rain' ? index===0 ? this.kind==='executioner' ? [ultimateSequences.executioner.release] : motionProfiles.clips['sword-onslaught'].contacts : [] : super.hitTimes(index);}
  override hitTime(index:number): number {return this.hitTimes(index)[0] ?? Infinity;}
  override seek(time:number,camera:THREE.Camera): void {
    if (this.kind==='arrow-rain') {super.seek(time,camera); return;}
    const enabled=this.enabled; this.enabled=false; super.seek(0,camera); this.enabled=enabled;
  }
}
