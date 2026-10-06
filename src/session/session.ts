import { createAreaContent } from './area-content';
import { SessionLifecycle } from './lifecycle';
import { createAreaOperation, type AreaStatus } from './area-operation';
import type { DevelopmentSession } from './development';
import type { EncounterView } from '../gameplay/state-view';
import { resizeDisplay } from '../rendering/display-resolution';
import { cancelNativePreparation, resetNativeFrameCompilation } from '../rendering/renderer';
import { loadRigArt } from '../assets/rig-art';
import { abilities, type ActionBar } from '../gameplay/abilities';
import { bindingLabel } from '../input/bindings';
import { loadingScreen } from '../ui/loading';
import { recordFailure } from '../diagnostics/report';
import { SmithingPanel } from '../ui/smithing-panel';
import { ShopMenu } from '../ui/shop';
import { ClearingDiagnostics } from './diagnostics';
import { disposeSceneInstances, sceneTextures } from '../assets/resource-ownership';
import type { SurfaceMode } from '../assets/environment-surfaces';
import { CombatUI } from '../ui/combat';
import type { KeybindingsMenu } from '../ui/keybindings';
import { actionSlotInputs, type InputPreferences, type InputAction } from '../input/bindings';
import { InteractionHighlight } from '../rendering/interaction-highlight';
import { homeArea, type Adventure, type AdventureEvent } from '../gameplay/adventure';
import { AdventureMenus } from '../ui/adventure';
import { LootLabels } from '../ui/loot';
import { AreaActivation } from './area-activation';
import type { AreaChange, AreaChangeResult } from './area-change';
import { MenuController } from './menu-controller';
import { InteractionActions, areaChangeFailed } from './interaction-actions';
import { runtimeAssets } from '../assets/runtime-assets';
import { createEncounter, type EncounterEvent, type ActorId, type AimPoint } from '../gameplay/encounter';
import type { WebGPURenderer } from 'three/webgpu';
import type { CharacterSave } from '../gameplay/character';
import type { GraphicsSettings } from '../rendering/graphics-settings';
import type { CombatTextSettings } from '../ui/combat-text-settings';
import { PlayerLantern } from '../rendering/player-lantern';
import { Graphics } from '../rendering/graphics';
import { CoreEffects } from '../rendering/effects';
import type { VegetationActor } from '../rendering/vegetation';
import type { Options } from '../ui/options';
import { weatherIntensity } from '../gameplay/weather';
import { rainExposure } from '../levels/weather';
import { createWorld } from '../levels/builder';
import { makeActor, play, duration, attachCharacter, updateActor, type Actor } from './actors';
import { createInput } from './input';
import { createCamera } from './camera';
import { createHud } from '../ui/hud';
import characters from '../../assets/playable-characters.json';
import { EnemyActors } from './enemy-actors';
import { Equipment } from '../rendering/equipment';
import { ProjectileVisuals } from '../rendering/projectiles';
import type { GameAudio } from '../audio/audio';
import { GameplayAudio } from '../audio/gameplay';
import { GatheringTools } from '../rendering/gathering-tools';
import { GatheringController } from './gathering';
import { GatheringAction } from '../gameplay/gathering-action';
import { SessionRuntime } from './runtime';
import { EquipmentSets } from './equipment-sets';
import { InventoryController } from './inventory';
import { CombatImpact } from './combat-impact';
import { CombatController } from './combat';
import { EncounterPresentation } from './encounter-presentation';
import { ClickApproach } from './click-approach';
import { PointerAim } from './pointer-aim';
import { interactionError as worldInteractionError, type WorldInteraction } from './world-interactions';
import '../ui/game.css';
import '../ui/options.css';
export type GameSession = {
  capture(): CharacterSave;
  save(): void;
  actionBar(): ActionBar;
  clearInput(): void;
  applySettings(settings: GraphicsSettings): void;
  applyCombatText(settings: CombatTextSettings): void;
  flushSettings(): void;
  resetMeasurements(): void;
  report(): ReturnType<ClearingDiagnostics['report']>;
  dispose(): Promise<void>;
};
export type SessionContext = {
  reportLoading?: (report: () => ReturnType<ClearingDiagnostics['report']>) => void;
  renderer: WebGPURenderer;
  adventure: Adventure;
  options: Options;
  preferences: InputPreferences;
  bindingsMenu: KeybindingsMenu;
  audio: GameAudio;
  development: boolean;
};

