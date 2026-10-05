import { ClampToEdgeWrapping, DataTexture, LinearFilter, NoColorSpace, RGBAFormat, UnsignedByteType } from 'three';
import type { GroundPatch, GroundPath } from '../levels/types';

/** Static authoring work becomes one filtered lookup instead of hundreds of
 * per-fragment patch/path expressions. Rebuild only when the area is prepared. */
export function prepareGroundCoverage(patches: GroundPatch[], paths: GroundPath[], min: [number, number], span: [number, number]) {
  const size = 512, bytes = new Uint8Array(size * size * 4);
  const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const noise = (x: number, z: number) => Math.sin(x * 1.13 + Math.sin(z * .71)) * Math.sin(z * 1.31 + Math.sin(x * .83));
  const bounds = (x: number, z: number, radius: number) => [Math.max(0, Math.floor((x - radius - min[0]) / span[0] * size)), Math.min(size - 1, Math.ceil((x + radius - min[0]) / span[0] * size)), Math.max(0, Math.floor((z - radius - min[1]) / span[1] * size)), Math.min(size - 1, Math.ceil((z + radius - min[1]) / span[1] * size))];
  for (const patch of patches) {
    const channel = patch.layer === 'litter' ? 0 : patch.layer === 'rocky-soil' ? 1 : 2;
    const [x0, x1, y0, y1] = bounds(...patch.center, patch.radius * 1.12);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const wx = min[0] + (x + .5) / size * span[0], wz = min[1] + (y + .5) / size * span[1];
      const distance = Math.hypot(wx - patch.center[0], wz - patch.center[1]) / patch.radius + noise(wx, wz) * .07;
      const weight = (1 - smooth(.35, 1, distance)) * patch.strength, index = (y * size + x) * 4;
      bytes[index + channel] = Math.max(bytes[index + channel], Math.round(weight * 255));
      if (patch.wetness) bytes[index + 3] = Math.max(bytes[index + 3], Math.round(weight * patch.wetness * 255));
    }
  }
  for (const path of paths) for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1], b = path.points[i], dx = b[0] - a[0], dz = b[1] - a[1], length = dx * dx + dz * dz;
    const [x0, x1, y0, y1] = bounds((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.sqrt(length) / 2 + path.width);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const wx = min[0] + (x + .5) / size * span[0], wz = min[1] + (y + .5) / size * span[1];
      const t = length ? Math.max(0, Math.min(1, ((wx - a[0]) * dx + (wz - a[1]) * dz) / length)) : 0;
      const distance = Math.hypot(wx - a[0] - dx * t, wz - a[1] - dz * t) + noise(wx, wz) * .06;
      const weight = (1 - smooth(path.width * .36, path.width * .66, distance)) * path.strength, index = (y * size + x) * 4 + 2;
      bytes[index] = Math.max(bytes[index], Math.round(weight * 255));
    }
  }
  const map = new DataTexture(bytes, size, size, RGBAFormat, UnsignedByteType);
  map.colorSpace = NoColorSpace; map.wrapS = map.wrapT = ClampToEdgeWrapping;
  map.minFilter = map.magFilter = LinearFilter; map.needsUpdate = true;
  return { map, min, span };
}
