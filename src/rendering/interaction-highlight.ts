import { isMesh } from '../assets/resource-ownership';
import * as THREE from 'three';
import { MeshBasicNodeMaterial, type NodeMaterial, type Node } from 'three/webgpu';
import { positionLocal, normalLocal, uniform, vec3 } from 'three/tsl';

/** An expanded back-face contour stays in the shared scene graph and obeys normal depth occlusion. */
export class InteractionHighlight {
  private root=new THREE.Group();
  private target:THREE.Object3D | null=null;
  private scale=new THREE.Vector3();
  private position=new THREE.Vector3();
  private rotation=new THREE.Quaternion();
  private parts:{source:THREE.Mesh;mesh:THREE.Mesh;material:MeshBasicNodeMaterial;width:ReturnType<typeof uniform>}[]=[];
  constructor(parent:THREE.Object3D){this.root.userData.transient=true;parent.add(this.root);}
  select(target:THREE.Object3D | null):void{
    if(this.target===target)return;
    this.clear();this.target=target;if(!target)return;
    target.traverse(object=>{
      if(!isMesh(object) || object instanceof THREE.SkinnedMesh || object instanceof THREE.InstancedMesh)return;
      const original=(Array.isArray(object.material) ? object.material[0] : object.material) as NodeMaterial;
      const material=new MeshBasicNodeMaterial({color:'#ab8d58',side:THREE.BackSide,depthWrite:false,transparent:true,opacity:.75,alphaTest:original.alphaTest,map:(original as NodeMaterial & {map?:THREE.Texture | null}).map});
      const width=uniform(.01);material.positionNode=vec3((original.positionNode as Node<'vec3'> | null) ?? positionLocal).add(normalLocal.mul(width));
      material.opacityNode=original.opacityNode;material.toneMapped=false;
      const mesh=new THREE.Mesh(object.geometry,material);mesh.matrixAutoUpdate=false;mesh.userData.transient=true;mesh.raycast=()=>{};
      this.root.add(mesh);this.parts.push({source:object,mesh,material,width});
    });
  }
  update(worldWidth:number):void{
    // Refresh shared ancestors and the selected subtree once. Per-mesh refreshes
    // repeat the same parent chains on multi-part scenery every hover frame.
    if(!this.parts.length)return;
    this.target!.updateWorldMatrix(true,true);
    const scale=this.scale;
    for(const part of this.parts){
      let visible=true;for(let object:THREE.Object3D | null=part.source;object;object=object.parent)if(!object.visible)visible=false;
      part.mesh.visible=visible;part.mesh.matrix.copy(part.source.matrixWorld);
      // The world matrix is already current; getWorldScale would refresh its ancestors again.
      part.source.matrixWorld.decompose(this.position,this.rotation,scale);part.width.value=worldWidth/Math.max(.001,Math.max(scale.x,scale.y,scale.z));
    }
  }
  clear():void{this.parts.forEach(part=>part.material.dispose());this.parts=[];this.root.clear();this.target=null;}
  dispose():void{this.clear();this.root.removeFromParent();}
}
