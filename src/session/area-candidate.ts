import type { SurfaceMode } from '../assets/environment-surfaces';
import type { AreaLighting } from '../levels/types';
import type { RenewalVisibility } from './renewal-visibility';
import type { AreaInstance } from '../levels/builder';
import type { MovementWorld } from '../gameplay/movement';
import type { PreparedLighting } from '../rendering/area-lighting';
import type { AbilityEffects } from '../rendering/ability-effects';
import type { AdventureVisuals } from '../rendering/adventure';
import type { WorldInteractions } from './world-interactions';
import type { PreparedEnemies } from './enemy-actors';

export type AreaResources = Readonly<{
  appearance: Readonly<{ surfaces: SurfaceMode; shelterRestored: boolean }>;
  lightingDefinition: AreaLighting;
  contentHash: string;
  renewalVisibility: RenewalVisibility;
  area: AreaInstance;
  movement: MovementWorld;
  lighting: PreparedLighting;
  abilities: AbilityEffects;
  enemies: PreparedEnemies;
  visuals: AdventureVisuals;
  interactions: WorldInteractions;
}>;

/** One owner for all destination resources, before and after promotion. */
export class PreparedArea {
  private releases: (() => void)[] = [];
  private resources?: AreaResources;
  get area(): AreaInstance { return this.value.area; }
  get value(): AreaResources {
    if (!this.resources) throw new Error('Area resources are not prepared.');
    return this.resources;
  }
  own<T>(resource: T, release: (resource: T) => void): T {
    this.releases.push(() => release(resource));
    return resource;
  }
  async prepare(build: (owner: PreparedArea) => Promise<AreaResources>): Promise<this> {
    try { this.resources = await build(this); return this; }
    catch (error) { this.dispose(); throw error; }
  }
  dispose(): void {
    const releases = this.releases.splice(0).reverse();
    this.resources = undefined;
    // A failing release must not strand the rest of the area.
    for (const release of releases) {
      try { release(); } catch (error) { console.error('Unable to release area resources.', error); }
    }
  }
}
