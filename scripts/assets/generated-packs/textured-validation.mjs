import { createHash } from 'node:crypto';
import { crc32, inflateSync } from 'node:zlib';
import { Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { embeddedGlb } from '../../lib/glb.mjs';
import { inspectModel, prepareModel } from './validate.mjs';

/** Decode the compressed PNG stream and check framing without changing source pixels. */
export function inspectPNG(bytes, name) {
  const fail = () => { throw new Error(`Invalid or unsupported PNG: ${name}`); };
  if (bytes.length < 45 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
    || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') fail();
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20), bitDepth = bytes[24];
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[bytes[25]];
  if (!width || !height || width > 8192 || height > 8192 || !channels || ![8, 16].includes(bitDepth) || bytes[26] || bytes[27] || bytes[28]) fail();
  const chunks = [];
  let ended = false;
  for (let offset = 8; offset < bytes.length;) {
    if (offset + 12 > bytes.length) fail();
    const length = bytes.readUInt32BE(offset), end = offset + length + 12;
    if (end > bytes.length || crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) fail();
    const kind = bytes.toString('ascii', offset + 4, offset + 8);
    if (kind === 'IDAT') chunks.push(bytes.subarray(offset + 8, end - 4));
    offset = end;
    if (kind === 'IEND') { ended = length === 0 && end === bytes.length; break; }
  }
  const row = width * channels * bitDepth / 8 + 1;
  const decoded = inflateSync(Buffer.concat(chunks), { maxOutputLength: row * height });
  if (!ended || decoded.length !== row * height) fail();
  for (let offset = 0; offset < decoded.length; offset += row) if (decoded[offset] > 4) fail();
  return { width, height, bitDepth, channels, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/** Headless inspection retains the pinned loader's texture bindings and sampler conversion. */
export async function inspectTexturedModel(source, name, expected = {}) {
  const output = prepareModel(source, name, { embeddedTextures: true });
  const { json, bin } = embeddedGlb(output.bytes, name);
  const images = (json.images ?? []).map((image, index) => {
    const view = json.bufferViews?.[image.bufferView];
    if (image.uri || image.mimeType !== 'image/png' || !view) throw new Error(`Expected embedded PNG: ${name}/${index}`);
    return inspectPNG(bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength), `${name}/${index}`);
  });
  for (const texture of json.textures ?? []) if (!images[texture.source] || texture.extensions
    || texture.sampler !== undefined && !json.samplers?.[texture.sampler]) throw new Error(`Invalid embedded texture: ${name}`);
  for (const material of json.materials ?? []) {
    const mappings = [material.pbrMetallicRoughness?.baseColorTexture, material.pbrMetallicRoughness?.metallicRoughnessTexture,
      material.normalTexture, material.occlusionTexture, material.emissiveTexture].filter(Boolean);
    if (mappings.some(mapping => !json.textures?.[mapping.index] || mapping.extensions)) throw new Error(`Invalid material texture binding: ${name}`);
  }
  // Browser image decoding is deliberately outside this CLI. PNG streams above are validated;
  // the loader uses dimensions-only images here, while applying its normal PBR/color-space rules.
  const loader = new GLTFLoader().register(parser => ({ name: 'LANTERN_source_image_inspection', beforeRoot() {
    parser.loadImageSource = async index => {
      if (!images[index]) throw new Error(`Missing embedded image: ${name}/${index}`);
      return new Texture({ width: images[index].width, height: images[index].height });
    };
  } }));
  const checked = await inspectModel(output.bytes, name, { preciseBounds: true, ...expected }, { loader, transparent: true });
  return { ...output, checked: { ...checked, images } };
}
