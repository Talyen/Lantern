import type { Node } from 'three/webgpu';
import type { AreaDefinition, RainShelter } from './types';
import { float, positionWorld, vec2, smoothstep } from 'three/tsl';

export const shelterFeather = .5;
export function rainShelters(area: AreaDefinition, restored: boolean): RainShelter[] {
  return (area.effects.weather?.shelters ?? []).filter(s => !s.restoredOnly || restored);
}
/** Signed horizontal distance: zero at the roof edge, negative beneath cover. */
export function shelterDistance(s: RainShelter, x: number, z: number): number {
  const dx = x - s.center[0], dz = z - s.center[1];
  if (!s.halfSize) return Math.hypot(dx, dz) - s.radius;
  const c = Math.cos(s.yaw ?? 0), n = Math.sin(s.yaw ?? 0);
  return Math.max(Math.abs(dx*c-dz*n)-s.halfSize[0], Math.abs(dx*n+dz*c)-s.halfSize[1]);
}
export function rainExposure(shelters: readonly RainShelter[], x: number, z: number): number {
  let exposure = 1;
  for (const s of shelters) { const t = Math.max(0, Math.min(1, shelterDistance(s,x,z) / shelterFeather)); exposure = Math.min(exposure, t*t*(3-2*t)); }
  return exposure;
}
/** The same footprint and edge feather as listener/particle exposure, without texture uploads. */
export function rainExposureNode(shelters: readonly RainShelter[]) {
  let exposure: Node<'float'> = float(1);
  for (const s of shelters) {
    const p = positionWorld.xz.sub(vec2(...s.center)), c = Math.cos(s.yaw ?? 0), n = Math.sin(s.yaw ?? 0);
    const distance = s.halfSize ? p.x.mul(c).sub(p.y.mul(n)).abs().sub(s.halfSize[0]).max(p.x.mul(n).add(p.y.mul(c)).abs().sub(s.halfSize[1])) : p.length().sub(s.radius);
    exposure = exposure.min(smoothstep(0,shelterFeather,distance));
  }
  return exposure;
}
