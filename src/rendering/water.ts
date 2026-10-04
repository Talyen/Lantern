import * as THREE from 'three';
import { MeshPhysicalNodeMaterial, type Node, type NodeBuilder } from 'three/webgpu';
import { Fn, color, float, mix, dot, normalView, positionViewDirection, positionLocal, positionPrevious, sin, smoothstep, texture, uv, vec2, vec3, vec4 } from 'three/tsl';
import { registerWaterPlane } from './water-registry';
import { mappedSurfaceNormal, surfaceSample } from './surface-detail';
import { waterCoverage, waterCurrent, waterDistance, waterDepth, waterLevel, type WaterDefinition } from '../levels/water';

export type WaterOptions = Partial<Omit<WaterDefinition, 'id' | 'position'>> & { shorelineMask?: THREE.Texture };

function dataTexture(size: number, sample: (x: number, z: number) => number[], height = size): THREE.DataTexture {
  const bytes = new Uint8Array(size * height * 4);
  for (let v = 0; v < height; v++) for (let u = 0; u < size; u++) {
    const values = sample(u / (size - 1) * 2 - 1, 1 - v / (height - 1) * 2);
    for (let c = 0; c < 4; c++) bytes[(v * size + u) * 4 + c] = Math.round(Math.max(0, Math.min(1, values[c])) * 255);
  }
  const map = new THREE.DataTexture(bytes, size, height); map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearFilter; map.needsUpdate = true;
  return map;
}

/** Shared broad ripple texture. No scene captures, simulation buffers or full-screen passes. */
export function waterNormalTexture(): THREE.DataTexture {
  const harmonics = [[1, 2, .038, 0], [2, -1, .031, 1.3], [3, 1, .012, 2.7], [1, -3, .013, 4.2]];
  const normal = dataTexture(64, (x, z) => {
    let nx = 0, nz = 0;
    for (const [kx, kz, amplitude, phase] of harmonics) {
      const slope = Math.cos(Math.PI * (x * kx + z * kz) + phase) * amplitude;
      nx += slope * kx; nz += slope * kz;
    }
    return [.5 + nx, .5 + nz, .98, 1];
  });
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping; normal.generateMipmaps = true; normal.minFilter = THREE.LinearMipmapLinearFilter;
  return normal;
}

