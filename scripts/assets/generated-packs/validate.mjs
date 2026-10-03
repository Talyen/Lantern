import { Box3, Vector3, DoubleSide } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { parseGlb, encodeGlb } from '../../lib/glb.mjs';

/** Preserve authored binary data; r186 reserves extras.pivot for numeric offsets. */
export function prepareModel(source, name) {
  const { json, tail } = parseGlb(source, name);
  if (json.asset?.version !== '2.0' || json.extensionsRequired?.length || json.images?.length || json.textures?.length
    || json.cameras?.length || json.extensions?.KHR_lights_punctual || json.buffers?.length !== 1 || json.buffers[0].uri
    || tail.length < 8 || tail.readUInt32LE(4) !== 0x004e4942 || tail.readUInt32LE(0) !== tail.length - 8
    || json.buffers[0].byteLength > tail.length - 8) throw new Error(`Expected self-contained, uncompressed geometry: ${name}`);
  for (const view of json.bufferViews ?? []) {
    if (view.buffer !== 0 || (view.byteOffset ?? 0) < 0 || view.byteLength < 0
      || (view.byteOffset ?? 0) + view.byteLength > json.buffers[0].byteLength) throw new Error(`Invalid buffer view: ${name}`);
  }
  let renamed = 0;
  for (const node of json.nodes ?? []) if (typeof node.extras?.pivot === 'string') {
    node.extras.placement_pivot_description = node.extras.pivot; delete node.extras.pivot; renamed++;
  }
  return { bytes: renamed ? encodeGlb(json, tail) : source, renamed };
}

export function yUpBounds({ min, max }) {
  return [[min[0], min[2], -max[1]], [max[0], max[2], -min[1]]];
}

/** Inspect actual decoded data and compatibility with the shared node-material adapter. */
export async function inspectModel(bytes, name, expected = {}) {
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const geometries = new Set(), materials = new Set();
  const fail = message => { throw new Error(`${name}: ${message}`); };
  const loadedBounds = () => {
    gltf.scene.updateMatrixWorld(true);
    const box = new Box3().setFromObject(gltf.scene), size = box.getSize(new Vector3());
    if (!box.min.toArray().concat(box.max.toArray()).every(Number.isFinite) || size.length() <= 0) fail('Invalid loaded bounds');
    return [box.min.toArray(), box.max.toArray()];
  };
  try {
    let triangles = 0, primitives = 0, coloredMeshes = 0;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(node => {
      if (!node.matrixWorld.elements.every(Number.isFinite)) fail('Nonfinite node transform');
      if (!node.isMesh) return;
      const geometry = node.geometry, position = geometry.attributes.position, normal = geometry.attributes.normal, index = geometry.index;
      geometries.add(geometry);
      if (!position || !normal || normal.count !== position.count) fail('Missing positions or normals');
      for (const attribute of Object.values(geometry.attributes)) {
        if (attribute.count !== position.count || !Array.from(attribute.array).every(Number.isFinite)) fail('Invalid vertex attribute');
      }
      if (index && Array.from(index.array).some(value => !Number.isInteger(value) || value < 0 || value >= position.count)) fail('Invalid triangle index');
      const count = index?.count ?? position.count;
      if (!count || count % 3) fail('Incomplete triangles');
      triangles += count / 3;
      for (let i = 0; i < normal.count; i++) {
        if (Math.abs(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i)) - 1) > .01) fail('Non-unit normal');
      }
      const meshMaterials = Array.isArray(node.material) ? node.material : [node.material];
      primitives += meshMaterials.length;
      if (geometry.attributes.color) coloredMeshes++;
      for (const material of meshMaterials) {
        materials.add(material);
        if (!material.isMeshStandardMaterial || material.transparent || material.opacity !== 1
          || !material.color.toArray().concat(material.roughness, material.metalness).every(Number.isFinite)) fail('Unsupported PBR material');
        const adapted = new MeshStandardNodeMaterial().copy(material);
        try {
          if (!adapted.color.equals(material.color) || adapted.side !== material.side || adapted.vertexColors !== material.vertexColors
            || adapted.roughness !== material.roughness || adapted.metalness !== material.metalness) fail('Node-material adaptation changed authored values');
        } finally { adapted.dispose(); }
        if (expected.vertexColors && (!geometry.attributes.color || !material.vertexColors || material.side !== DoubleSide)) fail('Lost botanical vertex colors or double-sided leaves');
      }
      if (node.isSkinnedMesh) fail('Static prop unexpectedly skinned');
    });
    const bounds = loadedBounds();
    if (expected.triangles !== undefined && triangles !== expected.triangles) fail('Triangle count differs from source manifest');
    if (expected.primitives !== undefined && primitives !== expected.primitives) fail('Material primitive count differs from source manifest');
    if (expected.bounds && bounds.some((point, side) => point.some((value, axis) => Math.abs(value - expected.bounds[side][axis]) > .001))) fail('Y-up bounds differ from source manifest');
    if (expected.ground && Math.abs(bounds[0][1]) > .001) fail('Ground contact changed');
    if (expected.ground && (gltf.scene.children.length !== 1 || gltf.scene.children[0].getWorldPosition(new Vector3()).length() > 1e-6)) fail('Ground placement origin changed');
    if (expected.identityMesh) {
      const meshes = gltf.scene.children;
      // GLTFLoader splits a multi-material glTF mesh into a group of primitives.
      if (meshes.length !== 1 || meshes[0].position.length() > 1e-6
        || meshes[0].quaternion.angleTo(gltf.scene.quaternion) > 1e-6 || !meshes[0].scale.equals(new Vector3(1, 1, 1))) fail('Weapon grip transform changed');
    }
    if (gltf.animations.length) fail('Static prop unexpectedly animated');
    return { bounds, triangles, primitives, coloredMeshes };
  } finally {
    geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
  }
}
