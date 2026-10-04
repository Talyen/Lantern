import * as THREE from 'three';

// Upstream instanceof declarations widen generic resources to any. These guards
// retain the same constructor checks with the runtime's concrete resource types.
export function isMesh(value: unknown): value is THREE.Mesh { return value instanceof THREE.Mesh; }
export function isTexture(value: unknown): value is THREE.Texture { return value instanceof THREE.Texture; }
export function isLine(value: unknown): value is THREE.Line { return value instanceof THREE.Line; }

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
function sceneResources(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  root.traverse(object => {
    if (!isMesh(object)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
  });
  for (const material of materials)
    for (const value of Object.values(material)) if (isTexture(value)) textures.add(ownTexture(value));
  return { geometries, materials, textures };
}
export function sceneTextures(root: THREE.Object3D): Set<THREE.Texture> { return sceneResources(root).textures; }
/** Release native bindings; plain scene clones borrow skeletons as well as art. */
export function disposeSceneInstances(root: THREE.Object3D, { skeletons = false }: { skeletons?: boolean } = {}): void {
  const ownedSkeletons = new Set<THREE.Skeleton>();
  root.traverse(object => {
    if (!isMesh(object)) return;
    object.dispose();
    if (skeletons && object instanceof THREE.SkinnedMesh) ownedSkeletons.add(object.skeleton);
  });
  for (const skeleton of ownedSkeletons) skeleton.dispose();
}
export function disposeSceneResources(root: THREE.Object3D): void {
  const { geometries, materials, textures } = sceneResources(root);
  disposeSceneInstances(root, { skeletons: true });
  geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose()); textures.forEach(texture => texture.dispose());
}
export function sceneResourceBytes(root: THREE.Object3D): number {
  let bytes = 0;
  const { geometries, textures } = sceneResources(root);
  for (const geometry of geometries) {
    if (geometry.index) bytes += geometry.index.array.byteLength;
    for (const value of Object.values(geometry.attributes)) { const attribute = value; bytes += attribute instanceof THREE.InterleavedBufferAttribute ? attribute.data.array.byteLength : attribute.array.byteLength; }
  }
  for (const texture of textures) {
    if (texture instanceof THREE.CompressedTexture) bytes += texture.mipmaps.reduce((sum, mip) => sum + mip.data.byteLength, 0);
    else if (texture.image) { const image = texture.image as { width: number; height: number }; bytes += image.width * image.height * 4 * (texture.generateMipmaps ? 4 / 3 : 1); }
  }
  return bytes;
}
