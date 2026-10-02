import { disposeSceneResources, sceneTextures } from '../assets/resource-ownership';
import { resolveAreaLighting as lightingFor } from '../levels/lighting';
import type { SurfaceMode } from '../assets/environment-surfaces';
import type { AreaDefinition, AreaLighting } from '../levels/types';
import { CombatUI } from '../ui/combat';
import { KeybindingsMenu } from '../ui/keybindings';
import { InputPreferences, type InputAction } from '../input/bindings';
import { abilities, abilitySet, basicAbility, type AbilityId } from '../gameplay/abilities';
import { InteractionHighlight } from '../rendering/interaction-highlight';
import { Adventure, homeArea, near, chestUnlocked } from '../gameplay/adventure';
import { AdventureMenus } from '../ui/adventure';
import { AdventureVisuals } from '../rendering/adventure';
import { LootLabels } from '../ui/loot';
import { itemLoadout, lootDefinitions, removeQuantity, validItems, type InventoryItem } from '../gameplay/inventory';
import type { Spawn, Point } from '../gameplay/area';
import { MovementWorld } from '../gameplay/movement';
import { cameraOffset } from './projection';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createEncounter, resetEncounter, useAbility, swapWeaponSet, inCombat, dodge, stepExploration, stepEncounter, type EncounterEvent, type ActorId, type Timings, type AimPoint, enemyIds } from '../gameplay/encounter';
import { readSettings } from '../rendering/graphics-settings';
import { FramePacer } from '../rendering/frame-pacer';
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
import { loadEquipmentMotions, type CombatMotions } from '../animation/combat-animations';
import { type Loadout } from '../gameplay/equipment';
import { Equipment, type PreparedEquipment } from '../rendering/equipment';
import { ProjectileVisuals, CasterVisuals } from '../rendering/projectiles';
import { GameAudio } from '../audio/audio';
import { GameplayAudio } from '../audio/gameplay';
import { GatheringTools } from '../rendering/gathering-tools';
import { gathering, progression } from '../gameplay/skills';
import { resourceSkill, type ResourceDefinition } from '../levels/resources';
import { Harvesting } from '../gameplay/harvesting';
import { traversalWithTrees } from '../levels/trees';
import '../ui/game.css';
import '../ui/options.css';
const renderQuery = new URLSearchParams(location.search);
// Legacy lab URLs open the same clearing and Options UI.
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
let ticking = false, frameRequest = 0, settleFrames = 64, lastTick: number | undefined;
let previouslyPaused = true;
function hidden(): boolean { return !renderingInspection && (document.hidden || document.documentElement.hasAttribute('data-window-hidden')); }
function requestFrame(): void { if (ticking && !frameRequest && !hidden()) frameRequest = requestAnimationFrame(tick); }
function invalidateFrame(): void { settleFrames = 64; requestFrame(); }
function visibilityChanged(): void {
  if (!ticking) return;
  clearInput(); lastTick = undefined; cameraOwner.suspendFollow();
  if (hidden()) { cancelAnimationFrame(frameRequest); frameRequest = 0; audio.update(encounter.player, true); }
  else { graphics?.resetMeasurements(); invalidateFrame(); }
}
document.addEventListener('visibilitychange', visibilityChanged);
window.addEventListener('lanternvisibilitychange', visibilityChanged);
for (const event of ['pointerdown', 'pointerup', 'pointermove', 'keydown', 'keyup', 'wheel', 'input', 'change']) window.addEventListener(event, () => { if (ticking && paused()) invalidateFrame(); });


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
let storage: Storage | undefined;
try { storage = localStorage; } catch { /* Report unavailable storage below. */ }
const enemyLoadout: Loadout = { main: 'axe', off: null };
const adventure = new Adventure(storage);
if (!storage) adventure.saveError = 'Unable to save progress. Allow local storage before restarting.';
else if (!adventure.saveError) adventure.save();
let adventureVisuals: AdventureVisuals | undefined;
const frames: { left: number; resolve: () => void }[] = [];
const waitFrames = (count = 16) => new Promise<void>(resolve => { frames.push({ left: count, resolve }); invalidateFrame(); });
const renderer = await createRenderer(mount);
renderer.domElement.setAttribute('aria-label', 'Lantern. Move and use abilities with your configured controls. Click objects to interact.');
renderer.info.autoReset = false;
let renderedFrames = 0;
const cameraOwner = createCamera(renderer.domElement);
const { camera, controls } = cameraOwner;
controls.addEventListener('change', invalidateFrame);
const encounter = createEncounter('loading', currentArea.layout);
const player = makeActor(scene, encounter.player);
const enemy = makeActor(scene, encounter.enemies.enemy);
const caster = makeActor(scene, encounter.enemies.caster);
const actors: Record<ActorId, Actor> = { player, enemy, caster };
const playerEquipment = new Equipment(player.root), enemyEquipment = new Equipment(enemy.root,'enemy'), casterEquipment = new Equipment(caster.root,'enemy');
const gatheringTools = new GatheringTools(player.root,playerEquipment);
const projectileVisuals = new ProjectileVisuals(scene);
const casterVisuals = new CasterVisuals(scene, caster.root);
const harvesting = new Harvesting();
const interactionHighlight=new InteractionHighlight(scene);
let preparedSets: {equipment:PreparedEquipment;motions:CombatMotions;loadout:Loadout}[]=[];
let combatUI: CombatUI | undefined;
const preferences=new InputPreferences(storage);
let worldApproach: {key:string;points:Point[];elapsed:number;stalled:number;last:Point} | null=null;
let hoveredInteraction: WorldInteraction | null=null;
const audio = new GameAudio();
const gameplayAudio = new GameplayAudio(audio);
document.addEventListener('click', event => {
  const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null;
  if (button && !button.disabled && button.closest('dialog, #result-panel')) audio.play('uiClick');
});
let equipmentLoading = false;
let chopping: { tree: ResourceDefinition; time: number; contacted: boolean } | null = null;
let gatheringTarget: ResourceDefinition | null = null;
function cancelChop(releaseLock = true): void {
  gatheringTarget=null; gatheringTools.show(null);
  if (!chopping) return;
  chopping = null; if (releaseLock) encounter.player.lock = 0;
  if (player.current === 'chop' || player.current === 'mine') play(player,'idle');
}
function clearInput(): void {adventure.cancelPickup();pickupRoute=null;worldApproach=null;input.clear();combatUI?.clearHold();encounter.pending=null;encounter.blocking=false;cancelChop();hoveredInteraction=null;interactionHighlight.clear();}
function applyLoadoutState(): void {
  encounter.weaponSets=[itemLoadout(adventure.character.items,0),itemLoadout(adventure.character.items,1)];
  encounter.activeSet=adventure.character.activeSet;encounter.weapon=encounter.weaponSets[encounter.activeSet].main;encounter.shield=!!encounter.weaponSets[encounter.activeSet].off;
}
async function changeEquipment(items: InventoryItem[] = adventure.character.items, save = false): Promise<void> {
  if(equipmentLoading || !player.mixer)throw new Error('Character equipment is still loading.');
  equipmentLoading=true;clearInput();
  const candidates:PreparedEquipment[]=[],next:typeof preparedSets=[];
  try {
    for(const set of [0,1] as const){const loadout=itemLoadout(items,set);if(loadout.main==='bow')await projectileVisuals.prepareArrow();const equipment=await playerEquipment.stage(loadout);candidates.push(equipment);const motions=await loadEquipmentMotions(loader,'player',loadout);next.push({equipment,motions,loadout});}
    installMotions(player,next[adventure.character.activeSet].motions);
    playerEquipment.commit(next[adventure.character.activeSet].equipment,true);
    for(const previous of preparedSets)playerEquipment.discard(previous.equipment);
    preparedSets=next;if(save)adventure.replaceItems(items);applyLoadoutState();play(player,'idle');menus.updateCharacter(adventure.character);if(save)audio.play('equip');
  } catch(error){candidates.forEach(candidate=>playerEquipment.discard(candidate));throw error;}
  finally{equipmentLoading=false;}
}

