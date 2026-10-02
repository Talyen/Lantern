import type * as THREE from 'three';
import { mix, vec2, vec3, float, color as surfaceColor, smoothstep, mx_noise_float, positionWorld, normalMap, texture, dFdx, dFdy } from 'three/tsl';
import earthUrl from '../../assets/textures/environment/showcase/earth-v2.png?url';
import litterUrl from '../../assets/textures/environment/showcase/litter-v2.png?url';
import rockyUrl from '../../assets/textures/environment/showcase/rocky-soil-v2.png?url';
import earthNormal from '../../assets/textures/environment/ground/earth-normal.png?url';
import earthData from '../../assets/textures/environment/ground/earth-surface.png?url';
import litterNormal from '../../assets/textures/environment/ground/litter-normal.png?url';
import litterData from '../../assets/textures/environment/ground/litter-surface.png?url';
import rockyNormal from '../../assets/textures/environment/ground/rocky-soil-normal.png?url';
import rockyData from '../../assets/textures/environment/ground/rocky-soil-surface.png?url';
import { Fn } from 'three/tsl';
import { type Node, type NodeBuilder } from 'three/webgpu';
import { reliefUV, reliefSample, surfaceBias } from './surface-detail';
import type { GroundLayer, GroundPatch } from '../levels/types';

export const woodlandLayerUrls: Record<GroundLayer, string> = { earth: earthUrl, litter: litterUrl, 'rocky-soil': rockyUrl };
const fields = { earth: [earthNormal, earthData], litter: [litterNormal, litterData], 'rocky-soil': [rockyNormal, rockyData] };
export const woodlandGroundRecipe = { scales: { earth: .29, litter: .64, 'rocky-soil': .48 }, depths: { earth: .015, litter: .045, 'rocky-soil': .045 }, edge: 1.1, tint: .08, litterSaturation: .72, litterValue: .86, heightBlend: .12, normalStrength: { earth: .45, litter: .8, 'rocky-soil': .8 } };
type WoodlandGroundRecipe = typeof woodlandGroundRecipe & { wornTint?: string; wornTintStrength?: number };
// Clearing is the first composed material study. Other areas retain their
// accepted treatment until the same art pass is deliberately authored there.
const clearingGroundRecipe = { ...woodlandGroundRecipe, scales: { earth: .16, litter: .3, 'rocky-soil': .26 }, litterSaturation: .92, litterValue: .97, wornTint: '#96856a', wornTintStrength: .32, normalStrength: { earth: .3, litter: .85, 'rocky-soil': .85 } };
export function woodlandGroundRecipeFor(area: string): WoodlandGroundRecipe { return area === 'clearing' ? clearingGroundRecipe : woodlandGroundRecipe; }

export function woodlandPatchWeight(patch: Pick<GroundPatch, 'center' | 'radius' | 'strength'>) {
  const ground = positionWorld.xz;
  const edge = mx_noise_float(ground.mul(woodlandGroundRecipe.edge).add(vec2(11, 31))).mul(.11);
  const distance = ground.sub(vec2(...patch.center)).length().div(patch.radius).add(edge);
  return smoothstep(.35, 1, distance).oneMinus().mul(patch.strength);
}
/** One coherent projection per layer preserves individual painted features instead of double-image crossfades. */
export function woodlandMaterial(load: (url: string, data: boolean) => THREE.Texture, patches: GroundPatch[], recipe: WoodlandGroundRecipe = woodlandGroundRecipe) {
  let litter: Node<'float'> = float(0), rocky: Node<'float'> = float(0), worn: Node<'float'> = float(0);
  for (const patch of patches) {
    const weight = woodlandPatchWeight(patch);
    if (patch.layer === 'litter') litter = litter.max(weight);
    else if (patch.layer === 'rocky-soil') rocky = rocky.max(weight);
    else worn = worn.max(weight);
  }
  litter = litter.mul(worn.oneMinus()); rocky = rocky.mul(worn.oneMinus());
  const layer = (kind: GroundLayer, coverage: typeof litter) => {
    const coords = positionWorld.xz.mul(recipe.scales[kind]);
    const data = load(fields[kind][1], true), map = load(woodlandLayerUrls[kind], false), normal = load(fields[kind][0], true);
    const displaced = reliefUV(data, coords, recipe.depths[kind], coverage).toVar();
    let color = reliefSample(map, coords, displaced).rgb;
    if (kind === 'litter') color = mix(vec3(color.dot(vec3(.2126, .7152, .0722))), color, recipe.litterSaturation).mul(recipe.litterValue);
    const field = reliefSample(data, coords, displaced);
    const surfaceNormal = Fn((builder: NodeBuilder) => {
      const scale = surfaceBias(builder).exp2();
      return normalMap(texture(normal, displaced).grad(dFdx(coords).mul(scale), dFdy(coords).mul(scale)), vec2(recipe.normalStrength[kind]));
    })();
    return { color, field, normal: surfaceNormal as unknown as Node<'vec3'> };
  };
  const earth = layer('earth', float(1)), leaves = layer('litter', litter), stone = layer('rocky-soil', rocky);
  // Compacted soil reads as a continuous dusty approach. Authored wear coverage
  // quiets only that soil, retaining painted marks and the surrounding leaf banks.
  const compacted = recipe.wornTint && recipe.wornTintStrength ? mix(earth.color, surfaceColor(recipe.wornTint), worn.mul(recipe.wornTintStrength)) : earth.color;
  const weight = (coverage: typeof litter, raised: typeof earth.field) => {
    const detail = raised.r.sub(earth.field.r).mul(recipe.heightBlend);
    return smoothstep(.08, .92, coverage.add(detail.mul(coverage).mul(coverage.oneMinus())));
  };
  const lw = weight(litter, leaves.field), rw = weight(rocky, stone.field).mul(lw.oneMinus());
  return {
    color: mix(mix(compacted, leaves.color, lw), stone.color, rw),
    normal: mix(mix(earth.normal, leaves.normal, lw), stone.normal, rw).normalize(),
    roughness: mix(mix(earth.field.g, leaves.field.g, lw), stone.field.g, rw),
    cavity: mix(mix(earth.field.b, leaves.field.b, lw), stone.field.b, rw),
  };
}
