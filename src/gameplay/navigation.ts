import { generateSoloNavMesh } from 'navcat/blocks';
import type { NavMesh } from 'navcat';

export type NavigationGeometry = { positions: number[]; indices: number[] };

/** Shared generation settings keep runtime tree updates identical to initial area navigation. */
export function buildNavigation(geometry: NavigationGeometry): NavMesh {
  return generateSoloNavMesh(geometry, { cellSize: .1, cellHeight: .1, walkableRadiusWorld: .35, walkableRadiusVoxels: 4, walkableHeightWorld: 1.8, walkableHeightVoxels: 18, walkableClimbWorld: .3, walkableClimbVoxels: 3, walkableSlopeAngleDegrees: 45, borderSize: 0, minRegionArea: 0, mergeRegionArea: 8, maxSimplificationError: 1.1, maxEdgeLength: 12, maxVerticesPerPoly: 6, detailSampleDistance: .6, detailSampleMaxError: .1 }).navMesh;
}
