// Minimal single-track WebM muxer for private, timestamped browser captures.
// Encoded timestamps follow simulation frames, independently of capture wall time.
const bytes = (value: number[]) => new Uint8Array(value);
function join(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let at = 0; for (const part of parts) { result.set(part, at); at += part.length; } return result;
}
function size(value: number): Uint8Array {
  let length = 1; while (value >= 2 ** (7 * length) - 1) length++;
  const result = new Uint8Array(length); let remaining = value;
  for (let i = length - 1; i >= 0; i--) { result[i] = remaining % 256; remaining = Math.floor(remaining / 256); }
  result[0] |= 1 << (8 - length); return result;
}
function element(id: number[], data: Uint8Array): Uint8Array { return join([bytes(id), size(data.length), data]); }
function integer(id: number[], value: number): Uint8Array {
  const data: number[] = []; do { data.unshift(value % 256); value = Math.floor(value / 256); } while (value); return element(id, bytes(data));
}
const textElement = (id: number[], value: string) => element(id, new TextEncoder().encode(value));
export class ComparisonVideo {
  private chunks: { timestamp: number; key: boolean; data: Uint8Array }[] = [];
  private encoder: VideoEncoder;
  private error?: Error;
  constructor(private width: number, private height: number) {
    this.encoder = new VideoEncoder({ output: chunk => {
      const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
      this.chunks.push({ timestamp: chunk.timestamp, key: chunk.type === 'key', data });
    }, error: error => { this.error = error; } });
    this.encoder.configure({ codec: 'vp8', width, height, bitrate: 24000000, framerate: 60, latencyMode: 'realtime' });
  }
  async frame(canvas: HTMLCanvasElement, index: number): Promise<void> {
    if (this.error) throw this.error;
    const frame = new VideoFrame(canvas, { timestamp: Math.round(index * 1000000 / 60), duration: Math.round(1000000 / 60) });
    try { this.encoder.encode(frame, { keyFrame: index % 60 === 0 }); } finally { frame.close(); }
    if (this.encoder.encodeQueueSize > 8) await this.encoder.flush();
  }
  async finish(): Promise<string> {
    try {
      await this.encoder.flush(); if (this.error) throw this.error;
      const header = element([0x1a, 0x45, 0xdf, 0xa3], join([integer([0x42,0x86],1), integer([0x42,0xf7],1), integer([0x42,0xf2],4), integer([0x42,0xf3],8), textElement([0x42,0x82],'webm'), integer([0x42,0x87],2), integer([0x42,0x85],2)]));
      const duration = new Uint8Array(8); new DataView(duration.buffer).setFloat64(0, this.chunks.length / 60 * 1000);
      const info = element([0x15,0x49,0xa9,0x66], join([integer([0x2a,0xd7,0xb1],1000000), element([0x44,0x89],duration), textElement([0x4d,0x80],'Lantern comparison'), textElement([0x57,0x41],'Lantern comparison')]));
      const video = element([0xe0], join([integer([0xb0],this.width), integer([0xba],this.height)]));
      const tracks = element([0x16,0x54,0xae,0x6b], element([0xae], join([integer([0xd7],1),integer([0x73,0xc5],1),integer([0x83],1),textElement([0x86],'V_VP8'),integer([0x23,0xe3,0x83],16666667),video])));
      const clusters = this.chunks.map(chunk => element([0x1f,0x43,0xb6,0x75], join([integer([0xe7],Math.round(chunk.timestamp / 1000)),element([0xa3],join([bytes([0x81,0,0,chunk.key ? 0x80 : 0]),chunk.data]))])));
      const webm = join([header,bytes([0x18,0x53,0x80,0x67,0x01,0xff,0xff,0xff,0xff,0xff,0xff,0xff]),info,tracks,...clusters]);
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Unable to read comparison video.'));
        reader.readAsDataURL(new Blob([webm], { type: 'video/webm' }));
      });
    } finally { this.encoder.close(); }
  }
  close(): void { if (this.encoder.state !== 'closed') this.encoder.close(); }
}
