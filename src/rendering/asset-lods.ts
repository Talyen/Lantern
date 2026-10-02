import * as THREE from 'three';
import type { AssetLodGroup } from '../assets/asset-assembly';

type LodBounds = { matrix: THREE.Matrix4; groups: { size: number; center: THREE.Vector3 }[] };
const lodBounds = new WeakMap<THREE.Object3D, LodBounds>();
const lodEye = new THREE.Vector3();
const lodBox = new THREE.Box3();
const lodSize = new THREE.Vector3();
/** Bounds queries are synchronous; only each root's retained results survive. */
function refreshBounds(root: THREE.Object3D, groups: AssetLodGroup[], cached: LodBounds): void {
  root.updateMatrixWorld(true);
  cached.matrix.copy(root.matrixWorld);
  for (let index = 0; index < groups.length; index++) {
    lodBox.makeEmpty(); for (const node of groups[index].levels[0].nodes) lodBox.expandByObject(node);
    const bounds = cached.groups[index];
    bounds.size = lodBox.getSize(lodSize).length(); lodBox.getCenter(bounds.center);
  }
}
/** Call once per frame for placed assemblies; authored screen-height thresholds remain intact. */
export function updateAssetLods(root: THREE.Object3D, camera: THREE.Camera): void {
  const groups = root.userData.lods as AssetLodGroup[] | undefined;
  if (!groups?.length) return;
  root.updateWorldMatrix(true, false);
  let cached = lodBounds.get(root);
  if (!cached || cached.groups.length !== groups.length) {
    cached = { matrix: new THREE.Matrix4(), groups: groups.map(() => ({ size: 0, center: new THREE.Vector3() })) };
    lodBounds.set(root, cached);
    // Newly allocated records must be filled even when the root is at identity.
    refreshBounds(root, groups, cached);
  } else if (root.userData.lodSkinned || !cached.matrix.equals(root.matrixWorld)) {
    refreshBounds(root, groups, cached);
  }
  // Orthographic thresholds depend on view height, never the camera position.
  if (camera instanceof THREE.PerspectiveCamera) camera.getWorldPosition(lodEye);
  for (const [index, group] of groups.entries()) {
    const { size, center } = cached.groups[index];
    const fraction = camera instanceof THREE.OrthographicCamera ? size / ((camera.top - camera.bottom) / camera.zoom)
      : camera instanceof THREE.PerspectiveCamera ? size / (2 * Math.max(0.01, lodEye.distanceTo(center)) * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) : 1;
    const selected = group.levels.findIndex(level => fraction >= level.height);
    for (let i = 0; i < group.levels.length; i++) for (const node of group.levels[i].nodes) node.visible = i === selected;
  }
}
