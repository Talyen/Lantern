import * as THREE from 'three';
import { createSurfaceMaterial } from './surface-detail';
import { positionLocal, mx_noise_float, mix, color, vec3 } from 'three/tsl';
import { markOutline } from './outlines';
import type { AreaDefinition } from '../levels/types';

/** Open cover keeps the character and chest visible from the fixed isometric camera. */
export function createShelter(definition: NonNullable<AreaDefinition['shelter']>, restored: boolean, chest: THREE.Group) {
  const root = new THREE.Group(); root.name = 'shelter'; root.position.set(definition.position[0],0,definition.position[1]); root.rotation.y=definition.yaw;
  const geometries: THREE.BufferGeometry[] = [], materials: THREE.Material[] = [];
  const material = (base: string, worn: string) => {
    const m = createSurfaceMaterial({roughness:1,side:THREE.DoubleSide});
    m.colorNode=mix(color(base),color(worn),mx_noise_float(positionLocal.mul(vec3(3,7,3))).mul(.14).add(.22)); materials.push(m); return m;
  };
  const timber=material('#514031','#9a8162'), canvas=material('#75634e','#a79575'), stone=material('#655f52','#958b79');
  const box = (size: number[], position: number[], mat: THREE.Material, rotation?: number[]) => {
    const g=new THREE.BoxGeometry(...size as [number,number,number]); geometries.push(g); const mesh=new THREE.Mesh(g,mat); mesh.position.fromArray(position); if(rotation)mesh.rotation.fromArray([...rotation,'XYZ'] as [number,number,number,THREE.EulerOrder]); mesh.castShadow=mesh.receiveShadow=true; root.add(mesh); return mesh;
  };
  for (const x of [-1.65,1.65]) for (const z of [-1.15,1.15]) {
    const front=z>0, height=front ? 2.15 : 1.8;
    box([.34,.22,.34],[x,.11,z],stone);
    box([.14,restored ? height : height*.65,.16],[x,restored ? height/2+.12 : height*.325+.12,z],timber,restored ? undefined : [0,0,x<0 ? -.14 : .13]);
  }
  box([3.55,.16,.16],[0,restored ? 2.23 : 1.3,1.15],timber,restored ? undefined : [0,0,-.16]);
  box([3.55,.14,.14],[0,restored ? 1.88 : .38,-1.15],timber,restored ? undefined : [0,.05,.08]);
  if (restored) {
    for(const x of [-1.65,1.65])box([.13,.14,2.65],[x,2.05,0],timber,[-.15,0,0]);
    box([.09,.75,.10],[-1.52,1.86,1.14],timber,[0,0,-.5]); box([.09,.75,.10],[1.52,1.86,1.14],timber,[0,0,.5]);
  } else {
    box([2.8,.13,.16],[.25,.18,.4],timber,[0,.32,.06]); box([1.5,.10,.12],[-.65,.14,-.35],timber,[0,-.45,0]);
  }
  // Repair changes the silhouette and purposeful arrangement, without obscuring the stash approach.
  if (restored) {
    for (const x of [-1.64,1.64]) for (const z of [-.95,.95]) box([.09,.65,.1],[x,1.55,z],timber,[0,0,x<0 ? -.38 : .38]);
    for (const x of [-1.3,-.95,-.6]) box([.16,.18,.75],[x,.16,-.8],timber);
    box([.48,.16,.66],[-1.13,.23,.32],canvas);
    box([.5,.06,.12],[-1.13,.34,.5],timber);
  } else {
    box([.9,.08,.14],[-1.16,.11,.82],timber,[0,.48,.06]);
    box([.54,.16,.5],[.85,.18,-.65],canvas,[0,-.3,.1]);
  }
  // Broad canvas facets and a shallow sag read as cloth without noisy geometry.
  const roof=new THREE.BufferGeometry(), vertices:number[]=[];
  const points=[[-1.83,restored?1.97:.32,-1.3],[0,restored?1.88:.16,-1.3],[1.83,restored?1.97:.4,-1.3],[-1.83,restored?2.35:1.47,1.35],[0,restored?2.25:.74,1.35],[1.83,restored?2.35:1.16,1.35]];
  for(const [a,b,c] of [[0,3,1],[1,3,4],[1,4,2],[2,4,5]])vertices.push(...points[a],...points[b],...points[c]);
  roof.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3)); roof.computeVertexNormals(); geometries.push(roof);
  const cover=new THREE.Mesh(roof,canvas);cover.castShadow=cover.receiveShadow=true;root.add(cover);
  if(restored) {
    root.updateMatrixWorld(true); chest.position.set(definition.stash[0],0,definition.stash[1]); root.worldToLocal(chest.position); chest.rotation.y=-definition.yaw; chest.name='shelter-stash'; root.add(chest);
  }
  markOutline(root,'prop');
  return {root,dispose:()=>{geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());}};
}
