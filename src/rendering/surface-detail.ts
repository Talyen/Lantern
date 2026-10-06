import { isMesh, isTexture } from '../assets/resource-ownership';
import * as THREE from 'three';
import { Fn, If, Loop, float, vec2, vec3, vec4, uniform, uv, texture, dFdx, dFdy, positionView, positionViewDirection, normalView, normalViewGeometry, cross, dot, normalMap, negateOnBackSide, materialRoughness, materialSpecularIntensity, nodeObject, mix, smoothstep, BRDF_GGX, specularF90, roughness, retroreflectivity } from 'three/tsl';
import { type MeshStandardNodeMaterial, MeshPhysicalNodeMaterial, PhysicalLightingModel, TextureNode, MaterialReferenceNode, NodeUpdateType, type NodeFrame, type Node, type NodeBuilder, type WebGPURenderer } from 'three/webgpu';
import { calibrationGain } from './material-calibration';
import { materialRecipes, type MaterialFamily } from './material-recipes';
import { validateMaterial } from '../assets/material-validation';

type SurfaceContext = { materialMipBias?: Node<'float'>; textureDepth?: boolean };
// The pinned r186 builder exposes this method; its declarations omit it.
type SurfaceBuilder = NodeBuilder & { isFlatShading(): boolean };
// r186 passes boolean feature flags to GGX; its declarations incorrectly require nodes.
const surfaceGGX = BRDF_GGX as unknown as (input: Omit<Parameters<typeof BRDF_GGX>[0], 'USE_IRIDESCENCE' | 'USE_ANISOTROPY'>
  & { USE_IRIDESCENCE: boolean; USE_ANISOTROPY: boolean }) => Node<'vec3'>;
/** r186 hardcodes direct GGX's grazing response to 1. Remove only that excess;
 * specularF90 already contains authored intensity, dry suppression and metalness. */
class SurfaceLightingModel extends PhysicalLightingModel {
  override direct(input: Parameters<PhysicalLightingModel['direct']>[0], builder: NodeBuilder): void {
    super.direct(input, builder);
    const lightDirection = input.lightDirection as Node<'vec3'>, lightColor = input.lightColor as Node<'vec3'>;
    const excess = (viewDirection = positionViewDirection) => surfaceGGX({
      lightDirection, viewDirection, f0: vec3(0), f90: specularF90.oneMinus(), roughness,
      f: vec3(0), USE_IRIDESCENCE: this.iridescence, USE_ANISOTROPY: this.anisotropy,
    });
    const correction = this.retroreflection
      ? mix(excess(), excess(positionViewDirection.negate().reflect(normalView)), retroreflectivity.clamp())
      : excess();
    (input.reflectedLight.directSpecular as Node<'vec3'>).subAssign(normalView.dot(lightDirection).clamp()
      .mul(lightColor).mul(correction).mul(this.multiScatteringCompensation as Node<'vec3'>));
  }
}
/** Preserve the lighting adapter through native clone/copy operations. */
class SurfaceMaterial extends MeshPhysicalNodeMaterial {
  override copy(source: THREE.Material): this {
    super.copy(source);
    prepareSurfaceHighlights(this);
    return this;
  }
  override setupLightingModel(): PhysicalLightingModel {
    return new SurfaceLightingModel(this.useClearcoat, this.useSheen, this.useIridescence, this.useAnisotropy,
      this.useTransmission, this.useDispersion, this.useRetroreflection);
  }
}
/** Use authored roughness, including maps/wetness, rather than an asset-wide gloss override.
 * Physical materials retain the metallic branch and authored smooth-surface response. */
export function prepareSurfaceHighlights(material: MeshPhysicalNodeMaterial): void {
  material.specularIntensityNode = surfaceHighlightIntensity;
}
const surfaceHighlightIntensity = Fn((builder: NodeBuilder) => {
    const material = surfaceOwner(builder) as MeshPhysicalNodeMaterial;
    const response = materialRecipes.dryHighlights;
    // Resolve after consumers install procedural roughness. Geometric AA must
    // not classify an otherwise polished surface as dry at silhouette edges.
    const surfaceRoughness = (material.roughnessNode as Node<'float'> | null) ?? materialRoughness;
    return materialSpecularIntensity.mul(mix(1, response.specularIntensity,
      smoothstep(response.roughnessStart, response.roughnessEnd, surfaceRoughness)));
  })();
