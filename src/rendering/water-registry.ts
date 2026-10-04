import type { Scene } from 'three';

const scenes = new WeakMap<Scene, { revision: number; planes: Map<number, number> }>();
export function waterPlanes(scene: Scene) {
  let state = scenes.get(scene);
  if (!state) { state = { revision: 0, planes: new Map() }; scenes.set(scene, state); }
  return state;
}
/** Surface lifetimes bound the shared pipeline's reflected views, including area replacement. */
export function registerWaterPlane(scene: Scene, height: number): () => void {
  const state = waterPlanes(scene); state.planes.set(height, (state.planes.get(height) ?? 0) + 1); state.revision++;
  let released = false;
  return () => {
    if (released) return; released = true;
    const count = (state.planes.get(height) ?? 1) - 1;
    if (count) state.planes.set(height, count); else state.planes.delete(height);
    state.revision++;
  };
}
