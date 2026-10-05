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

export type AreaPresentationResources = Readonly<{
  appearance: Readonly<{ surfaces: SurfaceMode; shelterRestored: boolean }>;
  lightingDefinition: AreaLighting;
  contentHash: string;
  renewalVisibility: RenewalVisibility;
  area: AreaInstance;
  lighting: PreparedLighting;
  abilities: AbilityEffects;
  enemies: PreparedEnemies;
  visuals: AdventureVisuals;
  interactions: WorldInteractions;
}>;

export type AreaResources = AreaPresentationResources & Readonly<{ movement: MovementWorld }>;

/** Collision, routes and dodge reservations outlive a presentation rebuild. */
export class AreaSimulation {
  private closed = false;
  constructor(readonly movement: MovementWorld) {}
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.movement.dispose();
  }
}

/** Owns staged presentation and, until promotion, newly prepared simulation. */
export class PreparedArea {
  private releases: (() => void)[] = [];
  private resources?: AreaResources;
  private ownsSimulation = false;
  constructor(private simulation?: AreaSimulation) {}
  get simulationResources(): AreaSimulation | undefined { return this.simulation; }
  ownSimulation(movement: MovementWorld): MovementWorld {
    if (this.simulationResources) throw new Error('Area simulation is already prepared.');
    this.simulation = new AreaSimulation(movement);
    this.ownsSimulation = true;
    return movement;
  }
  promoteSimulation(): AreaSimulation {
    const simulation = this.simulationResources;
    if (!simulation) throw new Error('Area simulation is not prepared.');
    this.ownsSimulation = false;
    return simulation;
  }
  get area(): AreaInstance { return this.value.area; }
  get value(): AreaResources {
    if (!this.resources) throw new Error('Area resources are not prepared.');
    return this.resources;
  }
  own<T>(resource: T, release: (resource: T) => void): T {
    this.releases.push(() => release(resource));
    return resource;
  }
  async prepare(build: (owner: PreparedArea) => Promise<AreaPresentationResources>): Promise<this> {
    try {
      const presentation = await build(this);
      const simulation = this.simulationResources;
      if (!simulation) throw new Error('Area simulation is not prepared.');
      this.resources = { ...presentation, movement: simulation.movement };
      return this;
    }
    catch (error) { this.dispose(); throw error; }
  }
  dispose(): void {
    const releases = this.releases.splice(0).reverse();
    this.resources = undefined;
    if (this.ownsSimulation) {
      this.ownsSimulation = false;
      releases.unshift(() => this.simulation?.dispose());
    }
    // A failing release must not strand the rest of the area.
    for (const release of releases) {
      try { release(); } catch (error) { console.error('Unable to release area resources.', error); }
    }
  }
}