export function createWaterSurface(parent: THREE.Object3D, x: number, z: number, options: WaterOptions,
  normal: THREE.Texture, clock: Node<'float'>, previousClock: Node<'float'>) {
  const shape = { width: options.width ?? 4, length: options.length ?? 2, flow: options.flow ?? .035, boundary: options.boundary, preset: options.preset, channel: options.channel, obstacles: options.obstacles, depth: options.depth, shorelineWidth: options.shorelineWidth };
  const height = waterLevel(options), style = options.surface;
  const puddle = options.preset === 'puddle';
  const field = dataTexture(shape.channel ? 512 : 128, (u, v) => {
    const distance = Math.max(0, waterDistance(shape, u, v));
    const variation = .5 + Math.sin(u * 17 + Math.sin(v * 11)) * Math.cos(v * 19) * .5;
    return [Math.min(1, waterDepth(shape, u, v) / .34), Math.max(0, 1 - Math.abs(distance - .055) * 24) * variation,
      variation, waterCoverage(shape, u, v)];
  }, 128);
  const flow = dataTexture(shape.channel ? 128 : 32, (u, v) => { const current = waterCurrent({ ...shape, currents: options.currents }, u, v); return [.5 + current[0] * .5, .5 + current[1] * .5, 0, 1]; }, 32);
  const coordinates = uv(), shore = texture(field, coordinates), current = texture(flow, coordinates).rg.mul(2).sub(1);
  const tiles = vec2(shape.width * .32, shape.length * .7);
  const phase = clock.mul(shape.flow).add(shore.b.mul(.37)).fract();
  const secondPhase = phase.add(.5).fract();
  const first = surfaceSample(normal, coordinates.mul(tiles).sub(current.mul(phase).mul(.65))).rgb;
  const second = surfaceSample(normal, coordinates.mul(tiles).sub(current.mul(secondPhase).mul(.65)).add(vec2(.31, .17))).rgb;
  const ripples = mix(first, second, phase.sub(.5).abs().mul(2));
  const foam = shore.g.mul(smoothstep(.47, .61, ripples.r)).mul(puddle ? .06 : .65);
  const material = new MeshPhysicalNodeMaterial({ transparent: true, depthWrite: false, alphaTest: .02, side: THREE.FrontSide, metalness: 0, envMapIntensity: 1.5, clearcoat: 1, clearcoatRoughness: .10, ior: 1.333 });
  const basin = mix(color(style?.shallowColor ?? '#73928b'), color(style?.deepColor ?? '#263f48'), shore.r);
  const currentLight = smoothstep(.51, .64, ripples.r).mul(shore.r).mul(puddle ? 0 : .045);
  material.colorNode = mix(mix(basin, color('#a6bbb5'), currentLight), color('#c2c9bd'), foam);
  const fresnel = dot(normalView, positionViewDirection).abs().oneMinus().pow(4);
  const bodyOpacity = mix(float(puddle ? .05 : .07), float(.75), shore.r).add(fresnel.mul(.3)).clamp(0, .85);
  material.opacityNode = shore.a.mul(mix(bodyOpacity, float(.9), foam))
    .mul(options.shorelineMask ? texture(options.shorelineMask, coordinates).a : float(1));
  material.roughnessNode = mix(mix(float(style?.roughness ?? .17), float((style?.roughness ?? .17) * .45), shore.r), float(.45), foam);
  material.normalNode = mappedSurfaceNormal(vec4(ripples, 1), coordinates.mul(tiles), vec2(style?.normalStrength ?? (puddle ? .18 : .48)));
  material.clearcoatNormalNode = material.normalNode;
  const reflected = Fn((builder: NodeBuilder) => {
    const reflection = (builder.context as { waterReflection?: (height: number, distortion: Node<'vec2'>) => Node<'vec4'> }).waterReflection;
    if (!reflection || style?.reflection === 'environment' || style?.reflectionStrength === 0) return vec4(0);
    return reflection(height, ripples.rg.mul(2).sub(1).mul(.006));
  })();
  const reflectionWeight = reflected.a.mul(float(.75).add(fresnel.mul(.2))).mul(style?.reflectionStrength ?? 1).mul(foam.oneMinus()).clamp(0, 1);
  const surfaceColor = material.colorNode;
  material.colorNode = surfaceColor.mul(reflectionWeight.oneMinus());
  material.emissiveNode = reflected.rgb.mul(reflectionWeight);
  const wave = (time: Node<'float'>) => sin(positionLocal.x.mul(2).add(time)).mul(.006)
    .add(sin(positionLocal.z.mul(3).sub(time.mul(.8))).mul(.004)).mul(shore.r).mul(puddle ? 0 : 1);
  material.positionNode = Fn(() => {
    positionPrevious.assign(positionLocal.add(vec3(0, wave(previousClock), 0)));
    return positionLocal.add(vec3(0, wave(clock), 0));
  })();
  const geometry = new THREE.PlaneGeometry(shape.width, shape.length, puddle ? 1 : 112, puddle ? 1 : 24); geometry.rotateX(-Math.PI / 2);
  geometry.computeBoundingSphere(); geometry.boundingSphere!.radius += .02;
  const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, height, z); mesh.rotation.y = options.yaw ?? 0;
  mesh.name = options.preset ? `water-${options.preset}` : 'water'; mesh.receiveShadow = true; parent.add(mesh);
  mesh.userData.transient = true;
  let owner: THREE.Scene | undefined, release: (() => void) | undefined;
  const register = (scene: THREE.Scene) => {
    if (owner === scene || style?.reflection === 'environment' || style?.reflectionStrength === 0) return;
    release?.(); owner = scene; release = registerWaterPlane(scene, height);
  };
  let scene: THREE.Object3D | null = parent;
  while (scene && !(scene instanceof THREE.Scene)) scene = scene.parent;
  if (scene instanceof THREE.Scene) register(scene as THREE.Scene<THREE.Object3DEventMap>);
  // A reusable body may be built under a detached group and attached later.
  mesh.onBeforeRender = (_renderer, scene) => register(scene);
  return { mesh, dispose() { release?.(); mesh.removeFromParent(); geometry.dispose(); material.dispose(); field.dispose(); flow.dispose(); } };
}
