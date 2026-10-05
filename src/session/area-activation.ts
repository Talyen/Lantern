import type { AreaResources } from './area-candidate';

type AreaBindings = {
  attachEnemies(enemies: AreaResources['enemies']): void;
  detachEnemies(): void;
  attachLighting(lighting: AreaResources['lighting']): void;
  detachLighting(): void;
  attachArea(area: AreaResources['area']): void;
  detachArea(area: AreaResources['area']): void;
};

/** Borrows one area's presentation resources; never owns or disposes its bundle. */
export class AreaActivation {
  private attached?: AreaResources;
  constructor(private readonly bindings: AreaBindings) {}

  activate(resources: AreaResources, finish: () => void): void {
    this.deactivate();
    this.attached = resources;
    try {
      this.bindings.attachEnemies(resources.enemies);
      this.bindings.attachLighting(resources.lighting);
      this.bindings.attachArea(resources.area);
      finish();
    } catch (error) {
      this.deactivate();
      throw error;
    }
  }

  deactivate(): void {
    const resources = this.attached;
    if (!resources) return;
    this.attached = undefined;
    // Continue detaching independent borrowers even if one cleanup fails.
    for (const detach of [
      () => this.bindings.detachArea(resources.area),
      () => this.bindings.detachLighting(),
      () => this.bindings.detachEnemies(),
    ]) {
      try { detach(); } catch (error) { console.error('Unable to detach area presentation.', error); }
    }
  }
}
