import * as THREE from 'three';

const owned = new WeakSet<THREE.Texture>();
const imageOwners = new WeakMap<object, number>();
/** Texture clones can share a bitmap. Close it only after the last owned texture is disposed. */
export function ownTexture(texture: THREE.Texture): THREE.Texture {
  if (owned.has(texture)) return texture;
  owned.add(texture);
  const image = texture.image as { close?: () => void } | undefined;
  if (image && typeof image.close === 'function') {
    imageOwners.set(image, (imageOwners.get(image) ?? 0) + 1);
    let disposed = false;
    texture.addEventListener('dispose', () => {
      if (disposed) return; disposed = true;
      const remaining = (imageOwners.get(image) ?? 1) - 1;
      if (remaining) imageOwners.set(image, remaining);
      else { imageOwners.delete(image); image.close!(); }
    });
  }
  return texture;
}
export function sceneTextures(root: THREE.Object3D): Set<THREE.Texture> {
  const textures = new Set<THREE.Texture>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(ownTexture(value));
    }
  });
  return textures;
}
/** Release native bindings; plain scene clones borrow skeletons as well as art. */
export function disposeSceneInstances(root: THREE.Object3D, { skeletons = false }: { skeletons?: boolean } = {}): void {
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    object.dispose();
    if (skeletons && object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
  });
}
export function disposeSceneResources(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  const textures = sceneTextures(root);
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
  });
  disposeSceneInstances(root, { skeletons: true });
  geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose()); textures.forEach(texture => texture.dispose());
}
export function sceneResourceBytes(root: THREE.Object3D): number {
  let bytes = 0; const geometries = new Set<THREE.BufferGeometry>();
  root.traverse(object => { if (object instanceof THREE.Mesh) geometries.add(object.geometry); });
  for (const geometry of geometries) {
    if (geometry.index) bytes += geometry.index.array.byteLength;
    for (const value of Object.values(geometry.attributes)) { const attribute = value as THREE.BufferAttribute | THREE.InterleavedBufferAttribute; bytes += attribute instanceof THREE.InterleavedBufferAttribute ? attribute.data.array.byteLength : attribute.array.byteLength; }
  }
  for (const texture of sceneTextures(root)) {
    if (texture instanceof THREE.CompressedTexture) bytes += texture.mipmaps.reduce((sum, mip) => sum + mip.data.byteLength, 0);
    else if (texture.image) { const image = texture.image as { width: number; height: number }; bytes += image.width * image.height * 4 * (texture.generateMipmaps ? 4 / 3 : 1); }
  }
  return bytes;
}
