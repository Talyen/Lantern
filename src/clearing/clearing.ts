import { AbilityEffects } from '../rendering/ability-effects';
import { abilities } from '../gameplay/abilities';
import { bindingLabel } from '../input/bindings';
import { loadingScreen } from '../ui/loading';
import { registerRuntimeSnapshot, recordFailure } from '../diagnostics/report';
import { ShopMenu } from '../ui/shop';
import { ClearingDiagnostics } from './diagnostics';
import { disposeSceneResources, sceneTextures } from '../assets/resource-ownership';
import { resolveAreaLighting as lightingFor } from '../levels/lighting';
import type { SurfaceMode } from '../assets/environment-surfaces';
import type { AreaLighting } from '../levels/types';
import { CombatUI } from '../ui/combat';
import { KeybindingsMenu } from '../ui/keybindings';
import { InputPreferences, actionSlotInputs, type InputAction } from '../input/bindings';
import { InteractionHighlight } from '../rendering/interaction-highlight';
import { Adventure, homeArea } from '../gameplay/adventure';
import { near } from '../gameplay/area';
import { AdventureMenus } from '../ui/adventure';
import { AdventureVisuals } from '../rendering/adventure';
import { LootLabels } from '../ui/loot';
import { MovementWorld } from '../gameplay/movement';
import { prepareAreaCandidate } from './area-candidate';
import type { AreaChange } from './area-change';
import { MenuController } from './menu-controller';
import { InteractionActions, areaChangeFailed } from './interaction-actions';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createEncounter, resetEncounter, stepExploration, stepEncounter, type EncounterEvent, type ActorId, type AimPoint } from '../gameplay/encounter';
import { readSettings } from '../rendering/graphics-settings';
import { createRenderer } from '../rendering/renderer';
import { PlayerLantern } from '../rendering/player-lantern';
import { Graphics } from '../rendering/graphics';
import { CoreEffects } from '../rendering/effects';
import type { VegetationActor } from '../rendering/vegetation';
import { Options } from '../ui/options';
import { buildArea, createWorld, disposeAreaCache, type AreaInstance } from '../levels/builder';
import { areas } from '../levels/registry';
import { validateAreas } from '../levels/validation';
import { GateTravel } from '../gameplay/area';
import { makeActor, play, attachCharacter, updateActor, type Actor } from './actors';
import { createInput } from './input';
import { createCamera } from './camera';
import { createHud } from '../ui/hud';
import characters from '../../assets/playable-characters.json';
import { EnemyActors, type PreparedEnemies } from './enemy-actors';
import { Equipment } from '../rendering/equipment';
import { ProjectileVisuals } from '../rendering/projectiles';
import { GameAudio } from '../audio/audio';
import { GameplayAudio } from '../audio/gameplay';
import { GatheringTools } from '../rendering/gathering-tools';
import { progression } from '../gameplay/skills';
import { Harvesting } from '../gameplay/harvesting';
import { GatheringController } from './gathering';
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
const renderQuery = new URLSearchParams(location.search);
// Legacy lab URLs load the clearing.
if (['art', 'renderers'].includes(renderQuery.get('lab') ?? '')) {
  renderQuery.set('area', 'clearing');
  const url = new URL(location.href); url.searchParams.set('area', 'clearing'); for (const key of ['lab', 'space', 'look', 'surface', 'edges']) url.searchParams.delete(key); history.replaceState({}, '', url.href);
}
window.addEventListener('error', (event) => {
  const message = event.error instanceof Error ? event.error.stack ?? event.message : event.message;
  document.getElementById('scene')!.dataset.renderError = message;
});
let graphics: Graphics | undefined;
let options: Options | undefined;
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
document.addEventListener('visibilitychange', visibilityChanged);
window.addEventListener('lanternvisibilitychange', visibilityChanged);
for (const event of ['pointerdown', 'pointerup', 'pointermove', 'keydown', 'keyup', 'wheel', 'input', 'change']) window.addEventListener(event, () => { if (frameLoop.running && paused()) invalidateFrame(); });


