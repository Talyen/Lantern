import * as THREE from 'three';
import { AnalyticLightNode, HemisphereLightNode, MeshStandardNodeMaterial, type Node, type NodeBuilder, type NodeMaterial, type WebGPURenderer } from 'three/webgpu';
import { array, clearcoat, clearcoatNormalView, F_Schlick, float, getShIrradianceAt, normalWorld, normalWorldGeometry, positionViewDirection, positionWorld, property, texture3D, uniform, vec3 } from 'three/tsl';
import type { LightProbeGrid } from 'three/addons/lighting/LightProbeGrid.js';

export const indirectSampling = { normalOffset: .15, collar: 1 };
export type IndirectContext = { lanternIndirect?: { enabled: Node<'float'>; min: Node<'vec3'>; max: Node<'vec3'> }; lanternAO?: boolean };
type NativeLightingContext = IndirectContext & { irradiance: Node<'vec3'>; reflectedLight: { indirectDiffuse: Node<'vec3'> } };
const diffuseOutput = property('vec3', 'lanternIndirectDiffuse');

/** Receiver coverage is independent of normal-map detail and probe sampling bias. */
export function probeOwnership(builder: NodeBuilder): Node<'float'> {
  const spec = (builder.context as IndirectContext).lanternIndirect;
  if (!spec) return float(0);
  const outside = spec.min.sub(positionWorld).max(0).add(positionWorld.sub(spec.max).max(0));
  return outside.length().smoothstep(0, indirectSampling.collar).oneMinus().mul(spec.enabled);
}

class EnclosureHemisphereNode extends HemisphereLightNode {
  override setup(builder: NodeBuilder): undefined {
    const context = builder.context as NativeLightingContext;
    if (!context.lanternIndirect) { super.setup(builder); return; }
    const target = context.irradiance, contribution = vec3().toVar();
    context.irradiance = contribution;
    try { super.setup(builder); } finally { context.irradiance = target; }
    target.addAssign(contribution.mul(probeOwnership(builder).oneMinus()));
    return undefined;
  }
}

/** Same r186 seven-slice L2 atlas; only receiver bias and ownership differ. */
export class EnclosureProbeNode extends AnalyticLightNode<LightProbeGrid> {
  private min = uniform(new THREE.Vector3());
  private max = uniform(new THREE.Vector3());
  private resolution = uniform(new THREE.Vector3());
  private strength = uniform(1);
  override update(): undefined {
    const light = this.light!;
    this.min.value.copy(light.boundingBox.min); this.max.value.copy(light.boundingBox.max);
    this.resolution.value.copy(light.resolution); this.strength.value = light.intensity;
    return undefined;
  }
  override setup(builder: NodeBuilder): undefined {
    const light = this.light!; if (!light.texture) return;
    const range = this.max.sub(this.min), res = this.resolution, steps = res.sub(1);
    const spacing = range.div(steps);
    const bias = spacing.x.min(spacing.y).min(spacing.z).mul(.5).min(indirectSampling.normalOffset);
    const sample = positionWorld.add(normalWorldGeometry.mul(bias));
    const uvw = sample.sub(this.min).div(range).clamp(0, 1).mul(steps).div(res).add(vec3(.5).div(res));
    const atlas = texture3D(light.texture), padded = res.z.add(2), depth = padded.mul(7);
    const slice = (index: number) => atlas.sample(vec3(uvw.xy, uvw.z.mul(res.z).add(1).add(padded.mul(index)).div(depth)));
    const s0 = slice(0), s1 = slice(1), s2 = slice(2), s3 = slice(3), s4 = slice(4), s5 = slice(5), s6 = slice(6);
    const coefficients = array([s0.xyz, vec3(s0.w, s1.xy), vec3(s1.zw, s2.x), s2.yzw, s3.xyz, vec3(s3.w, s4.xy), vec3(s4.zw, s5.x), s5.yzw, s6.xyz]);
    const weight = (builder.context as IndirectContext).lanternIndirect ? probeOwnership(builder) : float(1);
    (builder.context as NativeLightingContext).irradiance.addAssign(vec3(getShIrradianceAt(normalWorld, coefficients) as Node<'vec3'>).max(vec3(0)).mul(this.strength).mul(weight));
    return undefined;
  }
}

const installed = Symbol.for('lantern.indirectMaterialAdapter');
function prepareMaterial(material: NodeMaterial): void {
  if (!(material instanceof MeshStandardNodeMaterial) || Reflect.get(material, installed)) return;
  Reflect.set(material, installed, true);
  const setup = material.setupLightingModel.bind(material);
  const adaptedModel = () => {
    const model = setup();
    if (!model || !(Reflect.get(model, 'indirectSpecular') instanceof Function)) return model;
    const physical = model;
    const indirect = physical.indirectSpecular.bind(physical), finish = physical.finish.bind(physical);
    physical.indirectSpecular = (builder: NodeBuilder) => {
      const context = builder.context as NativeLightingContext;
      if (!context.lanternIndirect) { indirect(builder); return; }
      // r186 accumulates environment diffuse inside indirectSpecular. Redirect
      // only that accumulator; native radiance/multiscattering stay untouched.
      const target = context.reflectedLight.indirectDiffuse, contribution = vec3().toVar();
      context.reflectedLight.indirectDiffuse = contribution;
      try { indirect(builder); } finally { context.reflectedLight.indirectDiffuse = target; }
      target.addAssign(contribution.mul(probeOwnership(builder).oneMinus()));
    };
    physical.finish = (builder: NodeBuilder) => {
      finish(builder);
      const context = builder.context as NativeLightingContext;
      if (!context.lanternAO) return;
      let diffuse = context.reflectedLight.indirectDiffuse;
      if (physical.clearcoat) {
        const fresnel = vec3(F_Schlick({ dotVH: clearcoatNormalView.dot(positionViewDirection).clamp(), f0: vec3(.04), f90: float(1) }) as unknown as Node<'vec3'>);
        diffuse = diffuse.mul(clearcoat.mul(fresnel).oneMinus());
      }
      diffuseOutput.assign(diffuse);
    };
    return physical;
  };
  // r186 hashes enumerable material fields for every render object. A long
  // function here would be stringified on beauty/reflection/shadow submissions.
  Object.defineProperty(material, 'setupLightingModel', { value: adaptedModel, configurable: true, writable: true, enumerable: false });
}

/** Renderer-local conversion catches every material, including late equipment. */
export function installIndirectLighting(renderer: WebGPURenderer): void {
  if (THREE.REVISION !== '186') throw new Error('Indirect lighting integration needs updating for this three.js version.');
  const fromMaterial = renderer.library.fromMaterial.bind(renderer.library);
  renderer.library.fromMaterial = material => {
    const converted = fromMaterial(material);
    if (converted instanceof THREE.Material) prepareMaterial(converted);
    return converted;
  };
  const lights = Reflect.get(renderer.library, 'lightNodes') as unknown as WeakMap<typeof THREE.HemisphereLight, typeof HemisphereLightNode>;
  if (!(lights instanceof WeakMap)) throw new Error('Native lighting library integration needs updating.');
  lights.set(THREE.HemisphereLight, EnclosureHemisphereNode);
}

export function indirectDiffuseAttachment(builder: NodeBuilder): Node<'vec3'> {
  const material = builder.material;
  if (!material || material.transparent || (!Reflect.get(material, 'isMeshStandardMaterial') && !Reflect.get(material, 'isMeshStandardNodeMaterial'))) return vec3(0);
  return diffuseOutput;
}
