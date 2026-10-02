import * as THREE from 'three';
import type { AssetLodGroup } from '../assets/asset-assembly';

const lodBounds = new WeakMap<THREE.Object3D, { matrix: THREE.Matrix4; groups: { size: number; center: THREE.Vector3 }[] }>();
const lodEye = new THREE.Vector3();
/** Call once per frame for placed assemblies; authored screen-height thresholds remain intact. */
export function updateAssetLods(root: THREE.Object3D, camera: THREE.Camera): void {
  const groups = root.userData.lods as AssetLodGroup[] | undefined;
  if (!groups?.length) return;
  root.updateWorldMatrix(true, false);
  let cached = lodBounds.get(root);
  if (!cached || root.userData.lodSkinned || !cached.matrix.equals(root.matrixWorld)) {
    root.updateMatrixWorld(true);
    const box = new THREE.Box3(), size = new THREE.Vector3();
    cached = { matrix: root.matrixWorld.clone(), groups: groups.map(group => {
      box.makeEmpty(); for (const node of group.levels[0].nodes) box.expandByObject(node);
      return { size: box.getSize(size).length(), center: box.getCenter(new THREE.Vector3()) };
    }) };
    lodBounds.set(root, cached);
  }
  camera.getWorldPosition(lodEye);
  for (const [index, group] of groups.entries()) {
    const { size, center } = cached.groups[index];
    const fraction = camera instanceof THREE.OrthographicCamera ? size / ((camera.top - camera.bottom) / camera.zoom)
      : camera instanceof THREE.PerspectiveCamera ? size / (2 * Math.max(0.01, lodEye.distanceTo(center)) * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) : 1;
    const selected = group.levels.findIndex(level => fraction >= level.height);
    for (let i = 0; i < group.levels.length; i++) for (const node of group.levels[i].nodes) node.visible = i === selected;
  }
}