const mount = document.getElementById('scene')!;
const { scene, ambient, sun } = createWorld();
let definitions = areas;
let validateDefinitions = validateAreas;
let currentArea = definitions[renderQuery.get('area') ?? 'clearing'] ?? definitions.clearing;
let resolveLightingFor = lightingFor;
let committedLighting: AreaLighting = resolveLightingFor(currentArea);
let lanternEnabled = !(import.meta.env.DEV && renderQuery.get('lantern') === 'off');
let personalLantern: PlayerLantern | undefined;
let surfaceMode: SurfaceMode = import.meta.env.DEV && renderQuery.get('surfaces') === 'showcase' ? 'showcase' : import.meta.env.DEV && renderQuery.get('surfaces') === 'authored' ? 'authored' : 'projected';
let active: AreaInstance | undefined;
let worldInteractions: WorldInteractions | undefined;
let movementWorld: MovementWorld | undefined;
let generation = 0, revision = 0, renderedRevision = 0, transitioning = false;
let frozen = import.meta.env.DEV && renderQuery.get('author') === 'levels';
let fixedCamera = frozen;
let areaErrors: string[] = [], updateMs = 0, contentHash = '', characterMissing = false;
const travel = new GateTravel();
const adventure = new Adventure(() => localStorage);
await adventure.prepareSave();
let adventureVisuals: AdventureVisuals | undefined;
let abilityEffects: AbilityEffects | undefined;
const waitFrames = (count = 16) => frameLoop.waitFrames(count);
const renderer = await createRenderer(mount);
renderer.domElement.setAttribute('aria-label', 'Lantern. Move and use abilities with your configured controls. Click objects to interact.');
renderer.info.autoReset = false;
let renderedFrames = 0;
const cameraOwner = createCamera(renderer.domElement);
const { camera, controls } = cameraOwner;
const pointerAim = new PointerAim(renderer.domElement, camera);
controls.addEventListener('change', invalidateFrame);
const encounter = createEncounter('loading', currentArea.layout);
const impact = new CombatImpact();
const player = makeActor(scene, encounter.player);
const actors: Record<ActorId, Actor> = { player };
const loader = new GLTFLoader();
const approach = new ClickApproach(adventure, encounter);
const playerEquipment = new Equipment(player.root);
const enemyActors = new EnemyActors(scene, loader, actors);
const gatheringTools = new GatheringTools(player.root,playerEquipment);
const projectileVisuals = new ProjectileVisuals(scene);
const harvesting = new Harvesting();
const interactionHighlight=new InteractionHighlight(scene);
const equipmentSets = new EquipmentSets(player, playerEquipment, loader, () => projectileVisuals.prepareArrow());
const preferences=new InputPreferences(() => localStorage);
let hoveredInteraction: WorldInteraction | null=null;
const audio = new GameAudio();
const gameplayAudio = new GameplayAudio(audio);
let pendingUtility: 'potion'|'portal'|null=null;
document.addEventListener('click', event => {
  const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null;
  if (button && !button.disabled && button.closest('dialog, #result-panel')) audio.play('uiClick');
});
const gathering = new GatheringController(encounter, adventure, harvesting, player, gatheringTools, audio, {
  area: () => currentArea, instance: () => active, navigation: () => movementWorld, paused, effects: () => graphics?.effects,
});
function clearInput(): void {
  impact.clear(); cameraOwner.clearShake(); pendingUtility=null;
  input.clear();
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
const combat = new CombatController(encounter, adventure, actors, input, pointerAim, equipmentSets, {
  paused, cancelImpact: () => impact.clear(), navigation: () => movementWorld, impactHolding: () => impact.holding, safeArea: () => currentArea.kind === 'safe',
  interruptApproach, clearHold: () => combatUI?.clearHold(),
  blocking: () => !!combatUI?.blocking, present,
});
const inventory = new InventoryController(adventure, encounter, player, equipmentSets, audio, {
  clearInput, equipmentBlocked: () => transitioning || !!gathering.target,
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
    const site=currentArea.shelter;
    const canCommit=()=>!!site && currentArea.id===homeArea && encounter.player.hp>0 && near([encounter.player.x,encounter.player.z],site.position,progression.restedRadius) && adventure.canRepair();
    if(!canCommit())throw new Error('Not enough materials.');
    const ok=await changeArea({kind:'refresh',spawn:{position:[encounter.player.x,encounter.player.z],yaw:encounter.player.yaw},appearance:{shelterRestored:true},canCommit,onCommit:()=>adventure.repairShelter()});
    if(!ok)throw new Error('Unable to repair shelter. Materials were retained.');
    audio.play('chestOpen');
  },
  recover: id => inventory.recover(id),
  drop: (id, quantity) => inventory.drop(id, quantity),
}, cue => audio.play(cue));
const shop = new ShopMenu({
  clear: clearInput, focus: () => renderer.domElement.focus(), sound: cue => audio.play(cue),
  buy: item => { adventure.buy(encounter, currentArea, item); syncAdventure(); },
  sell: id => { adventure.sell(encounter, currentArea, id); syncAdventure(); },
  buyBack: id => { adventure.buyBack(encounter, currentArea, id); syncAdventure(); },
});
const lootLabels = new LootLabels(mount, selectLoot);
function selectLoot(id: string): void {
  if (paused() || encounter.player.hp <= 0) return;
  renderer.domElement.focus();
  if (!adventure.session().drops.some(drop => drop.id === id)) return;
  gathering.cancel();
  encounter.pending = null;
  approach.selectLoot(id, movementWorld);
}

