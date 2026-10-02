import { disposeSceneResources, sceneTextures } from '../assets/resource-ownership';
import { resolveAreaLighting as lightingFor } from '../levels/lighting';
import type { SurfaceMode } from '../assets/environment-surfaces';
import type { AreaLighting } from '../levels/types';
import { CombatUI } from '../ui/combat';
import { KeybindingsMenu } from '../ui/keybindings';
import { InputPreferences, type InputAction } from '../input/bindings';
import { abilities, abilitySet, type AbilityId } from '../gameplay/abilities';
import { InteractionHighlight } from '../rendering/interaction-highlight';
import { Adventure, homeArea, near } from '../gameplay/adventure';
import { AdventureMenus } from '../ui/adventure';
import { AdventureVisuals } from '../rendering/adventure';
import { LootLabels } from '../ui/loot';
import { itemLoadout, lootDefinitions, removeQuantity, sameEquipment, validItems, type InventoryItem } from '../gameplay/inventory';
import type { Spawn, Point } from '../gameplay/area';
import { MovementWorld } from '../gameplay/movement';
import { prepareAreaCandidate } from './area-candidate';
import { cameraOffset } from './projection';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createEncounter, resetEncounter, useAbility, swapWeaponSet, inCombat, dodge, stepExploration, stepEncounter, type EncounterEvent, type ActorId, type Timings, type AimPoint, enemyIds } from '../gameplay/encounter';
import { readSettings } from '../rendering/graphics-settings';
import { createRenderer } from '../rendering/renderer';
import { PlayerLantern } from '../rendering/player-lantern';
import { Graphics } from '../rendering/graphics';
import { CoreEffects } from '../rendering/effects';
import { Options } from '../ui/options';
import { buildArea, createWorld, disposeAreaCache, type AreaInstance } from '../levels/builder';
import { areas } from '../levels/registry';
import { validateAreas } from '../levels/validation';
import { GateTravel } from '../gameplay/area';
import { makeActor, play, attachCharacter, installMotions, updateActor, duration, type Actor } from './actors';
import { createInput } from './input';
import { createCamera } from './camera';
import { createHud } from '../ui/hud';
import characters from '../../assets/playable-characters.json';
import { loadEquipmentMotions } from '../animation/combat-animations';
import { type Loadout } from '../gameplay/equipment';
import { Equipment } from '../rendering/equipment';
import { ProjectileVisuals, CasterVisuals } from '../rendering/projectiles';
import { GameAudio } from '../audio/audio';
import { GameplayAudio } from '../audio/gameplay';
import { GatheringTools } from '../rendering/gathering-tools';
import { progression } from '../gameplay/skills';
import { Harvesting } from '../gameplay/harvesting';
import { GatheringController } from './gathering';
import { FrameLoop } from './frame-loop';
import { EquipmentSets } from './equipment-sets';
import { ClickApproach } from './click-approach';
import { PointerAim } from './pointer-aim';
import { worldTargets as buildWorldTargets, interactionError as worldInteractionError, pickInteraction as pickWorldInteraction, type WorldInteraction } from './world-interactions';
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


const fade = document.createElement('div');
fade.style.cssText = 'position:fixed;inset:0;background:#111e24;opacity:0;pointer-events:none;transition:opacity 150ms;z-index:90'; document.body.append(fade);
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
let movementWorld: MovementWorld | undefined;
let generation = 0, revision = 0, renderedRevision = 0, transitioning = false;
let frozen = import.meta.env.DEV && renderQuery.get('author') === 'levels';
let fixedCamera = frozen;
let areaErrors: string[] = [], updateMs = 0, contentHash = '', characterMissing = false;
const travel = new GateTravel();
const enemyLoadout: Loadout = { main: 'axe', off: null };
const adventure = new Adventure(() => localStorage);
await adventure.prepareSave();
let adventureVisuals: AdventureVisuals | undefined;
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
const player = makeActor(scene, encounter.player);
const enemy = makeActor(scene, encounter.enemies.enemy);
const caster = makeActor(scene, encounter.enemies.caster);
const actors: Record<ActorId, Actor> = { player, enemy, caster };
const actorIds: readonly ActorId[] = ['player', ...enemyIds];
const loader = new GLTFLoader();
const approach = new ClickApproach(adventure, encounter);
const playerEquipment = new Equipment(player.root), enemyEquipment = new Equipment(enemy.root,'enemy'), casterEquipment = new Equipment(caster.root,'enemy');
const gatheringTools = new GatheringTools(player.root,playerEquipment);
const projectileVisuals = new ProjectileVisuals(scene);
const casterVisuals = new CasterVisuals(scene, caster.root);
const harvesting = new Harvesting();
const interactionHighlight=new InteractionHighlight(scene);
const equipmentSets = new EquipmentSets(player, playerEquipment, loader, () => projectileVisuals.prepareArrow());
let combatUI: CombatUI | undefined;
const preferences=new InputPreferences(() => localStorage);
let hoveredInteraction: WorldInteraction | null=null;
const audio = new GameAudio();
const gameplayAudio = new GameplayAudio(audio);
document.addEventListener('click', event => {
  const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null;
  if (button && !button.disabled && button.closest('dialog, #result-panel')) audio.play('uiClick');
});
let equipmentLoading = false;
const gathering = new GatheringController(encounter, adventure, harvesting, player, gatheringTools, audio, {
  area: () => currentArea, instance: () => active, navigation: () => movementWorld, paused,
});
function clearInput(): void {
  input.clear();
  combatUI?.clearHold();
  hoveredInteraction = null;
  interactionHighlight.clear();
}
function applyLoadoutState(): void {
  encounter.weaponSets=[itemLoadout(adventure.character.items,0),itemLoadout(adventure.character.items,1)];
  encounter.activeSet=adventure.character.activeSet;encounter.weapon=encounter.weaponSets[encounter.activeSet].main;encounter.shield=!!encounter.weaponSets[encounter.activeSet].off;
}
async function changeEquipment(items: InventoryItem[] = adventure.character.items, save = false): Promise<void> {
  if (equipmentLoading || !player.mixer) throw new Error('Character equipment is still loading.');
  equipmentLoading = true;
  clearInput();
  try {
    await equipmentSets.prepare(items, adventure.character.activeSet);
    if (save) adventure.replaceItems(items);
    applyLoadoutState();
    play(player, 'idle');
    menus.updateCharacter(adventure.character);
    if (save) audio.play('equip');
  } finally {
    equipmentLoading = false;
  }
}

