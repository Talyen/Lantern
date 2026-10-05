import { afterEach, expect, test, vi } from 'vitest';
import { Vector2 } from 'three';
import CanvasTarget from 'three/src/renderers/common/CanvasTarget.js';
import type { WebGPURenderer } from 'three/webgpu';
import { resizeDisplay, syncDisplayResolution } from '../src/rendering/display-resolution';
afterEach(() => vi.unstubAllGlobals());

// Admission: preserve Retina output and CSS alignment while committing size/density atomically.
// The former mock hid setPixelRatio's implicit resize; the pinned canvas target exposes real buffer requests.
test('display output commits logical size and physical density together without redundant resizes', () => {
  const canvas = { width: 1470, height: 738, style: { width: '1470px', height: '738px' } } as HTMLCanvasElement;
  const target = new CanvasTarget(canvas), renderer = target as unknown as WebGPURenderer;
  const outputs: number[][] = [];
  target.addEventListener('resize', () => { outputs.push([canvas.width, canvas.height]); });
  try {
    vi.stubGlobal('window', { devicePixelRatio: 2 });
    resizeDisplay(renderer, 1470, 738);
    expect(outputs).toEqual([[2940, 1476]]);
    expect(target.getSize(new Vector2()).toArray()).toEqual([1470, 738]);
    outputs.length = 0;
    resizeDisplay(renderer, 1470, 738);
    expect(outputs).toEqual([]);

    vi.stubGlobal('window', { devicePixelRatio: 1.5 });
    resizeDisplay(renderer, 1000, 600);
    expect(outputs).toEqual([[1500, 900]]);
    expect(canvas.style).toEqual({ width: '1000px', height: '600px' });
    expect(target.getSize(new Vector2()).toArray()).toEqual([1000, 600]);
    outputs.length = 0;

    vi.stubGlobal('window', { devicePixelRatio: 1 });
    expect(syncDisplayResolution(renderer)).toBe(true);
    expect(outputs).toEqual([[1000, 600]]);
    expect(canvas.style).toEqual({ width: '1000px', height: '600px' });
    expect(syncDisplayResolution(renderer)).toBe(false);
  } finally { target.dispose(); }
});
