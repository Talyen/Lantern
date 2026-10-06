import type { Scene, WebGPURenderer } from 'three/webgpu';
import type { AreaDefinition } from '../levels/types';
import { observeAreaContent, type AreaContent, type AreaContentUpdate } from './area-content';
import type { AreaResources } from './area-candidate';
import type { AreaAppearance } from './area-change';
import type { Adventure } from '../gameplay/adventure';
import { advanceWeather, weatherIntensity, type WeatherPhase, type WeatherState } from '../gameplay/weather';
import { rainExposure } from '../levels/weather';
import { attachPreviewGraphics } from '../rendering/preview-graphics';
import type { Graphics } from '../rendering/graphics';
import type { PlayerLantern } from '../rendering/player-lantern';
import { loadingScreen } from '../ui/loading';
import type { Options } from '../ui/options';
import { play, type Actor } from './actors';
import type { createCamera } from './camera';
import type { ClearingDiagnostics } from './diagnostics';
import type { SessionLifecycle } from './lifecycle';
import type { SessionRuntime } from './runtime';
import { areaChangeFailed } from './interaction-actions';

type DevelopmentContext = {
  query: URLSearchParams;
  lifecycle: SessionLifecycle;
  content: AreaContent;
  appearance: { lantern: boolean };
  area(): AreaDefinition;
  current(): AreaResources | undefined;
  errors(value: string[]): void;
  adventure: Adventure;
  runtime: SessionRuntime;
  actors: Record<string, Actor>;
  camera: ReturnType<typeof createCamera>;
  scene: Scene;
  renderer: WebGPURenderer;
  graphics(): Graphics | undefined;
  personalLantern(): PlayerLantern | undefined;
  options: Options;
  diagnostics(): ReturnType<ClearingDiagnostics['snapshot']>;
  ready(): boolean;
  clearInput(): void;
  restart(): void;
  syncAdventure(): void;
  presentGathering(): void;
  attack(): void;
  render(dt: number): boolean;
};

/** Disposable development adapter. Preview state stays outside normal session policy. */
export class DevelopmentSession {
  private frozenValue: boolean;
  private fixedCameraValue: boolean;
  private inspectingValue = false;
  private movementValue: { x: number; z: number } | null = null;
  private weatherValue?: WeatherState;
  private readonly bridges = new Map<string, unknown>();
  private readonly releases: (() => void)[] = [];
  private disposed = false;

  constructor(private readonly ctx: DevelopmentContext) {
    this.frozenValue = ctx.query.get('author') === 'levels';
    this.fixedCameraValue = this.frozenValue;
    attachPreviewGraphics(() => {
      const graphics = ctx.graphics();
      if (ctx.lifecycle.closed || !graphics) return [];
      const view = graphics.previewGraphics(ctx.ready());
      return view ? [view] : [];
    });
    const weather = {
      status: () => {
        const value = this.weatherValue ?? ctx.adventure.character.outing.weather, area = ctx.area(), player = ctx.runtime.state.player;
        return { ...structuredClone(value), intensity: weatherIntensity(value), preview: !!this.weatherValue, area: area.id,
          outdoor: !!area.effects.weather, effectsEnabled: ctx.options.settings.weatherEffects,
          groundWetness: ctx.current()?.area.rainWetness.value,
          exposure: rainExposure(ctx.current()?.area.weatherShelters ?? [], player.x, player.z) };
      },
      preview: (phase: WeatherPhase | 'live', wetness = 0) => this.previewWeather(phase, wetness),
    };
    const renewal = {
      diagnostics: () => ctx.diagnostics(),
      snapshot: () => { ctx.adventure.save(); return ctx.adventure.capture().outing; },
      advance: (seconds: number) => {
        if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid clock advance');
        if (this.disposed) return;
        ctx.runtime.advanceRenewal(seconds); ctx.presentGathering(); ctx.syncAdventure(); ctx.lifecycle.frames.invalidate();
      },
    };
    Object.assign(window, { lanternWeather: weather, lanternRenewal: renewal });
    this.rememberBridges();
  }