let inspecting = false;
const input = createInput(renderer.domElement, preferences, dispatchInput, worldClick, () => {
  encounter.pending = null;
  encounter.blocking = false;
  interruptApproach();
});
async function changeInventory(items: InventoryItem[]): Promise<void> {
  if (!validItems(items)) throw new Error('Item does not fit.');
  if (!sameEquipment(items, adventure.character.items)) {
    if (!canEditAbilities()) throw new Error('Equipment cannot change during combat or an action.');
    await changeEquipment(items, true);
  } else {
    adventure.replaceItems(items);
    menus.updateCharacter(adventure.character);
    audio.play('inventoryMove');
  }
}

const menus = new AdventureMenus(clearInput, () => renderer.domElement.focus(), () => { if (!paused()) adventure.beginCast(encounter.player.hp > 0); }, {
  change: changeInventory, newId: adventure.newId,
  changeContainers: (items,stash) => { adventure.replaceContainers(items,stash); menus.updateCharacter(adventure.character); audio.play('inventoryMove'); },
  transfer: (id,quantity,toStash,point) => { adventure.transferStash(id,quantity,toStash,point); menus.updateCharacter(adventure.character); audio.play('inventoryMove'); },
  repair: async () => {
    const site=currentArea.shelter;
    const canCommit=()=>!!site && currentArea.id===homeArea && encounter.player.hp>0 && near([encounter.player.x,encounter.player.z],site.position,progression.restedRadius) && adventure.canRepair();
    if(!canCommit())throw new Error('Not enough materials.');
    const ok=await changeArea({kind:'refresh',spawn:{position:[encounter.player.x,encounter.player.z],yaw:encounter.player.yaw},appearance:{shelterRestored:true},canCommit,onCommit:()=>adventure.repairShelter()});
    if(!ok)throw new Error('Unable to repair shelter. Materials were retained.');
    audio.play('chestOpen');
  },
  recover: id => { adventure.recoverItem(id); menus.updateCharacter(adventure.character); audio.play('inventoryMove'); },
  drop: async (id, quantity) => {
    const entry = adventure.character.items.find(i => i.id === id); if (!entry) throw new Error('Item is no longer available.');
    if (entry.slot === 'bag' || entry.slot === 'overflow') {
      adventure.dropItem(id, quantity, [encounter.player.x, encounter.player.z]); audio.play('inventoryDrop');
      menus.updateCharacter(adventure.character); syncAdventure(); return;
    }
    const next = removeQuantity(adventure.character.items, id, quantity);
    await changeInventory(next);
    adventure.spawnDrop(entry.item, quantity, [encounter.player.x, encounter.player.z], { blocked: lootDefinitions[entry.item].stackable, instanceId: lootDefinitions[entry.item].stackable ? undefined : entry.id });
    audio.play('inventoryDrop'); syncAdventure();
  },
}, cue => audio.play(cue));
const lootLabels = new LootLabels(mount, selectLoot);
function selectLoot(id: string): void {
  if (paused() || encounter.player.hp <= 0) return;
  renderer.domElement.focus();
  if (!adventure.session().drops.some(drop => drop.id === id)) return;
  gathering.cancel();
  encounter.pending = null;
  approach.selectLoot(id, movementWorld);
}

