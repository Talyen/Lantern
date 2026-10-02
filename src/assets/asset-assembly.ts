import * as THREE from 'three';
import { disposeSceneInstances, isMesh } from './resource-ownership';

export type LibraryModel = { scene: THREE.Group; bindposes?: number[] };
type AssemblyNode = {
  name: string; parent: number; position: number[]; rotation: number[]; scale: number[]; enabled: boolean;
  mesh?: { assetId: string; name: string }; materials: (string | null)[]; bones?: number[]; rootBone: number;
  colliders: { center?: number[]; [key: string]: unknown }[];
  lods: { screenHeight: number; nodes: number[] }[]; unsupported: string[];
};
export type AssemblySpec = { nodes: AssemblyNode[]; warnings: string[] };
export type AssetLodGroup = { levels: { height: number; nodes: THREE.Object3D[] }[] };
type AssemblySources = {
  model(id: string): Promise<LibraryModel>;
  material(id: string): Promise<THREE.Material>;
};

/** Assemblies borrow cached art and own only their newly constructed instances. */
export async function assembleAsset(id: string, spec: AssemblySpec, sources: AssemblySources): Promise<THREE.Group> {
  const root = new THREE.Group();
  const nodes = spec.nodes.map(node => {
    const group = new THREE.Bone();
    group.name = node.name;
    group.position.set(node.position[0], node.position[1], -node.position[2]);
    group.quaternion.set(-node.rotation[0], -node.rotation[1], node.rotation[2], node.rotation[3]);
    group.scale.fromArray(node.scale);
    group.visible = node.enabled;
    group.userData.colliders = node.colliders.map(collider => ({ ...collider,
      center: collider.center ? [collider.center[0], collider.center[1], -collider.center[2]] : undefined,
    }));
    group.userData.unsupported = node.unsupported;
    return group;
  });
  nodes.forEach((node, index) => (spec.nodes[index].parent >= 0 ? nodes[spec.nodes[index].parent] : root).add(node));

  const loading = spec.nodes.map(async (node, index) => {
    if (!node.mesh) return;
    const model = await sources.model(node.mesh.assetId);
    const primitives: THREE.Mesh[] = [];
    model.scene.traverse(object => { if (isMesh(object)) primitives.push(object); });
    const materials = await Promise.all(node.materials.map(id => id ? sources.material(id) : Promise.resolve(null)));
    const bindposes = model.bindposes;
    for (const [primitive, source] of primitives.entries()) {
      const material = materials[primitive] ?? source.material;
      let mesh: THREE.Mesh;
      if (node.bones?.length && bindposes?.length) {
        const bones = node.bones.map(index => {
          if (index < 0 || !nodes[index]) throw new Error(`Unresolved bone in ${id}`);
          return nodes[index];
        });
        const inverses = bones.map((_, index) => new THREE.Matrix4().fromArray(bindposes, index * 16));
        const skin = new THREE.SkinnedMesh(source.geometry, material);
        root.updateMatrixWorld(true);
        skin.bind(new THREE.Skeleton(bones, inverses), new THREE.Matrix4());
        mesh = skin;
      } else mesh = new THREE.Mesh(source.geometry, material);
      mesh.name = node.mesh.name;
      nodes[index].add(mesh);
    }
  });
  try {
    await Promise.all(loading);
    // Preserve authored screen-height thresholds and hierarchy references.
    const lods: AssetLodGroup[] = spec.nodes.flatMap(node => node.lods.length ? [{
      levels: node.lods.map(level => ({ height: level.screenHeight, nodes: level.nodes.map(index => nodes[index]) })),
    }] : []);
    root.userData.lods = lods;
    root.userData.warnings = spec.warnings;
    return root;
  } catch (error) {
    // A sibling may still attach a mesh after another node has failed.
    await Promise.allSettled(loading);
    disposeSceneInstances(root, { skeletons: true });
    throw error;
  }
}
