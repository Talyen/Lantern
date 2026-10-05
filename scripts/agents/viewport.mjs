import { UsageError } from '../lib/cli.mjs';

export function previewViewport(viewport, density) {
  const dimensions = viewport === undefined ? [1920, 1080] : String(viewport).match(/^(\d+)x(\d+)$/)?.slice(1).map(Number);
  if (!dimensions || dimensions.some(value => !Number.isSafeInteger(value) || value <= 0 || value > 2147483647)) throw new UsageError('--viewport must be positive integer WIDTHxHEIGHT dimensions.');
  const dpr = density === undefined ? 1 : Number(density);
  if (!Number.isFinite(dpr) || dpr <= 0) throw new UsageError('--dpr must be a positive finite number.');
  return { width: dimensions[0], height: dimensions[1], dpr };
}
