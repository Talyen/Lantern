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
  renderer.getSize(logicalSize);
  renderer.setDrawingBufferSize(logicalSize.x, logicalSize.y, ratio);
  return true;
}
export function resizeDisplay(renderer: WebGPURenderer, width: number, height: number): void {
  const ratio = displayPixelRatio();
  renderer.getSize(logicalSize);
  const sizeChanged = logicalSize.x !== width || logicalSize.y !== height;
  if (renderer.getPixelRatio() !== ratio) {
    // r186 setPixelRatio resizes the old logical size. Commit both domains once.
    renderer.setDrawingBufferSize(width, height, ratio);
    if (sizeChanged) {
      renderer.domElement.style.width = `${width}px`;
      renderer.domElement.style.height = `${height}px`;
    }
  } else if (sizeChanged) renderer.setSize(width, height);
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
