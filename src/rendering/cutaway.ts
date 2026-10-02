import * as THREE from 'three';
/** Camera cutaways retain real opaque geometry in shadow and irradiance captures. */
export const lightingOnlyLayer = 1;
export function lightingOnly(root: THREE.Object3D): void {
  root.traverse(object => { object.layers.set(lightingOnlyLayer); object.userData.lightingOnly = true; });
}
export function restoreBakeVisibility(root: THREE.Object3D): void {
  root.traverse(object => { if (object.userData.lightingOnly) object.layers.set(0); });
}
export function includeCutawayShadows(light: THREE.DirectionalLight | THREE.PointLight): void {
  light.shadow.camera.layers.enable(lightingOnlyLayer);
}
