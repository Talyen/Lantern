import * as THREE from 'three';
import { mix, texture, vec2, vec3, smoothstep, mx_noise_float, positionWorld } from 'three/tsl';
import earthUrl from '../../assets/textures/environment/showcase/earth-v2.png?url';
import litterUrl from '../../assets/textures/environment/showcase/litter-v2.png?url';
import rockyUrl from '../../assets/textures/environment/showcase/rocky-soil-v2.png?url';
import type { GroundLayer, GroundPatch } from '../levels/types';

export const woodlandLayerUrls: Record<GroundLayer, string> = { earth: earthUrl, litter: litterUrl, 'rocky-soil': rockyUrl };
export const woodlandGroundRecipe = { scales: { earth: .29, litter: .64, 'rocky-soil': .48 }, variation: .37, edge: 1.1, tint: .08, litterSaturation: .72, litterValue: .86 };

/** Shared metre-scale material samples; area authoring decides where detail gathers. */
export function woodlandLayer(map: THREE.Texture, layer: GroundLayer) {
  const ground = positionWorld.xz, scale = woodlandGroundRecipe.scales[layer];
  const variation = mx_noise_float(ground.mul(woodlandGroundRecipe.variation).add(vec2(29, 7))).mul(.5).add(.5);
  const rotated = vec2(ground.x.mul(.8).sub(ground.y.mul(.6)), ground.x.mul(.6).add(ground.y.mul(.8))).mul(scale).add(vec2(.31, .57));
  const sampled = mix(texture(map, ground.mul(scale)).rgb, texture(map, rotated).rgb, smoothstep(.25, .75, variation));
  if (layer !== 'litter') return sampled;
  const gray = sampled.dot(vec3(.2126, .7152, .0722));
  return mix(vec3(gray), sampled, woodlandGroundRecipe.litterSaturation).mul(woodlandGroundRecipe.litterValue);
}

export function woodlandPatchWeight(patch: Pick<GroundPatch, 'center' | 'radius' | 'strength'>) {
  const ground = positionWorld.xz;
  const edge = mx_noise_float(ground.mul(woodlandGroundRecipe.edge).add(vec2(11, 31))).mul(.11);
  const distance = ground.sub(vec2(...patch.center)).length().div(patch.radius).add(edge);
  return smoothstep(.35, 1, distance).oneMinus().mul(patch.strength);
}

export function woodlandPatchColor(sample: ReturnType<typeof woodlandLayer>, patch: GroundPatch) {
  return mix(sample, vec3(...new THREE.Color(patch.color).toArray()), woodlandGroundRecipe.tint);
}
