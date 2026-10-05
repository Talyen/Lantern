import { DataUtils, type WebGPURenderer } from 'three/webgpu';
import accumulationShader from '../../rendering/fsr-accumulate.wgsl?raw';

// Exercise the shipping shader, rather than a CPU copy of its exposure math.
// The native r186 device methods are absent from three's declarations.
type Buffer = { mapAsync(mode: number): Promise<void>; getMappedRange(): ArrayBuffer; unmap(): void; destroy(): void };
type Texture = { createView(): unknown; destroy(): void };
type Pipeline = { getBindGroupLayout(index: number): unknown };
type Device = {
  createShaderModule(options: { code: string }): unknown;
  createComputePipelineAsync(options: { layout: 'auto'; compute: { module: unknown; entryPoint: string } }): Promise<Pipeline>;
  createTexture(options: { size: number[]; format: string; usage: number }): Texture;
  createBuffer(options: { size: number; usage: number }): Buffer;
  createSampler(options: { magFilter: string; minFilter: string }): unknown;
  createBindGroup(options: { layout: unknown; entries: { binding: number; resource: unknown }[] }): unknown;
  createCommandEncoder(): {
    beginComputePass(): { setPipeline(pipeline: Pipeline): void; setBindGroup(index: number, group: unknown): void; dispatchWorkgroups(x: number, y: number): void; end(): void };
    copyTextureToBuffer(source: { texture: Texture }, destination: { buffer: Buffer; bytesPerRow: number }, size: number[]): void;
    finish(): unknown;
  };
  queue: {
    writeBuffer(buffer: Buffer, offset: number, data: ArrayBufferView): void;
    writeTexture(destination: { texture: Texture }, data: ArrayBufferView, layout: { bytesPerRow: number }, size: number[]): void;
    submit(commands: unknown[]): void;
  };
};

/** Small, original GPU fixture: exposure must not alter unchanged HDR color. */
export async function runFsrExposureProbe(renderer: WebGPURenderer) {
  if (!import.meta.env.DEV) throw new Error('FSR probes require development authoring.');
  const device = Reflect.get(renderer.backend, 'device') as Device;
  const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module: device.createShaderModule({ code: accumulationShader }), entryPoint: 'main' } });
  const resources: { destroy(): void }[] = [];
  const texture = (value: number[], output = false) => {
    // COPY_SRC | COPY_DST | TEXTURE_BINDING | STORAGE_BINDING
    const target = device.createTexture({ size: [8, 8], format: 'rgba16float', usage: output ? 13 : 6 }); resources.push(target);
    if (!output) {
      const data = new Uint16Array(8 * 8 * 4);
      for (let i = 0; i < data.length; i++) data[i] = DataUtils.toHalfFloat(value[i % 4] ?? 0);
      device.queue.writeTexture({ texture: target }, data, { bytesPerRow: 64 }, [8, 8]);
    }
    return target;
  };
  const constants = device.createBuffer({ size: 96, usage: 72 }); resources.push(constants); // UNIFORM | COPY_DST
  const readback = device.createBuffer({ size: 8 * 256, usage: 9 }); resources.push(readback); // MAP_READ | COPY_DST
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const rgb = [.2, .4, .1], conditioned = (exposure: number) => rgb.map(channel => channel * exposure / (1 + .4 * exposure));
  const zero = texture([0, 0, 0, 0]), color = texture([...rgb, 1]);
  const out = texture([], true), locks = texture([], true);
  const cases = [
    { name: 'conditioning-increase', previous: 1, current: 2, host: 1, reset: false },
    { name: 'conditioning-decrease', previous: 2, current: .5, host: 1, reset: false },
    { name: 'combined-host-conditioning', previous: 2, current: .5, host: 2, reset: false },
    { name: 'reset', previous: 0, current: 2, host: 1, reset: true },
    { name: 'uninitialized-exposure', previous: 0, current: 1, host: 1, reset: false },
  ];
  const checks: Record<string, { passed: boolean; maximumError: number }> = {};
  try {
    for (const test of cases) {
      // Host changes are already baked into the current input. Previous host=1.
      const input = test.host === 1 ? color : texture([...rgb.map(c => c * test.host), 1]);
      const history = texture([...conditioned(test.previous || 1), 1]);
      const current = texture([test.current, 0, test.host, 0]);
      const previous = texture([test.previous, 0, 1, 0]);
      const values = new Float32Array(24);
      values.set([8, 8, 8, 8, 1 / 8, 1 / 8, 1 / 8, 1 / 8]); values[17] = 24;
      new Uint32Array(values.buffer)[20] = test.reset ? 1 : 0;
      device.queue.writeBuffer(constants, 0, values);
      const bindings = [{ buffer: constants }, input.createView(), zero.createView(), zero.createView(), history.createView(), sampler,
        out.createView(), zero.createView(), locks.createView(), current.createView(), zero.createView(), previous.createView(), zero.createView()];
      const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: bindings.map((resource, binding) => ({ binding, resource })) });
      const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
      pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(1, 1); pass.end();
      encoder.copyTextureToBuffer({ texture: out }, { buffer: readback, bytesPerRow: 256 }, [8, 8]); device.queue.submit([encoder.finish()]);
      await readback.mapAsync(1);
      const pixels = new Uint16Array(readback.getMappedRange()), expected = conditioned(test.current * test.host);
      let maximumError = 0;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) for (let c = 0; c < 3; c++) {
        const actual = DataUtils.fromHalfFloat(pixels[y * 128 + x * 4 + c]);
        maximumError = Number.isFinite(actual) ? Math.max(maximumError, Math.abs(actual - expected[c])) : Infinity;
      }
      readback.unmap(); checks[test.name] = { passed: maximumError < .001, maximumError };
    }
    return { passed: Object.values(checks).every(check => check.passed), checks };
  } finally { resources.forEach(resource => resource.destroy()); }
}