let inspecting = false;
const input = createInput(renderer.domElement,preferences,dispatchInput,worldClick,()=>{encounter.pending=null;encounter.blocking=false;worldApproach=null;pickupRoute=null;adventure.cancelPickup();cancelChop();});
async function changeInventory(items: InventoryItem[]): Promise<void> {
  if(!validItems(items))throw new Error('Item does not fit.');
  const equipment=(entries:InventoryItem[])=>entries.filter(i=>i.slot==='main' || i.slot==='off').map(i=>[i.id,i.slot,i.weaponSet ?? 0]).sort();
  if(JSON.stringify(equipment(items))!==JSON.stringify(equipment(adventure.character.items))){if(!canEditAbilities())throw new Error('Equipment cannot change during combat or an action.');await changeEquipment(items,true);}
  else{adventure.replaceItems(items);menus.updateCharacter(adventure.character);audio.play('inventoryMove');}
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
let pickupRoute: { id: string; points: Point[]; elapsed: number; stalled: number; last: Point } | null = null;
const lootLabels = new LootLabels(mount, selectLoot);
function selectLoot(id: string): void {
  if (paused() || encounter.player.hp <= 0) return;
  renderer.domElement.focus();
  const drop = adventure.session().drops.find(d => d.id === id); if (!drop) return;
  worldApproach=null;cancelChop(); encounter.pending = null; adventure.cancelPickup(); pickupRoute = null;
  const point: Point = [encounter.player.x, encounter.player.z];
  if (near(point, drop.position, 1.5) && adventure.canCollectGround(drop)) {
    if (drop.age >= .55) adventure.pickup(id, point, true);
    else { adventure.pickupTarget = id; pickupRoute = { id, points: [], elapsed: 0, stalled: 0, last: point }; }
    return;
  }
  const points = movementWorld?.pickupPath(encounter.player, drop.position, drop.height);
  if (!points) { adventure.message('Can’t reach item'); return; }
  adventure.pickupTarget = id; pickupRoute = { id, points, elapsed: 0, stalled: 0, last: point };
}

const hud = createHud(() => { if (!equipmentLoading && !transitioning) void changeArea({ kind: 'travel', area: homeArea, transition: true, spawn: definitions.homestead.layout.player, recover: true }); });
const loader = new GLTFLoader();
function inspect(): void {
  if (!currentArea.inspection) return;
  clearInput(); inspecting = !inspecting;
  cameraOwner.inspect(inspecting, { x: currentArea.inspection?.position[0] ?? 0, z: currentArea.inspection?.position[1] ?? 0 }); graphics?.resetHistory();
  if (inspecting) cameraOwner.suspendFollow();
  else if (!fixedCamera) cameraOwner.resetFollow(player.root.position);
}
function present(events: EncounterEvent[]): void {
  for (const id of ['player', ...enemyIds] as ActorId[]) {
    const actor = actors[id];
    const state = id === 'player' ? encounter.player : encounter.enemies[id];
    actor.root.position.set(state.x, state.y + .04, state.z);
    actor.root.rotation.y = state.yaw;
  }
  for (const event of events) {
    if(event.type==='weaponSet'){const prepared=preparedSets[event.set];if(!prepared)throw new Error('Weapon set is not prepared.');playerEquipment.commit(prepared.equipment,true);installMotions(player,prepared.motions);adventure.setWeaponSet(event.set);audio.play('equip');menus.updateCharacter(adventure.character);}
    if (event.type === 'axeXp') adventure.grantAxeCombatXp();
    if (event.type === 'hit' && event.actor === 'player') {cancelChop(false);worldApproach=null;pickupRoute=null;adventure.cancelPickup();if(events.some(e=>e.type==='impact' && e.actor==='player' && !e.blocked)){combatUI?.clearHold();for(let i=0;i<6;i++)if(adventure.character.actionBar[i]==='shield-basic')input.suppress(`slot${i}` as InputAction);}}
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
  for (const id of enemyIds) if (encounter.enemies[id].hp <= 0 && actors[id].actions.death) actors[id].actions.death!.time = duration(actors[id], 'death');
  if (!fixedCamera && !inspecting) cameraOwner.resetFollow(player.root.position);
  else cameraOwner.suspendFollow();
  graphics?.resetHistory();
}
function reset(): void { clearInput(); resetEncounter(encounter); applyLoadoutState(); resetPresentation(); }
const bindingsMenu=new KeybindingsMenu(preferences,()=>adventure.character.actionBar,clearInput,()=>renderer.domElement.focus());
function closeMenus(): void {if(bindingsMenu.paused)bindingsMenu.close();if(combatUI?.paused)combatUI.close();if(menus.paused)menus.close();if(options?.paused)options.close();}
function toggleOptions(): void {if(bindingsMenu.paused || combatUI?.paused || menus.paused || options?.paused)closeMenus();else options?.open();}
function openInventory(): void {if(menus.paused){menus.close();return;}closeMenus();if(!paused() && encounter.player.hp>0)menus.openInventory();}
function openSkills(): void {if(combatUI?.paused){combatUI.close();return;}closeMenus();if(!paused() && encounter.player.hp>0)combatUI?.open();}
function canEditAbilities(): boolean {return encounter.phase!=='loading' && encounter.player.hp>0 && !inCombat(encounter) && encounter.player.lock===0 && encounter.dodgeRemaining===0 && !equipmentLoading && !transitioning && !gatheringTarget;}
function dispatchInput(action:InputAction):void {
  if(action==='inventory'){openInventory();return;}if(action==='skills'){openSkills();return;}if(action==='options'){toggleOptions();return;}
  if(paused())return;
  if(action.startsWith('slot')){const id=adventure.character.actionBar[Number(action.slice(4))];if(id)startAbility(id);}
  else if(action==='dodge')startDodge();else if(action==='swap')startSwap();else if(action==='potion')usePotion();else if(action==='portal')castReturn();
  else if(action==='zoomIn' || action==='zoomOut')cameraOwner.zoom(action==='zoomIn' ? 1 : -1);
}
function usePotion():void {if(!paused()){adventure.usePotion(encounter);syncAdventure();}}
function castReturn():void {if(!paused()){worldApproach=null;pickupRoute=null;adventure.cancelPickup();cancelChop();adventure.beginCast(encounter.player.hp>0);syncAdventure();}}
combatUI=new CombatUI({character:()=>adventure.character,encounter:()=>encounter,preferences,activate:startAbility,potion:usePotion,portal:castReturn,swap:startSwap,canEdit:canEditAbilities,portalReady:()=>currentArea.id!==homeArea && encounter.player.hp>0 && adventure.character.scrolls>0 && adventure.castRemaining===0,assign:bar=>{if(canEditAbilities())adventure.setActionBar(bar);},clear:clearInput,focus:()=>renderer.domElement.focus()});
const optionsButton=document.createElement('button');optionsButton.id='hud-options';optionsButton.textContent='⚙';optionsButton.title='Options';optionsButton.setAttribute('aria-label','Options');optionsButton.onclick=()=>toggleOptions();document.getElementById('app')!.append(optionsButton);

type WorldBase={key:string;name:string;position:Point;range:number;height:number;obstacleId:string;object:THREE.Object3D};
type WorldInteraction=WorldBase & ({type:'resource';resource:ResourceDefinition} | {type:'chest';chest:NonNullable<AreaDefinition['chests']>[number]} | {type:'fire';fire:NonNullable<AreaDefinition['campfires']>[number]} | {type:'portal'} | {type:'shelter'|'stash'});
function worldTargets():WorldInteraction[]{
  const targets:WorldInteraction[]=[];if(!active)return targets;
  for(const node of active.resources){const object=active.interactables.get(`resource/${node.id}`) ?? active.interactables.get(`tree/${node.id}`);if(object && !harvesting.state(currentArea.id,node.id)?.felled)targets.push({key:`resource/${node.id}`,name:node.kind==='tree' ? 'Chop' : 'Mine',type:'resource',resource:node,position:[node.position[0],node.position[2]],range:node.radius+gathering.workingReach,height:node.position[1],obstacleId:node.id,object});}
  for(const chest of currentArea.chests ?? []){const object=active.interactables.get(`chest/${chest.id}`);if(object && !adventure.chest(currentArea,chest).opened)targets.push({key:`chest/${chest.id}`,name:'Open chest',type:'chest',chest,position:chest.position,range:1.8,height:0,obstacleId:chest.prop,object});}
  for(const fire of currentArea.campfires ?? []){const object=active.interactables.get(`fire/${fire.id}`);if(object)targets.push({key:`fire/${fire.id}`,name:'Travel',type:'fire',fire,position:fire.position,range:3,height:0,obstacleId:fire.id,object});}
  if(currentArea.shelter){const site=currentArea.shelter,key=adventure.character.shelterRestored ? 'stash' : 'shelter',object=active.interactables.get(key);if(object)targets.push({key,name:key==='stash' ? 'Stash' : 'Repair shelter',type:key,position:key==='stash' ? site.stash : site.position,range:key==='stash' ? 1.8 : progression.restedRadius,height:0,obstacleId:'shelter',object});}
  const portal=adventure.portalPosition(currentArea),object=adventureVisuals?.portalTarget;
  if(portal && object)targets.push({key:'portal',name:currentArea.id===homeArea ? 'Return to adventure' : 'Homestead',type:'portal',position:portal,range:1.8,height:0,obstacleId:'portal',object});
  return targets;
}
function interactionError(target:WorldInteraction):string {
  if(adventure.castRemaining>0)return 'Scroll of Return is casting';
  if(target.type==='resource' && !gatheringSafe())return 'Enemies nearby';
  if(target.type==='fire' && !adventure.fireSafe(currentArea,target.fire,encounter))return 'Enemies nearby';
  if(target.type==='chest' && !chestUnlocked(encounter,target.chest))return 'Defeat the guard';
  return '';
}
function pickInteraction():WorldInteraction | null {
  const targets=worldTargets();if(!active)return null;
  const roots=[active.root,...(adventureVisuals?.portalTarget ? [adventureVisuals.portalTarget] : []),player.root,enemy.root,caster.root];
  for(const hit of aimRay.intersectObjects(roots,true)){
    if(!hit.object.visible)continue;
    let visible=true;for(let object:THREE.Object3D | null=hit.object;object;object=object.parent)if(!object.visible)visible=false;if(!visible)continue;
    for(let object:THREE.Object3D | null=hit.object;object;object=object.parent){const target=targets.find(target=>target.object===object);if(target)return target;}
    return null;
  }
  return null;
}
function worldClick(clientX:number,clientY:number):boolean {
  if(paused() || encounter.player.hp<=0)return false;
  resolveAim({x:clientX,y:clientY});const loot=adventureVisuals?.pick(aimRay);if(loot){selectLoot(loot);return true;}
  const target=pickInteraction();if(!target)return false;
  if(target.type==='resource' && gatheringTarget?.id===target.resource.id)return true;
  clearInput();const error=interactionError(target);if(error){adventure.message(error);return true;}
  const points=movementWorld?.interactionPath(encounter.player,target.position,target.height,target.range,target.obstacleId);
  if(!points){adventure.message('Can’t reach object');return true;}
  worldApproach={key:target.key,points,elapsed:0,stalled:0,last:[encounter.player.x,encounter.player.z]};return true;
}
function interact(target:WorldInteraction):void {
  if(paused() || encounter.player.hp<=0 || encounter.player.lock>0 || encounter.dodgeRemaining>0)return;
  const error=interactionError(target);if(error){adventure.message(error);return;}
  if(target.type==='resource'){gatheringTarget=target.resource;beginChop(target.resource);}
  else if(target.type==='shelter')menus.openRepair();
  else if(target.type==='stash')menus.openInventory(true);
  else if(target.type==='chest')adventure.openChest(encounter,currentArea,target.chest);
  else if(target.type==='fire'){
    adventure.discover(currentArea,[encounter.player.x,encounter.player.z]);
    const sourceArea=currentArea,sourceFire=target.fire;
    menus.openTravel(adventure.destinations(definitions).map(({area,fire,available})=>({name:fire.name,available,travel:()=>{const allowed=()=>adventure.canTravel(encounter,sourceArea,sourceFire,area,fire);if(allowed())void changeArea({kind:'travel',area:area.id,transition:true,spawn:fire.arrival,canCommit:allowed}).then(ok=>{if(ok)audio.play('fireTravel');});}})));
  }else if(adventure.portal){const link=adventure.portal;if(currentArea.id===homeArea)void changeArea({kind:'travel',area:link.area,transition:true,spawn:link.departure}).then(ok=>{if(ok){audio.play('portalPass');if(adventure.portal===link){adventure.portal=null;syncAdventure();audio.play('portalClose');}}});else void changeArea({kind:'travel',area:homeArea,transition:true,spawn:definitions.homestead.portalArrival}).then(ok=>{if(ok)audio.play('portalPass');});}
}

function syncAdventure(): void {
  adventureVisuals?.sync(adventure.session(currentArea.id).drops, adventure.portalPosition(currentArea), lootLabels.hovered);
  for (const chest of currentArea.chests ?? []) active?.setChestOpened(chest.id, adventure.chest(currentArea, chest).opened);
  const prompt=paused() || encounter.player.hp<=0 ? '' : adventure.notice || (hoveredInteraction ? interactionError(hoveredInteraction) || hoveredInteraction.name : '');
  gameplayAudio.adventure(adventure.takeEvents());
  if (adventure.castRemaining<=0) audio.stop('return-cast');
  menus.updateCharacter(adventure.character);
  menus.update(adventure.character.scrolls, currentArea.id !== homeArea && encounter.player.hp > 0 && adventure.character.scrolls > 0 && adventure.castRemaining === 0, prompt, adventure.castRemaining);
  document.getElementById('save-status')!.textContent = adventure.saveError || preferences.error;combatUI?.update();
}
function paused(): boolean { return Boolean(hidden() || characterMissing || options?.paused || menus.paused || combatUI?.paused || bindingsMenu.paused || equipmentLoading || inspecting || graphics?.preparingSettings || frozen || transitioning); }
function timings(): Timings {
  const timing = (actor: Actor) => ({ attack: duration(actor, 'attack'), hit: duration(actor, 'hit'), contacts: actor.contacts, commitLead: actor.commitLead });
  const abilityTimings: NonNullable<Timings['player']['abilities']>={};
  for(const prepared of preparedSets){const basic=basicAbility(prepared.loadout.main);if(basic)abilityTimings[basic]={attack:prepared.motions.clips.attack.duration,contacts:prepared.motions.contacts};for(const [id,role] of [['sweep','sweep'],['piercing-shot','pierce']] as const){const clip=prepared.motions.clips[role],contacts=prepared.motions.skillContacts[role];if(clip && contacts)abilityTimings[id]={attack:clip.duration,contacts};}}
  return { player: {...timing(player),abilities:abilityTimings}, enemy: timing(enemy), caster: timing(caster) };
}
const aimRay = new THREE.Raycaster();
const aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0));
const aimPoint = new THREE.Vector3();
const aimPointer = new THREE.Vector2();
// Keep the displayed, unjittered view even if a wheel event changes the live camera.
const aimCamera = camera.clone();
function resolveAim(pointer = input.pointer()): AimPoint | undefined {
  if (!pointer) return;
  const rect = renderer.domElement.getBoundingClientRect();
  if (!rect.width || !rect.height || pointer.x < rect.left || pointer.x >= rect.right || pointer.y < rect.top || pointer.y >= rect.bottom) return;
  aimPointer.set((pointer.x - rect.left) / rect.width * 2 - 1, 1 - (pointer.y - rect.top) / rect.height * 2);
  aimRay.setFromCamera(aimPointer, aimCamera);
  aimPlane.constant = -encounter.player.y;
  if (aimRay.ray.intersectPlane(aimPlane, aimPoint)) return { x: aimPoint.x, z: aimPoint.z };
}
function resolveAttackAim(pointer: {x:number;y:number}): AimPoint | undefined {
  const ground=resolveAim(pointer);
  // Body pixels project beyond the enemy on the ground plane; pick its centre for the committed shot.
  let picked: {x:number;z:number;distance:number} | undefined;
  if (ground && currentArea.kind!=='safe') for (const id of enemyIds) {
    const state=encounter.enemies[id];
    if (!state.home || state.hp<=0) continue;
    const hit=aimRay.intersectObject(actors[id].root,true)[0];
    if (hit && (!picked || hit.distance<picked.distance)) picked={x:state.x,z:state.z,distance:hit.distance};
  }
  if (picked) return {x:picked.x,z:picked.z};
  return ground;
}
function gatheringSafe():boolean {return currentArea.kind==='safe' || !enemyIds.some(id=>{const enemy=encounter.enemies[id];return enemy.home && enemy.hp>0 && ((enemy.engaged && !enemy.returning) || Math.hypot(enemy.x-encounter.player.x,enemy.z-encounter.player.z)<=gathering.threatRadius);});}
function interruptApproach():void {worldApproach=null;pickupRoute=null;adventure.cancelPickup();cancelChop();}
function holdingShield():boolean {return !!combatUI?.blocking || adventure.character.actionBar.some((id,index)=>id==='shield-basic' && input.held(`slot${index}` as InputAction));}
function startAbility(id:AbilityId):void {
  if(paused())return;interruptApproach();if(!holdingShield())encounter.blocking=false;
  const pointer=input.pointer(),aim=pointer ? resolveAttackAim(pointer) : undefined;
  const events=useAbility(encounter,id,timings().player,false,aim);present(events);
  if(!events.length && !encounter.pending){const set=abilitySet(encounter.weaponSets,encounter.activeSet,id);if(set===undefined)adventure.message(`Equip ${abilities[id].family==='shield' ? 'a Shield' : abilities[id].family==='axe' ? 'an Axe' : `a ${abilities[id].family[0].toUpperCase()+abilities[id].family.slice(1)}`} in a weapon set`);else if(encounter.playerMana<abilities[id].mana)adventure.message('Not enough mana');}
}
function startSwap():void {if(paused())return;interruptApproach();combatUI?.clearHold();for(let i=0;i<6;i++)if(adventure.character.actionBar[i]==='shield-basic')input.suppress(`slot${i}` as InputAction);present(swapWeaponSet(encounter,false));}
function startDodge():void {
  if(!player.actions.dodge || paused())return;interruptApproach();combatUI?.clearHold();for(let i=0;i<6;i++)if(adventure.character.actionBar[i]==='shield-basic')input.suppress(`slot${i}` as InputAction);
  present(dodge(encounter,input.movement(),false,resolveAim()));
}
function resourceVisible(node:ResourceDefinition):boolean { return !!movementWorld?.resourceVisible(encounter.player,node.id,{x:node.position[0],y:node.position[1],z:node.position[2]}); }
function beginChop(tree: ResourceDefinition): void {
  const motion=tree.kind==='tree' ? 'chop' : 'mine';
  if(paused() || chopping || !gatheringSafe() || encounter.player.lock>0 || encounter.attackCooldown>0 || encounter.dodgeRemaining>0 || !player.actions[motion])return;
  if(harvesting.distance(tree,[encounter.player.x,encounter.player.z])>gathering.reach || !resourceVisible(tree))return;
  encounter.pending=null; encounter.player.attackTime=-1; encounter.blocking=false;
  encounter.player.yaw=Math.atan2(tree.position[0]-encounter.player.x,tree.position[2]-encounter.player.z);
  encounter.player.lock=duration(player,motion); chopping={tree,time:0,contacted:false};gatheringTarget=tree;
  gatheringTools.show(tree.kind);player.current=null;play(player,motion);audio.play('chopSwing',encounter.player);
}

