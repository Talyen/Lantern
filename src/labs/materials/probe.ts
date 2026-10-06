import * as THREE from 'three';
import { MeshStandardNodeMaterial, MeshPhysicalNodeMaterial, type WebGPURenderer } from 'three/webgpu';
import { color, dFdx, dFdy, Fn, normalMap, texture, uv, vec2 } from 'three/tsl';
import { createRenderer } from '../../rendering/renderer';
import { WebGPUPipeline } from '../../rendering/webgpu-pipeline';
import { defaults } from '../../rendering/graphics-settings';
import { createSurfaceMaterial, prepareSurfaceMaterial, surfaceBias } from '../../rendering/surface-detail';
import { lightingPreset } from '../../levels/lighting-preset';
import { resetMaterialCalibration } from '../../rendering/material-calibration';
import { runFsrExposureProbe } from '../fsr/exposure-probe';

type Sampler = { maxAnisotropy?: number; magFilter?: string; minFilter?: string; mipmapFilter?: string };
type Device = { createSampler(descriptor: Sampler): unknown; queue: { onSubmittedWorkDone(): Promise<void> } };
type Case = 'roles-shared' | 'roles-split' | 'roles-reference' | 'ao-direct' | 'ao-direct-reference' | 'ao-coat' | 'ao-coat-reference' | 'env-diffuse' | 'env-diffuse-owned' | 'env-metal' | 'env-metal-owned' | 'env-coat' | 'env-coat-owned' | 'legacy' | 'mapped' | 'reference' | 'tangents' | 'back' | 'back-reference' | 'transform' | 'transform-reference' | 'depth' | 'depth-off' | 'masked' | 'masked-off' | 'highlight-dry' | 'highlight-dry-reference' | 'highlight-metal' | 'highlight-metal-reference' | 'highlight-smooth' | 'highlight-smooth-reference';
const cases: Case[] = ['roles-shared','roles-split','roles-reference','ao-direct','ao-direct-reference','ao-coat','ao-coat-reference','env-diffuse','env-diffuse-owned','env-metal','env-metal-owned','env-coat','env-coat-owned','legacy', 'mapped', 'reference', 'tangents', 'back', 'back-reference', 'transform', 'transform-reference', 'depth', 'depth-off', 'masked', 'masked-off', 'highlight-dry', 'highlight-dry-reference', 'highlight-metal', 'highlight-metal-reference', 'highlight-smooth', 'highlight-smooth-reference'];

