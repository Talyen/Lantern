import { afterEach, expect, it, vi } from 'vitest';
import { FrameLoop } from '../src/clearing/frame-loop';

afterEach(() => vi.unstubAllGlobals());

it('rejects destination readiness when rendering fails instead of leaving loading pending', async () => {
  let frame: FrameRequestCallback | undefined;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  const failure = new Error('WebGPU render failed');
  const loop = new FrameLoop({ hidden: () => false, paused: () => true, fpsLimit: () => 60,
    onPause: () => {}, render: () => { throw failure; } });
  const readiness = expect(loop.waitFrames(2)).rejects.toBe(failure);
  loop.start();
  expect(() => frame!(0)).toThrow(failure);
  await readiness;
  loop.dispose();
});