const hud = createHud(() => { if (!inventory.loading && !transitioning) void changeArea({ kind: 'travel', area: homeArea, transition: true, spawn: definitions.homestead.layout.player, recover: true }).catch(areaChangeFailed); });
function inspect(): void {
  if (!currentArea.inspection) return;
  clearInput(); inspecting = !inspecting;
  cameraOwner.inspect(inspecting, { x: currentArea.inspection?.position[0] ?? 0, z: currentArea.inspection?.position[1] ?? 0 }); graphics?.resetHistory();
  if (inspecting) cameraOwner.suspendFollow();
  else if (!fixedCamera) cameraOwner.resetFollow(player.root.position);
}
const presentation = new EncounterPresentation(encounter, actors, gameplayAudio, hud, {
  effects: () => graphics?.effects,
  weaponSet: set => {
    equipmentSets.activate(set);
    adventure.setWeaponSet(set);
    combatUI?.update();
    audio.play('equip');
    menus.updateCharacter(adventure.character);
    shop.update(adventure.character);
  },
  proficiency: (family,amount) => {adventure.grantProficiency(family,amount); inventory.syncLoadout();},
  playerHit: () => interruptApproach(false),
});
function present(events: EncounterEvent[]): void {
  presentation.present(events);
  if (!frozen && !inspecting && !transitioning) impact.present(events);
  if (events.some(event => event.type === 'outcome' && !event.won)) { impact.clear(); pendingUtility=null; }
}
function resetPresentation(): void {
  gameplayAudio.reset();
  clearInput();
  graphics?.effects.clear();
  graphics?.effects.resetVegetation();
  vegetationActorRecords.clear();
  encounter.projectiles=[]; encounter.rains=[]; abilityEffects?.clear(); projectileVisuals.clear(); enemyActors.clear();
  inventory.syncLoadout();
  movementWorld?.reset();
  active?.portals.forEach(p => p.reset());
  hud.reset();
  hud.setSafe(currentArea.kind === 'safe');
  presentation.resetActors(currentArea.kind === 'safe');
  if (!fixedCamera && !inspecting) cameraOwner.resetFollow(player.root.position);
  else cameraOwner.suspendFollow();
  graphics?.resetHistory();
}
function reset(): void {
  clearInput(); resetEncounter(encounter); adventure.restart(); harvesting.reset();
  if (active && movementWorld) gathering.register(active, movementWorld);
  resetPresentation();
}
const bindingsMenu=new KeybindingsMenu(preferences,()=>adventure.character.actionBar,clearInput,()=>renderer.domElement.focus());
const menuController = new MenuController(
  {
    get adventure() { return menus; },
    get shop() { return shop; },
    get skills() { return combatUI; },
    get bindings() { return bindingsMenu; },
    get options() { return options; },
  },
  () => !paused() && encounter.player.hp > 0,
);
const interactionActions = new InteractionActions(adventure, encounter, menus, gathering, audio, {
  area: () => currentArea, definitions: () => definitions, paused, changeArea, syncAdventure,
  openShop: () => { shop.update(adventure.character); shop.open(); },
});
function dispatchInput(action: InputAction): void {
  if (loadingScreen.blocking || transitioning) { clearInput(); return; }
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
  syncAdventure();
}
function castReturn():void {
  if(impact.holding && !paused()){pendingUtility='portal';return;}
  if(paused())return;
  interruptApproach();
  if(!adventure.beginCast(encounter.player.hp>0) && encounter.player.hp>0)
    adventure.message(currentArea.id===homeArea ? 'Already at Homestead' : adventure.castRemaining>0 ? 'Scroll of Return is casting' : 'No Scrolls of Return');
  syncAdventure();
}
const combatUI = new CombatUI({
  paused,
  character: () => adventure.character, encounter: () => encounter, preferences,
  activate: id => combat.startAbility(id), potion: usePotion, portal: castReturn,
  canEdit: () => inventory.canEditEquipment(),
  portalReady: () => currentArea.id !== homeArea && encounter.player.hp > 0 &&
    adventure.character.scrolls > 0 && adventure.castRemaining === 0,
  assign: bar => { if (inventory.canEditEquipment()) adventure.setActionBar(bar); },
  clear: clearInput, focus: () => renderer.domElement.focus(),
});
const optionsButton = document.createElement('button');
optionsButton.id = 'hud-options'; optionsButton.textContent = '⚙';
optionsButton.title = 'Options'; optionsButton.setAttribute('aria-label', 'Options');
optionsButton.onclick = () => menuController.toggleOptions();
document.getElementById('app')!.append(optionsButton);

