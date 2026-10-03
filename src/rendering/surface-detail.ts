import { isMesh } from '../assets/resource-ownership';
import * as THREE from 'three';
import { Fn, If, Loop, float, vec2, vec3, color, uniform, uv, texture, dFdx, dFdy, positionView, positionViewDirection, normalViewGeometry, cross, dot, normalMap, negateOnBackSide } from 'three/tsl';
import { MeshStandardNodeMaterial, type Node, type NodeBuilder } from 'three/webgpu';

type SurfaceContext = { materialMipBias?: Node<'float'>; textureDepth?: boolean };
// The pinned r186 builder exposes this method; its declarations omit it.
type SurfaceBuilder = NodeBuilder & { isFlatShading(): boolean };
/** Material textures only: depth, data buffers and reconstruction samplers keep their own policy. */
export function filterMaterialTexture(map: THREE.Texture): THREE.Texture {
  if (!map.isRenderTargetTexture && !(map instanceof THREE.DepthTexture) && (map.generateMipmaps || map.mipmaps.length > 1)) {
    map.anisotropy = 16; map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearMipmapLinearFilter;
  }
  return map;
}
export function surfaceBias(builder: NodeBuilder): Node<'float'> { return (builder.context as SurfaceContext).materialMipBias ?? float(0); }
/** TextureNode does not apply a texture matrix when given explicit coordinates. */
export function surfaceUV(map: THREE.Texture): Node<'vec2'> {
  if (map.matrixAutoUpdate) map.updateMatrix();
  return uniform(map.matrix).mul(vec3(uv(map.channel), 1)).xy;
}
/** r186's normalMap() derives its tangent frame from UV0, even for other UV
 * channels or world projections. Use the coordinates which authored this map. */