export function createSurfaceMaterial(parameters?: ConstructorParameters<typeof MeshPhysicalNodeMaterial>[0]): MeshPhysicalNodeMaterial {
  const material = new SurfaceMaterial(parameters);
  prepareSurfaceHighlights(material);
  return material;
}
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
export function reliefUV(map: THREE.Texture | TextureNode, coordinates: Node<'vec2'>, depth: number, coverage: Node<'float'> = float(1), maskChannel: 'a' | 'b' = 'a', gain: Node<'float'> = float(1)) {
  if (map instanceof THREE.Texture) filterMaterialTexture(map);
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
    const delta = vec2(dot(direction, gu), dot(direction, gv)).mul(depth).mul(gain).div(dot(direction, normalViewGeometry).abs().max(.3)).toVar();
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
/** Texture bindings follow the current draw, while graph structure can be shared. */
function surfaceOwner(state: NodeFrame | NodeBuilder): THREE.Material {
  const context: unknown = 'context' in state ? state.context : undefined;
  const source: unknown = context && typeof context === 'object' ? Reflect.get(context, 'lanternSurfaceMaterial') : state.renderer ? Reflect.get(state.renderer, '_currentSourceMaterial') : undefined;
  if (source instanceof THREE.Material) return source as THREE.Material;
  if (!state.material) throw new Error('Surface material is unavailable.'); return state.material;
}
class SurfaceParameterReference extends MaterialReferenceNode {
  private _owner?: WeakRef<THREE.Material>;
  override updateReference(state: NodeFrame | NodeBuilder): THREE.Material { const material = surfaceOwner(state); this._owner = new WeakRef(material); return material; }
  // Pinned r186 method omitted from its declarations.
  getValueFromReference(object?: object): unknown {
    let value: unknown = object ?? this._owner?.deref();
    for (const property of this.properties) {
      if (!value || typeof value !== 'object') throw new Error('Surface material parameter is unavailable.');
      value = Reflect.get(value, property) as unknown;
    }
    return value;
  }
}
class SurfaceTextureReference extends TextureNode {
  private property?: string;
  private _texture?: WeakRef<THREE.Texture>;
  constructor(property: string | THREE.Texture, coordinates: Node | null = null, level: Node | null = null, bias: Node | null = null) {
    super(undefined, coordinates, level, bias);
    this.property = typeof property === 'string' ? property : undefined; this.updateType = NodeUpdateType.OBJECT;
    if (typeof property !== 'string') this.value = property;
  }
  override get value(): THREE.Texture { return this.referenceNode ? (this.referenceNode as TextureNode).value : this._texture?.deref() ?? super.value; }
  override set value(texture: THREE.Texture) { if (this.referenceNode) (this.referenceNode as TextureNode).value = texture; else this._texture = new WeakRef(texture); }
  // Per-role bindings stay stable even when one material packs roles into a
  // shared image and another material supplies separate maps.
  override getUniformHash(): string { return this.getBase().uuid; }
  override updateReference(state: NodeFrame | NodeBuilder): THREE.Texture {
    const material = surfaceOwner(state);
    const base = this.getBase();
    const property = this.property ?? (base instanceof SurfaceTextureReference ? base.property : undefined);
    if (!property) return this.value;
    const value: unknown = Reflect.get(material, property);
    if (!isTexture(value)) throw new Error(`Surface texture ${property} is unavailable.`);
    this.value = value; return value;
  }
  override update(frame: NodeFrame): undefined { this.updateReference(frame); return undefined; }
}
function materialParameter<T extends 'float' | 'vec2' | 'vec3' | 'mat3'>(name: string, type: T): Node<T> {
  // r186's reference factory returns a raw class; nodeObject supplies its TSL methods.
  return nodeObject(new SurfaceParameterReference(name, type === 'vec3' ? 'color' : type) as unknown as Node<T>) as unknown as Node<T>;
}
type SurfaceNodes = Pick<MeshStandardNodeMaterial, 'colorNode' | 'normalNode' | 'roughnessNode' | 'metalnessNode' | 'aoNode' | 'emissiveNode'>;
export class SurfaceTemplates {
  private entries = new Map<string, WeakRef<SurfaceNodes>>();
  get(key: string): SurfaceNodes | undefined { return this.entries.get(key)?.deref(); }
  set(key: string, nodes: SurfaceNodes): void {
    this.entries.set(key, new WeakRef(nodes));
    if (this.entries.size > 256) for (const [key, value] of this.entries) if (!value.deref()) this.entries.delete(key);
  }
}
function rolesForTransforms(material: MeshStandardNodeMaterial): THREE.Texture[] { return [material.map, material.normalMap, material.roughnessMap, material.metalnessMap, material.aoMap, material.emissiveMap, material.alphaMap].filter((map): map is THREE.Texture => !!map); }
const defaultSurfaceTemplates = new SurfaceTemplates();
const preparedSurfaces = new WeakMap<THREE.Material, { signature: string; templates: SurfaceTemplates }>();
export function prepareSurfaceMaterial(material: MeshStandardNodeMaterial, data?: THREE.Texture, depth = 0, format: 1 | 2 | 3 = 2, templates = defaultSurfaceTemplates): void {
  if (material instanceof MeshPhysicalNodeMaterial) prepareSurfaceHighlights(material);
  for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'] as const) if (material[key]) filterMaterialTexture(material[key]);
  for (const map of [...rolesForTransforms(material), ...(data ? [data] : [])]) if (map.matrixAutoUpdate) map.updateMatrix();
  const descriptor = material.userData.lanternSurface as { family?: MaterialFamily } | undefined;
  const family = descriptor?.family;
  const roles = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'] as const;
  const signature = JSON.stringify([family, !!data, depth, format, material.normalMapType, roles.map(role => {
    const map = material[role]; return map ? [map.channel, map.type, map.format, map.colorSpace, map.mapping, map.magFilter, map.minFilter, map.wrapS, map.wrapT, map.anisotropy] : null;
  })]);
  const prepared = preparedSurfaces.get(material);
  if (prepared?.signature === signature && prepared.templates === templates) return;
  if (data) Object.assign(material, { surfaceDataMap: data });
  const cached = templates.get(signature);
  if (cached) { Object.assign(material, cached); Object.defineProperty(material, 'surfaceTemplate', { value: cached, configurable: true }); preparedSurfaces.set(material, { signature, templates }); return; }
  const maps = new Map<string, ReturnType<typeof nodeObject<SurfaceTextureReference>>>();
  const referenced = (role: string) => { let node = maps.get(role); if (!node) { node = nodeObject(new SurfaceTextureReference(role)); maps.set(role, node); } return node; };
  const coordinates = (role: string, channel: number) => materialParameter(`${role}.matrix`, 'mat3').mul(vec3(uv(channel), 1)).xy;
  const recipeGain = family === 'stone' || family === 'bark' || family === 'timber' ? materialRecipes.prepared[family] : 1;
  const gain = family ? calibrationGain(family).mul(recipeGain) : float(1);
  const base = material.map ? coordinates('map', material.map.channel) : uv(0), displaced = data ? reliefUV(referenced('surfaceDataMap'), base, depth, float(1), format === 2 ? 'b' : 'a', gain).toVar() : base;
  const hasData = !!data;
  const sample = (role: string, map: THREE.Texture) => { const coords = coordinates(role, map.channel); return Fn((builder: NodeBuilder) => hasData
    ? texture(referenced(role), displaced).grad(dFdx(base).mul(surfaceBias(builder).exp2()), dFdy(base).mul(surfaceBias(builder).exp2()))
    : texture(referenced(role), coords).bias(surfaceBias(builder)))(); };
  if (material.map) material.colorNode = sample('map', material.map).rgb.mul(materialParameter('color', 'vec3'));
  if (material.normalMap) {
    const map = material.normalMap, normalCoordinates = data ? base : coordinates('normalMap', map.channel), normalDisplaced = data ? displaced : normalCoordinates;
    // Mixed pine/log atlases amplify bark only; their foliage/cut ends keep authored normals.
    const eligible = data ? sample('surfaceDataMap', data)[format === 2 ? 'b' : 'a'] : float(1);
    const amount = float(1).mix(gain.mul(family ? materialRecipes.families[family].normalStrength : 1), eligible);
    material.normalNode = Fn((builder: NodeBuilder) => {
      const current = surfaceOwner(builder) as MeshStandardNodeMaterial;
      const node = texture(referenced('normalMap'), normalDisplaced).grad(dFdx(normalCoordinates).mul(surfaceBias(builder).exp2()), dFdy(normalCoordinates).mul(surfaceBias(builder).exp2()));
      // Supplied tangents remain authoritative for authored/skinned assets.
      if (current.normalMapType === THREE.ObjectSpaceNormalMap || builder.geometry.hasAttribute('tangent')) {
        const normal = normalMap(node, materialParameter('normalScale', 'vec2').mul(amount)); normal.normalMapType = current.normalMapType; return normal;
      }
      return mappedSurfaceNormal(node, normalCoordinates, materialParameter('normalScale', 'vec2').mul(amount));
    })();
  }
  if (material.roughnessMap) material.roughnessNode = sample('roughnessMap', material.roughnessMap).g.mul(materialParameter('roughness', 'float'));
  if (material.metalnessMap) material.metalnessNode = sample('metalnessMap', material.metalnessMap).b.mul(materialParameter('metalness', 'float'));
  if (material.aoMap) material.aoNode = float(1).mix(sample('aoMap', material.aoMap).r, materialParameter('aoMapIntensity', 'float'));
  if (material.emissiveMap) material.emissiveNode = sample('emissiveMap', material.emissiveMap).rgb.mul(materialParameter('emissive', 'vec3')).mul(materialParameter('emissiveIntensity', 'float'));
  if (data) {
    // Keep an enumerable texture reference so the existing cache disposal owns this map too.
    Object.assign(material, { surfaceDataMap: data });
    const field = sample('surfaceDataMap', data);
    if (format === 1) material.roughnessNode = field.g;
    material.aoNode = (format === 3 && material.normalMap ? sample('normalMap', material.normalMap).a : format === 2 ? field.g : field.b).max(.86);
  }
  const template = Object.fromEntries(['colorNode', 'normalNode', 'roughnessNode', 'metalnessNode', 'aoNode', 'emissiveNode'].map(role => [role, Reflect.get(material, role)])) as SurfaceNodes;
  templates.set(signature, template); preparedSurfaces.set(material, { signature, templates });
  // Materials own the template, the lookup does not retain retired draws/textures.
  Object.defineProperty(material, 'surfaceTemplate', { value: template, configurable: true });
}

/** Convert shared loaded surfaces once while keeping authored textures and render flags. */
export function prepareStandardMaterials(root: THREE.Object3D, templates = defaultSurfaceTemplates): void {
  const converted = new Map<THREE.Material, MeshStandardNodeMaterial>();
  const issues: string[] = [];
  root.traverse(object => {
    if (!isMesh(object)) return;
    const convert = (source: THREE.Material) => {
      if (!(source instanceof THREE.MeshStandardMaterial)) return source;
      let material = converted.get(source);
      if (!material) { material = createSurfaceMaterial().copy(source); prepareSurfaceMaterial(material, undefined, 0, 2, templates); converted.set(source, material); }
      return material;
    };
    object.material = Array.isArray(object.material) ? object.material.map(convert) : convert(object.material);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) if (material instanceof THREE.MeshStandardMaterial) {
      for (const issue of validateMaterial(material, object.geometry)) issues.push(`material:${object.name}:${issue.material}:${issue.message}`);
    }
  });
  root.userData.materialIssues = issues;
  converted.forEach((_material, source) => source.dispose());
}