  get frozen(): boolean { return this.frozenValue; }
  get fixedCamera(): boolean { return this.fixedCameraValue; }
  get inspecting(): boolean { return this.inspectingValue; }
  get movement(): { x: number; z: number } | null { return this.movementValue; }
  get weather(): WeatherState | undefined { return this.weatherValue; }
  stopInspection(): void { this.inspectingValue = false; }

  inspect(): boolean {
    const site = this.ctx.area().inspection;
    if (!site || this.disposed) return this.inspecting;
    this.ctx.clearInput(); this.inspectingValue = !this.inspecting;
    this.ctx.camera.inspect(this.inspecting, { x: site.position[0], z: site.position[1] }); this.ctx.graphics()?.resetHistory();
    if (this.inspecting) this.ctx.camera.suspendFollow();
    else if (!this.fixedCamera) this.ctx.camera.resetFollow(this.ctx.actors.player.root.position);
    return this.inspecting;
  }

  freeze(value: boolean): void {
    if (this.disposed) return;
    const { camera, actors } = this.ctx, graphics = this.ctx.graphics();
    this.frozenValue = value; this.fixedCameraValue = value; this.ctx.clearInput();
    if (!value) { camera.restoreGameplayView(); camera.resetFollow(actors.player.root.position); graphics?.resetHistory(); }
    else {
      this.ctx.restart();
      for (const actor of Object.values(actors)) { play(actor, 'idle'); actor.actions.idle?.stopFading().setEffectiveWeight(1); actor.mixer?.setTime(0); }
      graphics?.effects.clearArea();
      if (graphics) this.ctx.current()?.area.activate(graphics.effects);
      graphics?.resetSceneTime();
    }
  }

  private previewView(id: string): void {
    this.fixedCameraValue = true; this.ctx.camera.previewView(this.ctx.area(), id); this.ctx.graphics()?.resetHistory();
  }
  private previewWeather(phase: WeatherPhase | 'live', wetness: number): void {
    if (!['live', 'dry', 'gathering', 'shower', 'clearing'].includes(phase) || !Number.isFinite(wetness) || wetness < 0 || wetness > 1) throw new Error('Invalid weather preview');
    this.weatherValue = phase === 'live' ? undefined : { ...structuredClone(this.ctx.adventure.character.outing.weather), phase, elapsed: 0, wetness };
    this.ctx.lifecycle.frames.invalidate();
  }
  advanceWeather(dt: number): void {
    const state = this.ctx.runtime.state;
    if (this.weatherValue && this.ctx.lifecycle.canAdvanceSimulation && state.player.hp > 0 && !['lost', 'loading'].includes(state.phase)) advanceWeather(this.weatherValue, dt);
  }
  private async changeAppearance(appearance: AreaAppearance): Promise<boolean> {
    if (appearance.lantern !== undefined && appearance.surfaces === undefined && appearance.shelterRestored === undefined) {
      this.ctx.appearance.lantern = appearance.lantern; this.ctx.personalLantern()?.setEnabled(appearance.lantern); return true;
    }
    const player = this.ctx.runtime.state.player;
    const current = this.ctx.current()!;
    const result = await this.ctx.lifecycle.changeArea({ kind: 'refresh', spawn: { position: [player.x, player.z], yaw: player.yaw },
      appearance: { lantern: appearance.lantern ?? this.ctx.appearance.lantern, surfaces: appearance.surfaces ?? current.appearance.surfaces,
        shelterRestored: appearance.shelterRestored ?? current.appearance.shelterRestored } });
    return result.status === 'committed' && result.readiness === 'ready';
  }