const hud = createHud(() => { if (!equipmentLoading && !transitioning) void changeArea({ kind: 'travel', area: homeArea, transition: true, spawn: definitions.homestead.layout.player, recover: true }).catch(areaChangeFailed); });
function inspect(): void {
  if (!currentArea.inspection) return;
  clearInput(); inspecting = !inspecting;
  cameraOwner.inspect(inspecting, { x: currentArea.inspection?.position[0] ?? 0, z: currentArea.inspection?.position[1] ?? 0 }); graphics?.resetHistory();
  if (inspecting) cameraOwner.suspendFollow();
  else if (!fixedCamera) cameraOwner.resetFollow(player.root.position);
}
function present(events: EncounterEvent[]): void {
  for (const id of actorIds) {
    const actor = actors[id];
    const state = id === 'player' ? encounter.player : encounter.enemies[id];
    actor.root.position.set(state.x, state.y + .04, state.z);
    actor.root.rotation.y = state.yaw;
  }
  for (const event of events) {
    if (event.type === 'weaponSet') {
      equipmentSets.activate(event.set);
      adventure.setWeaponSet(event.set);
      audio.play('equip');
      menus.updateCharacter(adventure.character);
    }
    if (event.type === 'axeXp') adventure.grantAxeCombatXp();
    if (event.type === 'hit' && event.actor === 'player') {
      interruptApproach(false);
      if (events.some(event => event.type === 'impact' && event.actor === 'player' && !event.blocked)) releaseShieldInput();
    }
    if (event.type === 'animation' || event.type === 'hit') {
      const actor = actors[event.actor];
      if (event.type === 'animation') play(actor, event.motion);
      else { const impact = events.find(e => e.type==='impact' && e.actor===event.actor); graphics?.effects.burst('hit', actor.root.position, impact?.type==='impact' && impact.blocked ? 5 : 8); }
    }
  }
  gameplayAudio.encounter(events,encounter);
  hud.update(encounter, events);
}
function resetPresentation(): void {
  gameplayAudio.reset();
  clearInput();
  graphics?.effects.clear();
  encounter.projectiles=[]; projectileVisuals.clear(); casterVisuals.clear();
  applyLoadoutState();
  movementWorld?.reset();
  active?.portals.forEach(p => p.reset());
  hud.reset();
  for (const actor of Object.values(actors)) {
    actor.mixer?.stopAllAction();
    actor.current = null; actor.previous=null; actor.velocity.set(0,0);
  }
  hud.setSafe(currentArea.kind === 'safe');
  for (const id of enemyIds) actors[id].root.visible = currentArea.kind !== 'safe' && !!encounter.enemies[id].home;
  present([{ type: 'animation', actor: 'player', motion: 'idle' }, ...enemyIds.map(id => ({type:'animation' as const,actor:id,motion:encounter.enemies[id].hp <= 0 ? 'death' as const : 'idle' as const}))]);
  for (const id of enemyIds) {
    const death = actors[id].actions.death;
    if (encounter.enemies[id].hp <= 0 && death) death.time = duration(actors[id], 'death');
  }
  if (!fixedCamera && !inspecting) cameraOwner.resetFollow(player.root.position);
  else cameraOwner.suspendFollow();
  graphics?.resetHistory();
}
function reset(): void { clearInput(); resetEncounter(encounter); applyLoadoutState(); resetPresentation(); }
const bindingsMenu=new KeybindingsMenu(preferences,()=>adventure.character.actionBar,clearInput,()=>renderer.domElement.focus());
function closeMenus(): void {
  if (bindingsMenu.paused) bindingsMenu.close();
  if (combatUI?.paused) combatUI.close();
  if (menus.paused) menus.close();
  if (options?.paused) options.close();
}
function toggleOptions(): void {
  if (bindingsMenu.paused || combatUI?.paused || menus.paused || options?.paused) closeMenus();
  else options?.open();
}
function openInventory(): void {
  if (menus.paused) { menus.close(); return; }
  closeMenus();
  if (!paused() && encounter.player.hp > 0) menus.openInventory();
}
function openSkills(): void {
  if (combatUI?.paused) { combatUI.close(); return; }
  closeMenus();
  if (!paused() && encounter.player.hp > 0) combatUI?.open();
}
function canEditAbilities(): boolean {
  return encounter.phase !== 'loading' && encounter.player.hp > 0 && !inCombat(encounter) &&
    encounter.player.lock === 0 && encounter.dodgeRemaining === 0 &&
    !equipmentLoading && !transitioning && !gathering.target;
}
function dispatchInput(action: InputAction): void {
  if (action === 'inventory') { openInventory(); return; }
  if (action === 'skills') { openSkills(); return; }
  if (action === 'options') { toggleOptions(); return; }
  if (paused()) return;

  if (action.startsWith('slot')) {
    const id = adventure.character.actionBar[Number(action.slice(4))];
    if (id) startAbility(id);
    return;
  }
  switch (action) {
    case 'dodge': startDodge(); break;
    case 'swap': startSwap(); break;
    case 'potion': usePotion(); break;
    case 'portal': castReturn(); break;
    case 'zoomIn': cameraOwner.zoom(1); break;
    case 'zoomOut': cameraOwner.zoom(-1); break;
  }
}
function usePotion():void {if(!paused()){adventure.usePotion(encounter);syncAdventure();}}
function castReturn():void {if(!paused()){interruptApproach();adventure.beginCast(encounter.player.hp>0);syncAdventure();}}
combatUI=new CombatUI({character:()=>adventure.character,encounter:()=>encounter,preferences,activate:startAbility,potion:usePotion,portal:castReturn,swap:startSwap,canEdit:canEditAbilities,portalReady:()=>currentArea.id!==homeArea && encounter.player.hp>0 && adventure.character.scrolls>0 && adventure.castRemaining===0,assign:bar=>{if(canEditAbilities())adventure.setActionBar(bar);},clear:clearInput,focus:()=>renderer.domElement.focus()});
const optionsButton=document.createElement('button');optionsButton.id='hud-options';optionsButton.textContent='⚙';optionsButton.title='Options';optionsButton.setAttribute('aria-label','Options');optionsButton.onclick=()=>toggleOptions();document.getElementById('app')!.append(optionsButton);

