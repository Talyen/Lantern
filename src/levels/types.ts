import type { GrassPatch } from './grass';
import type { LightingRecipe } from './lighting';
import type { LocalLightRole } from './local-lighting';
import type { Traversal } from '../gameplay/movement';
import type { PortalDefinition } from '../rendering/portal';
import type { EncounterLayout, Gate, Point, Spawn } from '../gameplay/area.ts';
export type EnvironmentLighting = { sky: string; horizon: string; ground: string; sunColor: string; sunIntensity: number; intensity: number; rotation: number };
export type ProbeLighting = { position: [number, number, number]; size: [number, number, number]; resolution: [number, number, number]; intensity: number; bounces: number };
export type AssetRef = { url: string } | { libraryId: string };
export type GroundPatch = { center: Point; radius: number; color: string; strength: number };
export type Primitive = { kind: 'box' | 'cylinder' | 'pebble' | 'tent'; size: number[]; color: string; doubleSided?: boolean; surface?: 'woodland'; patches?: GroundPatch[] };
export type Placement = {
  id: string; position: [number, number, number]; yaw: number; scale: [number, number, number];
  asset?: AssetRef; primitive?: Primitive; height?: number; foliage?: boolean; decoration?: boolean; terrain?: boolean;
  harvest?: { kind: 'tree'; radius?: number };
  castShadow: boolean; receiveShadow: boolean; fallback?: AssetRef;
};
export type Region = { id: string; center: Point; radius: number; role: 'combat' | 'arrival' | 'route' };
export type LightingGrade = { shadows: string; highlights: string; strength: number };
export type AreaLighting = { background: string; fogNear: number; fogFar: number; ambient: { sky: string; ground: string; intensity: number }; sun: { color: string; intensity: number; position: [number, number, number]; shadowExtent: number }; environment?: EnvironmentLighting; probes?: ProbeLighting; saturation?: number; grade?: LightingGrade };
export type Chest = { id: string; prop: string; position: Point; scrolls: number };
export type Campfire = { id: string; name: string; position: Point; arrival: Spawn; heals?: boolean };
export type AreaDefinition = {
  version: 1; id: string; name: string; legacy?: boolean; terminal?: boolean; chests?: Chest[]; kind?: 'safe' | 'encounter'; campfires?: Campfire[]; portalArrival?: Spawn;
  envelope: { width: number; depth: number; apron: number; yaw: number; reference: { width: number; height: number; zoom: number }; screen: [number, number] };
  layout: EncounterLayout; traversal?: Traversal; seed: number; props: Placement[];
  scatter: { id: string; count: number; radius: [number, number]; primitive: Primitive; harvest?: Placement['harvest']; excludedIds: string[] }[];
  grass?: GrassPatch[];
  reserved: Region[]; gates: Gate[]; lighting: LightingRecipe;
  effects: { portals?: PortalDefinition[]; water: { id: string; position: Point; width: number; length: number; flow: number }[]; fires: { id: string; position: Point; asset: AssetRef; height: number; emitterHeight?: number; intensity?: number; role?: LocalLightRole; color?: string; distance?: number; shadow?: boolean }[] };
  views: { id: string; target: [number, number, number] }[];
  inspection?: { position: Point };
};

export type ResolvedAreaDefinition = Omit<AreaDefinition, 'lighting'> & { lighting: AreaLighting };
