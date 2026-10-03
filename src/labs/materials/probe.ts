import * as THREE from 'three';
import { MeshStandardNodeMaterial, type WebGPURenderer } from 'three/webgpu';
import { color, dFdx, dFdy, float, normalMap, texture, uv, vec2 } from 'three/tsl';
import { createRenderer } from '../../rendering/renderer';
import { WebGPUPipeline } from '../../rendering/webgpu-pipeline';
import { defaults } from '../../rendering/graphics-settings';
import { prepareSurfaceMaterial } from '../../rendering/surface-detail';
import { lightingPreset } from '../../levels/lighting-preset';
import { resetMaterialCalibration } from '../../rendering/material-calibration';

type Sampler = { maxAnisotropy?: number; magFilter?: string; minFilter?: string; mipmapFilter?: string };
type Device = { createSampler(descriptor: Sampler): unknown; queue: { onSubmittedWorkDone(): Promise<void> } };
type Case = 'legacy' | 'mapped' | 'reference' | 'tangents' | 'back' | 'back-reference' | 'transform' | 'transform-reference' | 'depth' | 'depth-off' | 'masked' | 'masked-off';
const cases: Case[] = ['legacy', 'mapped', 'reference', 'tangents', 'back', 'back-reference', 'transform', 'transform-reference', 'depth', 'depth-off', 'masked', 'masked-off'];

function pixels(renderer: WebGPURenderer) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!; ctx.drawImage(renderer.domElement, 0, 0);
  return { rgba: Array.from(ctx.getImageData(0, 0, 128, 128).data), png: canvas.toDataURL('image/png') };
}
function difference(a: number[], b: number[]) {
  let maximum = 0, sum = 0; for (let i = 0; i < a.length; i++) { const delta = Math.abs(a[i] - b[i]); maximum = Math.max(maximum, delta); sum += delta; }
  return { maximum, mean: sum / a.length };
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
      const geometry = new THREE.PlaneGeometry(4, 4); geometry.setAttribute('uv2', geometry.getAttribute('uv').clone());
      const reference = kind === 'reference' || kind === 'back-reference' || kind === 'tangents' || kind === 'transform-reference';
      if (!reference) geometry.getAttribute('uv').array.fill(.5);
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
      albedo.colorSpace = THREE.SRGBColorSpace;
      const transform = kind.startsWith('transform'), depth = kind.startsWith('depth') || kind.startsWith('masked');
      if (transform) { albedo.repeat.set(2, 1); albedo.offset.set(.13, .07); albedo.rotation = .5; }
      const material = new MeshStandardNodeMaterial({ color: '#888888', roughness: 1, normalMap: transform || depth ? null : normal, map: transform || depth ? albedo : null, roughnessMap: depth ? data : null, side: kind.startsWith('back') ? THREE.DoubleSide : THREE.FrontSide });
      prepareSurfaceMaterial(material, depth ? data : undefined, depth ? .12 : 0, 3);
      if (kind === 'legacy' || kind === 'reference' || kind === 'back-reference') material.normalNode = normalMap(texture(normal, uv(2)).grad(dFdx(uv(2)), dFdy(uv(2))), vec2(1));
      if (kind === 'transform-reference') material.colorNode = texture(albedo).bias(float(0)).rgb.mul(color(material.color));
      const mesh = new THREE.Mesh(geometry, material); scene.add(mesh);
      const pipeline = new WebGPUPipeline(renderer, scene, camera, new THREE.Vector3());
      pipeline.configure({ ...defaults(), upscaleQuality: 'native', dof: 'off', ao: 0, bloom: 0, outlines: false, textureDepth: kind !== 'depth-off' && kind !== 'masked-off' }, 1);
      try { await pipeline.ready(); for (let i = 0; i < 32; i++) { await new Promise(requestAnimationFrame); pipeline.render(); } await device.queue.onSubmittedWorkDone(); pipeline.render(); images[kind] = pixels(renderer); }
      finally { pipeline.dispose(); mesh.dispose(); geometry.dispose(); material.dispose(); [normal, albedo, data].forEach(map => map.dispose()); }
    }
    const checks = {
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
    };
    return { passed: Object.values(checks).every(Boolean), checks, images: Object.fromEntries(Object.entries(images).map(([name, image]) => [name, image.png])) };
  } finally { device.createSampler = original; await renderer.dispose(); mount.remove(); }
}