function worldTargets(): readonly WorldInteraction[] {
  return worldInteractions?.targets(adventure, harvesting, adventureVisuals?.portalTarget) ?? [];
}
function interactionError(target: WorldInteraction): string {
  return worldInteractionError(target, currentArea, adventure, encounter);
}
function pickInteraction(): WorldInteraction | null {
  return worldInteractions?.pick(pointerAim.ray, worldTargets()) ?? null;
}

function worldClick(clientX: number, clientY: number): boolean {
  if (paused() || encounter.player.hp <= 0) return false;
  resolveAim({ x: clientX, y: clientY });
  if (impact.holding) return !!adventureVisuals?.pick(pointerAim.ray) || !!pickInteraction();
  const loot = adventureVisuals?.pick(pointerAim.ray);
  if (loot) { selectLoot(loot); return true; }
  const target = pickInteraction();
  if (!target) return false;
  if (target.type === 'resource' && gathering.target?.id === target.resource.id) return true;
  clearInput();
  const error = interactionError(target);
  if (error) { adventure.message(error); return true; }
  approach.selectWorld(target, movementWorld);
  return true;
}

function syncAdventure(): void {
  adventureVisuals?.sync(adventure.session(currentArea.id).drops, adventure.portalPosition(currentArea), lootLabels.hovered, adventure.portalHeight(currentArea));
  for (const chest of currentArea.chests ?? []) active?.setChestOpened(chest.id, adventure.chest(currentArea, chest).opened);
  const adventureEvents = adventure.takeEvents();
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
  menus.update(adventure.character.scrolls, currentArea.id !== homeArea && encounter.player.hp > 0 && adventure.character.scrolls > 0 && adventure.castRemaining === 0, prompt, adventure.castRemaining);
  combatUI?.update();
}
function paused(): boolean {
  return Boolean(loadingScreen.blocking || !active || hidden() || characterMissing || menuController.paused || inventory.loading || inspecting || graphics?.preparingSettings || frozen || transitioning);
}
function resolveAim(pointer = input.pointer()): AimPoint | undefined {
  return pointerAim.resolve(pointer, encounter.player.y);
}
function interruptApproach(releaseLock = true): void {
  approach.cancel();
  gathering.cancel(releaseLock);
}
function updateGame(dt: number): void {
  if (dt <= 0 && impact.holding && !paused()) { hud.update(encounter, []); return; }
  const isPaused = paused();
  if (pendingUtility && !isPaused && !impact.holding) {
    const command=pendingUtility; pendingUtility=null;
    if(command==='potion')usePotion();else castReturn();
  }
  let movement = input.movement();
  const block=combat.holdingShield();
  if(encounter.pending?.kind==='ability' && encounter.pending.ability==='shield-basic' && !block)encounter.pending=null;
  gathering.cancelIfInterrupted(movement, block);
  const approachCommand = isPaused ? undefined : approach.update(dt, {
    movement, block, navigation: movementWorld, targets: worldTargets, error: interactionError,
    interact: target => interactionActions.execute(target),
  });
  if (approachCommand) movement = approachCommand.movement;
  const commands = { ...movement, block, paused: isPaused || paused(), aim: isPaused ? undefined : approachCommand?.aim ?? resolveAim() };
  if (encounter.player.hp > 0 && !commands.paused && Math.hypot(movement.x, movement.z) > 0) hud.dismissResult();
  if (encounter.phase === 'won' || currentArea.kind === 'safe') {
    present(stepExploration(encounter, dt, commands, movementWorld, combat.timings()));
  } else present(stepEncounter(encounter, dt, commands, combat.timings(), movementWorld));
  if (!paused() && encounter.phase !== 'loading' && adventure.currentArea) adventure.step(encounter, currentArea, dt);
  if (!isPaused && encounter.player.hp > 0) gathering.advance(dt);
  projectileVisuals.sync(encounter.projectiles);
  enemyActors.sync(encounter, isPaused ? 0 : dt, currentArea.kind !== 'safe');
  if(!paused() && input.pointer()){resolveAim();hoveredInteraction=pickInteraction();}else hoveredInteraction=null;
  interactionHighlight.select(hoveredInteraction && !interactionError(hoveredInteraction) ? hoveredInteraction.object : null);interactionHighlight.update((camera.top-camera.bottom)/camera.zoom/Math.max(1,mount.clientHeight)*1.5);
  renderer.domElement.style.cursor=hoveredInteraction ? interactionError(hoveredInteraction) ? 'not-allowed' : 'pointer' : '';
  syncAdventure();
  hud.update(encounter, []);
  if (!paused() && encounter.phase !== 'lost' && encounter.phase !== 'loading' && adventure.castRemaining === 0) {
    const gate = travel.check(currentArea.gates, [encounter.player.x, encounter.player.z]);
    if (gate) void changeArea({ kind: 'travel', area: gate.destination.area, arrivalId: gate.destination.gate, transition: true }).catch(areaChangeFailed);
  }
}
function resize(): void {
  cameraOwner.resize(mount.clientWidth, mount.clientHeight);
  renderer.setSize(mount.clientWidth, mount.clientHeight); graphics?.resize(); invalidateFrame();
}
window.addEventListener('resize', resize);
resize();
const initialFpsLimit = readSettings().fpsLimit;
function renderFrame(dt: number): boolean {
  cameraOwner.clearShake();
  if (paused() || inspecting || fixedCamera || transitioning) impact.clear();
  const gameDt = impact.advance(dt);
  audio.update(encounter.player,paused() || encounter.phase==='loading');
  updateGame(gameDt);
  if (!inspecting && !paused() && !fixedCamera && encounter.player.hp > 0) {
    cameraOwner.follow(player.root.position, gameDt);
  } else cameraOwner.suspendFollow();
  for (const id in actors) {
    const actor = actors[id];
    const state = id === 'player' ? encounter.player : encounter.enemies[id];
    updateActor(actor, state, gameDt, paused(), id==='player' && encounter.blocking);
    gameplayAudio.locomotion(id,state,actor.gait,actor.current,paused());
  }
  abilityEffects?.sync(encounter,player.root,cameraOwner.camera);
  if (!paused()) { active?.portals.forEach(p => p.update(gameDt)); adventureVisuals?.update(gameDt); }
  const portalPoint = adventure.portalPosition(currentArea);
  gameplayAudio.ambience(currentArea.effects.fires,encounter.player,portalPoint ? {x:portalPoint[0],z:portalPoint[1]} : null,lanternEnabled && encounter.player.hp>0 ? encounter.player : null, currentArea.ambience ?? 'woodland', !!currentArea.effects.weather && (options?.settings.weatherEffects ?? true));
  controls.update();
  camera.updateMatrixWorld();
  pointerAim.capture(camera);
  const pointer = input.pointer();
  if (!paused() && pointer) { resolveAim(pointer); lootLabels.hovered = adventureVisuals?.pick(pointerAim.ray) ?? null; }
  const shake = impact.offset(options?.settings.cameraShake ?? true);
  cameraOwner.applyShake(shake.x,shake.y,mount.clientHeight);
  lootLabels.sync(adventure.session(currentArea.id).drops, camera, [encounter.player.x, encounter.player.z], paused() || encounter.player.hp <= 0);
  hud.positionEnemy(encounter, camera, mount, paused() ? 0 : gameDt, inspecting || transitioning);
  active?.update(camera, paused() ? 0 : gameDt);
  stageVegetationActors();
  graphics?.effects.setGameplayDelta(gameDt);
  graphics?.effects.weatherView(camera,player.root.position);
  renderer.info.reset();
  const rendered = graphics?.render(dt, paused()) ?? false;
  if (rendered) renderedFrames++;
  if (rendered && active && !transitioning) renderedRevision = revision;
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
  if (currentArea.kind !== 'safe') for (const id of encounter.enemyIds) {
    if (encounter.enemies[id].hp <= 0 || !actors[id]?.root.visible || !encounter.enemies[id].home) continue;
    vegetationEnemies.push(id);
  }
  const distance = (id: string): number => (encounter.enemies[id].x - encounter.player.x) ** 2 + (encounter.enemies[id].z - encounter.player.z) ** 2;
  vegetationEnemies.sort((a, b) => distance(a) - distance(b) || a.localeCompare(b));
  for (let i = 0; i < Math.min(3, vegetationEnemies.length); i++) vegetationActors.push(record(vegetationEnemies[i]));
  graphics?.effects.setVegetationActors(vegetationActors);
}
const runtimeDiagnostics = new ClearingDiagnostics({
  audio, adventure, encounter, preferences, harvesting, gathering, approach,
  playerEquipment, enemyActors, actors, camera, controls, renderer, mount,
  get currentArea() { return currentArea; },
  get active() { return active; },
  get graphics() { return graphics; },
  get options() { return options; },
  get personalLantern() { return personalLantern; },
  get movementWorld() { return movementWorld; },
  get hoveredInteraction() { return hoveredInteraction; },
  get surfaceMode() { return surfaceMode; },
  get revision() { return revision; },
  get renderedRevision() { return renderedRevision; },
  get transitioning() { return transitioning; },
  get areaErrors() { return areaErrors; },
  get characterMissing() { return characterMissing; },
  get contentHash() { return contentHash; },
  get updateMs() { return updateMs; },
  get renderedFrames() { return renderedFrames; },
});
const diagnostics = () => runtimeDiagnostics.snapshot();

