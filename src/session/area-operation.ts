import type { WebGPURenderer } from 'three/webgpu';
import { cancelNativePreparation, finishSubmittedFrame, resetNativeFrameCompilation } from '../rendering/renderer';
import { nativePreparation } from '../rendering/native-preparation';
import { AbilityEffects } from '../rendering/ability-effects';
import { AdventureVisuals } from '../rendering/adventure';
import type { Graphics } from '../rendering/graphics';
import type { PlayerLantern } from '../rendering/player-lantern';
import type { SurfaceMode } from '../assets/environment-surfaces';
import type { runtimeAssets } from '../assets/runtime-assets';
import { buildArea } from '../levels/builder';
import type { AreaDefinition } from '../levels/types';
import type { AdventureEvent } from '../gameplay/adventure';
import type { AreaContent } from './area-content';
import { traversalWithTrees } from '../levels/trees';
import { MovementWorld } from '../gameplay/movement';
import { createEncounter } from '../gameplay/encounter';
import type { EncounterView } from '../gameplay/state-view';
import type { GameAudio } from '../audio/audio';
import { loadingScreen } from '../ui/loading';
import type { createHud } from '../ui/hud';
import type { Options } from '../ui/options';
import { recordFailure } from '../diagnostics/report';
import { RenewalVisibility } from './renewal-visibility';
import { WorldInteractions } from './world-interactions';
import { areaChangeFailed } from './interaction-actions';
import type { AreaChange } from './area-change';
import type { AreaOperation, AreaRequest } from './area-transition';
import type { SessionLifecycle } from './lifecycle';
import type { SessionRuntime } from './runtime';
import type { AreaActivation } from './area-activation';
import type { createCamera } from './camera';
import type { EnemyActors } from './enemy-actors';
import type { Actor } from './actors';
import type { GatheringController } from './gathering';
import type { GatheringTools } from '../rendering/gathering-tools';
import type { ClickApproach } from './click-approach';
import type { DevelopmentSession } from './development';

export type AreaStatus = { errors: string[]; revision: number; updateMs: number; characterMissing: boolean };
type AreaOperationContext = {
  lifecycle: SessionLifecycle;
  content: AreaContent;
  status: AreaStatus;
  query: URLSearchParams;
  initialSurfaces: SurfaceMode;
  appearance: { lantern: boolean };
  area(): AreaDefinition;
  development(): DevelopmentSession | undefined;
  renderer: WebGPURenderer;
  mount: HTMLElement;
  assets: ReturnType<typeof runtimeAssets>;
  graphics(): Graphics;
  personalLantern(): PlayerLantern | undefined;
  enemies: EnemyActors;
  player: Actor;
  encounter: EncounterView;
  runtime: SessionRuntime;
  camera: ReturnType<typeof createCamera>;
  activation: AreaActivation;
  gathering: GatheringController;
  gatheringTools: GatheringTools;
  hud: ReturnType<typeof createHud>;
  audio: GameAudio;
  options: Options;
  presentation: { rememberPlayback(): void; reset(): void; restore(): void };
  approach: Pick<ClickApproach, 'cancel'>;
  clearInput(preserveAccepted?: boolean): void;
  interruptApproach(): void;
  syncAdventure(events: AdventureEvent[]): void;
  message(text: string): void;
};

