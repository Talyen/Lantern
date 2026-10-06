import type { EncounterView } from '../gameplay/state-view';
import type { OrthographicCamera } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { pendingNativeCompilations } from '../rendering/renderer';
import { pendingAreaAssets } from '../levels/builder';
import { nativePreparationDiagnostics } from '../rendering/native-preparation';
import { runtimeAssets } from '../assets/runtime-assets';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { parseJson } from '../data/json';
import type { RuntimeSnapshot } from '../diagnostics/report';
import type { SurfaceMode } from '../assets/environment-surfaces';
import type { AreaInstance } from '../levels/builder';
import type { AreaDefinition } from '../levels/types';
import type { Adventure } from '../gameplay/adventure';
import type { ActorId } from '../gameplay/encounter';
import type { Harvesting } from '../gameplay/harvesting';
import type { MovementWorld } from '../gameplay/movement';
import type { InputPreferences } from '../input/bindings';
import type { GameAudio } from '../audio/audio';
import type { Graphics } from '../rendering/graphics';
import type { PlayerLantern } from '../rendering/player-lantern';
import type { Equipment } from '../rendering/equipment';
import type { Options } from '../ui/options';
import type { Actor } from './actors';
import type { EnemyActors } from './enemy-actors';
import type { GatheringController } from './gathering';
import type { ClickApproach } from './click-approach';
import type { WorldInteraction } from './world-interactions';

// Live getters keep replaced areas and prepared graphics out of stale snapshots.
type Context = {
  readonly preparation: { generation: number; destination: string; stage: string };
  readonly currentArea: AreaDefinition;
  readonly active: AreaInstance | undefined;
  readonly graphics: Graphics | undefined;
  readonly options: Options | undefined;
  readonly personalLantern: PlayerLantern | undefined;
  readonly movementWorld: MovementWorld | undefined;
  readonly hoveredInteraction: WorldInteraction | null;
  readonly surfaceMode: SurfaceMode;
  readonly revision: number;
  readonly renderedRevision: number;
  readonly transitioning: boolean;
  readonly areaErrors: string[];
  readonly characterMissing: boolean;
  readonly contentHash: string;
  readonly updateMs: number;
  readonly renderedFrames: number;
  audio: GameAudio;
  adventure: Adventure;
  encounter: EncounterView;
  preferences: InputPreferences;
  harvesting: Harvesting;
  gathering: GatheringController;
  approach: ClickApproach;
  playerEquipment: Equipment;
  enemyActors: EnemyActors;
  actors: Record<ActorId, Actor>;
  camera: OrthographicCamera;
  controls: OrbitControls;
  renderer: WebGPURenderer;
  mount: HTMLElement;
};

/** Owns serialization only; the coordinator owns all gameplay and resource lifetimes. */
export class ClearingDiagnostics {
  constructor(private readonly context: Context) {}

  private status() {
    const { currentArea, active, revision, renderedRevision, transitioning, areaErrors, characterMissing, mount } = this.context;
    return {
      area: currentArea.id,
      ready: !!active && renderedRevision === revision && !transitioning && !areaErrors.length && !mount.dataset.renderError,
      errors: [...areaErrors, ...(mount.dataset.renderError ? [mount.dataset.renderError] : [])],
      missing: [...(active?.missing ?? []), ...(characterMissing ? ['character'] : [])],
    };
  }

