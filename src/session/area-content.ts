import type * as LevelValidation from '../levels/validation';
import type * as LevelLighting from '../levels/lighting';
import type * as LevelRegistry from '../levels/registry';
import { areas } from '../levels/registry';
import { resolveAreaLighting } from '../levels/lighting';
import { validateAreas } from '../levels/validation';
import type { AreaDefinition } from '../levels/types';

export type AreaContent = { definitions: Record<string, AreaDefinition>; validate: typeof validateAreas; lighting: typeof resolveAreaLighting };
export type AreaContentUpdate =
  | { kind: 'registry'; definitions: AreaContent['definitions'] }
  | { kind: 'lighting'; lighting: AreaContent['lighting'] }
  | { kind: 'validation'; validate: AreaContent['validate'] };
const latest: AreaContent = { definitions: areas, validate: validateAreas, lighting: resolveAreaLighting };
let observer: ((update: AreaContentUpdate) => void) | undefined;

/** Each session owns its accepted definitions; a later session starts with the latest modules. */
export function createAreaContent(): AreaContent { return { ...latest }; }
export function observeAreaContent(update: (value: AreaContentUpdate) => void): () => void {
  observer = update;
  return () => { if (observer === update) observer = undefined; };
}

// Accept at the session import owner so development extraction adds no unaccepted import path.
if (import.meta.hot) {
  import.meta.hot.accept('../levels/registry', module => {
    if (module) { latest.definitions = (module as unknown as typeof LevelRegistry).areas; observer?.({ kind: 'registry', definitions: latest.definitions }); }
  });
  import.meta.hot.accept('../levels/lighting', module => {
    if (module) { latest.lighting = (module as unknown as typeof LevelLighting).resolveAreaLighting; observer?.({ kind: 'lighting', lighting: latest.lighting }); }
  });
  import.meta.hot.accept('../levels/validation', module => {
    if (module) { latest.validate = (module as unknown as typeof LevelValidation).validateAreas; observer?.({ kind: 'validation', validate: latest.validate }); }
  });
}
