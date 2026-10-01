import { Color, type Object3D, type Node, type TextureNode } from 'three/webgpu';
import { Fn, float, mix, screenUV, smoothstep, uniform, vec2, vec4 } from 'three/tsl';

// Kept on instances, never shared materials: an excluded prop can reuse an actor's material.
export function markOutline(root: Object3D, role: 'actor' | 'prop'): void {
  root.traverse(object => { if ('isMesh' in object) object.userData.outlineStrength = role === 'actor' ? .68 : .32; });
}

/** MRT input defaults to zero for terrain, vegetation and effects, including newly loaded objects. */
export function outlineStrength() {
  return uniform(0).onObjectUpdate(({ object, material }) => material?.transparent ? 0 : Number(object?.userData.outlineStrength ?? 0));
}

/** Inward contours share the beauty pass's cutouts, deformation, depth, velocity and jitter. */
export function outlinedColor(color: TextureNode, mask: TextureNode, depth: TextureNode, viewDistance: (depth: Node<'float'>) => Node<'float'>, scale: Node<'float'>, texel: Node<'vec2'>) {
  const charcoal = uniform(new Color('#302a24'));
  return Fn(() => {
    const center = mask.sample(screenUV).r.toVar();
    const z = viewDistance(depth.sample(screenUV).r).toVar();
    // A footprint of at least one scene texel keeps Balanced/Performance contours sampled.
    // At Native/Quality the intended width is 1.7 output pixels; coverage remains fractional.
    const step = texel.mul(scale.mul(1.7).max(1));
    const edge = float(0).toVar();
    for (const [x, y] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      const offset = step.mul(vec2(x, y).normalize());
      const a = mask.sample(screenUV.add(offset)).r, b = mask.sample(screenUV.sub(offset)).r;
      const za = viewDistance(depth.sample(screenUV.add(offset)).r), zb = viewDistance(depth.sample(screenUV.sub(offset)).r);
      // Positive curvature detects foreground-to-background depth breaks without drawing
      // every planar slope/faceted normal. Mask loss also catches contacts with excluded ground.
      const curvature = za.add(zb).sub(z.mul(2)).max(0);
      const silhouette = center.sub(a.min(b)).div(center.max(.001)).clamp(0, 1);
      // Average angular coverage rather than letting one crossing sample snap the entire
      // contour on. Depth contours only fill gaps between eligible surfaces; excluded
      // ground/sky boundaries already have the softer mask coverage above.
      const eligible = a.min(b).div(center.max(.001)).clamp(0, 1);
      edge.addAssign(silhouette.max(smoothstep(.18, .45, curvature).mul(eligible)).mul(.25));
    }
    const coverage = smoothstep(.05, .95, edge).mul(center);
    const beauty = color.sample(screenUV);
    // Darken only; charcoal must not become a light rim in deep shadow.
    return vec4(mix(beauty.rgb, beauty.rgb.min(charcoal.rgb), coverage), beauty.a);
  })();
}