function updateGame(dt: number): void {
  const isPaused = paused();
  let movement = input.movement();
  const block=holdingShield();
  if(encounter.pending?.kind==='ability' && encounter.pending.ability==='shield-basic' && !block)encounter.pending=null;
  if(gatheringTarget && (block || Math.hypot(movement.x,movement.z)>0 || encounter.player.hp<=0 || !gatheringSafe()))cancelChop();
  if(Math.hypot(movement.x,movement.z)>0 || block)worldApproach=null;
  let approachAim: AimPoint | undefined;
  if (!isPaused && pickupRoute && adventure.pickupTarget) {
    const point: Point = [encounter.player.x, encounter.player.z], drop = adventure.session().drops.find(d => d.id === pickupRoute!.id);
    if (Math.hypot(movement.x, movement.z) > 0 || block || !drop || encounter.player.hp <= 0) { adventure.cancelPickup(); pickupRoute = null; }
    else if (near(point, drop.position, 1.5) && adventure.canCollectGround(drop)) { if (drop.age >= .55) { adventure.pickup(drop.id, point, true); adventure.cancelPickup(); pickupRoute = null; } }
    else {
      pickupRoute.elapsed += dt;
      if (pickupRoute.elapsed >= .3) {
        const refreshed = movementWorld?.pickupPath(encounter.player, drop.position, drop.height);
        if (refreshed) pickupRoute.points = refreshed;
        else if (movementWorld?.navigationReady) { adventure.message('Can’t reach item'); adventure.cancelPickup(); pickupRoute = null; }
        if (pickupRoute) pickupRoute.elapsed = 0;
      }
      if (pickupRoute) {
        while (pickupRoute.points.length && near(point, pickupRoute.points[0], .2)) pickupRoute.points.shift();
        const next = pickupRoute.points[0];
        if (next) { movement = { x: next[0] - point[0], z: next[1] - point[1] }; approachAim = { x: next[0], z: next[1] }; }
        pickupRoute.stalled = !encounter.player.lock && !encounter.dodgeRemaining && near(point, pickupRoute.last, .01) ? pickupRoute.stalled + dt : 0; pickupRoute.last = point;
        if (pickupRoute.stalled > 1 && !encounter.player.lock && !encounter.dodgeRemaining && movementWorld?.navigationReady) { adventure.message('Can’t reach item'); adventure.cancelPickup(); pickupRoute = null; }
      }
    }
  }
  if(!isPaused && worldApproach){
    const point:Point=[encounter.player.x,encounter.player.z],target=worldTargets().find(target=>target.key===worldApproach!.key);
    if(!target || encounter.player.hp<=0){worldApproach=null;}
    else if(interactionError(target)){adventure.message(interactionError(target));worldApproach=null;}
    else if(near(point,target.position,target.range) && movementWorld?.interactionVisible(encounter.player,target.position,target.height,target.obstacleId)){
      if(!encounter.player.lock && !encounter.dodgeRemaining){worldApproach=null;interact(target);}
    }else{
      worldApproach.elapsed+=dt;
      if(worldApproach.elapsed>=.3){const path=movementWorld?.interactionPath(encounter.player,target.position,target.height,target.range,target.obstacleId);if(path)worldApproach.points=path;else if(movementWorld?.navigationReady){adventure.message('Can’t reach object');worldApproach=null;}if(worldApproach)worldApproach.elapsed=0;}
      if(worldApproach){while(worldApproach.points.length && near(point,worldApproach.points[0],.18))worldApproach.points.shift();const next=worldApproach.points[0];if(next){movement={x:next[0]-point[0],z:next[1]-point[1]};approachAim={x:next[0],z:next[1]};}worldApproach.stalled=!encounter.player.lock && near(point,worldApproach.last,.01) ? worldApproach.stalled+dt : 0;worldApproach.last=point;if(worldApproach.stalled>1 && movementWorld?.navigationReady){adventure.message('Can’t reach object');worldApproach=null;}}
    }
  }
  const commands = { ...movement, block, paused: isPaused || paused(), aim: isPaused ? undefined : approachAim ?? resolveAim() };
  if (encounter.player.hp > 0 && !commands.paused && Math.hypot(movement.x, movement.z) > 0) hud.dismissResult();
  if (encounter.phase === 'won' || currentArea.kind === 'safe') {
    present(stepExploration(encounter, dt, commands, movementWorld, timings()));
  } else present(stepEncounter(encounter, dt, commands, timings(), movementWorld));
  if (!paused() && encounter.phase !== 'loading' && adventure.currentArea) adventure.step(encounter, currentArea, dt);
  if (!isPaused && encounter.player.hp>0) {
    for (const change of harvesting.advance(dt,[{areaId:currentArea.id,position:[encounter.player.x,encounter.player.z]}, ...enemyIds.filter(id=>currentArea.kind!=='safe' && encounter.enemies[id].hp>0).map(id=>({areaId:currentArea.id,position:[encounter.enemies[id].x,encounter.enemies[id].z] as Point}))])) {
      if (change.areaId===currentArea.id) { active?.setResourceState(change.id,false); movementWorld?.setTreeFelled(change.id,false); }
    }
    if (chopping) {
      chopping.time+=dt;
      const node=chopping.tree, motion=node.kind==='tree' ? 'chop' : 'mine';
      if(!chopping.contacted && chopping.time >= (motion==='chop' ? player.chopContact : player.mineContact)) {
        chopping.contacted=true;
        if(!resourceVisible(node)){cancelChop();return;}
        const reward=harvesting.contact(currentArea.id,node.id,[encounter.player.x,encounter.player.z],adventure.character.xp[resourceSkill(node.kind)]);
        if(reward) {
          audio.play(node.kind==='tree' ? 'chopHit' : 'equipmentLand',{x:node.position[0],z:node.position[2]});
          adventure.grantHarvest(reward.item,reward.quantity,reward.skill,reward.xpPerUnit,[node.position[0],node.position[2]]);
          active?.treeHit(node.id);
          if(reward.felled){active?.setResourceState(node.id,true);movementWorld?.setTreeFelled(node.id,true);if(node.kind==='tree'){audio.play('woodCrack',{x:node.position[0],z:node.position[2]});audio.play('treeFall',{x:node.position[0],z:node.position[2]});}}
        } else cancelChop();
      }
      if(chopping && chopping.time>=duration(player,motion)) {
        chopping=null;encounter.player.lock=0;
        if(harvesting.state(currentArea.id,node.id)?.felled)cancelChop();else beginChop(node);
      }
    }
  }
  projectileVisuals.sync(encounter.projectiles);
  casterVisuals.sync(encounter, caster.contacts[0] ?? .8, isPaused ? 0 : dt, currentArea.kind !== 'safe');
  if(!paused() && input.pointer()){resolveAim();hoveredInteraction=pickInteraction();}else hoveredInteraction=null;
  interactionHighlight.select(hoveredInteraction && !interactionError(hoveredInteraction) ? hoveredInteraction.object : null);interactionHighlight.update((camera.top-camera.bottom)/camera.zoom/Math.max(1,mount.clientHeight)*1.5);
  renderer.domElement.style.cursor=hoveredInteraction ? interactionError(hoveredInteraction) ? 'not-allowed' : 'pointer' : '';
  syncAdventure();
  hud.update(encounter, []);
  if (!paused() && encounter.phase !== 'lost' && encounter.phase !== 'loading' && adventure.castRemaining === 0) {
    const gate = travel.check(currentArea.gates, [encounter.player.x, encounter.player.z]);
    if (gate) void changeArea({ kind: 'travel', area: gate.destination.area, arrivalId: gate.destination.gate, transition: true });
  }
}
function resize(): void {
  cameraOwner.resize(mount.clientWidth, mount.clientHeight);
  renderer.setSize(mount.clientWidth, mount.clientHeight); graphics?.resize(); invalidateFrame();
}
window.addEventListener('resize', resize);
resize();
const framePacer = new FramePacer();
const initialFpsLimit = readSettings().fpsLimit;
function tick(now: number): void {
  frameRequest = 0;
  if (hidden()) { lastTick = undefined; return; }
  if (!framePacer.shouldRender(now, options?.settings.fpsLimit ?? initialFpsLimit)) { requestFrame(); return; }
  const isPaused = paused();
  if (isPaused && !previouslyPaused) { clearInput(); settleFrames = 64; }
  const dt = !isPaused && !previouslyPaused && lastTick !== undefined ? Math.min((now - lastTick) / 1000, .05) : 0;
  lastTick = now; previouslyPaused = isPaused;
  if (isPaused && settleFrames === 0 && !frames.length) { lastTick = undefined; return; }
  audio.update(encounter.player,paused() || encounter.phase==='loading');
  updateGame(dt);
  if (!inspecting && !paused() && !fixedCamera && encounter.player.hp > 0) {
    cameraOwner.follow(player.root.position, dt);
  } else cameraOwner.suspendFollow();
  for (const id of ['player', ...enemyIds] as ActorId[]) {
    const actor = actors[id];
    const state = id === 'player' ? encounter.player : encounter.enemies[id];
    updateActor(actor, state, dt, paused(), id==='player' && encounter.blocking);
    gameplayAudio.locomotion(id,state,actor.gait,actor.current,paused());
  }
  if (!paused()) { active?.portals.forEach(p => p.update(dt)); adventureVisuals?.update(dt); }
  const portalPoint = adventure.portalPosition(currentArea);
  const flames = currentArea.effects.fires.map(fire=>({id:fire.id,position:{x:fire.position[0],z:fire.position[1]},camp:fire.role==='campfire'})).sort((a,b)=>Math.hypot(a.position.x-encounter.player.x,a.position.z-encounter.player.z)-Math.hypot(b.position.x-encounter.player.x,b.position.z-encounter.player.z)).slice(0,6);
  gameplayAudio.ambience(flames,portalPoint ? {x:portalPoint[0],z:portalPoint[1]} : null,lanternEnabled && encounter.player.hp>0 ? encounter.player : null);
  controls.update();
  camera.updateMatrixWorld();
  aimCamera.copy(camera);
  const pointer = input.pointer();
  if (!paused() && pointer) { resolveAim(pointer); lootLabels.hovered = adventureVisuals?.pick(aimRay) ?? null; }
  lootLabels.sync(adventure.session(currentArea.id).drops, camera, [encounter.player.x, encounter.player.z], paused() || encounter.player.hp <= 0);
  hud.positionEnemy(encounter, camera, mount, paused() ? 0 : dt, inspecting || transitioning);
  active?.update(camera, paused() ? 0 : dt);
  renderer.info.reset();
  const rendered = graphics?.render(dt, paused()) ?? false;
  if (rendered) { renderedFrames++; if (isPaused) settleFrames = Math.max(0, settleFrames - 1); else settleFrames = 64; }
  if (rendered && active && !transitioning) renderedRevision = revision;
  if (rendered) for (const frame of [...frames]) if (--frame.left <= 0) { frames.splice(frames.indexOf(frame), 1); frame.resolve(); }
  if (!paused() || settleFrames || frames.length) requestFrame();
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
  window.addEventListener('pagehide', () => { ticking = false; cancelAnimationFrame(frameRequest); menusChanged.disconnect(); adventure.save(); gatheringTools.dispose(); audio.dispose(); graphics?.dispose(); personalLantern?.dispose(); playerEquipment.dispose(); interactionHighlight.dispose(); enemyEquipment.dispose(); casterEquipment.dispose(); projectileVisuals.dispose(); casterVisuals.dispose(); adventureVisuals?.dispose(); lootLabels.dispose(); active?.dispose(); movementWorld?.dispose(); for (const actor of Object.values(actors)) { actor.mixer?.stopAllAction(); actor.mixer?.uncacheRoot(actor.mixer.getRoot()); disposeSceneResources(actor.root); } renderer.dispose(); void disposeAreaCache(); }, { once: true });
  resize();
  await graphics.initialize();
  ticking = true; requestFrame();
  await changeArea({ kind: 'travel', area: currentArea.id });
  if (import.meta.env.DEV && renderQuery.get('author') === 'levels') {
    const { attachAuthoring } = await import('../levels/authoring');
    attachAuthoring({ invalidate: invalidateFrame, scene, camera, renderer, definitions: () => definitions, area: () => currentArea, encounter,
      exportLighting: () => graphics!.exportLighting(), lighting: () => graphics!.lightingDiagnostics(),
      changeArea: id => changeArea({ kind: 'travel', area: id }), restart: reset, inspect: () => { inspect(); return inspecting; }, waitFrames, setFrozen: freezePreview, setView: previewView,
      appearance: () => ({ lantern: lanternEnabled, surfaces: surfaceMode }),
      setAppearance: changeAppearance,
      diagnostics: () => ({ audio:audio.diagnostics(), lantern: personalLantern?.diagnostics(), surfaces: surfaceMode, area: currentArea.id, revision, renderedRevision, ready: !!active && renderedRevision === revision && !transitioning && !areaErrors.length && !mount.dataset.renderError, errors: [...areaErrors, ...(mount.dataset.renderError ? [mount.dataset.renderError] : [])], missing: [...(active?.missing ?? []), ...(characterMissing ? ['character'] : [])], contentHash, settings: options!.settings, backend: 'webgpu', updateMs, renderedFrames, phase: encounter.phase, equipment: playerEquipment.diagnostics(), controls:{bindings:preferences.value,actionBar:adventure.character.actionBar},interaction:{hover:hoveredInteraction?.key ?? null,approach:worldApproach?.key ?? null}, harvest: {chopping: chopping?.tree.id ?? null, trees: active?.resources.map(tree=>({...tree,...harvesting.state(currentArea.id,tree.id)}))}, adventure: { character: adventure.character, portal: adventure.portal, castRemaining: adventure.castRemaining, drops: adventure.session(currentArea.id).drops, chests: adventure.session(currentArea.id).chests, fires: (currentArea.campfires ?? []).map(fire => ({ id: fire.id, safe: adventure.fireSafe(currentArea, fire, encounter) })) }, encounter: { enemies: structuredClone(encounter.enemies), enemyEquipment: enemyEquipment.diagnostics(), casterEquipment: casterEquipment.diagnostics(), player: { ...encounter.player }, playerMana: encounter.playerMana, dodgeRemaining: encounter.dodgeRemaining, dodgeCooldown: encounter.dodgeCooldown, blocking: encounter.blocking, projectiles: encounter.projectiles, pending: encounter.pending, animations: { player: player.current, enemy: enemy.current, caster: caster.current }, navigationReady: movementWorld?.navigationReady ?? false, navigationMs: movementWorld?.generationMs ?? 0 }, camera: { position: camera.position.toArray(), target: controls.target.toArray(), zoom: camera.zoom, viewport: [mount.clientWidth, mount.clientHeight] }, objects: active?.root.children.length ?? 0, resources: { memory: { ...renderer.info.memory }, drawCalls: renderer.info.render.drawCalls, triangles: renderer.info.render.triangles }, graphics: renderer.domElement.dataset.graphics ? JSON.parse(renderer.domElement.dataset.graphics) : null }),
    });
  }

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
async function changeArea(change: AreaChange): Promise<boolean> {
  const id = change.kind === 'travel' ? change.area : currentArea.id;
  const { arrivalId, transition = false, recover = false } = change.kind === 'travel' ? change : {};
  const canCommit=change.canCommit;
  const appearance = change.kind === 'refresh' ? change.appearance : undefined;
  const spawn = change.spawn;
  const started = performance.now(), request = ++generation, next = definitions[id];
  const errors = validateDefinitions(definitions);
  if (!next || errors.length) { transitioning = false; fade.style.opacity = '0'; areaErrors = errors.length ? errors : [`Unknown area: ${id}`]; return false; }
  const nextSurfaces = appearance?.surfaces ?? surfaceMode;
  const resolved = { ...next, lighting: resolveLightingFor(next) };
  const savedView = frozen && active?.area.id === id ? { target: controls.target.clone(), zoom: camera.zoom } : null;
  transitioning = true; clearInput();
  try {
    if (transition) { fade.style.opacity = '1'; await new Promise(resolve => setTimeout(resolve, 160)); }
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ ...resolved, surfaces: nextSurfaces })));
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const candidate = await buildArea(next, nextSurfaces,appearance?.shelterRestored ?? adventure.character.shelterRestored);
    let candidateMovement: MovementWorld | undefined;
    let preparedLighting: Awaited<ReturnType<Graphics['prepareLighting']>>;
    try {
      candidateMovement = await MovementWorld.create(next.layout.boundary, traversalWithTrees(next));
      if (renderQuery.get('portal') === 'off') candidate.portals.forEach(p => p.root.visible = false);
      preparedLighting = await graphics!.prepareLighting(resolved, candidate.root);
    } catch (error) { candidateMovement?.dispose(); candidate.dispose(); throw error; }
    if (request !== generation || canCommit && !canCommit()) { graphics!.discardLighting(preparedLighting); candidate.dispose(); candidateMovement.dispose(); return false; }
    if(change.kind==='refresh')change.onCommit?.();
    graphics!.effects.clearArea(); adventureVisuals?.dispose(); active?.dispose(); movementWorld?.dispose(); movementWorld = candidateMovement; active = candidate; currentArea = next; committedLighting = resolved.lighting; lanternEnabled = appearance?.lantern ?? lanternEnabled; personalLantern?.setEnabled(lanternEnabled); surfaceMode = nextSurfaces; graphics!.commitLighting(preparedLighting); scene.add(candidate.root); candidate.activate(graphics!.effects);
    const arrival = next.gates.find(g => g.id === arrivalId);
    harvesting.register(next.id,candidate.resources);
    for (const tree of candidate.resources) { const felled=harvesting.state(next.id,tree.id)?.felled ?? false; candidate.setResourceState(tree.id,felled); candidateMovement.setTreeFelled(tree.id,felled); }
    adventure.enter(encounter, next, spawn ?? arrival?.arrival ?? next.layout.player, recover);
    adventureVisuals = new AdventureVisuals(candidate.root);
    adventure.placeGround = (origin, index) => movementWorld!.lootGround(origin, index, encounter.player);
    adventure.canCollectGround = drop => {
      const path = movementWorld!.pickupPath(encounter.player, drop.position, drop.height); if (!path) return false;
      let length = 0, previous: Point = [encounter.player.x, encounter.player.z];
      for (const point of [...path, drop.position]) { length += Math.hypot(point[0] - previous[0], point[1] - previous[1]); previous = point; }
      return length <= 1.65;
    };
    if (arrival) travel.arrive(arrival.id);
    inspecting = false; resetPresentation();
    syncAdventure(); cameraOwner.inspect(false, { x: 0, z: 0 });
    cameraOwner.resetFollow(player.root.position);
    graphics!.apply(options!.settings); graphics!.resetSceneTime(); revision++; contentHash = hash; areaErrors = [];
    hud.environmentLoaded(candidate.missing.length ? 0 : 3);
    if (characterMissing) hud.characterUnavailable(); else hud.setAssetStatus(candidate.missing.length ? `Missing art: ${candidate.missing.join(', ')}.` : '');
    if (frozen) freezePreview(true);
    if (savedView) { controls.target.copy(savedView.target); camera.position.copy(controls.target).add(new THREE.Vector3(...cameraOffset)); camera.zoom = savedView.zoom; camera.updateProjectionMatrix(); controls.update(); }
    transitioning = false; audio.update(encounter.player,paused()); await waitFrames(2); updateMs = performance.now() - started;
    renderer.domElement.focus(); return true;
  } catch (error) { if (request === generation) { areaErrors = [error instanceof Error ? error.message : String(error)]; hud.setAssetStatus(`Unable to travel. ${areaErrors[0]}`); } return false; }
  finally { if (request === generation) { transitioning = false; fade.style.opacity = '0'; clearInput(); } }
}
if (import.meta.hot) import.meta.hot.accept('../levels/registry', async module => {
  if (!module) return;
  const errors = validateDefinitions(module.areas);
  if (errors.length) { generation++; transitioning = false; fade.style.opacity = '0'; areaErrors = errors; return; }
  definitions = module.areas; await changeArea({ kind: 'refresh' });
});

if (import.meta.hot) import.meta.hot.on('vite:error', payload => { generation++; transitioning = false; fade.style.opacity = '0'; areaErrors = [payload.err.message]; });

if (import.meta.hot) import.meta.hot.accept('../levels/lighting', async module => {
  if (!module) return;
  resolveLightingFor = module.resolveAreaLighting;
  await changeArea({ kind: 'refresh' });
});

if (import.meta.hot) import.meta.hot.accept('../levels/validation', async module => {
  if (!module) return;
  validateDefinitions = module.validateAreas;
  await changeArea({ kind: 'refresh' });
});

if (import.meta.hot) window.addEventListener('lightingpresetchanged', () => {
  void changeArea({ kind: 'refresh' });
});
