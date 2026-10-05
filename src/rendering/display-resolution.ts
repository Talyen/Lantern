import { Vector2 } from 'three';
import type { WebGPURenderer } from 'three/webgpu';

const logicalSize = new Vector2();
/** Physical output is independent of the chosen FSR internal resolution. */
export function displayPixelRatio(): number {
  const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}
export function syncDisplayResolution(renderer: WebGPURenderer): boolean {
  const ratio = displayPixelRatio();
  if (renderer.getPixelRatio() === ratio) return false;
  renderer.setPixelRatio(ratio);
  return true;
}
export function resizeDisplay(renderer: WebGPURenderer, width: number, height: number): void {
  syncDisplayResolution(renderer);
  renderer.getSize(logicalSize);
  if (logicalSize.x !== width || logicalSize.y !== height) renderer.setSize(width, height);
}

/** A display-density change can occur without a CSS-size change, while paused. */
export function watchDisplayResolution(): void {
  const key = Symbol.for('lantern.displayResolutionWatcher');
  if (typeof window === 'undefined' || Reflect.get(window, key)) return;
  Reflect.set(window, key, true);
  const subscribe = () => {
    window.matchMedia(`(resolution: ${displayPixelRatio()}dppx)`).addEventListener('change', () => {
      subscribe(); window.dispatchEvent(new Event('resize'));
    }, { once: true });
  };
  subscribe();
}
