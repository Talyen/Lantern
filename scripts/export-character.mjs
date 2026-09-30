/** Combine already retargeted Mixamo clips with the local Synty warrior. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { cli, parseArgs, root } from './lib/cli.mjs';
await cli(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args['--help']) {
    console.log('Usage: npm run assets:export-character (requires assets:export-animation-lab first)');
    return;
  }
  function readGlb(path) {
    const data = readFileSync(path);
    if (data.readUInt32LE(0) !== 0x46546c67 || data.readUInt32LE(4) !== 2 || data.readUInt32LE(8) !== data.length) throw new Error(`Invalid GLB: ${path}`);
    const length = data.readUInt32LE(12);
    if (data.readUInt32LE(16) !== 0x4e4f534a) throw new Error(`Missing GLB JSON: ${path}`);
    const json = JSON.parse(data.subarray(20, 20 + length).toString());
    const binaryStart = 20 + length;
    if (data.readUInt32LE(binaryStart + 4) !== 0x004e4942 || json.buffers.length !== 1 || json.buffers[0].uri) throw new Error(`Expected one embedded buffer: ${path}`);
    const bin = data.subarray(binaryStart + 8, binaryStart + 8 + json.buffers[0].byteLength);
    return { json, bin };
  }
  const sourceDir = resolve(root, 'public/vendor/animations');
  const catalog = JSON.parse(readFileSync(resolve(sourceDir, 'catalog.json'), 'utf8'));
  const pack = catalog.packs.find((p) => p.id === 'mixamo');
  if (!pack) throw new Error('Export Mixamo in the animation lab first.');
  const { json: character, bin } = readGlb(resolve(root, 'public', catalog.character.slice(1)));
  const buffers = [bin];
  const nodes = new Map(character.nodes.map((node, index) => [node.name, index]));
  let byteLength = bin.length;
  character.animations = [];
  const chosen = { idle: 'sword and shield idle', run: 'sword and shield run', attack: 'sword and shield slash', hit: 'sword and shield impact', death: 'sword and shield death' };
  for (const [name, original] of Object.entries(chosen)) {
    const clip = pack.clips.find((c) => c.name === original);
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
        if (node === undefined) throw new Error(`Animation bone missing from Synty character: ${nodeName}`);
        return { ...channel, target: { ...channel.target, node } };
      }),
    });
    byteLength += motion.length;
  }
  character.buffers = [{ byteLength }];
  character.asset.generator = 'Lantern: Synty warrior with retained Mixamo clips';
  const jsonBytes = Buffer.from(JSON.stringify(character));
  const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc((4 - jsonBytes.length % 4) % 4, 0x20)]);
  const binary = Buffer.concat([...buffers, Buffer.alloc((4 - byteLength % 4) % 4)]);
  const header = Buffer.alloc(20); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + jsonChunk.length + binary.length, 8); header.writeUInt32LE(jsonChunk.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(binary.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
  const output = resolve(root, 'public/vendor/characters/prototype.glb');
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, Buffer.concat([header, jsonChunk, binHeader, binary]));
  console.log(`Exported Synty warrior with Mixamo clips: ${Object.values(chosen).join(', ')}`);

});
