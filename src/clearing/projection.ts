/** Fixed gameplay projection. Existing area envelopes never resize when this changes. */
export const cameraOffset = [12, Math.hypot(12, 12) * Math.tan(35 * Math.PI / 180), 12] as const;
export const desktopViewHeight = 13.5;