try {
  const character = await loader.loadAsync(characters.player.model);
  sceneTextures(character.scene);
  attachCharacter(player, character.scene, character.animations, characters.player.height);
  await inventory.initialize();
  await gatheringTools.prepare();
  reset();
} catch (error) {
  characterMissing = true;
  recordFailure('character', error);
  throw new Error('Required character art could not be prepared.', { cause: error });
}

{
  personalLantern = new PlayerLantern(player.root, lanternEnabled); await personalLantern.initialize();
  const effects = new CoreEffects(); scene.add(effects.root);
  const lighting = { get definition() { return committedLighting; }, get fires() { return active?.fires ?? []; }, get shadow() { return active?.shadow ?? null; } };
  options = new Options({
    apply: settings => {
      hud.resourceNumbers(settings.resourceNumbers);
      if (!settings.cameraShake) { impact.offset(false); cameraOwner.clearShake(); }
      if (cameraOwner.setDistance(settings.cameraDistance)) { graphics?.resetHistory(); invalidateFrame(); }
      graphics?.apply(settings); abilityEffects?.setQuality(settings.particleQuality);
    }, combatText: settings => hud.applyCombatText(settings), flushSettings: () => graphics?.flushSettings(),
    resetMeasurements: () => graphics?.resetMeasurements(), clearInput,
    focus: () => renderer.domElement.focus(), keybindings:()=>bindingsMenu.open(), audio: {apply:settings=>audio.applySettings(settings),play:cue=>audio.play(cue)},
  });
  graphics = new Graphics({ scene, camera, renderer, controls, sun, ambient, mount, lighting, invalidate: invalidateFrame }, options.settings, effects);
  const menusChanged = new MutationObserver(invalidateFrame);
  document.querySelectorAll('dialog').forEach(dialog => menusChanged.observe(dialog, { attributes: true, attributeFilter: ['open'] }));
  mount.addEventListener('graphicssettingschange', invalidateFrame, true);
  window.addEventListener('pagehide', () => { menusChanged.disconnect(); dispose(); }, { once: true });
  resize();
  await graphics.initialize();
  frameLoop.start();
  if (!await changeArea({ kind: 'travel', area: currentArea.id })) throw new Error('Initial area could not be prepared.');
  if (import.meta.env.DEV && renderQuery.get('author') === 'levels') {
    const { attachAuthoring } = await import('../levels/authoring');
    attachAuthoring({ invalidate: invalidateFrame, scene, camera, renderer, definitions: () => definitions, area: () => currentArea, encounter,
      resetMaterials: () => graphics.resetHistory(),
      exportLighting: () => graphics.exportLighting(), lighting: () => graphics.lightingDiagnostics(),
      changeArea: id => changeArea({ kind: 'travel', area: id }), restart: reset, inspect: () => { inspect(); return inspecting; }, waitFrames, setFrozen: freezePreview, setView: previewView,
      appearance: () => ({ lantern: lanternEnabled, surfaces: surfaceMode }),
      setAppearance: changeAppearance,
      diagnostics,
    });
  }

}

