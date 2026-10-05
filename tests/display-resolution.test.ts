import { afterEach, expect, test, vi } from 'vitest';
import { Vector2 } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { resizeDisplay } from '../src/rendering/display-resolution';
afterEach(() => vi.unstubAllGlobals());
// A stale CSS-pixel canvas can blur Retina output and corrupt resize/history domains.
test('display output follows physical density without multiplying logical sizes twice', () => {
  let ratio = 1; const size = new Vector2(1470, 738);
  const renderer = { getPixelRatio: () => ratio, setPixelRatio: vi.fn((value: number) => { ratio = value; }), getSize: (target: Vector2) => target.copy(size), setSize: vi.fn((w: number, h: number) => size.set(w, h)) } as unknown as WebGPURenderer;
  vi.stubGlobal('window', { devicePixelRatio: 2 });
  resizeDisplay(renderer, 1470, 738);
  expect(ratio).toBe(2); expect(size.toArray()).toEqual([1470, 738]);
  resizeDisplay(renderer, 1470, 738); expect(renderer.setPixelRatio).toHaveBeenCalledTimes(1); expect(renderer.setSize).not.toHaveBeenCalled();
  vi.stubGlobal('window', { devicePixelRatio: 1.5 }); resizeDisplay(renderer, 1000, 600);
  expect(ratio).toBe(1.5); expect(size.toArray()).toEqual([1000, 600]);
});
