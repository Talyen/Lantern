import { prepareGroundCoverage } from './ground-coverage';
import type * as THREE from 'three';
import { mix, vec2, vec3, float, smoothstep, mx_noise_float, positionWorld, texture, dFdx, dFdy } from 'three/tsl';
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
import { reliefUV, reliefSample, surfaceBias, mappedSurfaceNormal } from './surface-detail';
import type { GroundLayer, GroundPatch, GroundPath } from '../levels/types';
import { materialRecipes } from './material-recipes';
import { calibrationGain } from './material-calibration';

export const woodlandLayerUrls: Record<GroundLayer, string> = { earth: earthUrl, litter: litterUrl, 'rocky-soil': rockyUrl };
const fields = { earth: [earthNormal, earthData], litter: [litterNormal, litterData], 'rocky-soil': [rockyNormal, rockyData] };
export const woodlandTextureInputs: [string, boolean, string][] = [
  [earthUrl, false, '/assets/textures/environment/showcase/earth-v2.png'],
  [litterUrl, false, '/assets/textures/environment/showcase/litter-v2.png'],
  [rockyUrl, false, '/assets/textures/environment/showcase/rocky-soil-v2.png'],
  [earthNormal, true, '/assets/textures/environment/ground/earth-normal.png'],
  [earthData, true, '/assets/textures/environment/ground/earth-surface.png'],
  [litterNormal, true, '/assets/textures/environment/ground/litter-normal.png'],
  [litterData, true, '/assets/textures/environment/ground/litter-surface.png'],
  [rockyNormal, true, '/assets/textures/environment/ground/rocky-soil-normal.png'],
  [rockyData, true, '/assets/textures/environment/ground/rocky-soil-surface.png'],
];
export const woodlandGroundRecipe = { ...materialRecipes.ground.default, edge: 1.1, heightBlend: .12 };
type WoodlandGroundRecipe = typeof woodlandGroundRecipe;
// Clearing is the first composed material study. Other areas retain their
// accepted treatment until the same art pass is deliberately authored there.
const clearingGroundRecipe = { ...woodlandGroundRecipe, ...materialRecipes.ground.clearing };
export function woodlandGroundRecipeFor(area: string): WoodlandGroundRecipe { return area === 'clearing' ? clearingGroundRecipe : woodlandGroundRecipe; }

export function woodlandPatchWeight(patch: Pick<GroundPatch, 'center' | 'radius' | 'strength'>) {
  const ground = positionWorld.xz;
  const edge = mx_noise_float(ground.mul(woodlandGroundRecipe.edge).add(vec2(11, 31))).mul(.11);
  const distance = ground.sub(vec2(...patch.center)).length().div(patch.radius).add(edge);
  return smoothstep(.35, 1, distance).oneMinus().mul(patch.strength);
}
/** One coherent projection per layer preserves individual painted features instead of double-image crossfades. */
export function woodlandMaterial(load: (url: string, data: boolean) => THREE.Texture, patches: GroundPatch[], recipe: WoodlandGroundRecipe = woodlandGroundRecipe, paths: GroundPath[] = [], bankWetness?: Node<'float'>, bounds: { min: [number, number]; span: [number, number] } = { min: [-64, -64], span: [128, 128] }, rainWetness?: Node<'float'>) {
  const coverage = prepareGroundCoverage(patches, paths, bounds.min, bounds.span);
  const weights = texture(coverage.map, positionWorld.xz.sub(vec2(...bounds.min)).div(vec2(...bounds.span)));
  const wet: Node<'float'> = (bankWetness ?? float(0)).max(weights.a).max(rainWetness ?? float(0));
  let litter: Node<'float'> = weights.r, rocky: Node<'float'> = weights.g;
  const worn = weights.b;
  litter = litter.mul(worn.oneMinus()); rocky = rocky.mul(worn.oneMinus());
  const layer = (kind: GroundLayer, coverage: typeof litter) => {
    const coords = positionWorld.xz.mul(recipe.scales[kind]);
    const data = load(fields[kind][1], true), map = load(woodlandLayerUrls[kind], false), normal = load(fields[kind][0], true);
    const family = materialRecipes.families[kind], gain = calibrationGain(kind).mul(recipe.relief);
    const displaced = reliefUV(data, coords, family.heightMetres, coverage, 'a', gain).toVar();
    let color = reliefSample(map, coords, displaced).rgb;
    if (kind === 'litter') color = mix(vec3(color.dot(vec3(.2126, .7152, .0722))), color, recipe.litterSaturation).mul(recipe.litterValue);
    const field = reliefSample(data, coords, displaced);
    const surfaceNormal = Fn((builder: NodeBuilder) => {
      const scale = surfaceBias(builder).exp2();
      const correction = recipe.scales[kind] / materialRecipes.groundBakeScales[kind];
      return mappedSurfaceNormal(texture(normal, displaced).grad(dFdx(coords).mul(scale), dFdy(coords).mul(scale)), coords, vec2(family.normalStrength * correction).mul(gain));
    })();
    return { color, field, normal: surfaceNormal };
  };
  if (bankWetness) { const bed = smoothstep(.4, .82, bankWetness); litter = litter.mul(bed.oneMinus()); rocky = rocky.max(bed.mul(.85)); }
  const earth = layer('earth', float(1)), leaves = layer('litter', litter), stone = layer('rocky-soil', rocky);
  const weight = (coverage: typeof litter, raised: typeof earth.field) => {
    const detail = raised.r.sub(earth.field.r).mul(recipe.heightBlend);
    return smoothstep(.08, .92, coverage.add(detail.mul(coverage).mul(coverage.oneMinus())));
  };
  const lw = weight(litter, leaves.field), rw = weight(rocky, stone.field).mul(lw.oneMinus());
  return {
    coverageMap: coverage.map,
    color: mix(mix(earth.color, leaves.color, lw), stone.color, rw).mul(float(1).sub(wet.mul(.13))),
    normal: mix(mix(earth.normal, leaves.normal, lw), stone.normal, rw).normalize(),
    roughness: mix(mix(earth.field.g, leaves.field.g, lw), stone.field.g, rw).mul(float(1).sub(wet.mul(.48))),
    cavity: mix(mix(earth.field.b, leaves.field.b, lw), stone.field.b, rw),
  };
}
