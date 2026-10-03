import { encodeGlb } from '../../../lib/glb.mjs';
// three.js handles legacy ASCII FBX that Blender's importer rejects. No licensed content leaves this machine.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, relative } from 'node:path';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
globalThis.window = { URL };
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((result) => { this.result = result; this.onloadend?.(); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then((result) => { this.result = `data:${blob.type};base64,${Buffer.from(result).toString('base64')}`; this.onloadend?.(); }); }
};
const jobs = JSON.parse(await readFile(process.argv[2], 'utf8'));
for (const job of Array.isArray(jobs) ? jobs : [jobs]) {
  const result = { fingerprint: job.fingerprint, status: 'failed' };
  try {
    const manager = new THREE.LoadingManager();
    manager.addHandler(/.*/, { path: '', setPath() { return this; }, load: () => new THREE.Texture() });
    const source = await readFile(job.source);
    const object = new FBXLoader(manager).parse(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength), '');
    const mapping = new Map(); const used = new Set();
    object.traverse((mesh) => {
      if (!mesh.isMesh) return;
      const originals = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const replacements = originals.map((material, index) => {
        const slots = job.materialBindings?.[mesh.name];
        const spec = slots?.[index] ?? job.materials[material.name];
        const replacement = new THREE.MeshStandardMaterial({ name: material.name, color: material.color ?? 0xffffff, roughness: spec?.roughness ?? 0.9, side: spec?.doubleSided ? THREE.DoubleSide : THREE.FrontSide });
        replacement.name = `${mesh.name}:${index}:${material.name}`;
        if (spec) mapping.set(replacement.name, spec);
        return replacement;
      });
      mesh.material = Array.isArray(mesh.material) ? replacements : replacements[0];
    });
    const gltf = await new GLTFExporter().parseAsync(object, { binary: false, onlyVisible: false });
    gltf.images = []; gltf.textures = []; gltf.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }];
    for (const material of gltf.materials ?? []) {
      const spec = mapping.get(material.name); if (!spec) continue;
      material.alphaMode = spec.alphaMode ?? 'OPAQUE'; material.doubleSided = spec.doubleSided ?? false;
      if (material.alphaMode === 'MASK') material.alphaCutoff = spec.alphaCutoff ?? 0.5;
      if (spec.color) material.pbrMetallicRoughness.baseColorFactor = spec.color;
      for (const [channel, map] of Object.entries(spec.textures ?? {})) {
        const path = job.textures[map.id]; used.add(map.id);
        gltf.images.push({ uri: relative(dirname(job.target), path).replaceAll('\\', '/') });
        gltf.textures.push({ source: gltf.images.length - 1, sampler: 0 });
        const info = { index: gltf.textures.length - 1, extensions: { KHR_texture_transform: { offset: [map.offset[0], 1 - map.scale[1] - map.offset[1]], scale: map.scale } } };
        if (channel === 'baseColor') material.pbrMetallicRoughness.baseColorTexture = info;
        if (channel === 'normal') material.normalTexture = info;
        if (channel === 'emissive') { material.emissiveTexture = info; material.emissiveFactor = spec.emissive ?? [1, 1, 1]; }
        gltf.extensionsUsed = [...new Set([...(gltf.extensionsUsed ?? []), 'KHR_texture_transform'])];
      }
    }
    const binary = Buffer.from(gltf.buffers[0].uri.split(',')[1], 'base64'); delete gltf.buffers[0].uri;
    const binPad = Buffer.alloc(Math.ceil(binary.length / 4) * 4); binary.copy(binPad);
    const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(binPad.length); binHeader.writeUInt32LE(0x004e4942, 4);
    const output = encodeGlb(gltf, Buffer.concat([binHeader, binPad])); await mkdir(dirname(job.target), { recursive: true }); await writeFile(job.target, output);
    const bounds = new THREE.Box3().setFromObject(object); const bones = []; object.traverse((o) => { if (o.isBone) bones.push(o.name); });
    Object.assign(result, { status: 'converted', bytes: output.length, bounds: [bounds.min.toArray(), bounds.max.toArray()], rig: { bones }, dependencies: [...used], warnings: ['Converted legacy ASCII FBX using three.js; engine animation clips excluded'] });
  } catch (error) { result.reason = String(error); console.error(job.id, error); }
  await mkdir(dirname(job.result), { recursive: true }); await writeFile(job.result, JSON.stringify(result, null, 2));
}
