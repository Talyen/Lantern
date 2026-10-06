import { resizeDisplay } from '../rendering/display-resolution';
import { cancelNativePreparation } from '../rendering/renderer';
import { nativePreparation } from '../rendering/native-preparation';
import { attachPreviewGraphics } from '../rendering/preview-graphics';
import { loadRigArt } from '../assets/rig-art';
import { RenewalVisibility } from './renewal-visibility';
import { finishSubmittedFrame, resetNativeFrameCompilation } from '../rendering/renderer';
import { AbilityEffects } from '../rendering/ability-effects';
import { abilities, type ActionBar } from '../gameplay/abilities';
import { bindingLabel } from '../input/bindings';
import { loadingScreen } from '../ui/loading';
import { recordFailure } from '../diagnostics/report';
import { SmithingPanel } from '../ui/smithing-panel';
import { ShopMenu } from '../ui/shop';
import { ClearingDiagnostics } from './diagnostics';
import { disposeSceneInstances, sceneTextures } from '../assets/resource-ownership';
import { resolveAreaLighting as lightingFor } from '../levels/lighting';
import type { SurfaceMode } from '../assets/environment-surfaces';
import { CombatUI } from '../ui/combat';
import type { KeybindingsMenu } from '../ui/keybindings';
import { actionSlotInputs, type InputPreferences, type InputAction } from '../input/bindings';
import { InteractionHighlight } from '../rendering/interaction-highlight';
import { homeArea, type Adventure, type AdventureEvent } from '../gameplay/adventure';
import { near } from '../gameplay/area';
import { AdventureMenus } from '../ui/adventure';
import { AdventureVisuals } from '../rendering/adventure';
import { LootLabels } from '../ui/loot';
import { MovementWorld } from '../gameplay/movement';
import { AreaActivation } from './area-activation';
import { AreaTransitionController, type AreaOperation, type AreaRequest } from './area-transition';
import type { AreaChange, AreaChangeResult } from './area-change';
import { MenuController } from './menu-controller';
import { InteractionActions, areaChangeFailed } from './interaction-actions';
import { runtimeAssets } from '../assets/runtime-assets';
import { createEncounter, resetEncounter, type EncounterEvent, type ActorId, type AimPoint } from '../gameplay/encounter';
import { readSettings } from '../rendering/graphics-settings';
import type { WebGPURenderer } from 'three/webgpu';
import type { CharacterSave } from '../gameplay/character';
import type { GraphicsSettings } from '../rendering/graphics-settings';
import type { CombatTextSettings } from '../ui/combat-text-settings';
import { PlayerLantern } from '../rendering/player-lantern';
import { Graphics } from '../rendering/graphics';
import { CoreEffects } from '../rendering/effects';
import type { VegetationActor } from '../rendering/vegetation';
import type { Options } from '../ui/options';
import { advanceWeather, weatherIntensity, type WeatherPhase, type WeatherState } from '../gameplay/weather';
import { rainExposure } from '../levels/weather';
import { buildArea, createWorld } from '../levels/builder';
import type * as LevelRegistry from '../levels/registry';
import type * as LevelLighting from '../levels/lighting';
import type * as LevelValidation from '../levels/validation';
import { areas } from '../levels/registry';
import { validateAreas } from '../levels/validation';
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
import { progression } from '../gameplay/skills';
import { GatheringController } from './gathering';
import { GatheringAction } from '../gameplay/gathering-action';
import { SessionRuntime } from './runtime';
import { FrameLoop } from './frame-loop';
import { EquipmentSets } from './equipment-sets';
import { InventoryController } from './inventory';
import { CombatImpact } from './combat-impact';
import { CombatController } from './combat';
import { EncounterPresentation } from './encounter-presentation';
import { ClickApproach } from './click-approach';
import { PointerAim } from './pointer-aim';
import { WorldInteractions, interactionError as worldInteractionError, type WorldInteraction } from './world-interactions';
import { traversalWithTrees } from '../levels/trees';
import '../ui/game.css';
import '../ui/options.css';
export type GameSession = {
  capture(): CharacterSave;
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
const lifecycle = new AbortController();
const releases: (() => void | Promise<void>)[] = [];
let closed = false;
let areaTransitions: AreaTransitionController | undefined;
const preparation = { generation: 0, destination: 'startup', stage: 'character' };
async function dispose(): Promise<void> {
  if (closed) return;
  closed = true; lifecycle.abort();
  await cancelNativePreparation(ctx.renderer);
  await areaTransitions?.dispose();
  for (const release of releases.reverse()) {
    try { await release(); } catch (error) { console.error('Unable to release adventure resources.', error); }
  }
}
try {
const renderQuery = new URLSearchParams(location.search);
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
let comparisonMovement: { x: number; z: number } | null = null;
// Explicit hidden rendering checks opt in; ordinary hidden gameplay never advances.
const renderingInspection = renderQuery.get('inspection') === 'render';
const frameLoop = new FrameLoop({
  hidden, paused, fpsLimit: () => options?.settings.fpsLimit ?? initialFpsLimit,
  onPause: clearInput, render: renderFrame,
});
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
let definitions = areas;
let validateDefinitions = validateAreas;
let resolveLightingFor = lightingFor;
let lanternEnabled = !(import.meta.env.DEV && renderQuery.get('lantern') === 'off');
let personalLantern: PlayerLantern | undefined;
const initialSurfaces: SurfaceMode = import.meta.env.DEV && renderQuery.get('surfaces') === 'showcase' ? 'showcase' : import.meta.env.DEV && renderQuery.get('surfaces') === 'authored' ? 'authored' : 'projected';
let weatherPreview: WeatherState | undefined;
let revision = 0, renderedRevision = 0;
let frozen = import.meta.env.DEV && renderQuery.get('author') === 'levels';
let fixedCamera = frozen;
let areaErrors: string[] = [], updateMs = 0, characterMissing = false;
let presentationFailed = false;
let recoveringPresentation = false;
const adventure = ctx.adventure;
adventure.configureAreas(definitions);
const resumed = adventure.resume(definitions);
const explicitArea = ctx.development && renderQuery.has('area');
const initialDefinition = explicitArea ? definitions[renderQuery.get('area') ?? 'clearing'] ?? definitions.clearing : resumed.area;
const initialLighting = resolveLightingFor(initialDefinition);
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
const waitFrames = (count = 16) => frameLoop.waitFrames(count);
const renderer = ctx.renderer;
mount.append(renderer.domElement);
renderer.domElement.setAttribute('aria-label', 'Lantern. Move and use abilities with your configured controls. Click objects to interact.');
renderer.info.autoReset = false;
let renderedFrames = 0;
const cameraOwner = createCamera(renderer.domElement);
releases.push(() => cameraOwner.controls.dispose());
const { camera, controls } = cameraOwner;
releases.push(() => frameLoop.dispose());
const pointerAim = new PointerAim(renderer.domElement, camera);
controls.addEventListener('change', invalidateFrame);
const encounter = createEncounter('loading', areaState.definition.layout);
const impact = new CombatImpact();
releases.push(() => { impact.clear(); cameraOwner.clearShake(); });
const player = makeActor(scene, encounter.player);
releases.push(() => { player.mixer?.stopAllAction(); if (player.mixer) player.mixer.uncacheRoot(player.mixer.getRoot()); disposeSceneInstances(player.root, { skeletons: true }); playerArtRelease(); });
const actors: Record<ActorId, Actor> = { player };
const resources = runtimeAssets(renderer), loader = resources.loader;
let playerArtRelease = () => {};
const approach = new ClickApproach(adventure, encounter);
const playerEquipment = new Equipment(player.root, 'player', resources.library);
releases.push(() => playerEquipment.dispose());
const enemyActors = new EnemyActors(scene, loader, actors, resources);
releases.push(() => enemyActors.dispose());
const gatheringTools = new GatheringTools(player.root,playerEquipment, resources.library);
releases.push(() => gatheringTools.dispose());
const projectileVisuals = new ProjectileVisuals(scene, resources.library);
releases.push(() => projectileVisuals.dispose());
const harvesting = adventure.harvesting;
adventure.canRenew = (source, position, height, radius, arriving) => !!areaState.instance && (arriving || !areaTransitions?.transitioning && !frozen && !inspecting)
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
let pendingUtility: 'potion'|'portal'|null=null;
document.addEventListener('click', event => {
  const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null;
  if (button && !button.disabled && button.closest('dialog, #result-panel')) audio.play('uiClick');
}, { signal: lifecycle.signal });
const gatheringAction = new GatheringAction(encounter, adventure, {
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
const runtime = new SessionRuntime(encounter, adventure, gatheringAction, {
  area: () => areaState.definition, movement: () => areaState.movement, timings: () => combat.timings(),
  interruptApproach, defeated: () => { pendingUtility = null; interruptApproach(false); },
});
function clearInput(): void {
  impact.clear(); cameraOwner.clearShake(); pendingUtility=null;
  if (recoveringPresentation || presentationFailed) input.clearHeld(); else input.clear();
  combatUI?.clearHold();
  hoveredInteraction = null;
  interactionHighlight.clear();
}
let inspecting = false;
const input = createInput(renderer.domElement, preferences, dispatchInput, worldClick, () => {
  encounter.pending = null;
  encounter.blocking = false;
  interruptApproach();
});
releases.push(() => input.dispose());
const combat = new CombatController(encounter, adventure, actors, input, pointerAim, equipmentSets, {
  paused, cancelImpact: () => impact.clear(), navigation: () => areaState.movement, impactHolding: () => impact.holding, safeArea: () => areaState.definition.kind === 'safe',
  interruptApproach, clearHold: () => combatUI?.clearHold(),
  blocking: () => !!combatUI?.blocking, complete: events => runtime.complete(events),
});
const inventory = new InventoryController(adventure, encounter, player, equipmentSets, audio, {
  clearInput, equipmentBlocked: () => !!areaTransitions?.transitioning || !!gathering.target,
  updateCharacter: character => menus.updateCharacter(character), syncAdventure,
});

const menus = new AdventureMenus(clearInput, () => renderer.domElement.focus(), id => { if (!paused()) adventure.beginCast(encounter.player.hp > 0, id); }, {
  change: items => inventory.change(items), newId: adventure.newId,
  activateSet: set => inventory.activateSet(set),
  canEquip: () => inventory.canEditEquipment(),
  potion: id => {
    if (!adventure.usePotion(encounter, id)) throw new Error(encounter.player.hp >= encounter.stats.maxHealth ? 'Health is full.' : 'Potion is not ready.');
    syncAdventure();
  },
  changeContainers: (items, stash) => inventory.changeContainers(items, stash),
  transfer: (id, quantity, toStash, point) => inventory.transfer(id, quantity, toStash, point),
  repair: async () => {
    const site=areaState.definition.shelter;
    const canCommit=()=>!!site && areaState.definition.id===homeArea && encounter.player.hp>0 && near([encounter.player.x,encounter.player.z],site.position,progression.restedRadius) && adventure.canRepair();
    if(!canCommit())throw new Error('Not enough materials.');
    const ok=await changeArea({kind:'refresh',spawn:{position:[encounter.player.x,encounter.player.z],yaw:encounter.player.yaw},appearance:{shelterRestored:true},canCommit,onCommit:()=>adventure.repairShelter()});
    if(ok.status !== 'committed')throw new Error('Unable to repair shelter. Materials were retained.');
    if(ok.readiness === 'ready')audio.play('chestOpen');
  },
  recover: id => inventory.recover(id),
  drop: (id, quantity) => inventory.drop(id, quantity),
}, cue => audio.play(cue));
releases.push(() => menus.dispose());
const shop = new ShopMenu({
  clear: clearInput, focus: () => renderer.domElement.focus(), sound: cue => audio.play(cue),
  buy: item => { adventure.buy(encounter, areaState.definition, item); syncAdventure(); },
  sell: id => { adventure.sell(encounter, areaState.definition, id); syncAdventure(); },
  buyBack: id => { adventure.buyBack(encounter, areaState.definition, id); syncAdventure(); },
});
releases.push(() => shop.dispose());
const smithingMenu = new SmithingPanel({
  character:()=>adventure.character, backgrounded:hidden,
  clear:clearInput, focus:()=>renderer.domElement.focus(), sound:cue=>audio.play(cue),
  forge:item=>{const learned=adventure.forge(encounter,areaState.definition,item);inventory.syncLoadout();syncAdventure();return learned;},
  reclaim:(id,container)=>{const learned=adventure.reclaim(encounter,areaState.definition,id,container);inventory.syncLoadout();syncAdventure();return learned;},
});
releases.push(()=>smithingMenu.dispose());

const lootLabels = new LootLabels(mount, selectLoot);
releases.push(() => lootLabels.dispose());
function selectLoot(id: string): void {
  if (paused() || encounter.player.hp <= 0) return;
  renderer.domElement.focus();
  if (!adventure.session().drops.some(drop => drop.id === id)) return;
  gathering.cancel();
  encounter.pending = null;
  approach.selectLoot(id, areaState.movement);
}

const hud = createHud(() => { if (!inventory.loading && !areaTransitions?.transitioning) void changeArea({ kind: 'travel', area: homeArea, transition: true, spawn: definitions.homestead.layout.player, recover: true }).catch(areaChangeFailed); });
releases.push(() => hud.dispose());
function inspect(): void {
  if (!areaState.definition.inspection) return;
  clearInput(); inspecting = !inspecting;
  cameraOwner.inspect(inspecting, { x: areaState.definition.inspection?.position[0] ?? 0, z: areaState.definition.inspection?.position[1] ?? 0 }); graphics?.resetHistory();
  if (inspecting) cameraOwner.suspendFollow();
  else if (!fixedCamera) cameraOwner.resetFollow(player.root.position);
}
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
  if (!lost && !frozen && !inspecting && !areaTransitions?.transitioning) impact.present(events);
}
function clearPresentation(): void {
  gameplayAudio.reset();
  clearInput();
  graphics?.effects.clear();
  graphics?.effects.resetVegetation();
  vegetationActorRecords.clear();
  areaState.abilities?.clear(); projectileVisuals.clear(); enemyActors.clear();
  areaState.instance?.portals.forEach(p => p.reset());
  if (recoveringPresentation) hud.clearCombatText(); else hud.reset();
  hud.setSafe(areaState.definition.kind === 'safe');
  if (!fixedCamera && !inspecting) cameraOwner.resetFollow(player.root.position);
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
  clearInput(); resetEncounter(encounter); areaState.movement?.resetActors(); adventure.restart(); harvesting.reset();
  if (areaState.instance && areaState.movement) gathering.register(areaState.instance, areaState.movement);
  inventory.syncLoadout(); resetPresentation();
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
const interactionActions = new InteractionActions(adventure, encounter, menus, gathering, audio, {
  area: () => areaState.definition, definitions: () => definitions, paused, changeArea, syncAdventure,
  openShop: () => { shop.update(adventure.character); shop.open(); },
  openSmithing: () => smithingMenu.open(),
});
function dispatchInput(action: InputAction): void {
  if (loadingScreen.blocking || areaTransitions?.transitioning) { clearInput(); return; }
  if (action === 'inventory') { menuController.toggleInventory(); return; }
  if (action === 'skills') { menuController.toggleSkills(); return; }
  if (action === 'options') { menuController.toggleOptions(); return; }
  if (paused()) return;

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
  if(impact.holding){pendingUtility='potion';return;}
  if (adventure.usePotion(encounter)) interruptApproach();
  else if (encounter.player.hp > 0) adventure.message(encounter.player.hp >= encounter.stats.maxHealth ? 'Health is full' : adventure.character.potions === 0 ? 'No Health Potions' : 'Potion is not ready');
  invalidateFrame();
}
function castReturn():void {
  if(impact.holding && !paused()){pendingUtility='portal';return;}
  if(paused())return;
  interruptApproach();
  if(!adventure.beginCast(encounter.player.hp>0) && encounter.player.hp>0)
    adventure.message(areaState.definition.id===homeArea ? 'Already at Homestead' : adventure.castRemaining>0 ? 'Scroll of Return is casting' : 'No Scrolls of Return');
  invalidateFrame();
}
const combatUI = new CombatUI({
  paused,
  character: () => adventure.character, encounter: () => encounter, preferences,
  activate: id => combat.startAbility(id), potion: usePotion, portal: castReturn,
  canEdit: () => inventory.canEditEquipment(),
  portalReady: () => areaState.definition.id !== homeArea && encounter.player.hp > 0 &&
    adventure.character.scrolls > 0 && adventure.castRemaining === 0,
  assign: bar => { if (inventory.canEditEquipment()) adventure.setActionBar(bar); },
  clear: clearInput, focus: () => renderer.domElement.focus(),
});
releases.push(() => combatUI.dispose());
const optionsButton = document.createElement('button');
optionsButton.id = 'hud-options'; optionsButton.textContent = '⚙';
optionsButton.title = 'Options'; optionsButton.setAttribute('aria-label', 'Options');
optionsButton.onclick = () => menuController.toggleOptions();
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
  areaState.visuals?.sync(adventure.session(areaState.definition.id).drops, adventure.portalPosition(areaState.definition), lootLabels.hovered, adventure.portalHeight(areaState.definition));
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
function paused(): boolean {
  return Boolean(closed || presentationFailed || loadingScreen.blocking || !areaState.instance || hidden() || characterMissing || menuController.paused || inventory.loading || inspecting || graphics?.preparingSettings || frozen || areaTransitions?.transitioning);
}
function resolveAim(pointer = input.pointer()): AimPoint | undefined {
  return pointerAim.resolve(pointer, encounter.player.y);
}
function interruptApproach(releaseLock = true): void {
  approach.cancel();
  gathering.cancel(releaseLock);
}
function updateGame(dt: number, weatherDt: number): void {
  if (dt <= 0 && impact.holding && !paused()) { runtime.advanceWeather(weatherDt); hud.update(encounter, []); return; }
  const isPaused = paused();
  if (pendingUtility && !isPaused && !impact.holding) {
    const command=pendingUtility; pendingUtility=null;
    if(command==='potion')usePotion();else castReturn();
  }
  let movement = comparisonMovement ?? input.movement();
  const block=combat.holdingShield();
  gatheringAction.cancelIfInterrupted(movement, block);
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
const initialFpsLimit = readSettings().fpsLimit;
function renderFrame(dt: number): boolean {
  if (presentationFailed) return false;
  try { return drawFrame(dt); }
  catch (error) {
    // Transition readiness failures already have destination-aware recovery.
    if (areaTransitions?.transitioning || !areaState.instance) throw error;
    presentationFailed = true;
    areaErrors = [error instanceof Error ? error.message : String(error)];
    recordFailure('gameplay-presentation', error);
    frameLoop.suspend(error);
    clearInput(); approach.cancel();
    presentation.rememberPlayback();
    const token = loadingScreen.begin(areaState.definition.name, true);
    loadingScreen.fail(token, error, { kind: 'feedback', retry: () => {
      presentationFailed = false;
      frameLoop.setManual(false);
      void changeArea({ kind: 'presentation-recovery' }).catch(areaChangeFailed);
    } });
    return false;
  }
}
function drawFrame(dt: number): boolean {
  cameraOwner.clearShake();
  if (paused() || inspecting || fixedCamera || areaTransitions?.transitioning) impact.clear();
  const gameDt = impact.advance(dt);
  updateGame(gameDt, dt);
  audio.update(encounter.player,paused() || encounter.phase==='loading');
  if (!inspecting && !paused() && !fixedCamera && encounter.player.hp > 0) {
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
  if (weatherPreview && !paused() && encounter.player.hp > 0 && encounter.phase !== 'lost' && encounter.phase !== 'loading') advanceWeather(weatherPreview,dt);
  const weather = weatherPreview ?? adventure.character.outing.weather;
  const rain = areaState.definition.effects.weather ? weatherIntensity(weather) : 0;
  const exposure = rainExposure(areaState.instance?.weatherShelters ?? [], encounter.player.x, encounter.player.z);
  if (areaState.instance) areaState.instance.rainWetness.value = areaState.definition.effects.weather ? weather.wetness : 0;
  graphics?.effects.setRainIntensity(rain);
  const portalPoint = adventure.portalPosition(areaState.definition);
  gameplayAudio.ambience(areaState.definition.effects.fires,encounter.player,portalPoint ? {x:portalPoint[0],z:portalPoint[1]} : null,lanternEnabled && encounter.player.hp>0 ? encounter.player : null, areaState.definition.ambience ?? 'woodland', (options?.settings.weatherEffects ?? true) ? rain : 0, exposure);
  controls.update();
  camera.updateMatrixWorld();
  pointerAim.capture(camera);
  const pointer = input.pointer();
  if (!paused() && pointer) { resolveAim(pointer); lootLabels.hovered = areaState.visuals?.pick(pointerAim.ray) ?? null; }
  const shake = impact.offset(options?.settings.cameraShake ?? true);
  cameraOwner.applyShake(shake.x,shake.y,mount.clientHeight);
  lootLabels.sync(adventure.session(areaState.definition.id).drops, camera, [encounter.player.x, encounter.player.z], paused() || encounter.player.hp <= 0);
  hud.positionEnemy(encounter, camera, mount, paused() ? 0 : gameDt, inspecting || !!areaTransitions?.transitioning);
  areaState.instance?.update(camera, paused() ? 0 : gameDt);
  stageVegetationActors();
  graphics?.effects.setGameplayDelta(gameDt);
  graphics?.effects.weatherView(camera,player.root.position);
  renderer.info.reset();
  const rendered = graphics?.render(dt, paused()) ?? false;
  if (rendered) renderedFrames++;
  if (rendered && areaState.instance && !areaTransitions?.transitioning) renderedRevision = revision;
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
areaTransitions = new AreaTransitionController(beginAreaChange);
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
  get revision() { return revision; },
  get renderedRevision() { return renderedRevision; },
  get transitioning() { return !!areaTransitions?.transitioning; },
  get areaErrors() { return areaErrors; },
  get characterMissing() { return characterMissing; },
  get contentHash() { return areaState.contentHash; },
  get updateMs() { return updateMs; },
  get renderedFrames() { return renderedFrames; },
});
ctx.reportLoading?.(() => runtimeDiagnostics.report());
const diagnostics = () => runtimeDiagnostics.snapshot();
attachPreviewGraphics(() => {
  if (closed || !graphics) return [];
  const view = graphics.previewGraphics(!!runtimeDiagnostics.report().ready);
  return view ? [view] : [];
});
const previewWeather = (phase: WeatherPhase | 'live', wetness = 0) => {
  if (!['live','dry','gathering','shower','clearing'].includes(phase) || !Number.isFinite(wetness) || wetness < 0 || wetness > 1) throw new Error('Invalid weather preview');
  weatherPreview = phase === 'live' ? undefined : { ...structuredClone(adventure.character.outing.weather), phase, elapsed: 0, wetness };
  invalidateFrame();
};
if (import.meta.env.DEV) Object.assign(window, { lanternWeather: {
  status: () => ({ ...structuredClone(weatherPreview ?? adventure.character.outing.weather), intensity: weatherIntensity(weatherPreview ?? adventure.character.outing.weather), preview: !!weatherPreview, area: areaState.definition.id, outdoor: !!areaState.definition.effects.weather, effectsEnabled: options.settings.weatherEffects, groundWetness: areaState.instance?.rainWetness.value, exposure: rainExposure(areaState.instance?.weatherShelters ?? [],encounter.player.x,encounter.player.z) }),
  preview: previewWeather,
}, lanternRenewal: {
  diagnostics,
  snapshot: () => { adventure.save(); return structuredClone(adventure.character.outing); },
  advance: (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid clock advance');
    adventure.advanceRenewal(encounter, areaState.definition, seconds); gatheringAction.advance(0); gathering.present(gatheringAction.takeEvents()); syncAdventure(); invalidateFrame();
  },
} });

if (import.meta.env.DEV) releases.push(() => { Reflect.deleteProperty(window, 'lanternRenewal'); Reflect.deleteProperty(window, 'lanternWeather'); });
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
  characterMissing = true;
  recordFailure('character', error);
  throw new Error('Required character art could not be prepared.', { cause: error });
}

{
  loadingScreen.preparing(loadingScreen.current, 'Preparing lighting');
  preparation.stage = 'lighting';
  personalLantern = new PlayerLantern(player.root, lanternEnabled, resources); releases.push(() => personalLantern?.dispose()); await personalLantern.initialize();
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
  if (import.meta.env.DEV && renderQuery.get('author') === 'levels') {
    const { attachAuthoring } = await import('../levels/authoring');
    const authoring = attachAuthoring({ previewWeather, previewGraphics: () => graphics.previewGraphics(diagnostics().ready), invalidate: invalidateFrame, scene, camera, renderer, definitions: () => definitions, area: () => areaState.definition, encounter,
      resetMaterials: () => graphics.resetHistory(),
      resetMeasurements: () => graphics.resetMeasurements(), measurements: () => graphics.measurements(),
      exportLighting: () => graphics.exportLighting(), lighting: () => graphics.lightingDiagnostics(),
      changeArea: async id => areaReady(await changeArea({ kind: 'travel', area: id })), restart: reset, inspect: () => { inspect(); return inspecting; }, waitFrames, setFrozen: freezePreview, setView: previewView,
      appearance: () => ({ lantern: lanternEnabled, surfaces: areaState.surfaces, shelterRestored: areaState.shelterRestored }),
      setAppearance: changeAppearance,
      diagnostics,
    });
    const { fsrComparison } = await import('../labs/fsr/settings');
    if (fsrComparison) {
      const { attachFsrComparison } = await import('../labs/fsr/comparison');
      attachFsrComparison({ graphics, frameLoop, camera, controls, canvas: renderer.domElement, encounter, diagnostics,
        freeze: freezePreview,
        clean: () => { authoring.clean(true); authoring.overlays(false); },
        foliageFixture: () => {
          areaState.instance?.root.traverse(object => { if (object.userData.harvestTree) graphics.effects.addFoliage(object); });
        },
        step: (dt, movement, attack) => {
          comparisonMovement = movement; frozen = false; fixedCamera = true;
          try { if (attack) combat.startAbility('axe-basic'); return renderFrame(dt); }
          finally { frozen = true; comparisonMovement = null; }
        },
      });
    }
  }

}

function applySettings(settings: GraphicsSettings): void {
  hud.resourceNumbers(settings.resourceNumbers);
  if (!settings.cameraShake) { impact.offset(false); cameraOwner.clearShake(); }
  if (cameraOwner.setDistance(settings.cameraDistance)) { graphics?.resetHistory(); invalidateFrame(); }
  graphics?.apply(settings); areaState.abilities?.setQuality(settings.particleQuality);
}



function freezePreview(value: boolean): void {
  frozen = value; fixedCamera = value; clearInput();
  if (!value) { cameraOwner.restoreGameplayView(); cameraOwner.resetFollow(player.root.position); graphics?.resetHistory(); }
  if (value) { reset(); for (const actor of Object.values(actors)) { play(actor, 'idle'); actor.actions.idle?.stopFading().setEffectiveWeight(1); actor.mixer?.setTime(0); } graphics?.effects.clearArea(); areaState.instance?.activate(graphics!.effects); graphics?.resetSceneTime(); }
}
function previewView(id: string): void {
  fixedCamera = true;
  cameraOwner.previewView(areaState.definition, id);
  graphics?.resetHistory();
}
async function changeAppearance(appearance: { surfaces?: SurfaceMode; lantern?: boolean; shelterRestored?: boolean }): Promise<boolean> {
  if (appearance.lantern !== undefined && appearance.surfaces === undefined && appearance.shelterRestored === undefined) { lanternEnabled = appearance.lantern; personalLantern?.setEnabled(lanternEnabled); return true; }
  return areaReady(await changeArea({ kind: 'refresh', spawn: { position: [encounter.player.x, encounter.player.z], yaw: encounter.player.yaw },
    appearance: { lantern: appearance.lantern ?? lanternEnabled, surfaces: appearance.surfaces ?? areaState.surfaces, shelterRestored: appearance.shelterRestored ?? areaState.shelterRestored } }));
}
function areaReady(result: AreaChangeResult): boolean { return result.status === 'committed' && result.readiness === 'ready'; }
function changeArea(change: AreaChange): Promise<AreaChangeResult> {
  return areaTransitions!.change(change);
}
function beginAreaChange(change: AreaChange, request: AreaRequest): AreaOperation {
  const id = change.kind === 'travel' ? change.area : areaState.definition.id;
  const { arrivalId, recover = false } = change.kind === 'travel' ? change : {};
  const appearance = change.kind === 'refresh' ? change.appearance : undefined;
  const presentationOnly = change.kind === 'presentation-recovery';
  const next = definitions[id];
  const nextSurfaces = appearance?.surfaces ?? areaState.surfaces;
  const resolved = next && { ...next, lighting: resolveLightingFor(next) };
  const savedView = frozen && areaState.instance?.area.id === id ? cameraOwner.captureView() : null;
  const startup = !areaState.instance, started = performance.now();
  const showLoading = startup || presentationOnly || loadingScreen.blocking || change.kind === 'travel' && renderQuery.get('author') !== 'levels';
  let token = startup ? loadingScreen.current : showLoading ? loadingScreen.begin(next?.name ?? id) : undefined;
  if (token !== undefined) loadingScreen.preparing(token, `Preparing ${next?.name ?? id}`);
  const fadeUntil = performance.now() + (startup || matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 150);
  recoveringPresentation = presentationOnly;
  if (presentationOnly) presentation.rememberPlayback();
  audio.update(encounter.player, true); hud.clearCombatText(); clearInput();
  if (presentationOnly) approach.cancel(); else interruptApproach();
  let hash = '';
  return {
    prepare: () => areaTransitions!.prepare(change, async owner => {
      await cancelNativePreparation(renderer); request.check();
      const errors = validateDefinitions(definitions);
      if (!next || !resolved || errors.length) throw new Error(errors.join('\n') || `Unknown area: ${id}`);
      request.stage('content-hash');
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ ...resolved, surfaces: nextSurfaces })));
      hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''); request.check();
      request.stage('area-assets');
      const area = owner.own(await buildArea(next, nextSurfaces, appearance?.shelterRestored ?? adventure.character.shelterRestored, resources), value => value.dispose()); request.check();
      if (!presentationOnly) {
        request.stage('navigation');
        owner.ownSimulation(await MovementWorld.create(next.layout.boundary, traversalWithTrees(next))); request.check();
      }
      request.stage('ability-graphics');
      const abilities = owner.own(new AbilityEffects(area, options.settings.particleQuality, renderer), value => value.dispose());
      await abilities.prepare(cameraOwner.camera); request.check();
      if (renderQuery.get('portal') === 'off') area.portals.forEach(portal => { portal.root.visible = false; });
      request.stage('lighting');
      const lighting = owner.own(await graphics!.prepareLighting(resolved, area.root), value => value.release()); request.check();
      request.stage('enemies');
      const enemies = owner.own(await enemyActors.prepare(presentationOnly ? encounter : createEncounter('playing', next.layout)), value => value.dispose()); request.check();
      const visuals = owner.own(new AdventureVisuals(area.root, resources.library), value => value.dispose());
      const interactions = new WorldInteractions(next, area, [player.root, ...Object.values(enemies.entries).map(entry => entry.actor.root)]);
      if (showLoading && performance.now() < fadeUntil) await request.wait(new Promise(resolve => setTimeout(resolve, fadeUntil - performance.now())));
      const renewalVisibility = new RenewalVisibility();
      renewalVisibility.register(area, Object.fromEntries(Object.entries(enemies.entries).map(([id, entry]) => [id, entry.actor])));
      return { area, abilities, lighting, enemies, visuals, interactions, renewalVisibility,
        lightingDefinition: resolved.lighting, contentHash: hash,
        appearance: { surfaces: nextSurfaces, shelterRestored: Boolean(area.root.userData.shelterRestored) } };
    }),
    commitGameplay: () => {
      lanternEnabled = appearance?.lantern ?? lanternEnabled;
      const arrival = next.gates.find(gate => gate.id === arrivalId);
      // Commit gameplay before presentation can fail; returning through a portal saves its consumption with arrival.
      if (!presentationOnly) adventure.enter(encounter, next, change.spawn ?? arrival?.arrival ?? next.layout.player, recover, change.kind === 'travel' ? change.consumePortal : undefined);
      if (arrival) runtime.travel.arrive(arrival.id);
    },
    activate: candidate => areaActivation.activate(candidate.value, () => {
      personalLantern?.setEnabled(lanternEnabled);
      if (!presentationOnly) gathering.register(candidate.value.area, candidate.value.movement);
      inspecting = false;
      const feedback = runtime.takeFeedback(); gatheringTools.show(null);
      if (presentationOnly) restorePresentation(); else resetPresentation();
      syncAdventure(presentationOnly ? [] : feedback.adventure);
      cameraOwner.inspect(false, { x: 0, z: 0 });
      if (!frozen) cameraOwner.restoreGameplayView();
      cameraOwner.resetFollow(player.root.position);
      graphics!.apply(options.settings); graphics!.resetSceneTime();
      revision++; areaErrors = [];
      hud.environmentLoaded(candidate.value.area.missing.length ? 0 : 3);
      if (characterMissing) hud.characterUnavailable();
      else hud.setAssetStatus(candidate.value.area.missing.length ? `Missing art: ${candidate.value.area.missing.join(', ')}.` : '');
      if (frozen && !presentationOnly) freezePreview(true);
      if (savedView) cameraOwner.restoreView(savedView);
      if (presentationOnly) { resetNativeFrameCompilation(renderer); delete mount.dataset.renderError; delete renderer.domElement.dataset.renderError; }
    }),
    deactivate: () => areaActivation.deactivate(),
    ready: async () => {
      if (!frameLoop.running) frameLoop.start();
      request.stage('first-frames'); await request.wait(waitFrames(2)); request.check();
      request.stage('gpu-completion'); await request.wait(finishSubmittedFrame(renderer)); request.check();
      if (mount.dataset.renderError) throw new Error(mount.dataset.renderError);
      if (token !== undefined && !await request.wait(loadingScreen.ready(token))) return false;
      request.check(); request.stage('ready');
      updateMs = performance.now() - started; renderer.domElement.focus(); return true;
    },
    cancelled: async () => {
      adventure.message('Travel cancelled.');
      if (token !== undefined && await request.wait(loadingScreen.ready(token))) renderer.domElement.focus();
    },
    failed: async (error, committed) => {
      await cancelNativePreparation(renderer); request.check();
      areaErrors = [error instanceof Error ? error.message : String(error)];
      recordFailure(startup ? 'startup-area' : 'travel', error);
      if (startup) return 'back';
      if (committed || presentationOnly) {
        token ??= loadingScreen.begin(areaState.definition.name);
        loadingScreen.fail(token, error, { kind: 'presentation', retry: () => {
          void changeArea({ kind: 'presentation-recovery' }).catch(areaChangeFailed);
        } });
        return 'back';
      }
      if (token === undefined) { hud.setAssetStatus(`Unable to travel. ${areaErrors[0]}`); return 'back'; }
      const choice = await request.wait(loadingScreen.recover(token, error));
      request.check();
      if (choice === 'back') { areaErrors = []; if (await request.wait(loadingScreen.ready(token))) renderer.domElement.focus(); }
      return choice;
    },
    settlePreparation: async () => {
      const native = nativePreparation(renderer);
      await native.builders.idle(); await native.pipelines.idle();
      await finishSubmittedFrame(renderer);
    },
    finish: () => { clearInput(); recoveringPresentation = false; audio.update(encounter.player, paused()); },
  };
}

