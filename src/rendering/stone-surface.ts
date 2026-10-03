import type * as THREE from 'three';
import { positionLocal, normalGeometry, vec3, vec2 } from 'three/tsl';
import stoneV1 from '../../assets/textures/environment/stone-v1.png?url';
import stoneV2 from '../../assets/textures/environment/showcase/stone-v2.png?url';
import normalV1 from '../../assets/textures/environment/ground/stone-v1-normal.png?url';
import normalV2 from '../../assets/textures/environment/ground/stone-v2-normal.png?url';
import fieldV1 from '../../assets/textures/environment/ground/stone-v1-surface.png?url';
import fieldV2 from '../../assets/textures/environment/ground/stone-v2-surface.png?url';
import { mappedSurfaceNormal, surfaceSample } from './surface-detail';

export const stoneSurfaceRecipe = { scale: .45, normalStrength: 1 };

/** Color and material fields share each local projection; blended normals are
 * transformed by that projection's derivatives, not the mesh's unrelated UV0. */
export function stoneSurface(load: (url: string, data: boolean) => THREE.Texture, study: boolean) {
  const color = load(study ? stoneV2 : stoneV1, false), normal = load(study ? normalV2 : normalV1, true), field = load(study ? fieldV2 : fieldV1, true);
  const position = positionLocal.mul(stoneSurfaceRecipe.scale);
  const weight = normalGeometry.abs().div(normalGeometry.abs().dot(vec3(1)));
  const axes = [position.yz, position.zx, position.xy];
  const colors = axes.map(coords => surfaceSample(color, coords).rgb);
  const fields = axes.map(coords => surfaceSample(field, coords));
  const normals = axes.map(coords => mappedSurfaceNormal(surfaceSample(normal, coords), coords, vec2(stoneSurfaceRecipe.normalStrength)));
  return {
    color: colors[0].mul(weight.x).add(colors[1].mul(weight.y)).add(colors[2].mul(weight.z)),
    normal: normals[0].mul(weight.x).add(normals[1].mul(weight.y)).add(normals[2].mul(weight.z)).normalize(),
    roughness: fields[0].g.mul(weight.x).add(fields[1].g.mul(weight.y)).add(fields[2].g.mul(weight.z)),
    cavity: fields[0].b.mul(weight.x).add(fields[1].b.mul(weight.y)).add(fields[2].b.mul(weight.z)).max(.86),
  };
}
