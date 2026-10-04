/** GLB framing only; callers own dependency and schema validation. */
export function glbJsonLength(header, size, name) {
  if (header.length < 20 || header.readUInt32LE(0) !== 0x46546c67 || header.readUInt32LE(4) !== 2
    || header.readUInt32LE(8) !== size || header.readUInt32LE(16) !== 0x4e4f534a) throw new Error(`Malformed GLB: ${name}`);
  const length = header.readUInt32LE(12);
  if (length % 4 || length > size - 20 || length > 32 * 1024 * 1024) throw new Error(`Invalid GLB JSON length: ${name}`);
  return length;
}
export function parseGlb(bytes, name) {
  const length = glbJsonLength(bytes, bytes.length, name);
  return { json: JSON.parse(bytes.subarray(20, 20 + length).toString()), tail: bytes.subarray(20 + length) };
}
/** Animation packing and static imports accept one well-framed embedded buffer. */
export function embeddedGlb(bytes, name) {
  const { json, tail } = parseGlb(bytes, name), length = json.buffers?.[0]?.byteLength;
  if (json.buffers?.length !== 1 || json.buffers[0].uri || !Number.isSafeInteger(length) || length < 0
    || tail.length < 8 || tail.readUInt32LE(4) !== 0x004e4942 || tail.readUInt32LE(0) !== tail.length - 8
    || length > tail.length - 8 || tail.length - 8 - length > 3)
    throw new Error(`Expected one embedded buffer: ${name}`);
  return { json, tail, bin: tail.subarray(8, 8 + length) };
}
/** Preserve binary/extension chunks byte-for-byte when changing JSON metadata. */
export function encodeGlb(json, tail) {
  const encoded = Buffer.from(JSON.stringify(json));
  const padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 0x20); encoded.copy(padded);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + padded.length + tail.length, 8);
  header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([header, padded, tail]);
}