hotSession = { registry: module => {
  if (!module) return;
  const updated = module.areas;
  const errors = validateDefinitions(updated);
  if (errors.length) { areaTransitions!.invalidate(); if (areaState.instance) loadingScreen.dismiss(); areaErrors = errors; return; }
  definitions = updated; adventure.configureAreas(definitions); void changeArea({ kind: 'refresh' }).catch((error: unknown) => console.error('Unable to refresh area definitions.', error));
},

error: payload => { areaTransitions!.invalidate(); if (areaState.instance) loadingScreen.dismiss(); areaErrors = [payload.err.message]; },

lighting: module => {
  if (!module) return;
  resolveLightingFor = module.resolveAreaLighting;
  void changeArea({ kind: 'refresh' }).catch((error: unknown) => console.error('Unable to refresh lighting.', error));
},

validation: module => {
  if (!module) return;
  validateDefinitions = module.validateAreas;
  void changeArea({ kind: 'refresh' }).catch((error: unknown) => console.error('Unable to refresh area validation.', error));
},

preset: () => {
  void changeArea({ kind: 'refresh' }).catch(areaChangeFailed);
}
};
const hot = hotSession;
releases.push(() => { if (hotSession === hot) hotSession = undefined; });
return { capture: () => adventure.capture(), actionBar: () => adventure.character.actionBar, clearInput, applySettings,
  applyCombatText: settings => hud.applyCombatText(settings), flushSettings: () => graphics?.flushSettings(),
  resetMeasurements: () => graphics?.resetMeasurements(), report: () => runtimeDiagnostics.report(), dispose };
} catch (error) { await dispose(); throw error; }
}

let hotSession: {
  registry(module: typeof LevelRegistry | undefined): void;
  lighting(module: typeof LevelLighting | undefined): void;
  validation(module: typeof LevelValidation | undefined): void;
  error(payload: { err: { message: string } }): void;
  preset(): void;
} | undefined;
if (import.meta.hot) {
  import.meta.hot.accept('../levels/registry', module => hotSession?.registry(module as typeof LevelRegistry | undefined));
  import.meta.hot.accept('../levels/lighting', module => hotSession?.lighting(module as typeof LevelLighting | undefined));
  import.meta.hot.accept('../levels/validation', module => hotSession?.validation(module as typeof LevelValidation | undefined));
  import.meta.hot.on('vite:error', payload => hotSession?.error(payload));
  window.addEventListener('lightingpresetchanged', () => hotSession?.preset());
}
