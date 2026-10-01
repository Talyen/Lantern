import { buildNavigation, type NavigationGeometry } from './navigation';

// Runtime tree changes must not spend the contact frame voxelizing the entire area.
self.onmessage = (event: MessageEvent<{ revision: number; geometry: NavigationGeometry }>) => {
  const { revision, geometry } = event.data;
  try { self.postMessage({ revision, nav: buildNavigation(geometry) }); }
  catch (error) { self.postMessage({ revision, error: error instanceof Error ? error.message : String(error) }); }
};