/** r186 otherwise creates a fixed map reference per material for shadow draws. */
export function installSurfaceShadowTemplates(renderer: WebGPURenderer): void {
  type ShadowMaterial = MeshStandardNodeMaterial & { castShadowNode?: Node | null; maskShadowNode?: Node | null; maskNode?: Node | null; depthNode?: Node | null; castShadowPositionNode?: Node | null; positionNode?: Node | null };
  type ShadowNodes = { colorNode: Node | null; depthNode: Node | null; positionNode: Node | null };
  const original = Reflect.get(renderer, '_getShadowNodes') as (material: ShadowMaterial) => ShadowNodes;
  if (!original) throw new Error('Native shadow material integration needs updating.');
  const colors = new Map<string, WeakRef<Node>>(), owners = new WeakMap<THREE.Material, Node>();
  Reflect.set(renderer, '_getShadowNodes', (material: ShadowMaterial): ShadowNodes => {
    // Explicit casting/masking graphs keep their authored behavior and ownership.
    if (material.castShadowNode || material.maskShadowNode || material.maskNode) return original.call(renderer, material);
    const map = material.map;
    const template = Reflect.get(material, 'surfaceTemplate') as SurfaceNodes | undefined;
    // Authored prepared albedo graphs return vec3; r186 expands their .a to 1.
    // Avoid reattaching the whole beauty graph to every equivalent shadow graph.
    const color = map && template?.colorNode === material.colorNode ? null : material.colorNode;
    let colorNode: Node | null = null;
    if (map || color) {
      const key = JSON.stringify([color?.uuid, map ? [map.channel, map.type, map.format, map.colorSpace, map.mapping, map.flipY, map.magFilter, map.minFilter, map.wrapS, map.wrapT, map.anisotropy] : null]);
      colorNode = colors.get(key)?.deref() ?? null;
      if (!colorNode) {
        let alpha: Node<'float'> = float(1);
        if (map) {
          const coordinates = materialParameter('map.matrix', 'mat3').mul(vec3(uv(map.channel), 1)).xy;
          alpha = alpha.mul(texture(nodeObject(new SurfaceTextureReference('map')), coordinates).a);
        }
        if (color) alpha = alpha.mul((color as Node<'vec4'>).a);
        colorNode = vec4(vec3(0), alpha); colors.set(key, new WeakRef(colorNode));
        if (colors.size > 256) for (const [key, value] of colors) if (!value.deref()) colors.delete(key);
      }
    }
    if (colorNode) owners.set(material, colorNode);
    return { colorNode, depthNode: material.depthNode ?? null, positionNode: material.castShadowPositionNode ?? material.positionNode ?? null };
  });
}