  /** Reports deliberately select bounded fields, never the developer's character snapshot. */
  report(): RuntimeSnapshot {
    const { audio, graphics, options, adventure, preparation, renderer, renderedFrames } = this.context;
    const status = this.status();
    const sound = audio.diagnostics();
    const pipeline = graphics?.pipelineDiagnostics();
    return {
      ...status, backend: 'webgpu', missing: status.missing.slice(0, 16), errors: status.errors.slice(-16),
      preparation: { ...preparation, pendingAssets: pendingAreaAssets(runtimeAssets(renderer)), lightingStage: graphics?.lightingDiagnostics().stage,
        compilationPending: pendingNativeCompilations(renderer), completedFrames: renderedFrames },
      settings: options ? { ...options.settings } : undefined,
      audio: { state: sound.state, loaded: sound.loaded, loading: sound.loading, voices: sound.voices, errors: sound.errors.slice(-16) },
      persistence: adventure.saveDiagnostics(),
      resources: runtimeAssets(renderer).diagnostics(),
      nativePreparation: nativePreparationDiagnostics(renderer),
      graphics: pipeline && 'sceneWidth' in pipeline ? { ready: pipeline.ready, method: pipeline.method, sceneWidth: pipeline.sceneWidth ?? 0, sceneHeight: pipeline.sceneHeight ?? 0,
        outputWidth: pipeline.outputWidth ?? 0, outputHeight: pipeline.outputHeight ?? 0 } : undefined,
    };
  }

  snapshot() {
    const { audio, personalLantern, surfaceMode, currentArea, revision, renderedRevision, contentHash, options, updateMs, renderedFrames, encounter, playerEquipment, preferences, adventure, hoveredInteraction, approach, gathering, active, harvesting, graphics, enemyActors, actors, movementWorld, camera, controls, mount, renderer } = this.context;
    return {
      audio: audio.diagnostics(), lantern: personalLantern?.diagnostics(), surfaces: surfaceMode,
      ...this.status(), revision, renderedRevision,
      contentHash, settings: options!.settings, backend: 'webgpu', updateMs, renderedFrames, phase: encounter.phase,
      equipment: playerEquipment.diagnostics(),
      controls: { bindings: preferences.value, actionBar: adventure.character.actionBar },
      interaction: { hover: hoveredInteraction?.key ?? null, approach: approach.worldKey },
      harvest: { chopping: gathering.choppingId, trees: active?.resources.map(tree => ({ ...tree, ...harvesting.state(currentArea.id, tree.id) })) },
      fluids: graphics?.effects.fluids.snapshot(),
      vegetation: active?.vegetation.diagnostics(), grass: active?.grass, treeFalls: active?.treeFelling.diagnostics(),
      adventure: {
        persistence: adventure.saveDiagnostics(),
      resources: runtimeAssets(renderer).diagnostics(),
      nativePreparation: nativePreparationDiagnostics(renderer), character: adventure.capture(), portal: adventure.portal, castRemaining: adventure.castRemaining,
        drops: adventure.areaDrops(currentArea.id), chests: adventure.areaChests(currentArea.id),
        fires: (currentArea.campfires ?? []).map(fire => ({ id: fire.id, safe: adventure.fireSafe(currentArea, fire, encounter) })),
      },
      encounter: {
        enemies: structuredClone(encounter.enemies), equipment: enemyActors.diagnostics(),
        player: { ...encounter.player }, playerMana: encounter.playerMana, berserkingRemaining: encounter.berserkingRemaining, ultimateCooldown: encounter.ultimateCooldown, stats: {...encounter.stats}, dodgeRemaining: encounter.dodgeRemaining,
        dodgeCooldown: encounter.dodgeCooldown, lunge: encounter.playerAction?.lunge, blocking: encounter.blocking, projectiles: encounter.projectiles, pending: encounter.pending,
        animations: Object.fromEntries(Object.entries(actors).map(([id, actor]) => [id, actor.current])),
        navigationReady: movementWorld?.navigationReady ?? false, navigationMs: movementWorld?.generationMs ?? 0, movement: movementWorld?.diagnostics(),
      },
      camera: { position: camera.position.toArray(), target: controls.target.toArray(), zoom: camera.zoom, viewport: [mount.clientWidth, mount.clientHeight] },
      objects: active?.root.children.length ?? 0,
      resources: { memory: { ...renderer.info.memory }, drawCalls: renderer.info.render.drawCalls, triangles: renderer.info.render.triangles },
      graphics: renderer.domElement.dataset.graphics ? parseJson(renderer.domElement.dataset.graphics) : null,
    };
  }
}

export type ClearingSnapshot = ReturnType<ClearingDiagnostics['snapshot']>;