/** Explicit prepare/commit/activate/readiness adapters; the transition owner decides publication. */
export function createAreaOperation(ctx: AreaOperationContext, change: AreaChange, request: AreaRequest): AreaOperation {
  const id = change.kind === 'travel' ? change.area : ctx.area().id;
  const { arrivalId, recover = false } = change.kind === 'travel' ? change : {};
  const appearance = change.kind === 'refresh' ? change.appearance : undefined;
  const presentationOnly = change.kind === 'presentation-recovery';
  const next = ctx.content.definitions[id];
  const nextSurfaces = appearance?.surfaces ?? ctx.lifecycle.areas.current?.appearance.surfaces ?? ctx.initialSurfaces;
  const resolved = next && { ...next, lighting: ctx.content.lighting(next) };
  const savedView = ctx.development()?.frozen && ctx.lifecycle.areas.current?.area.area.id === id ? ctx.camera.captureView() : null;
  const startup = !ctx.lifecycle.areas.current?.area, started = performance.now();
  const showLoading = startup || presentationOnly || loadingScreen.blocking || change.kind === 'travel' && ctx.query.get('author') !== 'levels';
  let token = startup ? loadingScreen.current : showLoading ? loadingScreen.begin(next?.name ?? id) : undefined;
  if (token !== undefined) loadingScreen.preparing(token, `Preparing ${next?.name ?? id}`);
  const fadeUntil = performance.now() + (startup || matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 150);
  if (presentationOnly) ctx.presentation.rememberPlayback();
  ctx.audio.update(ctx.encounter.player, true); ctx.hud.clearCombatText(); ctx.clearInput();
  if (presentationOnly) ctx.approach.cancel(); else ctx.interruptApproach();
  let hash = '';
  return {
    prepare: () => ctx.lifecycle.areas.prepare(change, async owner => {
      await cancelNativePreparation(ctx.renderer); request.check();
      try {
      const errors = ctx.content.validate(ctx.content.definitions);
      if (!next || !resolved || errors.length) throw new Error(errors.join('\n') || `Unknown area: ${id}`);
      request.stage('content-hash');
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ ...resolved, surfaces: nextSurfaces })));
      hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''); request.check();
      request.stage('area-assets');
      const area = owner.own(await buildArea(next, nextSurfaces, appearance?.shelterRestored ?? ctx.runtime.character.shelterRestored, ctx.assets), value => value.dispose()); request.check();
      if (!presentationOnly) {
        request.stage('navigation');
        owner.ownSimulation(await MovementWorld.create(next.layout.boundary, traversalWithTrees(next))); request.check();
      }
      request.stage('ability-graphics');
      const abilities = owner.own(new AbilityEffects(area, ctx.options.settings.particleQuality, ctx.renderer), value => value.dispose());
      await abilities.prepare(ctx.camera.camera); request.check();
      if (ctx.query.get('portal') === 'off') area.portals.forEach(portal => { portal.root.visible = false; });
      request.stage('lighting');
      const lighting = owner.own(await ctx.graphics().prepareLighting(resolved, area.root), value => value.release()); request.check();
      request.stage('enemies');
      const enemies = owner.own(await ctx.enemies.prepare(presentationOnly ? ctx.encounter : createEncounter('playing', next.layout)), value => value.dispose()); request.check();
      const visuals = owner.own(new AdventureVisuals(area.root, ctx.assets.library), value => value.dispose());
      const interactions = new WorldInteractions(next, area, [ctx.player.root, ...Object.values(enemies.entries).map(entry => entry.actor.root)]);
      if (showLoading && performance.now() < fadeUntil) await request.wait(new Promise(resolve => setTimeout(resolve, fadeUntil - performance.now())));
      const renewalVisibility = new RenewalVisibility();
      renewalVisibility.register(area, Object.fromEntries(Object.entries(enemies.entries).map(([id, entry]) => [id, entry.actor])));
      return { area, abilities, lighting, enemies, visuals, interactions, renewalVisibility,
        lightingDefinition: resolved.lighting, contentHash: hash,
        appearance: { surfaces: nextSurfaces, shelterRestored: Boolean(area.root.userData.shelterRestored) } };
      } catch (error) {
        // PreparedArea releases its sources after this callback rejects. Keep
        // submitted native work alive until its borrowed resources are idle.
        const native = nativePreparation(ctx.renderer);
        await native.builders.idle(); await native.pipelines.idle();
        await finishSubmittedFrame(ctx.renderer);
        throw error;
      }
    }),
    commitGameplay: candidate => {
      ctx.appearance.lantern = appearance?.lantern ?? ctx.appearance.lantern;
      const arrival = next.gates.find(gate => gate.id === arrivalId);
      // Commit gameplay before presentation can fail; returning through a portal saves its consumption with arrival.
      if (!presentationOnly) ctx.runtime.enter(next, change.spawn ?? arrival?.arrival ?? next.layout.player, recover, change.kind === 'travel' ? change.consumePortal : undefined);
      if (arrival) ctx.runtime.arrive(arrival.id);
      if (!presentationOnly) ctx.runtime.registerResources(candidate.value.area.resources, candidate.value.movement);
    },
    activate: candidate => ctx.activation.activate(candidate.value, () => {
      ctx.personalLantern()?.setEnabled(ctx.appearance.lantern);
      if (!presentationOnly) ctx.gathering.restore(candidate.value.area);
      ctx.development()?.stopInspection();
      const feedback = ctx.runtime.takeFeedback(); ctx.gatheringTools.show(null);
      if (presentationOnly) ctx.presentation.restore(); else ctx.presentation.reset();
      ctx.syncAdventure(presentationOnly ? [] : feedback.adventure);
      ctx.camera.inspect(false, { x: 0, z: 0 });
      if (!ctx.development()?.frozen) ctx.camera.restoreGameplayView();
      ctx.camera.resetFollow(ctx.player.root.position);
      ctx.graphics().apply(ctx.options.settings); ctx.graphics().resetSceneTime();
      ctx.status.revision++; ctx.status.errors = [];
      ctx.hud.environmentLoaded(candidate.value.area.missing.length ? 0 : 3);
      if (ctx.status.characterMissing) ctx.hud.characterUnavailable();
      else ctx.hud.setAssetStatus(candidate.value.area.missing.length ? `Missing art: ${candidate.value.area.missing.join(', ')}.` : '');
      if (ctx.development()?.frozen && !presentationOnly) ctx.development()?.freeze(true);
      if (savedView) ctx.camera.restoreView(savedView);
      if (presentationOnly) { resetNativeFrameCompilation(ctx.renderer); delete ctx.mount.dataset.renderError; delete ctx.renderer.domElement.dataset.renderError; }
    }),
    deactivate: () => ctx.activation.deactivate(),
    ready: async () => {
      if (!ctx.lifecycle.frames.running) ctx.lifecycle.frames.start();
      request.stage('first-frames'); await request.wait(ctx.lifecycle.frames.waitFrames(2)); request.check();
      request.stage('gpu-completion'); await request.wait(finishSubmittedFrame(ctx.renderer)); request.check();
      if (ctx.mount.dataset.renderError) throw new Error(ctx.mount.dataset.renderError);
      if (token !== undefined && !await request.wait(loadingScreen.ready(token))) return false;
      request.check(); request.stage('ready');
      ctx.status.updateMs = performance.now() - started; ctx.renderer.domElement.focus(); return true;
    },
    cancelled: async () => {
      ctx.message('Travel cancelled.');
      if (token !== undefined && await request.wait(loadingScreen.ready(token))) ctx.renderer.domElement.focus();
    },
    failed: async (error, committed) => {
      await cancelNativePreparation(ctx.renderer); request.check();
      ctx.status.errors = [error instanceof Error ? error.message : String(error)];
      recordFailure(startup ? 'startup-area' : 'travel', error);
      if (startup) return 'back';
      if (committed || presentationOnly) {
        token ??= loadingScreen.begin(ctx.area().name);
        loadingScreen.fail(token, error, { kind: 'presentation', retry: () => {
          void ctx.lifecycle.changeArea({ kind: 'presentation-recovery' }).catch(areaChangeFailed);
        } });
        return 'back';
      }
      if (token === undefined) { ctx.hud.setAssetStatus(`Unable to travel. ${ctx.status.errors[0]}`); return 'back'; }
      const choice = await request.wait(loadingScreen.recover(token, error));
      request.check();
      if (choice === 'back') { ctx.status.errors = []; if (await request.wait(loadingScreen.ready(token))) ctx.renderer.domElement.focus(); }
      return choice;
    },
    finish: () => { ctx.clearInput(presentationOnly); ctx.audio.update(ctx.encounter.player, !ctx.lifecycle.canAdvanceSimulation); },
  };
}