export function mappedSurfaceNormal(sample: Node<'vec4'>, coordinates: Node<'vec2'>, strength: Node<'vec2'>): Node<'vec3'> {
  return Fn((builder: NodeBuilder) => {
    // Preserve r186's flat/double-sided conventions while replacing only UV0.
    const flat = (builder as SurfaceBuilder).isFlatShading();
    const n = flat ? normalViewGeometry : negateOnBackSide(normalViewGeometry);
    const px = dFdx(positionView), py = dFdy(positionView), dx = dFdx(coordinates), dy = dFdy(coordinates);
    const a = cross(py, n), b = cross(n, px);
    const t = a.mul(dx.x).add(b.mul(dy.x)), bt = a.mul(dx.y).add(b.mul(dy.y));
    const scale = dot(t, t).max(dot(bt, bt)).max(1e-12).inverseSqrt();
    const tangent = flat ? t : negateOnBackSide(t), bitangent = flat ? bt : negateOnBackSide(bt);
    const normal = sample.rgb.mul(2).sub(1), amount = flat ? negateOnBackSide(vec3(strength, 1)).xy : strength;
    return tangent.mul(normal.x.mul(amount.x)).add(bitangent.mul(normal.y.mul(amount.y))).mul(scale).add(n.mul(normal.z)).normalize();
  })();
}
export function surfaceSample(map: THREE.Texture, coordinates: Node<'vec2'> = surfaceUV(map)) {
  filterMaterialTexture(map);
  return Fn((builder: NodeBuilder) => texture(map, coordinates).bias(surfaceBias(builder)))();
}
/** Use physical surface gradients so depth remains in metres across UV islands and world-space terrain. */
export function reliefUV(map: THREE.Texture, coordinates: Node<'vec2'>, depth: number, coverage: Node<'float'> = float(1), maskChannel: 'a' | 'b' = 'a') {
  filterMaterialTexture(map);
  return Fn((builder: NodeBuilder) => {
    if (!(builder.context as SurfaceContext).textureDepth || depth <= 0) return coordinates;
    // Derivatives precede all varying control flow; all loop reads use explicit gradients.
    const dx = dFdx(coordinates).toVar(), dy = dFdy(coordinates).toVar();
    const gx = dx.mul(surfaceBias(builder).exp2()).toVar(), gy = dy.mul(surfaceBias(builder).exp2()).toVar();
    const px = dFdx(positionView).toVar(), py = dFdy(positionView).toVar();
    const a = cross(py, normalViewGeometry).toVar(), b = cross(normalViewGeometry, px).toVar();
    const determinant = dot(px, a).toVar();
    const inverse = determinant.abs().max(.000001).reciprocal().mul(determinant.sign());
    const gu = a.mul(dx.x).add(b.mul(dy.x)).mul(inverse);
    const gv = a.mul(dx.y).add(b.mul(dy.y)).mul(inverse);
    const direction = positionViewDirection;
    const delta = vec2(dot(direction, gu), dot(direction, gv)).mul(depth).div(dot(direction, normalViewGeometry).abs().max(.3)).toVar();
    const mask = (field: Node<'vec4'>) => maskChannel === 'b' ? field.b : field.a;
    const first = texture(map, coordinates).grad(gx, gy).toVar();
    const result = coordinates.toVar();
    If(mask(first).greaterThan(.05).and(coverage.greaterThan(.01)), () => {
      const step = delta.mul(mask(first)).div(12).toVar();
      const ray = coordinates.toVar(), layer = float(0).toVar(), previous = coordinates.toVar();
      const found = float(0).toVar();
      Loop(12, () => {
        If(found.lessThan(.5), () => {
          previous.assign(ray); ray.subAssign(step); layer.addAssign(1 / 12);
          const field = texture(map, ray).grad(gx, gy);
          If(layer.greaterThanEqual(float(1).sub(field.r)).or(mask(field).lessThan(.025)), () => { found.assign(1); });
        });
      });
      const low = previous.toVar(), high = ray.toVar(), lowDepth = layer.sub(1 / 12).toVar(), highDepth = layer.toVar();
      Loop(2, () => {
        const mid = low.add(high).mul(.5).toVar(), z = lowDepth.add(highDepth).mul(.5).toVar();
        const field = texture(map, mid).grad(gx, gy);
        If(z.greaterThanEqual(float(1).sub(field.r)), () => { high.assign(mid); highDepth.assign(z); })
          .Else(() => { low.assign(mid); lowDepth.assign(z); });
      });
      result.assign(low.add(high).mul(.5));
      // Guard both ends of the lookup; faded borders cannot reach adjacent atlas islands.
      const end = texture(map, result).grad(gx, gy);
      If(mask(end).lessThan(.025), () => { result.assign(coordinates); });
    });
    return result;
  })();
}
/** Explicit gradients prevent POM offsets from selecting unstable mip levels. */
export function reliefSample(map: THREE.Texture, base: Node<'vec2'>, displaced: Node<'vec2'>) {
  filterMaterialTexture(map);
  return Fn((builder: NodeBuilder) => {
    const scale = surfaceBias(builder).exp2();
    return texture(map, displaced).grad(dFdx(base).mul(scale), dFdy(base).mul(scale));
  })();
}
export function prepareSurfaceMaterial(material: MeshStandardNodeMaterial, data?: THREE.Texture, depth = 0, format: 1 | 2 | 3 = 2): void {
  for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'] as const) if (material[key]) filterMaterialTexture(material[key]);
  const base = material.map ? surfaceUV(material.map) : uv(0), displaced = data ? reliefUV(data, base, depth, float(1), format === 2 ? 'b' : 'a').toVar() : base;
  const sample = (map: THREE.Texture) => data ? reliefSample(map, base, displaced) : surfaceSample(map);
  if (material.map) material.colorNode = sample(material.map).rgb.mul(color(material.color));
  if (material.normalMap) {
    const map = material.normalMap, normalCoordinates = data ? base : surfaceUV(map), normalDisplaced = data ? displaced : normalCoordinates;
    material.normalNode = Fn((builder: NodeBuilder) => {
      const node = texture(map, normalDisplaced).grad(dFdx(normalCoordinates).mul(surfaceBias(builder).exp2()), dFdy(normalCoordinates).mul(surfaceBias(builder).exp2()));
      // Supplied tangents remain authoritative for authored/skinned assets.
      if (material.normalMapType === THREE.ObjectSpaceNormalMap || builder.geometry.hasAttribute('tangent')) {
        const normal = normalMap(node, uniform(material.normalScale)); normal.normalMapType = material.normalMapType; return normal;
      }
      return mappedSurfaceNormal(node, normalCoordinates, uniform(material.normalScale));
    })();
  }
  if (material.roughnessMap) material.roughnessNode = sample(material.roughnessMap).g.mul(material.roughness);
  if (material.metalnessMap) material.metalnessNode = sample(material.metalnessMap).b.mul(material.metalness);
  if (material.aoMap) material.aoNode = float(1).mix(sample(material.aoMap).r, material.aoMapIntensity);
  if (material.emissiveMap) material.emissiveNode = sample(material.emissiveMap).rgb.mul(color(material.emissive)).mul(material.emissiveIntensity);
  if (data) {
    // Keep an enumerable texture reference so the existing cache disposal owns this map too.
    Object.assign(material, { surfaceDataMap: data });
    const field = sample(data);
    if (format === 1) material.roughnessNode = field.g;
    material.aoNode = (format === 3 && material.normalMap ? sample(material.normalMap).a : format === 2 ? field.g : field.b).max(.86);
  }
}

/** Convert shared loaded surfaces once while keeping authored textures and render flags. */
export function prepareStandardMaterials(root: THREE.Object3D): void {
  const converted = new Map<THREE.Material, MeshStandardNodeMaterial>();
  root.traverse(object => {
    if (!isMesh(object)) return;
    const convert = (source: THREE.Material) => {
      if (!(source instanceof THREE.MeshStandardMaterial)) return source;
      let material = converted.get(source);
      if (!material) { material = new MeshStandardNodeMaterial().copy(source); prepareSurfaceMaterial(material); converted.set(source, material); }
      return material;
    };
    object.material = Array.isArray(object.material) ? object.material.map(convert) : convert(object.material);
  });
  converted.forEach((_material, source) => source.dispose());
}