  async attach(): Promise<void> {
    const { ctx } = this, graphics = ctx.graphics()!;
    if (ctx.query.get('author') === 'levels') {
      const { attachAuthoring } = await import('../levels/authoring');
      if (this.disposed) return;
      const authoring = attachAuthoring({
        previewWeather: (phase, wetness) => this.previewWeather(phase, wetness), previewGraphics: () => graphics.previewGraphics(ctx.diagnostics().ready),
        invalidate: () => ctx.lifecycle.frames.invalidate(), scene: ctx.scene, camera: ctx.camera.camera, renderer: ctx.renderer,
        definitions: () => ctx.content.definitions, area: () => ctx.area(), placePlayer: (x, z, yaw) => ctx.runtime.placePlayer(x, z, yaw),
        resetMaterials: () => graphics.resetHistory(), resetMeasurements: () => graphics.resetMeasurements(), measurements: () => graphics.measurements(),
        exportLighting: () => graphics.exportLighting(), lighting: () => graphics.lightingDiagnostics(),
        changeArea: async id => { const result = await ctx.lifecycle.changeArea({ kind: 'travel', area: id }); return result.status === 'committed' && result.readiness === 'ready'; },
        restart: () => ctx.restart(), inspect: () => this.inspect(), waitFrames: count => ctx.lifecycle.frames.waitFrames(count),
        setFrozen: value => this.freeze(value), setView: id => this.previewView(id),
        appearance: () => ({ lantern: ctx.appearance.lantern, surfaces: ctx.current()!.appearance.surfaces, shelterRestored: ctx.current()!.appearance.shelterRestored }),
        setAppearance: appearance => this.changeAppearance(appearance), diagnostics: () => ctx.diagnostics(),
      });
      this.releases.push(() => authoring.dispose()); this.rememberBridges();
      const { fsrComparison } = await import('../labs/fsr/settings');
      if (fsrComparison && !this.disposed) {
        const { attachFsrComparison } = await import('../labs/fsr/comparison');
        if (this.disposed) return;
        const comparison = attachFsrComparison({ graphics, frameLoop: ctx.lifecycle.frames, camera: ctx.camera.camera, controls: ctx.camera.controls,
          canvas: ctx.renderer.domElement, encounter: ctx.runtime.state, prepareFixture: () => ctx.runtime.prepareComparisonFixture(), diagnostics: () => ctx.diagnostics(),
          freeze: value => this.freeze(value), clean: () => { authoring.clean(true); authoring.overlays(false); },
          foliageFixture: () => ctx.current()?.area.root.traverse(object => { if (object.userData.harvestTree) graphics.effects.addFoliage(object); }),
          step: (dt, movement, attack) => {
            if (this.disposed) return false;
            this.movementValue = movement; this.frozenValue = false; this.fixedCameraValue = true;
            try { if (attack) ctx.attack(); return ctx.render(dt); }
            finally { this.frozenValue = true; this.movementValue = null; }
          },
        });
        if (comparison) this.releases.push(() => comparison.dispose());
      }
    }
    if (!this.disposed) { activeDevelopment = this; this.releases.push(observeAreaContent(update => this.updateContent(update))); this.rememberBridges(); }
  }

  private rememberBridges(): void {
    for (const name of ['lanternWeather', 'lanternRenewal', 'lanternPreviewGraphics']) this.bridges.set(name, Reflect.get(window, name));
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (activeDevelopment === this) activeDevelopment = undefined;
    for (const release of this.releases.reverse()) {
      try { release(); } catch (error) { console.error('Unable to release development session.', error); }
    }
    for (const [name, value] of this.bridges) if (Reflect.get(window, name) === value) Reflect.deleteProperty(window, name);
  }

  private updateContent(update: AreaContentUpdate): void {
    switch (update.kind) {
      case 'registry': {
        const errors = this.ctx.content.validate(update.definitions);
        if (errors.length) { this.contentError(errors); return; }
        this.ctx.content.definitions = update.definitions; this.ctx.adventure.configureAreas(update.definitions);
        break;
      }
      case 'lighting': this.ctx.content.lighting = update.lighting; break;
      case 'validation': this.ctx.content.validate = update.validate; break;
    }
    this.refresh();
  }
  contentError(errors: string[]): void {
    this.ctx.lifecycle.areas.invalidate();
    if (this.ctx.current() && this.ctx.lifecycle.phase === 'ready') loadingScreen.dismiss();
    this.ctx.errors(errors);
  }
  refresh(): void { void this.ctx.lifecycle.changeArea({ kind: 'refresh' }).catch(areaChangeFailed); }
}

let activeDevelopment: DevelopmentSession | undefined;
if (import.meta.hot) {
  import.meta.hot.on('vite:error', payload => activeDevelopment?.contentError([payload.err.message]));
  const presetChanged = () => activeDevelopment?.refresh();
  window.addEventListener('lightingpresetchanged', presetChanged);
  import.meta.hot.dispose(() => window.removeEventListener('lightingpresetchanged', presetChanged));
}