function dispose(): void {
  impact.clear(); cameraOwner.clearShake();
  frameLoop.dispose();
  hud.dispose();
  input.dispose();
  generation++;
  adventure.closeSave();
  preferences.close();
  gatheringTools.dispose();
  audio.dispose();
  graphics?.dispose();
  personalLantern?.dispose();
  playerEquipment.dispose();
  interactionHighlight.dispose();
  enemyActors.dispose();
  projectileVisuals.dispose(); abilityEffects?.dispose();
  adventureVisuals?.dispose();
  shop.dispose(); lootLabels.dispose();
  worldInteractions = undefined;
  active?.dispose();
  movementWorld?.dispose();
  for (const actor of [player]) {
    actor.mixer?.stopAllAction();
    actor.mixer?.uncacheRoot(actor.mixer.getRoot());
    disposeSceneResources(actor.root);
  }
  void renderer.dispose().catch((error: unknown) => console.error('Unable to release graphics.', error));
  void disposeAreaCache().catch((error: unknown) => console.error('Unable to release area assets.', error));
}

registerRuntimeSnapshot(() => runtimeDiagnostics.report());

function freezePreview(value: boolean): void {
  frozen = value; fixedCamera = value; clearInput();
  if (!value) { cameraOwner.restoreGameplayView(); cameraOwner.resetFollow(player.root.position); graphics?.resetHistory(); }
  if (value) { reset(); for (const actor of Object.values(actors)) { play(actor, 'idle'); actor.actions.idle?.stopFading().setEffectiveWeight(1); actor.mixer?.setTime(0); } graphics?.effects.clearArea(); active?.activate(graphics!.effects); graphics?.resetSceneTime(); }
}
function previewView(id: string): void {
  fixedCamera = true;
  cameraOwner.previewView(currentArea, id);
  graphics?.resetHistory();
}
async function changeAppearance(appearance: { surfaces?: SurfaceMode; lantern?: boolean }): Promise<boolean> {
  if (appearance.lantern !== undefined && appearance.surfaces === undefined) { lanternEnabled = appearance.lantern; personalLantern?.setEnabled(lanternEnabled); return true; }
  return changeArea({ kind: 'refresh', spawn: { position: [encounter.player.x, encounter.player.z], yaw: encounter.player.yaw },
    appearance: { lantern: appearance.lantern ?? lanternEnabled, surfaces: appearance.surfaces ?? surfaceMode } });
}
async function changeArea(change: AreaChange): Promise<boolean> {
  const id = change.kind === 'travel' ? change.area : currentArea.id;
  const { arrivalId, recover = false } = change.kind === 'travel' ? change : {};
  const { canCommit, spawn } = change;
  const appearance = change.kind === 'refresh' ? change.appearance : undefined;
  const started = performance.now(), request = ++generation, next = definitions[id];
  const errors = validateDefinitions(definitions);
  if (!next || errors.length) {
    transitioning = false;
    areaErrors = errors.length ? errors : [`Unknown area: ${id}`];
    return false;
  }
  const nextSurfaces = appearance?.surfaces ?? surfaceMode;
  const resolved = { ...next, lighting: resolveLightingFor(next) };
  const savedView = frozen && active?.area.id === id
    ? cameraOwner.captureView()
    : null;
  const startup = !active;
  const presentation = startup || loadingScreen.blocking || change.kind === 'travel' && renderQuery.get('author') !== 'levels';
  const token = startup ? loadingScreen.current : presentation ? loadingScreen.begin(next.name) : undefined;
  const fadeUntil = performance.now() + (startup || matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 150);
  transitioning = true;
  audio.update(encounter.player, true);
  hud.clearCombatText();
  clearInput();
  let preparedEnemies: PreparedEnemies | undefined;
  let candidateAbilities: AbilityEffects | undefined;
  let actorsAccepted = false;
  let committed = false;
  let candidateOwner: Awaited<ReturnType<typeof prepareAreaCandidate>> | undefined;
  try {
    if (canCommit && !canCommit()) {
      adventure.message('Travel cancelled.');
      if (token !== undefined && await loadingScreen.ready(token)) renderer.domElement.focus();
      return false;
    }
    const digest = await crypto.subtle.digest('SHA-256',
      new TextEncoder().encode(JSON.stringify({ ...resolved, surfaces: nextSurfaces })));
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    candidateOwner = await prepareAreaCandidate(
      () => buildArea(next, nextSurfaces, appearance?.shelterRestored ?? adventure.character.shelterRestored),
      () => MovementWorld.create(next.layout.boundary, traversalWithTrees(next)),
      async candidate => {
        candidateAbilities=new AbilityEffects(candidate,options!.settings.particleQuality,renderer);
        await candidateAbilities.prepare(cameraOwner.camera);
        if (renderQuery.get('portal') === 'off') candidate.portals.forEach(p => { p.root.visible = false; });
        return graphics!.prepareLighting(resolved, candidate.root);
      },
    );
    preparedEnemies = await enemyActors.prepare(createEncounter('playing', next.layout));
    if (presentation && performance.now() < fadeUntil) await new Promise(resolve => setTimeout(resolve, fadeUntil - performance.now()));
    const accepted = candidateOwner.accept(
      () => request === generation && (!canCommit || canCommit()),
      () => { if (change.kind === 'refresh') change.onCommit?.(); },
    );
    if (!accepted) {
      if (request === generation && token !== undefined) {
        adventure.message('Travel cancelled.');
        if (await loadingScreen.ready(token)) renderer.domElement.focus();
      }
      return false;
    }

    const { area: candidate, movement: candidateMovement, lighting: preparedLighting } = candidateOwner;
    committed = true;
    enemyActors.commit(preparedEnemies); actorsAccepted = true;
    graphics!.effects.clearArea();
    abilityEffects?.dispose(); abilityEffects=candidateAbilities;
    adventureVisuals?.dispose();
    active?.dispose();
    movementWorld?.dispose();
    movementWorld = candidateMovement;
    active = candidate;
    worldInteractions = new WorldInteractions(next, candidate, [...Object.values(actors).map(actor => actor.root)]);
    currentArea = next;
    committedLighting = resolved.lighting;
    lanternEnabled = appearance?.lantern ?? lanternEnabled;
    personalLantern?.setEnabled(lanternEnabled);
    surfaceMode = nextSurfaces;
    graphics!.commitLighting(preparedLighting);
    scene.add(candidate.root);
    candidate.activate(graphics!.effects);

    const arrival = next.gates.find(gate => gate.id === arrivalId);
    gathering.register(candidate, candidateMovement);
    adventure.enter(encounter, next, spawn ?? arrival?.arrival ?? next.layout.player, recover);
    adventureVisuals = new AdventureVisuals(candidate.root);
    adventure.placeGround = (origin, index) => movementWorld!.lootGround(origin, index, encounter.player);
    adventure.canCollectGround = drop => movementWorld!.pickupReachable(encounter.player, drop.position, drop.height, 1.65);
    if (arrival) travel.arrive(arrival.id);
    inspecting = false;
    resetPresentation();
    syncAdventure();
    cameraOwner.inspect(false, { x: 0, z: 0 });
    if (!frozen) cameraOwner.restoreGameplayView();
    cameraOwner.resetFollow(player.root.position);
    graphics!.apply(options!.settings);
    graphics!.resetSceneTime();
    revision++;
    contentHash = hash;
    areaErrors = [];
    hud.environmentLoaded(candidate.missing.length ? 0 : 3);
    if (characterMissing) hud.characterUnavailable();
    else hud.setAssetStatus(candidate.missing.length ? `Missing art: ${candidate.missing.join(', ')}.` : '');
    if (frozen) freezePreview(true);
    if (savedView) {
      cameraOwner.restoreView(savedView);
    }
    await waitFrames(2);
    if (request !== generation) return false;
    if (token !== undefined && !await loadingScreen.ready(token)) return false;
    transitioning = false;
    audio.update(encounter.player, paused());
    updateMs = performance.now() - started;
    renderer.domElement.focus();
    return true;
  } catch (error) {
    if (request !== generation) return false;
    areaErrors = [error instanceof Error ? error.message : String(error)];
    recordFailure(startup ? 'startup-area' : 'travel', error);
    if (startup) throw error;
    if (token === undefined) { hud.setAssetStatus(`Unable to travel. ${areaErrors[0]}`); return false; }
    if (committed) { loadingScreen.fail(token, error); return false; }
    if (!actorsAccepted) { preparedEnemies?.dispose(); preparedEnemies = undefined; }
    candidateOwner?.dispose(); candidateOwner = undefined;
    const choice = await loadingScreen.recover(token, error);
    if (request !== generation || choice === 'superseded') return false;
    areaErrors = [];
    if (choice === 'retry') return await changeArea(change);
    if (await loadingScreen.ready(token)) renderer.domElement.focus();
    return false;
  } finally {
    if (!committed) candidateAbilities?.dispose();
    if (!actorsAccepted) preparedEnemies?.dispose();
    candidateOwner?.dispose();
    if (request === generation) {
      transitioning = false;
      clearInput();
    }
  }
}
if (import.meta.hot) import.meta.hot.accept('../levels/registry', module => {
  if (!module) return;
  const updated = module.areas as typeof areas;
  const errors = validateDefinitions(updated);
  if (errors.length) { generation++; transitioning = false; if (active) loadingScreen.dismiss(); areaErrors = errors; return; }
  definitions = updated; void changeArea({ kind: 'refresh' }).catch((error: unknown) => console.error('Unable to refresh area definitions.', error));
});

if (import.meta.hot) import.meta.hot.on('vite:error', payload => { generation++; transitioning = false; if (active) loadingScreen.dismiss(); areaErrors = [payload.err.message]; });

if (import.meta.hot) import.meta.hot.accept('../levels/lighting', module => {
  if (!module) return;
  resolveLightingFor = module.resolveAreaLighting as typeof resolveLightingFor;
  void changeArea({ kind: 'refresh' }).catch((error: unknown) => console.error('Unable to refresh lighting.', error));
});

if (import.meta.hot) import.meta.hot.accept('../levels/validation', module => {
  if (!module) return;
  validateDefinitions = module.validateAreas as typeof validateAreas;
  void changeArea({ kind: 'refresh' }).catch((error: unknown) => console.error('Unable to refresh area validation.', error));
});

if (import.meta.hot) window.addEventListener('lightingpresetchanged', () => {
  void changeArea({ kind: 'refresh' }).catch(areaChangeFailed);
});
