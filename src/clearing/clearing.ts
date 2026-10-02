import { resolveAreaLighting as lightingFor } from '../levels/lighting';
import type { SurfaceMode } from '../assets/environment-surfaces';
import type { AreaDefinition, AreaLighting } from '../levels/types';
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
import { createEncounter, resetEncounter, attack, dodge, stepExploration, stepEncounter, type EncounterEvent, type ActorId, type Timings, type AimPoint, enemyIds } from '../gameplay/encounter';
import { readSettings } from '../rendering/graphics-settings';
import { FramePacer } from '../rendering/frame-pacer';
import { createRenderer } from '../rendering/renderer';
import { PlayerLantern } from '../rendering/player-lantern';
import type { Graphics } from '../rendering/graphics';
import type { Options } from '../ui/options';
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
import { normalizeLoadout, type Loadout } from '../gameplay/equipment';
import { Equipment, type PreparedEquipment } from '../rendering/equipment';
import { ProjectileVisuals, CasterVisuals } from '../rendering/projectiles';
import { Harvesting } from '../gameplay/harvesting';
import { traversalWithTrees, type TreeDefinition } from '../levels/trees';
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
const waitFrames = (count = 16) => new Promise<void>(resolve => frames.push({ left: count, resolve }));
const renderer = await createRenderer(mount);
renderer.domElement.setAttribute('aria-label', 'Lantern. WASD or arrows to move, Mouse to aim, Left click to attack, Shift to dodge, E to interact, B for inventory, Escape for options.');
renderer.info.autoReset = false;
let renderedFrames = 0;
const cameraOwner = createCamera(renderer.domElement);
const { camera, controls } = cameraOwner;
const encounter = createEncounter('loading', currentArea.layout);
const player = makeActor(scene, encounter.player);
const enemy = makeActor(scene, encounter.enemies.enemy);
const caster = makeActor(scene, encounter.enemies.caster);
const actors: Record<ActorId, Actor> = { player, enemy, caster };
const playerEquipment = new Equipment(player.root), enemyEquipment = new Equipment(enemy.root,'enemy'), casterEquipment = new Equipment(caster.root,'enemy');
const projectileVisuals = new ProjectileVisuals(scene);
const casterVisuals = new CasterVisuals(scene, caster.root);
const harvesting = new Harvesting();
let equipmentLoading = false;
let chopping: { tree: TreeDefinition; time: number; contacted: boolean } | null = null;
function cancelChop(releaseLock = true): void {
  if (!chopping) return;
  chopping = null; if (releaseLock) encounter.player.lock = 0;
  if (player.current === 'chop') play(player,'idle');
}
function clearInput(): void { adventure.cancelPickup(); pickupRoute = null; input.clear(); encounter.pending = null; encounter.blocking = false; cancelChop(); }
function applyLoadoutState(): void { encounter.weapon = adventure.character.loadout.main; encounter.shield = !!adventure.character.loadout.off; }
async function changeEquipment(requested: Loadout, save = false, items?: InventoryItem[]): Promise<void> {
  if (equipmentLoading || !player.mixer) throw new Error('Character equipment is still loading.');
  const loadout = normalizeLoadout(requested);
  if ([loadout.main,loadout.off].some(item=>item && !adventure.character.equipment.includes(item))) throw new Error('That item is not in your Inventory.');
  equipmentLoading = true; clearInput();
  let candidate: PreparedEquipment | undefined;
  try {
    if (loadout.main === 'bow') await projectileVisuals.prepareArrow();
    candidate = await playerEquipment.stage(loadout);
    const prepared = await loadEquipmentMotions(loader,'player',loadout);
    installMotions(player,prepared); playerEquipment.commit(candidate); candidate=undefined;
    if (save && items) adventure.replaceItems(items);
    applyLoadoutState(); encounter.player.lock=0; encounter.player.attackTime=-1; encounter.attackCooldown=0;
    play(player,'idle'); menus.updateCharacter(adventure.character);
  } catch(error) { if (candidate) playerEquipment.discard(candidate); throw error; }
  finally { equipmentLoading=false; }
}
let inspecting = false;
const input = createInput(renderer.domElement, startAttack, startDodge, interact, openInventory, toggleOptions, () => { encounter.pending=null; encounter.blocking=false; cancelChop(); });
async function changeInventory(items: InventoryItem[]): Promise<void> {
  if (!validItems(items)) throw new Error('Item does not fit.');
  const loadout = itemLoadout(items);
  if (JSON.stringify(loadout) !== JSON.stringify(adventure.character.loadout)) await changeEquipment(loadout, true, items);
  else { adventure.replaceItems(items); menus.updateCharacter(adventure.character); }
}
const menus = new AdventureMenus(clearInput, () => renderer.domElement.focus(), () => { if (!paused()) adventure.beginCast(encounter.player.hp > 0); }, {
  change: changeInventory, newId: adventure.newId,
  recover: id => { adventure.recoverItem(id); menus.updateCharacter(adventure.character); },
  drop: async (id, quantity) => {
    const entry = adventure.character.items.find(i => i.id === id); if (!entry) throw new Error('Item is no longer available.');
    if (entry.slot === 'bag' || entry.slot === 'overflow') {
      adventure.dropItem(id, quantity, [encounter.player.x, encounter.player.z]);
      menus.updateCharacter(adventure.character); syncAdventure(); return;
    }
    const next = removeQuantity(adventure.character.items, id, quantity);
    await changeInventory(next);
    adventure.spawnDrop(entry.item, quantity, [encounter.player.x, encounter.player.z], { blocked: lootDefinitions[entry.item].stackable, instanceId: lootDefinitions[entry.item].stackable ? undefined : entry.id });
    syncAdventure();
  },
});
let pickupRoute: { id: string; points: Point[]; elapsed: number; stalled: number; last: Point } | null = null;
const lootLabels = new LootLabels(mount, selectLoot);
function selectLoot(id: string): void {
  if (paused() || encounter.player.hp <= 0) return;
  const drop = adventure.session().drops.find(d => d.id === id); if (!drop) return;
  cancelChop(); encounter.pending = null; adventure.cancelPickup(); pickupRoute = null;
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
    if (event.type === 'axeXp') adventure.grantAxeCombatXp();
    if (event.type === 'hit' && event.actor === 'player') cancelChop(false);
    if (event.type === 'animation' || event.type === 'hit') {
      const actor = actors[event.actor];
      if (event.type === 'animation') play(actor, event.motion);
      else graphics?.effects.burst('hit', actor.root.position);
    }
  }
  hud.update(encounter, events);
}
function resetPresentation(): void {
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
function toggleOptions(): void {
  if (options?.paused) options.close();
  else if (menus.paused) menus.close();
  else options?.open();
}
function openInventory(): void {
  if (options?.paused) options.close();
  if (menus.paused) { menus.close(); return; }
  if (!paused() && encounter.player.hp > 0) menus.openInventory();
}
function interaction(): { type: 'portal'; position: Point } | { type: 'fire'; position: Point; fire: NonNullable<AreaDefinition['campfires']>[number] } | { type: 'chest'; position: Point; chest: NonNullable<AreaDefinition['chests']>[number] } | { type: 'tree'; position: Point; tree: TreeDefinition } | null {
  const point: Point = [encounter.player.x, encounter.player.z], portal = adventure.portalPosition(currentArea);
  if (portal && near(point, portal, 1.8)) return { type: 'portal', position: portal };
  const chest = currentArea.chests?.find(c => near(point, c.position, 1.8) && chestUnlocked(encounter,c) && (!adventure.chest(currentArea, c).opened || adventure.chest(currentArea, c).remaining > 0));
  if (chest) return { type: 'chest', position: chest.position, chest };
  const fire = currentArea.campfires?.find(f => near(point, f.position, 3) && adventure.fireSafe(currentArea, f, encounter));
  if (fire) return { type: 'fire', position: fire.position, fire };
  const tree = harvesting.nearest(currentArea.id,point);
  return tree ? { type:'tree', position:[tree.position[0],tree.position[2]], tree } : null;
}
function interact(): void {
  if (paused() || encounter.player.hp <= 0 || adventure.castRemaining > 0) return;
  const target = interaction();
  if (target?.type === 'fire') {
    const sourceArea = currentArea, sourceFire = target.fire;
    menus.openTravel(adventure.destinations(definitions).map(({ area, fire, available }) => ({ name: fire.name, available,
      travel: () => {
        const allowed = () => adventure.canTravel(encounter, sourceArea, sourceFire, area, fire);
        if (allowed()) void changeArea({ kind: 'travel', area: area.id, transition: true, spawn: fire.arrival, canCommit: allowed });
      },
    })));
  } else if (target?.type === 'tree') beginChop(target.tree);
  else if (target?.type === 'chest') adventure.openChest(encounter, currentArea, target.chest);
  else if (target?.type === 'portal' && adventure.portal) {
    const link = adventure.portal;
    if (currentArea.id === homeArea) void changeArea({ kind: 'travel', area: link.area, transition: true, spawn: link.departure }).then(ok => { if (ok && adventure.portal === link) { adventure.portal = null; syncAdventure(); } });
    else void changeArea({ kind: 'travel', area: homeArea, transition: true, spawn: definitions.homestead.portalArrival });
  }
}
function syncAdventure(): void {
  adventureVisuals?.sync(adventure.session(currentArea.id).drops, adventure.portalPosition(currentArea), lootLabels.hovered);
  for (const chest of currentArea.chests ?? []) active?.setChestOpened(chest.id, adventure.chest(currentArea, chest).opened);
  const target = interaction();
  const prompt = paused() || encounter.player.hp <= 0 ? '' : adventure.notice || (target?.type === 'portal' ? (currentArea.id === homeArea ? 'E · Return to adventure' : 'E · Homestead') : target?.type === 'chest' ? 'E · Open chest' : target?.type === 'tree' ? (encounter.weapon === 'axe' ? 'Hold E · Chop' : 'Equip an Axe') : target ? 'E · Travel' : '');
  menus.updateCharacter(adventure.character);
  menus.update(adventure.character.scrolls, currentArea.id !== homeArea && encounter.player.hp > 0 && adventure.character.scrolls > 0 && adventure.castRemaining === 0, prompt, adventure.castRemaining);
  document.getElementById('save-status')!.textContent = adventure.saveError;
}
function paused(): boolean { return Boolean(characterMissing || options?.paused || menus.paused || equipmentLoading || inspecting || graphics?.preparingSettings || frozen || transitioning); }
function timings(): Timings {
  const timing = (actor: Actor) => ({ attack: duration(actor, 'attack'), hit: duration(actor, 'hit'), contacts: actor.contacts });
  return { player: timing(player), enemy: timing(enemy), caster: timing(caster) };
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
function startAttack(clientX: number, clientY: number): void {
  if (!paused()) {
    resolveAim({ x: clientX, y: clientY });
    const loot = adventureVisuals?.pick(aimRay); if (loot) { selectLoot(loot); return; }
    adventure.cancelPickup(); pickupRoute = null; cancelChop();
  }
  present(attack(encounter, timings().player, paused(), resolveAttackAim({ x: clientX, y: clientY })));
}
function startDodge(): void {
  if (!player.actions.dodge) return;
  if (!paused()) { adventure.cancelPickup(); pickupRoute = null; cancelChop(); }
  present(dodge(encounter, input.movement(), paused(), resolveAim()));
}
function beginChop(tree: TreeDefinition): void {
  if (paused() || chopping || encounter.weapon!=='axe' || encounter.player.lock>0 || encounter.attackCooldown>0 || encounter.dodgeRemaining>0 || !player.actions.chop || Math.hypot(tree.position[0]-encounter.player.x,tree.position[2]-encounter.player.z)>tree.radius+.9) return;
  encounter.pending=null; encounter.player.attackTime=-1;
  encounter.player.yaw=Math.atan2(tree.position[0]-encounter.player.x,tree.position[2]-encounter.player.z);
  encounter.player.lock=duration(player,'chop'); chopping={tree,time:0,contacted:false};
  // Restart each distinct chop, while locomotion and menu input remain interruptible.
  player.current=null; play(player,'chop');
}
function updateGame(dt: number): void {
  const isPaused = paused();
  if (isPaused) clearInput();
  let movement = input.movement();
  if (chopping && (!input.interacting() || input.blocking() || Math.hypot(movement.x,movement.z)>0 || encounter.player.hp<=0 || encounter.weapon!=='axe' || Math.hypot(encounter.player.x-chopping.tree.position[0],encounter.player.z-chopping.tree.position[2])>1.8+chopping.tree.radius)) cancelChop();
  let approachAim: AimPoint | undefined;
  if (!isPaused && pickupRoute && adventure.pickupTarget) {
    const point: Point = [encounter.player.x, encounter.player.z], drop = adventure.session().drops.find(d => d.id === pickupRoute!.id);
    if (Math.hypot(movement.x, movement.z) > 0 || input.interacting() || input.blocking() || !drop || encounter.player.hp <= 0) { adventure.cancelPickup(); pickupRoute = null; }
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
  if (!isPaused && input.interacting() && !chopping && !input.blocking() && encounter.weapon==='axe' && !encounter.player.lock && !encounter.dodgeRemaining && Math.hypot(movement.x,movement.z)===0) {
    const target=interaction();
    if (target?.type==='tree') {
      const dx=target.tree.position[0]-encounter.player.x,dz=target.tree.position[2]-encounter.player.z;
      if (Math.hypot(dx,dz)>target.tree.radius+.9) { movement={x:dx,z:dz}; approachAim={x:target.tree.position[0],z:target.tree.position[2]}; }
    }
  }
  const commands = { ...movement, block: input.blocking(), paused: isPaused, aim: isPaused ? undefined : approachAim ?? resolveAim() };
  if (encounter.player.hp > 0 && !commands.paused && Math.hypot(movement.x, movement.z) > 0) hud.dismissResult();
  if (encounter.phase === 'won' || currentArea.kind === 'safe') {
    present(stepExploration(encounter, dt, commands, movementWorld, timings()));
  } else present(stepEncounter(encounter, dt, commands, timings(), movementWorld));
  if (!paused() && encounter.phase !== 'loading' && adventure.currentArea) adventure.step(encounter, currentArea, dt);
  if (!isPaused && encounter.player.hp>0) {
    for (const change of harvesting.advance(dt,[{areaId:currentArea.id,position:[encounter.player.x,encounter.player.z]}, ...enemyIds.filter(id=>currentArea.kind!=='safe' && encounter.enemies[id].hp>0).map(id=>({areaId:currentArea.id,position:[encounter.enemies[id].x,encounter.enemies[id].z] as Point}))])) {
      if (change.areaId===currentArea.id) { active?.setTreeState(change.id,false); movementWorld?.setTreeFelled(change.id,false); }
    }
    if (input.interacting() && !chopping && !input.blocking() && Math.hypot(movement.x,movement.z)===0 && adventure.castRemaining===0) {
      const target=interaction(); if (target?.type==='tree') beginChop(target.tree);
    }
    if (chopping) {
      chopping.time+=dt;
      if (!chopping.contacted && chopping.time>=player.chopContact) {
        chopping.contacted=true;
        const reward=harvesting.contact(currentArea.id,chopping.tree.id,[encounter.player.x,encounter.player.z]);
        if (reward) { adventure.grantHarvest(reward.wood,reward.xp,[chopping.tree.position[0],chopping.tree.position[2]]); active?.treeHit(chopping.tree.id); if (reward.felled) { active?.setTreeState(chopping.tree.id,true); movementWorld?.setTreeFelled(chopping.tree.id,true); } }
        else cancelChop();
      }
      if (chopping && chopping.time>=duration(player,'chop')) cancelChop();
    }
  }
  projectileVisuals.sync(encounter.projectiles);
  casterVisuals.sync(encounter, caster.contacts[0] ?? .8, isPaused ? 0 : dt, currentArea.kind !== 'safe');
  syncAdventure();
  hud.update(encounter, []);
  if (!paused() && encounter.phase !== 'lost' && encounter.phase !== 'loading' && adventure.castRemaining === 0) {
    const gate = travel.check(currentArea.gates, [encounter.player.x, encounter.player.z]);
    if (gate) void changeArea({ kind: 'travel', area: gate.destination.area, arrivalId: gate.destination.gate, transition: true });
  }
}
function resize(): void {
  cameraOwner.resize(mount.clientWidth, mount.clientHeight);
  renderer.setSize(mount.clientWidth, mount.clientHeight); graphics?.resize();
}
window.addEventListener('resize', resize);
resize();
const clock = new THREE.Timer();
const framePacer = new FramePacer();
const initialFpsLimit = readSettings().fpsLimit;
function tick(now: number): void {
  requestAnimationFrame(tick);
  if (!framePacer.shouldRender(now, options?.settings.fpsLimit ?? initialFpsLimit)) return;
  clock.update(now);
  const dt = Math.min(clock.getDelta(), 0.05);
  updateGame(dt);
  if (!inspecting && !paused() && !fixedCamera && encounter.player.hp > 0) {
    cameraOwner.follow(player.root.position, dt);
  } else cameraOwner.suspendFollow();
  for (const id of ['player', ...enemyIds] as ActorId[]) {
    const actor = actors[id];
    const state = id === 'player' ? encounter.player : encounter.enemies[id];
    updateActor(actor, state, dt, paused(), id==='player' && encounter.blocking);
  }
  if (!paused()) { active?.portals.forEach(p => p.update(dt)); adventureVisuals?.update(dt); }
  controls.update();
  camera.updateMatrixWorld();
  aimCamera.copy(camera);
  const pointer = input.pointer();
  if (!paused() && pointer) { resolveAim(pointer); lootLabels.hovered = adventureVisuals?.pick(aimRay) ?? null; }
  lootLabels.sync(adventure.session(currentArea.id).drops, camera, [encounter.player.x, encounter.player.z], paused() || encounter.player.hp <= 0);
  hud.positionEnemy(encounter, camera, mount, paused() ? 0 : dt, inspecting || transitioning);
  active?.update(camera, paused() ? 0 : dt);
  renderer.info.reset();
  if (graphics) graphics.render(dt, paused());
  renderedFrames++;
  if (active && !transitioning) renderedRevision = revision;
  for (const frame of [...frames]) if (--frame.left <= 0) { frames.splice(frames.indexOf(frame), 1); frame.resolve(); }
}
try {
  const [paladin, goblin] = await Promise.all([loader.loadAsync(characters.player.model), loader.loadAsync(characters.enemy.model)]);
  attachCharacter(player, paladin.scene, paladin.animations, characters.player.height);
  attachCharacter(enemy, goblin.scene, goblin.animations, characters.enemy.height);
  attachCharacter(caster, goblin.scene, goblin.animations, characters.enemy.height);
  renderer.domElement.dataset.characters = JSON.stringify({ player: characters.player.name, enemy: characters.enemy.name });
  await changeEquipment(adventure.character.loadout, false);
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
  const [{ Graphics }, { CoreEffects }, { Options }] = await Promise.all([
    import('../rendering/graphics'), import('../rendering/effects'), import('../ui/options'),
  ]);
  personalLantern = new PlayerLantern(player.root, lanternEnabled); await personalLantern.initialize();
  const effects = new CoreEffects(); scene.add(effects.root);
  const lighting = { get definition() { return committedLighting; }, get fires() { return active?.fires ?? []; }, get shadow() { return active?.shadow ?? null; } };
  options = new Options({
    apply: settings => graphics?.apply(settings), flushSettings: () => graphics?.flushSettings(),
    resetMeasurements: () => graphics?.resetMeasurements(), clearInput,
    focus: () => renderer.domElement.focus(),
  });
  graphics = new Graphics({ scene, camera, renderer, controls, sun, ambient, mount, lighting }, options.settings, effects);
  window.addEventListener('pagehide', () => { graphics?.dispose(); personalLantern?.dispose(); playerEquipment.dispose(); enemyEquipment.dispose(); casterEquipment.dispose(); projectileVisuals.dispose(); casterVisuals.dispose(); adventureVisuals?.dispose(); lootLabels.dispose(); active?.dispose(); movementWorld?.dispose(); renderer.dispose(); void disposeAreaCache(); }, { once: true });
  resize();
  await graphics.initialize();
  requestAnimationFrame(tick);
  await changeArea({ kind: 'travel', area: currentArea.id });
  if (import.meta.env.DEV && renderQuery.get('author') === 'levels') {
    const { attachAuthoring } = await import('../levels/authoring');
    attachAuthoring({ scene, camera, renderer, definitions: () => definitions, area: () => currentArea, encounter,
      exportLighting: () => graphics!.exportLighting(), lighting: () => graphics!.lightingDiagnostics(),
      changeArea: id => changeArea({ kind: 'travel', area: id }), restart: reset, inspect: () => { inspect(); return inspecting; }, waitFrames, setFrozen: freezePreview, setView: previewView,
      appearance: () => ({ lantern: lanternEnabled, surfaces: surfaceMode }),
      setAppearance: changeAppearance,
      diagnostics: () => ({ lantern: personalLantern?.diagnostics(), surfaces: surfaceMode, area: currentArea.id, revision, renderedRevision, ready: !!active && renderedRevision === revision && !transitioning && !areaErrors.length && !mount.dataset.renderError, errors: [...areaErrors, ...(mount.dataset.renderError ? [mount.dataset.renderError] : [])], missing: [...(active?.missing ?? []), ...(characterMissing ? ['character'] : [])], contentHash, settings: options!.settings, backend: 'webgpu', updateMs, renderedFrames, phase: encounter.phase, equipment: playerEquipment.diagnostics(), harvest: {chopping: chopping?.tree.id ?? null, trees: active?.trees.map(tree=>({...tree,...harvesting.state(currentArea.id,tree.id)}))}, adventure: { character: adventure.character, portal: adventure.portal, castRemaining: adventure.castRemaining, drops: adventure.session(currentArea.id).drops, chests: adventure.session(currentArea.id).chests, fires: (currentArea.campfires ?? []).map(fire => ({ id: fire.id, safe: adventure.fireSafe(currentArea, fire, encounter) })) }, encounter: { enemies: structuredClone(encounter.enemies), enemyEquipment: enemyEquipment.diagnostics(), casterEquipment: casterEquipment.diagnostics(), player: { ...encounter.player }, playerMana: encounter.playerMana, dodgeRemaining: encounter.dodgeRemaining, dodgeCooldown: encounter.dodgeCooldown, blocking: encounter.blocking, projectiles: encounter.projectiles, pending: encounter.pending, animations: { player: player.current, enemy: enemy.current, caster: caster.current }, navigationReady: movementWorld?.navigationReady ?? false, navigationMs: movementWorld?.generationMs ?? 0 }, camera: { position: camera.position.toArray(), target: controls.target.toArray(), zoom: camera.zoom, viewport: [mount.clientWidth, mount.clientHeight] }, objects: active?.root.children.length ?? 0, resources: { memory: { ...renderer.info.memory }, drawCalls: renderer.info.render.drawCalls, triangles: renderer.info.render.triangles }, graphics: renderer.domElement.dataset.graphics ? JSON.parse(renderer.domElement.dataset.graphics) : null }),
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
type AreaAppearance = { lantern?: boolean; surfaces?: SurfaceMode };
type AreaChange =
  | { kind: 'travel'; area: string; arrivalId?: string; transition?: boolean; spawn?: Spawn; recover?: boolean; canCommit?: () => boolean }
  | { kind: 'refresh'; spawn?: Spawn; appearance?: AreaAppearance };
async function changeArea(change: AreaChange): Promise<boolean> {
  const id = change.kind === 'travel' ? change.area : currentArea.id;
  const { arrivalId, transition = false, recover = false, canCommit } = change.kind === 'travel' ? change : {};
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
    const candidate = await buildArea(next, nextSurfaces);
    let candidateMovement: MovementWorld | undefined;
    let preparedLighting: Awaited<ReturnType<Graphics['prepareLighting']>>;
    try {
      candidateMovement = await MovementWorld.create(next.layout.boundary, traversalWithTrees(next));
      if (renderQuery.get('portal') === 'off') candidate.portals.forEach(p => p.root.visible = false);
      preparedLighting = await graphics!.prepareLighting(resolved, candidate.root);
    } catch (error) { candidateMovement?.dispose(); candidate.dispose(); throw error; }
    if (request !== generation || canCommit && !canCommit()) { graphics!.discardLighting(preparedLighting); candidate.dispose(); candidateMovement.dispose(); return false; }
    graphics!.effects.clearArea(); adventureVisuals?.dispose(); active?.dispose(); movementWorld?.dispose(); movementWorld = candidateMovement; active = candidate; currentArea = next; committedLighting = resolved.lighting; lanternEnabled = appearance?.lantern ?? lanternEnabled; personalLantern?.setEnabled(lanternEnabled); surfaceMode = nextSurfaces; graphics!.commitLighting(preparedLighting); scene.add(candidate.root); candidate.activate(graphics!.effects);
    const arrival = next.gates.find(g => g.id === arrivalId);
    harvesting.register(next.id,candidate.trees);
    for (const tree of candidate.trees) { const felled=harvesting.state(next.id,tree.id)?.felled ?? false; candidate.setTreeState(tree.id,felled); candidateMovement.setTreeFelled(tree.id,felled); }
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
    transitioning = false; await waitFrames(2); updateMs = performance.now() - started;
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
