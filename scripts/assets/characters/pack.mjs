/** Assemble locally baked clips without modifying mesh, texture or rig buffers. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { root } from '../../lib/cli.mjs';
import { parseGlb, encodeGlb } from '../../lib/glb.mjs';
export function packCharacter(characterUrl, catalogPath, output) {
  function readGlb(path) {
    const { json, tail } = parseGlb(readFileSync(path), path);
    if (tail.length < 8 || tail.readUInt32LE(4) !== 0x004e4942 || tail.readUInt32LE(0) !== tail.length - 8
      || json.buffers?.length !== 1 || json.buffers[0].uri || json.buffers[0].byteLength > tail.length - 8)
      throw new Error(`Expected one embedded buffer: ${path}`);
    const bin = tail.subarray(8, 8 + json.buffers[0].byteLength);
    return { json, bin };
  }
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  const pack = catalog.packs.find((p) => p.id === 'mixamo');
  if (!pack) throw new Error('Prepare compatible Mixamo motions first.');
  const { json: character, bin } = readGlb(resolve(root, 'public', characterUrl.slice(1)));
  const buffers = [bin];
  const nodes = new Map(character.nodes.map((node, index) => [node.name, index]));
  let byteLength = bin.length;
  character.animations = [];
  const chosen = catalog.defaults;
  for (const [name, original] of Object.entries(chosen)) {
    const clip = pack.clips.find((c) => c.id === original || c.name === original);
    if (!clip) throw new Error(`Missing retained clip: ${original}`);
    const { json, bin: motion } = readGlb(resolve(root, 'public', clip.url.slice(1)));
    if (json.animations.length !== 1) throw new Error(`Expected one clip: ${original}`);
    const pad = (4 - byteLength % 4) % 4;
    buffers.push(Buffer.alloc(pad), motion);
    byteLength += pad;
    const viewOffset = character.bufferViews.length;
    const accessorOffset = character.accessors.length;
    character.bufferViews.push(...json.bufferViews.map((view) => ({ ...view, buffer: 0, byteOffset: (view.byteOffset ?? 0) + byteLength })));
    character.accessors.push(...json.accessors.map((accessor) => {
      if (accessor.sparse) throw new Error(`Sparse animation accessors are unsupported: ${original}`);
      return { ...accessor, ...(accessor.bufferView !== undefined ? { bufferView: accessor.bufferView + viewOffset } : {}) };
    }));
    const animation = json.animations[0];
    character.animations.push({
      ...animation, name,
      samplers: animation.samplers.map((sampler) => ({ ...sampler, input: sampler.input + accessorOffset, output: sampler.output + accessorOffset })),
      channels: animation.channels.map((channel) => {
        const nodeName = json.nodes[channel.target.node].name;
        const node = nodes.get(nodeName);
        if (node === undefined) throw new Error(`Animation bone missing from character: ${nodeName}`);
        return { ...channel, target: { ...channel.target, node } };
      }),
    });
    byteLength += motion.length;
  }
  character.buffers = [{ byteLength }];
  character.asset.generator = 'Lantern: compatible retained Mixamo clips';
  const binary = Buffer.concat([...buffers, Buffer.alloc((4 - byteLength % 4) % 4)]);
  const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(binary.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, encodeGlb(character, Buffer.concat([binHeader, binary])));
}
