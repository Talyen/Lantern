import { afterEach, expect, it, vi } from 'vitest';
import { FrameLoop } from '../src/session/frame-loop';

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

// Admission: failure recovery must reject pending frame waits and stop scheduling,
// then resume with no elapsed-time catch-up. Destination-failure coverage does not exercise retry.
it('suspends failed presentation until recovery and resumes without advancing the paused interval', async () => {
  let frame: FrameRequestCallback | undefined, requests = 0, failed = false;
  const deltas: number[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return ++requests; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  const loop = new FrameLoop({ hidden: () => false, paused: () => false, fpsLimit: () => 60,
    onPause: () => {}, render: dt => {
      deltas.push(dt);
      if (failed) { loop.suspend(new Error('Display unavailable')); return false; }
      return true;
    } });
  const readiness = expect(loop.waitFrames(2)).rejects.toThrow('Display unavailable');
  loop.start(); frame!(0);
  failed = true; frame!(20);
  await readiness;
  const suspendedRequests = requests;
  loop.invalidate();
  expect(requests).toBe(suspendedRequests);
  failed = false; loop.setManual(false); frame!(10000);
  expect(deltas.at(-1)).toBe(0);
  loop.dispose();
});