function worldTargets(): WorldInteraction[] {
  return buildWorldTargets(currentArea, active, adventure, harvesting, adventureVisuals?.portalTarget);
}
function interactionError(target: WorldInteraction): string {
  return worldInteractionError(target, currentArea, adventure, encounter);
}
function pickInteraction(): WorldInteraction | null {
  if (!active) return null;
  const roots = [active.root, ...(adventureVisuals?.portalTarget ? [adventureVisuals.portalTarget] : []), player.root, enemy.root, caster.root];
  return pickWorldInteraction(pointerAim.ray, roots, worldTargets());
}

function worldClick(clientX: number, clientY: number): boolean {
  if (paused() || encounter.player.hp <= 0) return false;
  resolveAim({ x: clientX, y: clientY });
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
function interact(target: WorldInteraction): void {
  if (paused() || encounter.player.hp <= 0 || encounter.player.lock > 0 || encounter.dodgeRemaining > 0) return;
  const error = interactionError(target);
  if (error) { adventure.message(error); return; }
  switch (target.type) {
    case 'resource': gathering.select(target.resource); break;
    case 'shelter': menus.openRepair(); break;
    case 'stash': menus.openInventory(true); break;
    case 'chest': adventure.openChest(encounter, currentArea, target.chest); break;
    case 'fire': {
      adventure.discover(currentArea, [encounter.player.x, encounter.player.z]);
      const sourceArea = currentArea, sourceFire = target.fire;
      menus.openTravel(adventure.destinations(definitions).map(({ area, fire, available }) => ({
        name: fire.name, available,
        travel: () => {
          const allowed = () => adventure.canTravel(encounter, sourceArea, sourceFire, area, fire);
          if (allowed()) void changeArea({ kind: 'travel', area: area.id, transition: true, spawn: fire.arrival, canCommit: allowed }).then(ok => {
            if (ok) audio.play('fireTravel');
          }).catch(areaChangeFailed);
        },
      })));
      break;
    }
    case 'portal': {
      const link = adventure.portal;
      if (!link) return;
      if (currentArea.id === homeArea) {
        void changeArea({ kind: 'travel', area: link.area, transition: true, spawn: link.departure }).then(ok => {
          if (!ok) return;
          audio.play('portalPass');
          if (adventure.portal === link) { adventure.portal = null; syncAdventure(); audio.play('portalClose'); }
        }).catch(areaChangeFailed);
      } else {
        void changeArea({ kind: 'travel', area: homeArea, transition: true, spawn: definitions.homestead.portalArrival }).then(ok => {
          if (ok) audio.play('portalPass');
        }).catch(areaChangeFailed);
      }
      break;
    }
  }
}

function syncAdventure(): void {
  adventureVisuals?.sync(adventure.session(currentArea.id).drops, adventure.portalPosition(currentArea), lootLabels.hovered);
  for (const chest of currentArea.chests ?? []) active?.setChestOpened(chest.id, adventure.chest(currentArea, chest).opened);
  const prompt=paused() || encounter.player.hp<=0 ? '' : adventure.notice || (hoveredInteraction ? interactionError(hoveredInteraction) || hoveredInteraction.name : '');
  gameplayAudio.adventure(adventure.takeEvents());
  if (adventure.castRemaining<=0) audio.stop('return-cast');
  menus.updateCharacter(adventure.character);
  menus.update(adventure.character.scrolls, currentArea.id !== homeArea && encounter.player.hp > 0 && adventure.character.scrolls > 0 && adventure.castRemaining === 0, prompt, adventure.castRemaining);
  combatUI?.update();
}
function paused(): boolean {
  return Boolean(hidden() || characterMissing || options?.paused || menus.paused || combatUI?.paused ||
    bindingsMenu.paused || equipmentLoading || inspecting || graphics?.preparingSettings || frozen || transitioning);
}
function timings(): Timings {
  const timing = (actor: Actor) => ({ attack: duration(actor, 'attack'), hit: duration(actor, 'hit'), contacts: actor.contacts, commitLead: actor.commitLead });
  return { player: { ...timing(player), abilities: equipmentSets.abilityTimings() }, enemy: timing(enemy), caster: timing(caster) };
}
function resolveAim(pointer = input.pointer()): AimPoint | undefined {
  return pointerAim.resolve(pointer, encounter.player.y);
}
function interruptApproach(releaseLock = true): void {
  approach.cancel();
  gathering.cancel(releaseLock);
}
function releaseShieldInput(): void {
  combatUI?.clearHold();
  adventure.character.actionBar.forEach((id, index) => {
    if (id === 'shield-basic') input.suppress(`slot${index}` as InputAction);
  });
}

function holdingShield(): boolean {
  return !!combatUI?.blocking || adventure.character.actionBar.some((id, index) =>
    id === 'shield-basic' && input.held(`slot${index}` as InputAction));
}
function startAbility(id: AbilityId): void {
  if (paused()) return;
  interruptApproach();
  if (!holdingShield()) encounter.blocking = false;
  const pointer = input.pointer();
  const aim = pointer ? pointerAim.attack(pointer, encounter, currentArea.kind === 'safe', actors) : undefined;
  const events = useAbility(encounter, id, timings().player, false, aim);
  present(events);
  if (!events.length && !encounter.pending) {
    const definition = abilities[id];
    const set = abilitySet(encounter.weaponSets, encounter.activeSet, id);
    if (set === undefined) {
      const family = definition.family;
      const item = family === 'shield' ? 'a Shield' : family === 'axe' ? 'an Axe' : `a ${family[0].toUpperCase() + family.slice(1)}`;
      adventure.message(`Equip ${item} in a weapon set`);
    } else if (encounter.playerMana < definition.mana) adventure.message('Not enough mana');
  }
}
function startSwap(): void {
  if (paused()) return;
  interruptApproach();
  releaseShieldInput();
  present(swapWeaponSet(encounter, false));
}
function startDodge(): void {
  if (!player.actions.dodge || paused()) return;
  interruptApproach();
  releaseShieldInput();
  present(dodge(encounter, input.movement(), false, resolveAim()));
}

function updateGame(dt: number): void {
  const isPaused = paused();
  let movement = input.movement();
  const block=holdingShield();
  if(encounter.pending?.kind==='ability' && encounter.pending.ability==='shield-basic' && !block)encounter.pending=null;
  gathering.cancelIfInterrupted(movement, block);
  const approachCommand = isPaused ? undefined : approach.update(dt, {
    movement, block, navigation: movementWorld, targets: worldTargets, error: interactionError, interact,
  });
  if (approachCommand) movement = approachCommand.movement;
  const commands = { ...movement, block, paused: isPaused || paused(), aim: isPaused ? undefined : approachCommand?.aim ?? resolveAim() };
  if (encounter.player.hp > 0 && !commands.paused && Math.hypot(movement.x, movement.z) > 0) hud.dismissResult();
  if (encounter.phase === 'won' || currentArea.kind === 'safe') {
    present(stepExploration(encounter, dt, commands, movementWorld, timings()));
  } else present(stepEncounter(encounter, dt, commands, timings(), movementWorld));
  if (!paused() && encounter.phase !== 'loading' && adventure.currentArea) adventure.step(encounter, currentArea, dt);
  if (!isPaused && encounter.player.hp > 0) gathering.advance(dt);
  projectileVisuals.sync(encounter.projectiles);
  casterVisuals.sync(encounter, caster.contacts[0] ?? .8, isPaused ? 0 : dt, currentArea.kind !== 'safe');
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
  audio.update(encounter.player,paused() || encounter.phase==='loading');
  updateGame(dt);
  if (!inspecting && !paused() && !fixedCamera && encounter.player.hp > 0) {
    cameraOwner.follow(player.root.position, dt);
  } else cameraOwner.suspendFollow();
  for (const id of actorIds) {
    const actor = actors[id];
    const state = id === 'player' ? encounter.player : encounter.enemies[id];
    updateActor(actor, state, dt, paused(), id==='player' && encounter.blocking);
    gameplayAudio.locomotion(id,state,actor.gait,actor.current,paused());
  }
  if (!paused()) { active?.portals.forEach(p => p.update(dt)); adventureVisuals?.update(dt); }
  const portalPoint = adventure.portalPosition(currentArea);
  gameplayAudio.ambience(currentArea.effects.fires,encounter.player,portalPoint ? {x:portalPoint[0],z:portalPoint[1]} : null,lanternEnabled && encounter.player.hp>0 ? encounter.player : null);
  controls.update();
  camera.updateMatrixWorld();
  pointerAim.capture(camera);
  const pointer = input.pointer();
  if (!paused() && pointer) { resolveAim(pointer); lootLabels.hovered = adventureVisuals?.pick(pointerAim.ray) ?? null; }
  lootLabels.sync(adventure.session(currentArea.id).drops, camera, [encounter.player.x, encounter.player.z], paused() || encounter.player.hp <= 0);
  hud.positionEnemy(encounter, camera, mount, paused() ? 0 : dt, inspecting || transitioning);
  active?.update(camera, paused() ? 0 : dt);
  renderer.info.reset();
  const rendered = graphics?.render(dt, paused()) ?? false;
  if (rendered) renderedFrames++;
  if (rendered && active && !transitioning) renderedRevision = revision;
  return rendered;
}
try {
  const [paladin, goblin] = await Promise.all([loader.loadAsync(characters.player.model), loader.loadAsync(characters.enemy.model)]);
  sceneTextures(paladin.scene); sceneTextures(goblin.scene);
  attachCharacter(player, paladin.scene, paladin.animations, characters.player.height);
  attachCharacter(enemy, goblin.scene, goblin.animations, characters.enemy.height);
  attachCharacter(caster, goblin.scene, goblin.animations, characters.enemy.height);
  renderer.domElement.dataset.characters = JSON.stringify({ player: characters.player.name, enemy: characters.enemy.name });
  await changeEquipment();
  await gatheringTools.prepare();
  const goblinMotions = await loadEquipmentMotions(loader, 'enemy', enemyLoadout);
  installMotions(enemy, goblinMotions);
  const goblinEquipment = await enemyEquipment.stage(enemyLoadout); enemyEquipment.commit(goblinEquipment);
  installMotions(caster,await loadEquipmentMotions(loader,'enemy',{main:'staff',off:null}));
  casterEquipment.commit(await casterEquipment.stage({main:'staff',off:null}));
  reset();
} catch (error) {
  characterMissing = true; hud.characterUnavailable();
  console.error(error);
}

{
  personalLantern = new PlayerLantern(player.root, lanternEnabled); await personalLantern.initialize();
  const effects = new CoreEffects(); scene.add(effects.root);
  const lighting = { get definition() { return committedLighting; }, get fires() { return active?.fires ?? []; }, get shadow() { return active?.shadow ?? null; } };
  options = new Options({
    apply: settings => graphics?.apply(settings), flushSettings: () => graphics?.flushSettings(),
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
  await changeArea({ kind: 'travel', area: currentArea.id });
  if (import.meta.env.DEV && renderQuery.get('author') === 'levels') {
    const { attachAuthoring } = await import('../levels/authoring');
    attachAuthoring({ invalidate: invalidateFrame, scene, camera, renderer, definitions: () => definitions, area: () => currentArea, encounter,
      exportLighting: () => graphics!.exportLighting(), lighting: () => graphics!.lightingDiagnostics(),
      changeArea: id => changeArea({ kind: 'travel', area: id }), restart: reset, inspect: () => { inspect(); return inspecting; }, waitFrames, setFrozen: freezePreview, setView: previewView,
      appearance: () => ({ lantern: lanternEnabled, surfaces: surfaceMode }),
      setAppearance: changeAppearance,
      diagnostics,
    });
  }

}

function dispose(): void {
  frameLoop.dispose();
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
  enemyEquipment.dispose();
  casterEquipment.dispose();
  projectileVisuals.dispose();
  casterVisuals.dispose();
  adventureVisuals?.dispose();
  lootLabels.dispose();
  active?.dispose();
  movementWorld?.dispose();
  for (const actor of Object.values(actors)) {
    actor.mixer?.stopAllAction();
    actor.mixer?.uncacheRoot(actor.mixer.getRoot());
    disposeSceneResources(actor.root);
  }
  void renderer.dispose().catch(error => console.error('Unable to release graphics.', error));
  void disposeAreaCache().catch(error => console.error('Unable to release area assets.', error));
}

function diagnostics() {
  return {
    audio: audio.diagnostics(), lantern: personalLantern?.diagnostics(), surfaces: surfaceMode,
    area: currentArea.id, revision, renderedRevision,
    ready: !!active && renderedRevision === revision && !transitioning && !areaErrors.length && !mount.dataset.renderError,
    errors: [...areaErrors, ...(mount.dataset.renderError ? [mount.dataset.renderError] : [])],
    missing: [...(active?.missing ?? []), ...(characterMissing ? ['character'] : [])],
    contentHash, settings: options!.settings, backend: 'webgpu', updateMs, renderedFrames, phase: encounter.phase,
    equipment: playerEquipment.diagnostics(),
    controls: { bindings: preferences.value, actionBar: adventure.character.actionBar },
    interaction: { hover: hoveredInteraction?.key ?? null, approach: approach.worldKey },
    harvest: { chopping: gathering.choppingId, trees: active?.resources.map(tree => ({ ...tree, ...harvesting.state(currentArea.id, tree.id) })) },
    adventure: {
      persistence: adventure.saveDiagnostics(), character: adventure.character, portal: adventure.portal, castRemaining: adventure.castRemaining,
      drops: adventure.session(currentArea.id).drops, chests: adventure.session(currentArea.id).chests,
      fires: (currentArea.campfires ?? []).map(fire => ({ id: fire.id, safe: adventure.fireSafe(currentArea, fire, encounter) })),
    },
    encounter: {
      enemies: structuredClone(encounter.enemies), enemyEquipment: enemyEquipment.diagnostics(), casterEquipment: casterEquipment.diagnostics(),
      player: { ...encounter.player }, playerMana: encounter.playerMana, dodgeRemaining: encounter.dodgeRemaining,
      dodgeCooldown: encounter.dodgeCooldown, blocking: encounter.blocking, projectiles: encounter.projectiles, pending: encounter.pending,
      animations: { player: player.current, enemy: enemy.current, caster: caster.current },
      navigationReady: movementWorld?.navigationReady ?? false, navigationMs: movementWorld?.generationMs ?? 0,
    },
    camera: { position: camera.position.toArray(), target: controls.target.toArray(), zoom: camera.zoom, viewport: [mount.clientWidth, mount.clientHeight] },
    objects: active?.root.children.length ?? 0,
    resources: { memory: { ...renderer.info.memory }, drawCalls: renderer.info.render.drawCalls, triangles: renderer.info.render.triangles },
    graphics: renderer.domElement.dataset.graphics ? JSON.parse(renderer.domElement.dataset.graphics) : null,
  };
}

function freezePreview(value: boolean): void {
  frozen = value; fixedCamera = value; clearInput();
  controls.minZoom = value ? .1 : .9;
  if (!value) { camera.zoom = defaultPreviewZoom(); camera.updateProjectionMatrix(); cameraOwner.resetFollow(player.root.position); graphics?.resetHistory(); }
  if (value) { reset(); for (const actor of Object.values(actors)) { play(actor, 'idle'); actor.actions.idle?.stopFading().setEffectiveWeight(1); actor.mixer?.setTime(0); } graphics?.effects.clearArea(); active?.activate(graphics!.effects); graphics?.resetSceneTime(); }
}
function previewView(id: string): void {
  cameraOwner.suspendFollow();
  fixedCamera = true; controls.minZoom = .1;
  const target = currentArea.views.find(v => v.id === id)?.target ?? [0, .9, 0];
  controls.target.fromArray(target); camera.position.copy(controls.target).add(new THREE.Vector3(...cameraOffset));
  camera.zoom = id === 'overview' ? Math.min(defaultPreviewZoom(), defaultPreviewZoom() * Math.min(currentArea.envelope.screen[0] / (currentArea.envelope.width + 8), currentArea.envelope.screen[1] / (currentArea.envelope.depth + 8)) * .9) : defaultPreviewZoom();
  camera.updateProjectionMatrix(); controls.update(); graphics?.resetHistory();
}
async function changeAppearance(appearance: { surfaces?: SurfaceMode; lantern?: boolean }): Promise<boolean> {
  if (appearance.lantern !== undefined && appearance.surfaces === undefined) { lanternEnabled = appearance.lantern; personalLantern?.setEnabled(lanternEnabled); return true; }
  return changeArea({ kind: 'refresh', spawn: { position: [encounter.player.x, encounter.player.z], yaw: encounter.player.yaw },
    appearance: { lantern: appearance.lantern ?? lanternEnabled, surfaces: appearance.surfaces ?? surfaceMode } });
}
function defaultPreviewZoom(): number { return currentArea.envelope.reference.zoom; }
type AreaAppearance = { lantern?: boolean; surfaces?: SurfaceMode; shelterRestored?: boolean };
type AreaChange =
  | { kind: 'travel'; area: string; arrivalId?: string; transition?: boolean; spawn?: Spawn; recover?: boolean; canCommit?: () => boolean }
  | { kind: 'refresh'; spawn?: Spawn; appearance?: AreaAppearance; canCommit?:()=>boolean; onCommit?:()=>void };
function areaChangeFailed(error: unknown): void { console.error('Unable to change area.', error); }
async function changeArea(change: AreaChange): Promise<boolean> {
  const id = change.kind === 'travel' ? change.area : currentArea.id;
  const { arrivalId, transition = false, recover = false } = change.kind === 'travel' ? change : {};
  const { canCommit, spawn } = change;
  const appearance = change.kind === 'refresh' ? change.appearance : undefined;
  const started = performance.now(), request = ++generation, next = definitions[id];
  const errors = validateDefinitions(definitions);
  if (!next || errors.length) {
    transitioning = false;
    fade.style.opacity = '0';
    areaErrors = errors.length ? errors : [`Unknown area: ${id}`];
    return false;
  }
  const nextSurfaces = appearance?.surfaces ?? surfaceMode;
  const resolved = { ...next, lighting: resolveLightingFor(next) };
  const savedView = frozen && active?.area.id === id
    ? { target: controls.target.clone(), zoom: camera.zoom }
    : null;
  transitioning = true;
  clearInput();
  let candidateOwner: Awaited<ReturnType<typeof prepareAreaCandidate>> | undefined;
  try {
    if (transition) {
      fade.style.opacity = '1';
      await new Promise(resolve => setTimeout(resolve, 160));
    }
    const digest = await crypto.subtle.digest('SHA-256',
      new TextEncoder().encode(JSON.stringify({ ...resolved, surfaces: nextSurfaces })));
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    candidateOwner = await prepareAreaCandidate(
      () => buildArea(next, nextSurfaces, appearance?.shelterRestored ?? adventure.character.shelterRestored),
      () => MovementWorld.create(next.layout.boundary, traversalWithTrees(next)),
      candidate => {
        if (renderQuery.get('portal') === 'off') candidate.portals.forEach(p => { p.root.visible = false; });
        return graphics!.prepareLighting(resolved, candidate.root);
      },
    );
    const accepted = candidateOwner.accept(
      () => request === generation && (!canCommit || canCommit()),
      () => { if (change.kind === 'refresh') change.onCommit?.(); },
    );
    if (!accepted) return false;

    const { area: candidate, movement: candidateMovement, lighting: preparedLighting } = candidateOwner;
    graphics!.effects.clearArea();
    adventureVisuals?.dispose();
    active?.dispose();
    movementWorld?.dispose();
    movementWorld = candidateMovement;
    active = candidate;
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
    adventure.canCollectGround = drop => {
      const path = movementWorld!.pickupPath(encounter.player, drop.position, drop.height);
      if (!path) return false;
      let length = 0, previous: Point = [encounter.player.x, encounter.player.z];
      for (const point of [...path, drop.position]) {
        length += Math.hypot(point[0] - previous[0], point[1] - previous[1]);
        previous = point;
      }
      return length <= 1.65;
    };
    if (arrival) travel.arrive(arrival.id);
    inspecting = false;
    resetPresentation();
    syncAdventure();
    cameraOwner.inspect(false, { x: 0, z: 0 });
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
      controls.target.copy(savedView.target);
      camera.position.copy(controls.target).add(new THREE.Vector3(...cameraOffset));
      camera.zoom = savedView.zoom;
      camera.updateProjectionMatrix();
      controls.update();
    }
    transitioning = false;
    audio.update(encounter.player, paused());
    await waitFrames(2);
    if (request !== generation) return false;
    updateMs = performance.now() - started;
    renderer.domElement.focus();
    return true;
  } catch (error) {
    if (request === generation) {
      areaErrors = [error instanceof Error ? error.message : String(error)];
      hud.setAssetStatus(`Unable to travel. ${areaErrors[0]}`);
    }
    return false;
  } finally {
    candidateOwner?.dispose();
    if (request === generation) {
      transitioning = false;
      fade.style.opacity = '0';
      clearInput();
    }
  }
}
if (import.meta.hot) import.meta.hot.accept('../levels/registry', module => {
  if (!module) return;
  const errors = validateDefinitions(module.areas);
  if (errors.length) { generation++; transitioning = false; fade.style.opacity = '0'; areaErrors = errors; return; }
  definitions = module.areas; void changeArea({ kind: 'refresh' }).catch(error => console.error('Unable to refresh area definitions.', error));
});

if (import.meta.hot) import.meta.hot.on('vite:error', payload => { generation++; transitioning = false; fade.style.opacity = '0'; areaErrors = [payload.err.message]; });

if (import.meta.hot) import.meta.hot.accept('../levels/lighting', module => {
  if (!module) return;
  resolveLightingFor = module.resolveAreaLighting;
  void changeArea({ kind: 'refresh' }).catch(error => console.error('Unable to refresh lighting.', error));
});

if (import.meta.hot) import.meta.hot.accept('../levels/validation', module => {
  if (!module) return;
  validateDefinitions = module.validateAreas;
  void changeArea({ kind: 'refresh' }).catch(error => console.error('Unable to refresh area validation.', error));
});

if (import.meta.hot) window.addEventListener('lightingpresetchanged', () => {
  void changeArea({ kind: 'refresh' }).catch(areaChangeFailed);
});
