import { unmatchedMotionNode } from '../animation/rig-bindings';
import * as THREE from 'three';
import type { RuntimeAssets } from '../assets/runtime-assets';
import { disposeSceneInstances, isMesh } from '../assets/resource-ownership';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { markOutline } from './outlines';
import type { Shop } from '../levels/types';

/** One area-owned NPC with its own verified, packed Mixamo idle. */
export async function createMerchant(shop: Shop, resources: RuntimeAssets) {
  const lease = resources.acquireRig(shop.merchant.model, false);
  let gltf: Awaited<typeof lease.ready>;
  try { gltf = await lease.ready; } catch (error) { lease.release(); throw error; }
  const root = new THREE.Group(), model = clone(gltf.scene);
  root.name = 'merchant'; root.userData.transient = true; root.add(model);
  const mixer = new THREE.AnimationMixer(model);
  try {
    const idle = gltf.animations.find(clip => clip.name === 'idle');
    if (!idle || unmatchedMotionNode(model, [idle]) !== undefined)
      throw new Error('Prepare the Peasant Man and compatible neutral idle with npm run assets:export-merchant.');
    mixer.clipAction(idle).play(); mixer.update(0);
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model), size = bounds.getSize(new THREE.Vector3());
    if (size.y <= 0) throw new Error('Merchant model has no visible height.');
    model.scale.multiplyScalar(shop.merchant.height / size.y); model.updateMatrixWorld(true);
    bounds.setFromObject(model); const center = bounds.getCenter(new THREE.Vector3());
    model.position.sub(new THREE.Vector3(center.x, bounds.min.y, center.z));
    root.position.set(shop.merchant.position[0], .02, shop.merchant.position[1]); root.rotation.y = shop.merchant.yaw;
    model.traverse(object => { if (isMesh(object)) { object.castShadow = true; object.receiveShadow = true; } });
    markOutline(model, 'actor');
    return { root, update: (dt: number) => mixer.update(dt), dispose: () => {
      mixer.stopAllAction(); mixer.uncacheRoot(model); root.removeFromParent(); disposeSceneInstances(model, { skeletons: true }); lease.release();
    } };
  } catch (error) { mixer.stopAllAction(); mixer.uncacheRoot(model); disposeSceneInstances(model, { skeletons: true }); lease.release(); throw error; }
}
