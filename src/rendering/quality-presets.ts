import { DirectionalLight, PointLight, type Scene } from 'three/webgpu';
export const qualityLevels = ['low', 'medium', 'high'] as const;
export type QualityLevel = typeof qualityLevels[number];
export const shadowPresets = {
  low: { sunMap: 1024, localMap: 256 },
  medium: { sunMap: 2048, localMap: 512 },
  high: { sunMap: 2048, localMap: 1024 },
} as const;
export const particlePresets = {
  low: { capacity: .5, emission: .55, weather: 24 },
  medium: { capacity: .75, emission: .75, weather: 40 },
  high: { capacity: 1, emission: 1, weather: 60 },
} as const;
/** Keep authored shadow coverage, bias and softness; change only sampling cost. */
export function applyShadowQuality(scene: Scene, quality: QualityLevel): void {
  const preset = shadowPresets[quality];
  scene.traverse(object => {
    if (!(object instanceof DirectionalLight || object instanceof PointLight) || !object.castShadow) return;
    const shadow = object.shadow;
    const size = object instanceof DirectionalLight ? preset.sunMap : preset.localMap;
    if (shadow.mapSize.x !== size || shadow.mapSize.y !== size) {
      // Native shadow nodes retain these target objects. setSize disposes the
      // old GPU allocations and recreates them without breaking node references.
      shadow.map?.setSize(size, size, shadow.map.depth);
      shadow.mapPass?.setSize(size, size, shadow.mapPass.depth);
      shadow.mapSize.set(size, size); shadow.needsUpdate = true;
    }
  });
}
