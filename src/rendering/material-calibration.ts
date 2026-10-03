import { float, uniform } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { calibrationFamily, calibrationStrengths, type CalibrationFamily, type MaterialFamily } from './material-recipes';
const gains = { stone: uniform(1), bark: uniform(1), ground: uniform(1) };
/** Development-only coupled normal/height comparison. Never saved to player options. */
export function calibrationGain(family: MaterialFamily): Node<'float'> {
  const group = calibrationFamily(family);
  return import.meta.env.DEV && group ? gains[group] : float(1);
}
export function setMaterialCalibration(family: CalibrationFamily, strength: number): void {
  if (!import.meta.env.DEV) return;
  if (!Object.hasOwn(gains, family) || !calibrationStrengths.some(value => value === strength)) throw new Error('Unsupported material comparison.');
  gains[family].value = strength;
}
export function resetMaterialCalibration(): void { Object.values(gains).forEach(gain => { gain.value = 1; }); }
export function materialCalibration() { return Object.fromEntries(Object.entries(gains).map(([key, gain]) => [key, gain.value])); }
