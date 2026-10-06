import { loadRigArt } from '../assets/rig-art';
import * as THREE from 'three';
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { RuntimeAssets, RigArt } from '../assets/runtime-assets';
import type { ArtLease } from '../assets/art-cache';
import characters from '../../assets/playable-characters.json';
import type { Encounter } from '../gameplay/encounter';
import type { EnemyRig } from '../gameplay/area';
import { loadEquipmentMotions, releaseCombatMotions, type CombatMotions } from '../animation/combat-animations';
import { disposeSceneInstances } from '../assets/resource-ownership';
import { Equipment } from '../rendering/equipment';
import { CasterVisuals } from '../rendering/projectiles';
import { attachCharacter, makeActor, installMotions, type Actor } from './actors';

type EnemyPresentation = { actor: Actor; equipment: Equipment; caster?: CasterVisuals; motions?: CombatMotions };
export type PreparedEnemies = { entries: Record<string, EnemyPresentation>; dispose(): void };

/** Area-owned actor instances borrow cached rig art; preparation never replaces the active actors. */
export class EnemyActors {
  private active?: PreparedEnemies;
  private disposed = false;
  private ownsActive = true;
  constructor(private scene: THREE.Scene, private loader: GLTFLoader, private actors: Record<string, Actor>, private resources: RuntimeAssets) {}

  private source(rig: EnemyRig): ArtLease<RigArt> {
    const lease = loadRigArt(this.resources, characters[rig].model);
    return { ...lease, ready: lease.ready.catch((error: unknown) => {
      throw new Error(`Prepare ${characters[rig].name} with npm run assets:export-character. ${String(error)}`, { cause: error });
    }) };
  }

  async prepare(state: Encounter): Promise<PreparedEnemies> {
    const root = new THREE.Scene(), entries: PreparedEnemies['entries'] = {};
    const rigLeases: ArtLease<RigArt>[] = [];
    let released = false;
    const dispose = () => {
      if (released) return;
      released = true;
      for (const { actor, equipment, caster, motions } of Object.values(entries)) {
        equipment.dispose(); caster?.dispose();
        actor.mixer?.stopAllAction();
        if (actor.mixer) actor.mixer.uncacheRoot(actor.mixer.getRoot());
        disposeSceneInstances(actor.root, { skeletons: true }); actor.root.removeFromParent();
        if (motions) releaseCombatMotions(motions);
      }
      rigLeases.forEach(lease => lease.release());
    };
    const results = await Promise.allSettled(state.enemyIds.filter(id => state.enemies[id].home).map(async id => {
      const enemy = state.enemies[id], lease = this.source(enemy.rig); rigLeases.push(lease); const source = await lease.ready;
      const actor = makeActor(root, enemy), equipment = new Equipment(actor.root, 'enemy', this.resources.library);
      entries[id] = { actor, equipment };
      attachCharacter(actor, source.scene, source.animations, characters[enemy.rig].height);
      const motions = await loadEquipmentMotions(this.loader, enemy.rig, enemy.loadout); entries[id].motions = motions; installMotions(actor, motions);
      equipment.commit(await equipment.stage(enemy.loadout));
      if (enemy.kind === 'caster') entries[id].caster = new CasterVisuals(root, actor.root, id);
    }));
    const failure = results.find(result => result.status === 'rejected');
    if (failure || this.disposed) { dispose(); throw failure?.reason ?? new Error('Enemy presentation is closed.'); }
    return { entries, dispose };
  }

  commit(next: PreparedEnemies, borrowed = false): void {
    this.detach();
    this.active = next; this.ownsActive = !borrowed;
    for (const [id, { actor, caster }] of Object.entries(next.entries)) {
      this.actors[id] = actor; this.scene.add(actor.root); caster?.attach(this.scene);
    }
  }
  detach(): void {
    const previous = this.active, owned = this.ownsActive;
    this.active = undefined; this.ownsActive = true;
    for (const id of Object.keys(this.actors)) if (id !== 'player') delete this.actors[id];
    for (const { actor, caster } of Object.values(previous?.entries ?? {})) {
      for (const detach of [() => actor.root.removeFromParent(), () => caster?.detach()]) {
        try { detach(); } catch (error) { console.error('Unable to detach enemy presentation.', error); }
      }
    }
    if (owned) previous?.dispose();
  }
  clear(): void { for (const entry of Object.values(this.active?.entries ?? {})) entry.caster?.clear(); }
  restore(state: Encounter): void {
    for (const entry of Object.values(this.active?.entries ?? {})) entry.caster?.restore(state);
    this.sync(state, 0, true);
  }
  sync(state: Encounter, dt: number, visible: boolean): void {
    if (!this.active) return;
    for (const id in this.active.entries) {
      const entry = this.active.entries[id];
      entry.caster?.sync(state, entry.actor.contacts[0] ?? .8, dt, visible && !!state.enemies[id]);
    }
  }
  diagnostics() { return Object.fromEntries(Object.entries(this.active?.entries ?? {}).map(([id, entry]) => [id, entry.equipment.diagnostics()])); }
  dispose(): void {
    this.disposed = true; if (this.ownsActive) this.active?.dispose();
    this.active = undefined;
  }
}
