import * as THREE from 'three';
import type { GLTF, GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import characters from '../../assets/playable-characters.json';
import type { Encounter } from '../gameplay/encounter';
import type { EnemyRig } from '../gameplay/area';
import { loadEquipmentMotions } from '../animation/combat-animations';
import { disposeSceneInstances, disposeSceneResources, sceneTextures } from '../assets/resource-ownership';
import { prepareStandardMaterials } from '../rendering/surface-detail';
import { Equipment } from '../rendering/equipment';
import { CasterVisuals } from '../rendering/projectiles';
import { attachCharacter, makeActor, installMotions, type Actor } from './actors';

type EnemyPresentation = { actor: Actor; equipment: Equipment; caster?: CasterVisuals };
export type PreparedEnemies = { entries: Record<string, EnemyPresentation>; dispose(): void };

/** Area-owned actor instances borrow cached rig art; preparation never replaces the active actors. */
export class EnemyActors {
  private sources = new Map<EnemyRig, Promise<GLTF>>();
  private active?: PreparedEnemies;
  private disposed = false;
  constructor(private scene: THREE.Scene, private loader: GLTFLoader, private actors: Record<string, Actor>) {}

  private source(rig: EnemyRig): Promise<GLTF> {
    let source = this.sources.get(rig);
    if (!source) {
      source = this.loader.loadAsync(characters[rig].model).then(gltf => {
        sceneTextures(gltf.scene); prepareStandardMaterials(gltf.scene); return gltf;
      }).catch((error: unknown) => { this.sources.delete(rig); throw new Error(`Prepare ${characters[rig].name} with npm run assets:export-character. ${String(error)}`); });
      this.sources.set(rig, source);
    }
    return source;
  }

  async prepare(state: Encounter): Promise<PreparedEnemies> {
    const root = new THREE.Scene(), entries: PreparedEnemies['entries'] = {};
    let released = false;
    const dispose = () => {
      if (released) return;
      released = true;
      for (const { actor, equipment, caster } of Object.values(entries)) {
        equipment.dispose(); caster?.dispose();
        actor.mixer?.stopAllAction();
        if (actor.mixer) actor.mixer.uncacheRoot(actor.mixer.getRoot());
        disposeSceneInstances(actor.root, { skeletons: true }); actor.root.removeFromParent();
      }
    };
    const results = await Promise.allSettled(state.enemyIds.filter(id => state.enemies[id].home).map(async id => {
      const enemy = state.enemies[id], source = await this.source(enemy.rig);
      const actor = makeActor(root, enemy), equipment = new Equipment(actor.root, 'enemy');
      entries[id] = { actor, equipment };
      attachCharacter(actor, source.scene, source.animations, characters[enemy.rig].height);
      installMotions(actor, await loadEquipmentMotions(this.loader, enemy.rig, enemy.loadout));
      equipment.commit(await equipment.stage(enemy.loadout));
      if (enemy.kind === 'caster') entries[id].caster = new CasterVisuals(root, actor.root, id);
    }));
    const failure = results.find(result => result.status === 'rejected');
    if (failure || this.disposed) { dispose(); throw failure?.reason ?? new Error('Enemy presentation is closed.'); }
    return { entries, dispose };
  }

  commit(next: PreparedEnemies): void {
    this.active?.dispose();
    for (const id of Object.keys(this.actors)) if (id !== 'player') delete this.actors[id];
    for (const [id, { actor, caster }] of Object.entries(next.entries)) {
      this.actors[id] = actor; this.scene.add(actor.root); caster?.attach(this.scene);
    }
    this.active = next;
  }
  clear(): void { for (const entry of Object.values(this.active?.entries ?? {})) entry.caster?.clear(); }
  sync(state: Encounter, dt: number, visible: boolean): void {
    if (!this.active) return;
    for (const id in this.active.entries) {
      const entry = this.active.entries[id];
      entry.caster?.sync(state, entry.actor.contacts[0] ?? .8, dt, visible && !!state.enemies[id]);
    }
  }
  diagnostics() { return Object.fromEntries(Object.entries(this.active?.entries ?? {}).map(([id, entry]) => [id, entry.equipment.diagnostics()])); }
  dispose(): void {
    this.disposed = true; this.active?.dispose();
    for (const source of this.sources.values()) void source.then(gltf => disposeSceneResources(gltf.scene)).catch(() => {});
    this.sources.clear();
  }
}