function pixels(renderer: WebGPURenderer) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!; ctx.drawImage(renderer.domElement, 0, 0);
  return { rgba: Array.from(ctx.getImageData(0, 0, 128, 128).data), png: canvas.toDataURL('image/png') };
}
function difference(a: number[], b: number[]) {
  let maximum = 0, sum = 0; for (let i = 0; i < a.length; i++) { const delta = Math.abs(a[i] - b[i]); maximum = Math.max(maximum, delta); sum += delta; }
  return { maximum, mean: sum / a.length };
}
function interior(rgba: number[]): number[] {
  const result: number[] = []; for (let y = 40; y < 88; y++) for (let x = 40; x < 88; x++) result.push(...rgba.slice((y * 128 + x) * 4, (y * 128 + x) * 4 + 4));
  return result;
}
function deviation(rgba: number[]) {
  const values: number[] = []; for (let y = 24; y < 104; y++) for (let x = 24; x < 104; x++) values.push(rgba[(y * 128 + x) * 4]);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
}
/** Synthetic original maps only. Each lane uses the shipping native pipeline. */
export async function runMaterialProbe() {
  if (!import.meta.env.DEV) throw new Error('Material probes require development authoring.');
  resetMaterialCalibration();
  const mount = document.createElement('div'); mount.style.cssText = 'position:fixed;width:128px;height:128px;left:0;top:0;visibility:hidden'; document.body.append(mount);
  const renderer = await createRenderer(mount); renderer.setSize(128, 128);
  const device = Reflect.get(renderer.backend, 'device') as Device, original = device.createSampler.bind(device);
  const samplers: Sampler[] = []; device.createSampler = descriptor => { samplers.push({ ...descriptor }); return original(descriptor); };
  const images: Record<string, ReturnType<typeof pixels>> = {};
  try {
    for (const kind of cases) {
      const scene = new THREE.Scene(); scene.background = new THREE.Color('#000');
      const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, .1, 20);
      camera.position.set(kind.startsWith('depth') || kind.startsWith('masked') ? 1.5 : 0, 0, 5); camera.lookAt(0, 0, 0);
      const look = lightingPreset.lighting;
      const sun = new THREE.DirectionalLight(look.sun.color, look.sun.intensity); sun.position.fromArray(look.sun.position); scene.add(sun, new THREE.HemisphereLight(look.ambient.sky, look.ambient.ground, look.ambient.intensity));
      const aoFixture = kind.startsWith('ao-');
      const enclosure = kind.startsWith('env-') || aoFixture;
      const roles = kind.startsWith('roles-');
      const highlight = kind.startsWith('highlight-') || enclosure || roles;
      let sky: THREE.DataTexture | undefined;
      if (enclosure) {
        const pixels = new Float32Array(128 * 64 * 4).fill(1); sky = new THREE.DataTexture(pixels, 128, 64, THREE.RGBAFormat, THREE.FloatType);
        sky.mapping = THREE.EquirectangularReflectionMapping; sky.needsUpdate = true; scene.environment = sky;
        if (!aoFixture) scene.remove(sun);
      }
      const geometry = highlight ? new THREE.SphereGeometry(1.5, 32, 16) : new THREE.PlaneGeometry(4, 4); geometry.setAttribute('uv2', geometry.getAttribute('uv').clone());
      const reference = kind === 'reference' || kind === 'back-reference' || kind === 'tangents' || kind === 'transform-reference';
      if (!reference && !highlight) geometry.getAttribute('uv').array.fill(.5);
      if (kind === 'tangents') geometry.computeTangents();
      if (kind.startsWith('back')) geometry.rotateY(Math.PI);
      const bytes = new Uint8Array(64 * 64 * 4), colors = new Uint8Array(bytes.length), fields = new Uint8Array(bytes.length);
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        const sx = Math.sin(x / 64 * Math.PI * 8) * .72, i = (y * 64 + x) * 4;
        bytes.set([(sx * .5 + .5) * 255, 128, (Math.sqrt(1 - sx * sx) * .5 + .5) * 255, 255], i);
        const value = (x % 16 < 8) !== (y % 16 < 8) ? 200 : 50; colors.set([value, value, value, 255], i);
        fields.set([(Math.sin(x / 64 * Math.PI * 4) * .4 + .5) * 255, 230, 0, kind.startsWith('masked') ? 0 : 255], i);
      }
      const normal = new THREE.DataTexture(bytes, 64, 64), albedo = new THREE.DataTexture(colors, 64, 64), data = new THREE.DataTexture(fields, 64, 64);
      for (const map of [normal, albedo, data]) { map.channel = 2; map.generateMipmaps = true; map.needsUpdate = true; map.wrapS = map.wrapT = THREE.RepeatWrapping; }
      albedo.colorSpace = roles ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      const transform = kind.startsWith('transform'), depth = kind.startsWith('depth') || kind.startsWith('masked');
      if (transform) { albedo.repeat.set(2, 1); albedo.offset.set(.13, .07); albedo.rotation = .5; }
      const source = new MeshStandardNodeMaterial({ color: '#888888', roughness: highlight ? kind.includes('smooth') ? .25 : .9 : 1,
        metalness: roles || kind.includes('highlight-metal') || kind.includes('env-metal') || kind.includes('env-coat') ? 1 : 0,
        normalMap: highlight || transform || depth ? null : normal, map: !highlight && (transform || depth) ? albedo : null,
        roughnessMap: roles ? kind === 'roles-shared' ? data : normal : depth ? data : null, metalnessMap: roles ? kind === 'roles-shared' ? data : albedo : null, side: kind.startsWith('back') ? THREE.DoubleSide : THREE.FrontSide });
      const material = kind.startsWith('highlight-') && kind.endsWith('reference') ? source : createSurfaceMaterial().copy(source);
      if (material !== source) source.dispose();
      if ((kind.includes('env-coat') || kind.startsWith('ao-coat')) && material instanceof MeshPhysicalNodeMaterial) { material.clearcoat = 1; material.clearcoatRoughness = .2; }
      if (aoFixture) material.emissive.set('#4c210b');
      if (kind === 'roles-reference') {
        prepareSurfaceMaterial(material);
        // Independent fixed bindings, with the same sampling policy as the
        // shared template, provide the expected draw for the split maps.
        material.roughnessNode = Fn(builder => texture(normal, uv(2)).bias(surfaceBias(builder)).g.mul(material.roughness))();
        material.metalnessNode = Fn(builder => texture(albedo, uv(2)).bias(surfaceBias(builder)).b.mul(material.metalness))();
      } else prepareSurfaceMaterial(material, depth ? data : undefined, depth ? .12 : 0, 3);
      if (kind === 'legacy' || kind === 'reference' || kind === 'back-reference') material.normalNode = Fn(builder => {
        const scale = surfaceBias(builder).exp2();
        return normalMap(texture(normal, uv(2)).grad(dFdx(uv(2)).mul(scale), dFdy(uv(2)).mul(scale)), vec2(1));
      })();
      if (kind === 'transform-reference') material.colorNode = Fn(builder => texture(albedo).bias(surfaceBias(builder)).rgb.mul(color(material.color)))();
      const mesh = new THREE.Mesh(geometry, material); scene.add(mesh);
      const pipeline = new WebGPUPipeline(renderer, scene, camera, new THREE.Vector3());
      // Exercise all five scene attachments on the real default-limit device.
      // This unmarked mesh has zero outline strength, preserving the AO pixel
      // comparison while catching the Safari startup failure from AO + outlines.
      pipeline.configure({ ...defaults(), upscaleQuality: 'native', dof: 'off', ao: aoFixture && !kind.endsWith('reference') ? 1 : 0, bloom: 0, outlines: kind === 'ao-direct', textureDepth: kind !== 'depth-off' && kind !== 'masked-off' }, 1, kind.endsWith('-owned') || aoFixture ? { ...look, probes: { position: [0,0,0], size: [10,10,10], resolution: [2,2,2], intensity: 1, bounces: 1 } } : look);
      try {
        await pipeline.ready();
        // Shader skips are not warmup frames. Capture only after 32 completed
        // shared-graph frames, keeping the existing pixel checks unchanged.
        for (let frames = 0; frames < 32;) { await new Promise(requestAnimationFrame); if (pipeline.render()) frames++; }
        await device.queue.onSubmittedWorkDone(); pipeline.render(); images[kind] = pixels(renderer);
      }
      finally { pipeline.dispose(); mesh.dispose(); geometry.dispose(); material.dispose(); [normal, albedo, data].forEach(map => map.dispose()); sky?.dispose(); }
    }
    const fsrExposure = await runFsrExposureProbe(renderer);
    const checks = {
      // Admission: a shared graph must keep separate bindings after an earlier
      // material packed roughness/metalness into one image. Compare native pixels.
      materialRoleBindings: difference(images['roles-split'].rgba, images['roles-reference'].rgba).maximum <= 2,
      fsrExposureDomain: fsrExposure.passed,
      aoDirectEmissionPreserved: difference(interior(images['ao-direct'].rgba), interior(images['ao-direct-reference'].rgba)).maximum <= 1 && difference(images['ao-direct'].rgba, images['ao-direct-reference'].rgba).mean < .3,
      aoClearcoatPreserved: difference(interior(images['ao-coat'].rgba), interior(images['ao-coat-reference'].rgba)).maximum <= 1 && difference(images['ao-coat'].rgba, images['ao-coat-reference'].rgba).mean < .3,
      enclosureDiffuseOwned: difference(images['env-diffuse'].rgba, images['env-diffuse-owned'].rgba).mean > 5,
      enclosureMetalPreserved: difference(interior(images['env-metal'].rgba), interior(images['env-metal-owned'].rgba)).maximum <= 1 && difference(images['env-metal'].rgba, images['env-metal-owned'].rgba).mean < .3,
      enclosureClearcoatPreserved: difference(interior(images['env-coat'].rgba), interior(images['env-coat-owned'].rgba)).maximum <= 1 && difference(images['env-coat'].rgba, images['env-coat-owned'].rgba).mean < .3,
      flatControl: deviation(images.legacy.rgba) < 2,
      alternateUVRelief: deviation(images.mapped.rgba) > 8,
      validUVParity: difference(images.mapped.rgba, images.reference.rgba).maximum <= 2,
      // Authored and derivative frames differ slightly after normalization; bound both peak and average error.
      authoredTangents: difference(images.tangents.rgba, images.reference.rgba).maximum <= 8 && difference(images.tangents.rgba, images.reference.rgba).mean < .25,
      backFaces: difference(images.back.rgba, images['back-reference'].rgba).maximum <= 8,
      textureTransforms: difference(images.transform.rgba, images['transform-reference'].rgba).maximum <= 2,
      parallaxActive: difference(images.depth.rgba, images['depth-off'].rgba).mean > .25,
      atlasMask: difference(images.masked.rgba, images['masked-off'].rgba).maximum <= 2,
      anisotropy: samplers.some(s => s.maxAnisotropy === 16 && s.magFilter === 'linear' && s.minFilter === 'linear' && s.mipmapFilter === 'linear'),
      dryHighlightsRestrained: difference(images['highlight-dry'].rgba, images['highlight-dry-reference'].rgba).mean > .1,
      metallicHighlightsPreserved: difference(images['highlight-metal'].rgba, images['highlight-metal-reference'].rgba).maximum <= 1,
      smoothHighlightsPreserved: difference(images['highlight-smooth'].rgba, images['highlight-smooth-reference'].rgba).maximum <= 1,
    };
    return { passed: Object.values(checks).every(Boolean), checks, fsrExposure, images: Object.fromEntries(Object.entries(images).map(([name, image]) => [name, image.png])) };
  } finally { device.createSampler = original; await renderer.dispose(); mount.remove(); }
}
