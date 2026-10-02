/** External JSON stays unknown until its owning save, preference or asset schema validates it. */
export function parseJson(source: string): unknown { return JSON.parse(source); }
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