/** A fresh world/input/presentation lifetime for one already selected adventure. */
export async function createGameSession(ctx: SessionContext): Promise<GameSession> {
resetNativeFrameCompilation(ctx.renderer);
let sessionLifecycle: SessionLifecycle | undefined;
const releases: (() => void | Promise<void>)[] = [];
let disposal: Promise<void> | undefined;
let inventoryPreparation: InventoryController | undefined;
const preparation = { generation: 0, destination: 'startup', stage: 'character' };
async function dispose(): Promise<void> {
  disposal ??= (async () => {
    try { await sessionLifecycle?.dispose(async () => { await cancelNativePreparation(ctx.renderer); await inventoryPreparation?.dispose(); }); }
    finally {
      for (const release of releases.reverse()) {
        try { await release(); } catch (error) { console.error('Unable to release adventure resources.', error); }
      }
    }
  })();
  return disposal;
}
try {
const renderQuery = new URLSearchParams(location.search);
const lifecycle: SessionLifecycle = sessionLifecycle = new SessionLifecycle({
  beginAreaChange: (change, request) => createAreaOperation(areaOperations, change, request),
  hidden, loading: () => loadingScreen.blocking,
  pauseReasons: () => Boolean(hidden() || areaStatus.characterMissing || menuController.paused || inventory.loading ||
    development?.inspecting || graphics?.preparingSettings || development?.frozen),
  fpsLimit: () => ctx.options.settings.fpsLimit, clearInput: () => clearInput(), render: drawFrame,
  feedbackFailed: showPresentationFailure,
});
const areaTransitions = lifecycle.areas;
const frameLoop = lifecycle.frames;

// Legacy lab URLs load the clearing.
if (['art', 'renderers'].includes(renderQuery.get('lab') ?? '')) {
  renderQuery.set('area', 'clearing');
  const url = new URL(location.href); url.searchParams.set('area', 'clearing'); for (const key of ['lab', 'space', 'look', 'surface', 'edges']) url.searchParams.delete(key); history.replaceState({}, '', url.href);
}
window.addEventListener('error', (event) => {
  const message = event.error instanceof Error ? event.error.stack ?? event.message : event.message;
  document.getElementById('scene')!.dataset.renderError = message;
}, { signal: lifecycle.signal });
let graphics: Graphics | undefined;
const options = ctx.options;

// Explicit hidden rendering checks opt in; ordinary hidden gameplay never advances.
const renderingInspection = renderQuery.get('inspection') === 'render';
function hidden(): boolean { return !renderingInspection && (document.hidden || document.documentElement.hasAttribute('data-window-hidden')); }
function invalidateFrame(): void { frameLoop.invalidate(); }
function visibilityChanged(): void {
  if (!frameLoop.running) return;
  clearInput(); cameraOwner.suspendFollow();
  if (hidden()) audio.update(encounter.player, true);
  else graphics?.resetMeasurements();
  frameLoop.visibilityChanged();
}
document.addEventListener('visibilitychange', visibilityChanged, { signal: lifecycle.signal });
window.addEventListener('lanternvisibilitychange', visibilityChanged, { signal: lifecycle.signal });
for (const event of ['pointerdown', 'pointerup', 'pointermove', 'keydown', 'keyup', 'wheel', 'input', 'change']) window.addEventListener(event, () => { if (frameLoop.running && paused()) invalidateFrame(); }, { signal: lifecycle.signal });

const mount = document.getElementById('scene')!;
const { scene, ambient, sun } = createWorld();
releases.push(() => { scene.clear(); });
const content = createAreaContent();
const appearance = { lantern: !(import.meta.env.DEV && renderQuery.get('lantern') === 'off') };
let personalLantern: PlayerLantern | undefined;
const initialSurfaces: SurfaceMode = import.meta.env.DEV && renderQuery.get('surfaces') === 'showcase' ? 'showcase' : import.meta.env.DEV && renderQuery.get('surfaces') === 'authored' ? 'authored' : 'projected';
let development: DevelopmentSession | undefined;
const areaStatus: AreaStatus = { revision: 0, errors: [], updateMs: 0, characterMissing: false };
let renderedRevision = 0;
const adventure = ctx.adventure;
adventure.configureAreas(content.definitions);
const resumed = adventure.resume(content.definitions);
const explicitArea = ctx.development && renderQuery.has('area');
const initialDefinition = explicitArea ? content.definitions[renderQuery.get('area') ?? 'clearing'] ?? content.definitions.clearing : resumed.area;
const initialLighting = content.lighting(initialDefinition);
// Read-through views share the transition owner's single published bundle.
const areaState = {
  get definition() { return areaTransitions?.current?.area.area ?? initialDefinition; },
  get instance() { return areaTransitions?.current?.area; },
  get movement() { return areaTransitions?.current?.movement; },
  get visuals() { return areaTransitions?.current?.visuals; },
  get abilities() { return areaTransitions?.current?.abilities; },
  get interactions() { return areaTransitions?.current?.interactions; },
  get lighting() { return areaTransitions?.current?.lightingDefinition ?? initialLighting; },
  get surfaces() { return areaTransitions?.current?.appearance.surfaces ?? initialSurfaces; },
  get shelterRestored() { return areaTransitions?.current?.appearance.shelterRestored ?? adventure.character.shelterRestored; },
  get contentHash() { return areaTransitions?.current?.contentHash ?? ''; },
};

const renderer = ctx.renderer;
mount.append(renderer.domElement);
renderer.domElement.setAttribute('aria-label', 'Lantern. Move and use abilities with your configured controls. Click objects to interact.');
renderer.info.autoReset = false;
let renderedFrames = 0;
const cameraOwner = createCamera(renderer.domElement);
releases.push(() => cameraOwner.controls.dispose());
const { camera, controls } = cameraOwner;
const pointerAim = new PointerAim(renderer.domElement, camera);
controls.addEventListener('change', invalidateFrame);
const simulation = createEncounter('loading', areaState.definition.layout);
const encounter: EncounterView = simulation;
const impact = new CombatImpact();
releases.push(() => { impact.clear(); cameraOwner.clearShake(); });
const player = makeActor(scene, encounter.player);
releases.push(() => { player.mixer?.stopAllAction(); if (player.mixer) player.mixer.uncacheRoot(player.mixer.getRoot()); disposeSceneInstances(player.root, { skeletons: true }); playerArtRelease(); });
const actors: Record<ActorId, Actor> = { player };
const resources = runtimeAssets(renderer), loader = resources.loader;
let playerArtRelease = () => {};
const playerEquipment = new Equipment(player.root, 'player', resources.library);
releases.push(() => playerEquipment.dispose());
const enemyActors = new EnemyActors(scene, loader, actors, resources);
releases.push(() => enemyActors.dispose());
const gatheringTools = new GatheringTools(player.root,playerEquipment, resources.library);
releases.push(() => gatheringTools.dispose());
const projectileVisuals = new ProjectileVisuals(scene, resources.library);
releases.push(() => projectileVisuals.dispose());
const harvesting = adventure.harvesting;
adventure.canRenew = (source, position, height, radius, arriving) => !!areaState.instance && (arriving || !areaTransitions?.transitioning && !development?.frozen && !development?.inspecting)
  && !!areaTransitions?.current?.renewalVisibility.eligible(camera, encounter, source, position, height, radius, arriving);
adventure.placeGround = (origin, index) => areaState.movement!.lootGround(origin, index, encounter.player);
adventure.canCollectGround = drop => !!areaState.movement?.pickupReachable(encounter.player, drop.position, drop.height, 1.65);
const interactionHighlight=new InteractionHighlight(scene);
releases.push(() => interactionHighlight.dispose());
const equipmentSets = new EquipmentSets(player, playerEquipment, loader, () => projectileVisuals.prepareArrow());
releases.push(() => equipmentSets.dispose());
const preferences = ctx.preferences;
let hoveredInteraction: WorldInteraction | null=null;
const audio = ctx.audio;
releases.push(() => { audio.clearArea(); audio.update({ x: 0, z: 0 }, true); });
const gameplayAudio = new GameplayAudio(audio);
document.addEventListener('click', event => {
  const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null;
  if (button && !button.disabled && button.closest('dialog, #result-panel')) audio.play('uiClick');
}, { signal: lifecycle.signal });
const gatheringAction = new GatheringAction(simulation, adventure, {
  area: () => areaState.definition, paused,
  timing: resource => {
    const motion = resource.kind === 'tree' ? 'chop' : 'mine';
    return player.actions[motion] ? { duration: duration(player, motion), contact: motion === 'chop' ? player.chopContact : player.mineContact } : undefined;
  },
  visible: resource => !!areaState.movement?.resourceVisible(encounter.player, resource.id, { x: resource.position[0], y: resource.position[1], z: resource.position[2] }),
  setTreeFelled: (id, felled) => areaState.movement?.setTreeFelled(id, felled),
});
const gathering = new GatheringController(gatheringAction, harvesting, player, gatheringTools, audio, {
  instance: () => areaState.instance, effects: () => graphics?.effects,
});
const runtime: SessionRuntime = new SessionRuntime(simulation, adventure, gatheringAction, {
  area: () => areaState.definition, movement: () => areaState.movement, timings: () => combat.timings(),
  paused, impactHolding: () => impact.holding, equipmentBlocked: () => !lifecycle.canEditEquipment || !!gathering.target,
  interruptApproach, defeated: () => interruptApproach(false),
});
const approach = new ClickApproach(adventure, encounter, runtime);
function clearInput(preserveAccepted = lifecycle.preserveAcceptedActions): void {
  impact.clear(); cameraOwner.clearShake(); runtime.clearInput(preserveAccepted);
  input.clearHeld();
  combatUI?.clearHold();
  hoveredInteraction = null;
  interactionHighlight.clear();
}

const input = createInput(renderer.domElement, preferences, dispatchInput, worldClick, () => {
  runtime.clearInput();
});
releases.push(() => input.dispose());
const combat = new CombatController(actors, input, pointerAim, equipmentSets, {
  paused, cancelImpact: () => impact.clear(), safeArea: () => areaState.definition.kind === 'safe',
  clearHold: () => combatUI?.clearHold(),
  blocking: () => !!combatUI?.blocking,
}, runtime);
const inventory = new InventoryController(player, equipmentSets, audio, {
  clearInput, closed: () => lifecycle.closed, presentationFailed: failPresentation,
  updateCharacter: () => menus.updateCharacter(adventure.character), syncAdventure,
}, runtime);
inventoryPreparation = inventory;

const menus = new AdventureMenus(clearInput, () => renderer.domElement.focus(), id => runtime.castReturn(id), {
  change: items => inventory.change(items), newId: adventure.newId, present: presentCommitted,
  activateSet: set => inventory.activateSet(set),
  canEquip: () => inventory.canEditEquipment(),
  potion: id => {
    runtime.usePotion(id, true);
    presentCommitted(syncAdventure);
  },
  changeContainers: (items, stash) => inventory.changeContainers(items, stash),
  transfer: (id, quantity, toStash, point) => inventory.transfer(id, quantity, toStash, point),
  repair: async () => {
    const canCommit=()=>runtime.canRepair();
    if(!canCommit())throw new Error('Not enough materials.');
    const ok=await changeArea({kind:'refresh',spawn:{position:[encounter.player.x,encounter.player.z],yaw:encounter.player.yaw},appearance:{shelterRestored:true},canCommit,onCommit:()=>runtime.repairShelter()});
    if(ok.status !== 'committed')throw new Error('Unable to repair shelter. Materials were retained.');
    if(ok.readiness === 'ready')presentCommitted(() => audio.play('chestOpen'));
  },
  recover: id => inventory.recover(id),
  drop: (id, quantity) => inventory.drop(id, quantity),
}, cue => audio.play(cue));
releases.push(() => menus.dispose());
const shop = new ShopMenu({
  clear: clearInput, focus: () => renderer.domElement.focus(), sound: cue => audio.play(cue), present: presentCommitted,
  buy: item => { runtime.buy(item); presentCommitted(syncAdventure); },
  sell: id => { runtime.sell(id); presentCommitted(syncAdventure); },
  buyBack: id => { runtime.buyBack(id); presentCommitted(syncAdventure); },
});
releases.push(() => shop.dispose());
const smithingMenu = new SmithingPanel({
  character:()=>runtime.character, backgrounded:hidden, present: presentCommitted,
  clear:clearInput, focus:()=>renderer.domElement.focus(), sound:cue=>audio.play(cue),
  forge:item=>{const learned=runtime.forge(item);presentCommitted(syncAdventure);return learned;},
  reclaim:(id,container)=>{const learned=runtime.reclaim(id,container);presentCommitted(syncAdventure);return learned;},
});
releases.push(()=>smithingMenu.dispose());

const lootLabels = new LootLabels(mount, selectLoot);
releases.push(() => lootLabels.dispose());
function selectLoot(id: string): void {
  if (paused() || encounter.player.hp <= 0) return;
  renderer.domElement.focus();
  if (!adventure.session().drops.some(drop => drop.id === id)) return;
  runtime.clearInput();
  approach.selectLoot(id, areaState.movement);
}

const hud = createHud(() => { if (!inventory.loading && lifecycle.canAcceptMenuInput) void changeArea({ kind: 'travel', area: homeArea, transition: true, spawn: content.definitions.homestead.layout.player, recover: true }).catch(areaChangeFailed); });
releases.push(() => hud.dispose());
const presentation = new EncounterPresentation(encounter, actors, gameplayAudio, hud, {
  effects: () => graphics?.effects,
  weaponSet: set => {
    equipmentSets.activate(set);
    combatUI?.update();
    audio.play('equip');
    menus.updateCharacter(adventure.character);
    shop.update(adventure.character);
  },
});
function present(events: EncounterEvent[]): void {
  const lost = events.some(event => event.type === 'outcome' && !event.won);
  if (lost) impact.clear();
  presentation.present(events);
  if (!lost && !development?.frozen && !development?.inspecting && !areaTransitions?.transitioning) impact.present(events);
}
function clearPresentation(): void {
  gameplayAudio.reset();
  clearInput();
  graphics?.effects.clear();
  graphics?.effects.resetVegetation();
  vegetationActorRecords.clear();
  areaState.abilities?.clear(); projectileVisuals.clear(); enemyActors.clear();
  areaState.instance?.portals.forEach(p => p.reset());
  if (lifecycle.phase === 'recovering') hud.clearCombatText(); else hud.reset();
  hud.setSafe(areaState.definition.kind === 'safe');
  if (!development?.fixedCamera && !development?.inspecting) cameraOwner.resetFollow(player.root.position);
  else cameraOwner.suspendFollow();
  graphics?.resetHistory();
}
function resetPresentation(): void {
  clearPresentation();
  presentation.resetActors(areaState.definition.kind === 'safe');
}
function restorePresentation(): void {
  clearPresentation();
  equipmentSets.activate(adventure.character.activeSet);
  presentation.restoreActors(areaState.definition.kind === 'safe');
  if (areaState.instance) gathering.restore(areaState.instance);
  projectileVisuals.sync(encounter.projectiles);
  enemyActors.restore(encounter);
  areaState.abilities?.sync(encounter, player.root, camera);
  hud.restore(encounter);
}
function reset(): void {
  runtime.takeFeedback();
  clearInput(); runtime.restart(); areaState.movement?.resetActors();
  if (areaState.instance && areaState.movement) { runtime.registerResources(areaState.instance.resources, areaState.movement); gathering.restore(areaState.instance); }
  runtime.syncLoadout(); resetPresentation();
}
const bindingsMenu = ctx.bindingsMenu;
const menuController = new MenuController(
  {
    get adventure() { return menus; },
    get shop() { return shop; },
    get smithing() { return smithingMenu; },
    get skills() { return combatUI; },
    get bindings() { return bindingsMenu; },
    get options() { return options; },
  },
  () => !paused() && encounter.player.hp > 0,
);
const interactionActions = new InteractionActions(adventure, encounter, menus, audio, {
  area: () => areaState.definition, definitions: () => content.definitions, paused, changeArea, syncAdventure,
  openShop: () => { shop.update(adventure.character); shop.open(); },
  openSmithing: () => smithingMenu.open(),
}, runtime);
function dispatchInput(action: InputAction): void {
  if (!lifecycle.canAcceptMenuInput) { clearInput(); return; }
  if (action === 'inventory') { menuController.toggleInventory(); return; }
  if (action === 'skills') { menuController.toggleSkills(); return; }
  if (action === 'options') { menuController.toggleOptions(); return; }
  if (!lifecycle.canAcceptGameplayInput) return;

  switch (action) {
    case 'slot0': case 'slot1': case 'slot2': case 'slot3': case 'slot4': case 'slot5': {
      const id = adventure.character.actionBar[actionSlotInputs.indexOf(action)];
      if (id) combat.startAbility(id);
      break;
    }
    // Movement reads held inputs in the frame loop.
    case 'moveUp': case 'moveDown': case 'moveLeft': case 'moveRight': break;
    case 'dodge': combat.dodge(); break;
    case 'swap': combat.swap(); break;
    case 'potion': usePotion(); break;
    case 'portal': castReturn(); break;
  }
}
function usePotion(): void {
  if (paused()) return;
  runtime.usePotion();
  invalidateFrame();
}
function castReturn(): void { runtime.castReturn(); invalidateFrame(); }
const combatUI = new CombatUI({
  paused,
  character: () => runtime.character, encounter: () => runtime.state, preferences,
  activate: id => combat.startAbility(id), potion: usePotion, portal: castReturn,
  canEdit: () => inventory.canEditEquipment(),
  portalReady: () => areaState.definition.id !== homeArea && encounter.player.hp > 0 &&
    adventure.character.scrolls > 0 && adventure.castRemaining === 0,
  assign: bar => { if (!inventory.loading) runtime.setActionBar(bar); },
  clear: clearInput, focus: () => renderer.domElement.focus(),
});
releases.push(() => combatUI.dispose());
const optionsButton = document.createElement('button');
optionsButton.id = 'hud-options'; optionsButton.textContent = '⚙';
optionsButton.title = 'Options'; optionsButton.setAttribute('aria-label', 'Options');
optionsButton.onclick = () => dispatchInput('options');
document.getElementById('app')!.append(optionsButton);
releases.push(() => optionsButton.remove());

function worldTargets(): readonly WorldInteraction[] {
  return areaState.interactions?.targets(adventure, harvesting, areaState.visuals?.portalTarget) ?? [];
}
function interactionError(target: WorldInteraction): string {
  return worldInteractionError(target, areaState.definition, adventure, encounter);
}
function pickInteraction(): WorldInteraction | null {
  return areaState.interactions?.pick(pointerAim.ray, worldTargets()) ?? null;
}

function worldClick(clientX: number, clientY: number): boolean {
  if (paused() || encounter.player.hp <= 0) return false;
  resolveAim({ x: clientX, y: clientY });
  if (impact.holding) return !!areaState.visuals?.pick(pointerAim.ray) || !!pickInteraction();
  const loot = areaState.visuals?.pick(pointerAim.ray);
  if (loot) { selectLoot(loot); return true; }
  const target = pickInteraction();
  if (!target) return false;
  if (target.type === 'resource' && gathering.target?.id === target.resource.id) return true;
  clearInput();
  const error = interactionError(target);
  if (error) { adventure.message(error); return true; }
  approach.selectWorld(target, areaState.movement);
  return true;
}

function syncAdventure(adventureEvents: AdventureEvent[] = adventure.takeEvents()): void {
  areaState.visuals?.sync(adventure.areaDrops(areaState.definition.id), adventure.portalPosition(areaState.definition), lootLabels.hovered, adventure.portalHeight(areaState.definition));
  for (const chest of areaState.definition.chests ?? []) areaState.instance?.setChestOpened(chest.id, adventure.chest(areaState.definition, chest).opened);
  for (const event of adventureEvents) if (event.type === 'enemyRenewed') {
    const actor = actors[event.id], state = encounter.enemies[event.id];
    if (actor && state) {
      actor.mixer?.stopAllAction(); actor.current = null; actor.previous = null; actor.velocity.set(0, 0);
      actor.root.position.set(state.x, state.y + .04, state.z); actor.root.rotation.y = state.yaw;
      play(actor, 'idle');
    }
    hud.dismissResult();
  }
  const learned=adventureEvents.filter(event=>event.type==='abilityLearned');
  if (learned.length) adventure.message(learned.map(event=>{
    const binding=event.slot===null ? null : preferences.value[actionSlotInputs[event.slot]].find(Boolean);
    return abilities[event.ability].name+' learned'+(event.slot===null ? '' : ' · '+(binding ? bindingLabel(binding) : 'Slot '+(event.slot+1)));
  }).join(' · '),4);
  const prompt=paused() || encounter.player.hp<=0 ? '' : adventure.notice || (hoveredInteraction ? interactionError(hoveredInteraction) || hoveredInteraction.name : '');
  gameplayAudio.adventure(adventureEvents);
  hud.adventure(adventureEvents);
  if (adventure.castRemaining<=0) audio.stop('return-cast');
  menus.updateCharacter(adventure.character);
  shop.update(adventure.character);
  menus.update(adventure.character.scrolls, areaState.definition.id !== homeArea && encounter.player.hp > 0 && adventure.character.scrolls > 0 && adventure.castRemaining === 0, prompt, adventure.castRemaining);
  combatUI?.update();
}
function paused(): boolean { return !lifecycle.canAdvanceSimulation; }
function resolveAim(pointer = input.pointer()): AimPoint | undefined {
  return pointerAim.resolve(pointer, encounter.player.y);
}
function interruptApproach(releaseLock = true): void {
  approach.cancel();
  runtime.cancelGathering(releaseLock);
}
function updateGame(dt: number, weatherDt: number): void {
  if (dt <= 0 && impact.holding && !paused()) { runtime.advanceWeather(weatherDt); hud.update(encounter, []); return; }
  const isPaused = paused();
  runtime.flushUtility();
  let movement = development?.movement ?? input.movement();
  const block=combat.holdingShield();
  runtime.interruptGathering(movement, block);
  const approachCommand = isPaused ? undefined : approach.update(dt, {
    movement, block, navigation: areaState.movement, targets: worldTargets, error: interactionError,
    interact: target => interactionActions.execute(target),
  });
  if (approachCommand) movement = approachCommand.movement;
  const commands = { ...movement, block, paused: isPaused || paused(), aim: isPaused ? undefined : approachCommand?.aim ?? resolveAim() };
  if (encounter.player.hp > 0 && !commands.paused && Math.hypot(movement.x, movement.z) > 0) hud.dismissResult();
  const gate = runtime.advance(dt, commands, weatherDt);
  if (gate) void changeArea({ kind: 'travel', area: gate.destination.area, arrivalId: gate.destination.gate, transition: true }).catch(areaChangeFailed);
  const feedback = runtime.takeFeedback();
  gathering.present(feedback.gathering);
  present(feedback.combat);
  projectileVisuals.sync(encounter.projectiles, isPaused ? 0 : dt);
  enemyActors.sync(encounter, isPaused ? 0 : dt, areaState.definition.kind !== 'safe');
  if(!paused() && input.pointer()){resolveAim();hoveredInteraction=pickInteraction();}else hoveredInteraction=null;
  interactionHighlight.select(hoveredInteraction && !interactionError(hoveredInteraction) ? hoveredInteraction.object : null);interactionHighlight.update((camera.top-camera.bottom)/camera.zoom/Math.max(1,mount.clientHeight)*1.5);
  renderer.domElement.style.cursor=hoveredInteraction ? interactionError(hoveredInteraction) ? 'not-allowed' : 'pointer' : '';
  syncAdventure(feedback.adventure);
  hud.update(encounter, []);
}
function resize(): void {
  cameraOwner.resize(mount.clientWidth, mount.clientHeight);
  if (graphics) graphics.resize();
  else resizeDisplay(renderer, mount.clientWidth, mount.clientHeight);
  invalidateFrame();
}
window.addEventListener('resize', resize, { signal: lifecycle.signal });
resize();
function presentCommitted(feedback: () => void): void { lifecycle.present(feedback); }
function failPresentation(error: unknown): void { lifecycle.failPresentation(error); }
function showPresentationFailure(error: unknown, retry: () => void): void {
  areaStatus.errors = [error instanceof Error ? error.message : String(error)];
  recordFailure('gameplay-presentation', error);
  clearInput(); approach.cancel(); presentation.rememberPlayback();
  const token = loadingScreen.begin(areaState.definition.name, true);
  loadingScreen.fail(token, error, { kind: 'feedback', retry });
}
function drawFrame(dt: number): boolean {
  cameraOwner.clearShake();
  if (paused() || development?.inspecting || development?.fixedCamera || areaTransitions?.transitioning) impact.clear();
  const gameDt = impact.advance(dt);
  updateGame(gameDt, dt);
  audio.update(encounter.player,paused() || encounter.phase==='loading');
  if (!development?.inspecting && !paused() && !development?.fixedCamera && encounter.player.hp > 0) {
    cameraOwner.follow(player.root.position, gameDt);
  } else cameraOwner.suspendFollow();
  for (const id in actors) {
    const actor = actors[id];
    const state = id === 'player' ? encounter.player : encounter.enemies[id];
    updateActor(actor, state, gameDt, paused(), id==='player' && encounter.blocking);
    gameplayAudio.locomotion(id,state,actor.gait,actor.current,paused());
    graphics?.effects.fluids.locomotion(state.x, state.y, state.z, state.yaw, actor.gait,
      actor.current === 'run' && state.hp > 0 && actor.root.visible, paused() || !!areaTransitions?.transitioning, gameDt, id);
  }
  areaState.abilities?.sync(encounter,player.root,cameraOwner.camera);
  if (!paused()) { areaState.instance?.portals.forEach(p => p.update(gameDt)); areaState.visuals?.update(gameDt); }
  development?.advanceWeather(dt);
  const weather = development?.weather ?? adventure.character.outing.weather;
  const rain = areaState.definition.effects.weather ? weatherIntensity(weather) : 0;
  const exposure = rainExposure(areaState.instance?.weatherShelters ?? [], encounter.player.x, encounter.player.z);
  if (areaState.instance) areaState.instance.rainWetness.value = areaState.definition.effects.weather ? weather.wetness : 0;
  graphics?.effects.setRainIntensity(rain);
  const portalPoint = adventure.portalPosition(areaState.definition);
  gameplayAudio.ambience(areaState.definition.effects.fires,encounter.player,portalPoint ? {x:portalPoint[0],z:portalPoint[1]} : null,appearance.lantern && encounter.player.hp>0 ? encounter.player : null, areaState.definition.ambience ?? 'woodland', (options?.settings.weatherEffects ?? true) ? rain : 0, exposure);
  controls.update();
  camera.updateMatrixWorld();
  pointerAim.capture(camera);
  const pointer = input.pointer();
  if (!paused() && pointer) { resolveAim(pointer); lootLabels.hovered = areaState.visuals?.pick(pointerAim.ray) ?? null; }
  const shake = impact.offset(options?.settings.cameraShake ?? true);
  cameraOwner.applyShake(shake.x,shake.y,mount.clientHeight);
  lootLabels.sync(adventure.areaDrops(areaState.definition.id), camera, [encounter.player.x, encounter.player.z], paused() || encounter.player.hp <= 0);
  hud.positionEnemy(encounter, camera, mount, paused() ? 0 : gameDt, !!development?.inspecting || areaTransitions.transitioning);
  areaState.instance?.update(camera, paused() ? 0 : gameDt);
  stageVegetationActors();
  graphics?.effects.setGameplayDelta(gameDt);
  graphics?.effects.weatherView(camera,player.root.position);
  renderer.info.reset();
  const rendered = graphics?.render(dt, paused()) ?? false;
  if (rendered) renderedFrames++;
  if (rendered && areaState.instance && !areaTransitions?.transitioning) renderedRevision = areaStatus.revision;
  return rendered;
}
const vegetationActors: VegetationActor[] = [];
const vegetationActorRecords = new Map<string, VegetationActor>();
const vegetationEnemies: string[] = [];
function stageVegetationActors(): void {
  vegetationActors.length = 0; vegetationEnemies.length = 0;
  const record = (id: string): VegetationActor => {
    const state = id === 'player' ? encounter.player : encounter.enemies[id];
    let value = vegetationActorRecords.get(id);
    if (!value) { value = { id, x: 0, y: 0, z: 0, yaw: 0 }; vegetationActorRecords.set(id, value); }
    value.x = state.x; value.y = state.y; value.z = state.z; value.yaw = state.yaw; return value;
  };
  if (encounter.player.hp > 0 && player.root.visible) vegetationActors.push(record('player'));
  if (areaState.definition.kind !== 'safe') for (const id of encounter.enemyIds) {
    if (encounter.enemies[id].hp <= 0 || !actors[id]?.root.visible || !encounter.enemies[id].home) continue;
    vegetationEnemies.push(id);
  }
  const distance = (id: string): number => (encounter.enemies[id].x - encounter.player.x) ** 2 + (encounter.enemies[id].z - encounter.player.z) ** 2;
  vegetationEnemies.sort((a, b) => distance(a) - distance(b) || a.localeCompare(b));
  for (let i = 0; i < Math.min(3, vegetationEnemies.length); i++) vegetationActors.push(record(vegetationEnemies[i]));
  graphics?.effects.setVegetationActors(vegetationActors);
}
const areaActivation = new AreaActivation({
  attachEnemies: enemies => enemyActors.commit(enemies, true), detachEnemies: () => enemyActors.detach(),
  attachLighting: lighting => graphics!.commitLighting(lighting, true), detachLighting: () => graphics?.detachLighting(),
  attachArea: area => { scene.add(area.root); area.activate(graphics!.effects); },
  detachArea: area => { try { area.root.removeFromParent(); } finally { graphics?.effects.clearArea(); } },
});
const areaOperations = {
  lifecycle, content, status: areaStatus, query: renderQuery, initialSurfaces, appearance,
  area: () => areaState.definition, development: () => development, renderer, mount, assets: resources,
  graphics: () => graphics!, personalLantern: () => personalLantern, enemies: enemyActors, player, encounter, runtime,
  camera: cameraOwner, activation: areaActivation, gathering, gatheringTools, hud, audio, options,
  presentation: { rememberPlayback: () => presentation.rememberPlayback(), reset: resetPresentation, restore: restorePresentation },
  approach, clearInput, interruptApproach, syncAdventure, message: (text: string) => adventure.message(text),
};
areaTransitions.preparation = preparation;
const runtimeDiagnostics = new ClearingDiagnostics({
  get preparation() { return areaTransitions?.preparation ?? preparation; },
  audio, adventure, encounter, preferences, harvesting, gathering, approach,
  playerEquipment, enemyActors, actors, camera, controls, renderer, mount,
  get currentArea() { return areaState.definition; },
  get active() { return areaState.instance; },
  get graphics() { return graphics; },
  get options() { return options; },
  get personalLantern() { return personalLantern; },
  get movementWorld() { return areaState.movement; },
  get hoveredInteraction() { return hoveredInteraction; },
  get surfaceMode() { return areaState.surfaces; },
  get revision() { return areaStatus.revision; },
  get renderedRevision() { return renderedRevision; },
  get transitioning() { return !!areaTransitions?.transitioning; },
  get areaErrors() { return areaStatus.errors; },
  get characterMissing() { return areaStatus.characterMissing; },
  get contentHash() { return areaState.contentHash; },
  get updateMs() { return areaStatus.updateMs; },
  get renderedFrames() { return renderedFrames; },
});
ctx.reportLoading?.(() => runtimeDiagnostics.report());
const diagnostics = () => runtimeDiagnostics.snapshot();
if (import.meta.env.DEV) {
  const { DevelopmentSession } = await import('./development');
  development = new DevelopmentSession({ query: renderQuery, lifecycle, content, appearance,
    area: () => areaState.definition, current: () => areaTransitions.current,
    errors: errors => { areaStatus.errors = errors; }, adventure, runtime, actors, camera: cameraOwner, scene, renderer,
    graphics: () => graphics, personalLantern: () => personalLantern, options, diagnostics, ready: () => !!runtimeDiagnostics.report().ready,
    clearInput, restart: reset, syncAdventure, presentGathering: () => gathering.present(gatheringAction.takeEvents()),
    attack: () => combat.startAbility('axe-basic'), render: dt => lifecycle.render(dt),
  });
  releases.push(() => development?.dispose());
}

try {
  loadingScreen.preparing(loadingScreen.current, 'Preparing character');
  const playerArt = loadRigArt(resources, characters.player.model); playerArtRelease = playerArt.release;
  const character = await playerArt.ready;
  sceneTextures(character.scene);
  attachCharacter(player, character.scene, character.animations, characters.player.height);
  loadingScreen.preparing(loadingScreen.current, 'Preparing equipment');
  preparation.stage = 'equipment';
  await inventory.initialize();
  loadingScreen.preparing(loadingScreen.current, 'Preparing equipment');
  await gatheringTools.prepare();
  resetPresentation();
} catch (error) {
  areaStatus.characterMissing = true;
  recordFailure('character', error);
  throw new Error('Required character art could not be prepared.', { cause: error });
}

{
  loadingScreen.preparing(loadingScreen.current, 'Preparing lighting');
  preparation.stage = 'lighting';
  personalLantern = new PlayerLantern(player.root, appearance.lantern, resources); releases.push(() => personalLantern?.dispose()); await personalLantern.initialize();
  const effects = new CoreEffects(); scene.add(effects.root);
  const lighting = { get definition() { return areaState.lighting; }, get fires() { return areaState.instance?.fires ?? []; }, get shadow() { return areaState.instance?.shadow ?? null; } };
  applySettings(options.settings);
  hud.applyCombatText(options.combatText);
  graphics = new Graphics({ scene, camera, renderer, controls, sun, ambient, mount, lighting, invalidate: invalidateFrame }, options.settings, effects);
  releases.push(() => graphics?.dispose());
  const menusChanged = new MutationObserver(invalidateFrame);
  document.querySelectorAll('dialog').forEach(dialog => menusChanged.observe(dialog, { attributes: true, attributeFilter: ['open'] }));
  mount.addEventListener('graphicssettingschange', invalidateFrame, { capture: true, signal: lifecycle.signal });
  releases.push(() => menusChanged.disconnect());
  resize();
  loadingScreen.preparing(loadingScreen.current, 'Preparing graphics');
  preparation.stage = 'graphics';
  await graphics.initialize();
  const initialArea = await changeArea({ kind: 'travel', area: areaState.definition.id, spawn: explicitArea ? undefined : resumed.spawn });
  if (initialArea.status !== 'committed' || initialArea.readiness !== 'ready') throw new Error('Initial area could not be prepared.', { cause: 'error' in initialArea ? initialArea.error : undefined });
  await development?.attach();

}

function applySettings(settings: GraphicsSettings): void {
  hud.resourceNumbers(settings.resourceNumbers);
  if (!settings.cameraShake) { impact.offset(false); cameraOwner.clearShake(); }
  if (cameraOwner.setDistance(settings.cameraDistance)) { graphics?.resetHistory(); invalidateFrame(); }
  graphics?.apply(settings); areaState.abilities?.setQuality(settings.particleQuality);
}

function changeArea(change: AreaChange): Promise<AreaChangeResult> {
  return lifecycle.changeArea(change);
}

return { capture: () => adventure.capture(), save: () => adventure.save(), actionBar: () => adventure.character.actionBar, clearInput, applySettings,
  applyCombatText: settings => hud.applyCombatText(settings), flushSettings: () => graphics?.flushSettings(),
  resetMeasurements: () => graphics?.resetMeasurements(), report: () => runtimeDiagnostics.report(), dispose };
} catch (error) { await dispose(); throw error; }
}
