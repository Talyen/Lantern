import * as THREE from 'three';
import { runtimeAssets } from '../../assets/runtime-assets';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { createRenderer } from '../../rendering/renderer';
import { resizeDisplay } from '../../rendering/display-resolution';
import { Graphics } from '../../rendering/graphics';
import { CoreEffects } from '../../rendering/effects';
import { cameraDistanceMultipliers } from '../../rendering/graphics-settings';
import { readSettings } from '../../rendering/graphics-settings';
import { createCamera } from '../../session/camera';
import { createWorld, buildArea, type AreaInstance } from '../../levels/builder';
import { resolveAreaLighting } from '../../levels/lighting';
import { areas } from '../../levels/registry';
import { Equipment } from '../../rendering/equipment';
import { PlayerLantern } from '../../rendering/player-lantern';
import { markOutline } from '../../rendering/outlines';
import { prepareStandardMaterials } from '../../rendering/surface-detail';
import { disposeSceneResources, disposeSceneInstances, isMesh, sceneTextures } from '../../assets/resource-ownership';
import { loadEquipmentMotions, releaseCombatMotions, type CombatMotions } from '../../animation/combat-animations';
import { GameAudio } from '../../audio/audio';
import characters from '../../../assets/playable-characters.json';
import { UltimateEffects, ultimateSequences, ultimateTargets, type UltimateKind } from './ultimate-effects';
import './ultimate-lab.css';

const authored = areas.clearing;
const camp = authored.layout.enemy;
if (!camp) throw new Error('Forest Clearing practice anchor is unavailable.');
type PreviewActor = { root: THREE.Group; model: THREE.Object3D; mixer: THREE.AnimationMixer; idle: THREE.AnimationAction; hit?: THREE.AnimationAction; actions: Map<UltimateKind, THREE.AnimationAction>; equipment: Equipment; lantern?: PlayerLantern; location: THREE.Vector3 };
const app = document.querySelector<HTMLElement>('#app')!;
document.title = 'Lantern — Ultimate study';
app.innerHTML = `<main class="ultimate-lab"><header><a href="/">← Lantern</a><h1>Ultimate study</h1><span class="ultimate-engine">Plume + TSLFX</span><label>Ability<select id="ultimate-kind"><option value="arrow-rain">Bow · Rain of Arrows</option><option value="executioner">Sword · Executioner’s Strike</option><option value="onslaught">Sword · Onslaught</option></select></label><label><input id="ultimate-shield" type="checkbox">Shield</label><button id="ultimate-replay" disabled>Replay</button><button id="ultimate-pause" disabled>Pause</button><label>Speed<select id="ultimate-speed"><option value="1">Normal</option><option value="0.5">½ speed</option><option value="0.25">¼ speed</option></select></label><label><input id="ultimate-loop" type="checkbox">Loop</label><label><input id="ultimate-effects" type="checkbox" checked>Effects</label><label><input id="ultimate-sound" type="checkbox" checked>Sound</label><button id="ultimate-view">Close view</button></header><section id="lab-canvas" aria-label="Woodland ability preview"><p id="ultimate-status" role="status">Preparing woodland…</p></section><footer><label>Sequence<input id="ultimate-time" type="range" min="0" max="4.8" step="0.01" value="0" disabled></label><output id="ultimate-clock">0.00 s</output></footer></main>`;
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const mount = element<HTMLElement>('lab-canvas');
const status = element<HTMLElement>('ultimate-status');
const select = element<HTMLSelectElement>('ultimate-kind');
const replay = element<HTMLButtonElement>('ultimate-replay');
const pause = element<HTMLButtonElement>('ultimate-pause');
const speed = element<HTMLSelectElement>('ultimate-speed');
const loop = element<HTMLInputElement>('ultimate-loop');
const shield=element<HTMLInputElement>('ultimate-shield');
const enabled = element<HTMLInputElement>('ultimate-effects');
const sound = element<HTMLInputElement>('ultimate-sound');
const timeline = element<HTMLInputElement>('ultimate-time');
const clock = element<HTMLOutputElement>('ultimate-clock');
let kind: UltimateKind = 'arrow-rain', seconds = 0, playing = true, disposed = false, changing = false, closeView = false;
let renderer: Awaited<ReturnType<typeof createRenderer>> | undefined;
let graphics: Graphics | undefined;
let cameraOwner: ReturnType<typeof createCamera> | undefined;
let area: AreaInstance | undefined;
let effects: UltimateEffects | undefined;
let player: PreviewActor | undefined;
const targets: PreviewActor[] = [];
const sources: THREE.Group[] = [];
const motionSources: CombatMotions[] = [];
const world = createWorld(), scene = world.scene;
const ambientEffects = new CoreEffects(); scene.add(ambientEffects.root);
const audio = new GameAudio();
const yaw = authored.layout.player.yaw;
const forward = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
const origin = new THREE.Vector3(camp.position[0], .04, camp.position[1]).add(new THREE.Vector3(0, 0, -2.5).applyQuaternion(forward));
const at = (point: THREE.Vector3) => point.clone().applyQuaternion(forward).add(origin);
let observer: ResizeObserver | undefined;
let frame = 0;
let invalidate = () => {};

function action(mixer: THREE.AnimationMixer, clip: THREE.AnimationClip): THREE.AnimationAction {
  const result = mixer.clipAction(clip); result.setLoop(THREE.LoopOnce, 1); result.clampWhenFinished = true; result.play(); result.paused = true; result.setEffectiveWeight(0); return result;
}
async function actor(source: THREE.Group, clips: THREE.AnimationClip[], location: THREE.Vector3, actorYaw: number, rig: 'player' | 'enemy'): Promise<PreviewActor> {
  const root = new THREE.Group(), model = clone(source);
  prepareStandardMaterials(model); markOutline(model, 'actor');
  model.traverse(object => { if (isMesh(object)) object.castShadow = object.receiveShadow = true; });
  root.add(model); root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model), size = bounds.getSize(new THREE.Vector3());
  const scale = characters[rig].height / size.y;
  model.scale.multiplyScalar(scale); root.updateMatrixWorld(true);
  const fitted = new THREE.Box3().setFromObject(model), center = fitted.getCenter(new THREE.Vector3()); model.position.sub(new THREE.Vector3(center.x, fitted.min.y, center.z));
  root.position.copy(location); root.rotation.y = actorYaw;
  const mixer = new THREE.AnimationMixer(model), idleClip = clips.find(c => c.name === 'idle');
  if (!idleClip) throw new Error('Compatible idle motion is missing.');
  const equipment = new Equipment(root, rig, runtimeAssets(renderer!).library), result: PreviewActor = { root, model, mixer, idle: action(mixer, idleClip), actions: new Map(), equipment, location: location.clone() };
  const hit = clips.find(c => c.name === 'hit'); if (hit) result.hit = action(mixer, hit);
  scene.add(root); return result;
}
async function initialize(): Promise<void> {
  renderer = await createRenderer(mount);
  const assets = runtimeAssets(renderer), loader = assets.loader;
  cameraOwner = createCamera(renderer.domElement); cameraOwner.setDistance(readSettings().cameraDistance);
  resizeDisplay(renderer, Math.max(1, mount.clientWidth), Math.max(1, mount.clientHeight)); cameraOwner.resize(mount.clientWidth, mount.clientHeight);
  const look = resolveAreaLighting(authored), settings = readSettings();
  const lighting = { definition: look, fires: [] as THREE.PointLight[], shadow: null as THREE.PointLight | null };
  graphics = new Graphics({ ...world, camera: cameraOwner.camera, renderer, controls: cameraOwner.controls, mount, invalidate() {}, lighting }, settings, ambientEffects);
  status.textContent = 'Preparing Forest Clearing…';
  area = await buildArea(authored, 'projected', false, assets); scene.add(area.root); area.activate(ambientEffects); lighting.fires = area.fires; lighting.shadow = area.shadow;
  if (area.missing.length) throw new Error(`Prepared woodland art is incomplete: ${area.missing.join(', ')}`);
  ambientEffects.setQuality(settings.particleQuality); ambientEffects.setAtmosphericParticles(settings.atmosphericParticles);
  const ground = area.root.getObjectByName('woodland-ground');
  if (!isMesh(ground)) throw new Error('Woodland ground receiver is unavailable.');
  status.textContent = 'Preparing characters and ability art…';
  const playerSource = await loader.loadAsync(characters.player.model); sources.push(playerSource.scene); sceneTextures(playerSource.scene);
  player = await actor(playerSource.scene, playerSource.animations, origin, yaw, 'player');
  const bow = await loadEquipmentMotions(loader, 'player', { main: 'bow', off: null }, player.model);
  motionSources.push(bow);
  player.actions.set('arrow-rain', action(player.mixer,bow.clips['arrow-rain']!));
  const bowIdle = action(player.mixer, bow.clips.idle);
  const sword=await loadEquipmentMotions(loader,'player',{main:'sword',off:null},player.model);
  motionSources.push(sword);
  player.actions.set('executioner',action(player.mixer,sword.clips.executioner!));
  player.actions.set('onslaught',action(player.mixer,sword.clips.onslaught!));
  const swordIdle=action(player.mixer,sword.clips.idle);
  player.idle.setEffectiveWeight(0); player.idle = bowIdle;
  const enemySource = await loader.loadAsync(characters.enemy.model); sources.push(enemySource.scene); sceneTextures(enemySource.scene);
  const enemy = await loadEquipmentMotions(loader, 'enemy', { main: 'axe', off: null });
  motionSources.push(enemy);
  const enemyClips = ['idle', 'hit'].map(role => { const clip = enemy.clips[role as 'idle' | 'hit'].clone(); clip.name = role; return clip; });
  for (const position of ultimateTargets) {
    const target = await actor(enemySource.scene, enemyClips, at(position), yaw + Math.PI, 'enemy'); targets.push(target);
    target.equipment.commit(await target.equipment.stage({ main: 'axe', off: null }));
  }
  player.lantern = new PlayerLantern(player.root, true, assets); await player.lantern.initialize();
  effects = new UltimateEffects(ground, origin.clone().setY(0), yaw, settings.particleQuality, renderer, scene); scene.add(effects.root); await effects.prepare();
  await changeKind('arrow-rain'); effects.stageMaterials(cameraOwner.camera);
  // Set up the same pipeline and prepared Golden lighting used by gameplay.
  status.textContent = 'Preparing Golden lighting…';
  await graphics.initialize(); graphics.commitLighting(await graphics.prepareLighting({ ...authored, lighting: look }, area.root));
  effects.resetParticles();
  resize(); observer = new ResizeObserver(resize); observer.observe(mount); window.addEventListener('resize', resize);
  replay.disabled = pause.disabled = timeline.disabled = false; status.hidden = true;
  renderPose();
  let last = performance.now(), settling = 64;
  invalidate = () => { settling = 64; last = performance.now(); if (!frame && !disposed) frame = requestAnimationFrame(tick); };
  document.addEventListener('visibilitychange', invalidate);
  function tick(now: number): void {
    frame = 0;
    if (disposed) return;
    const dt = Math.min(.05, Math.max(0, (now - last) / 1000)); last = now;
    if (!document.hidden && !changing && (playing || settling > 0)) {
      if (playing) settling = 64; else settling--;
      const old = seconds;
      if (playing) {
        seconds += dt * Number(speed.value);
        if (seconds >= ultimateSequences[kind].duration) {
          if (loop.checked) { seconds %= ultimateSequences[kind].duration; graphics!.resetHistory(); }
          else { seconds = ultimateSequences[kind].duration; playing = false; pause.textContent = 'Play'; }
        }
      }
      audio.update(origin, !playing || !sound.checked);
      if (playing && seconds > old) {
        const release = ultimateSequences[kind].release;
        if (old < release && seconds >= release) audio.play(kind!=='arrow-rain' ? 'swordSwing' : 'bowRelease',origin);
        for (let i = 0; i < targets.length; i++) for (const hit of effects!.hitTimes(i)) if (old < hit && seconds >= hit) audio.play(kind!=='arrow-rain' ? 'bodyImpact' : 'arrowImpact',targets[i].location);
      }
      renderPose(); area!.update(cameraOwner!.camera, playing ? dt : 0); graphics!.render(dt, !playing);
    }
    if (!document.hidden && (playing || settling > 0)) frame = requestAnimationFrame(tick);
  }
  shield.addEventListener('change',()=>{void changeKind(kind).catch(failed);});
  select.addEventListener('change', () => { void changeKind(select.value as UltimateKind).catch(failed); });
  async function changeKind(next: UltimateKind): Promise<void> {
    if (next!=='arrow-rain' && next!=='executioner' && next!=='onslaught') throw new Error('Unknown Ultimate study.');
    changing = true; select.disabled = replay.disabled = pause.disabled = timeline.disabled = true;
    audio.update(origin, true); status.hidden = false; status.textContent = `Preparing ${ultimateSequences[next].name}…`;
    const previous = kind;
    try {
      const prepared=await player!.equipment.stage(next!=='arrow-rain' ? {main:'sword',off:shield.checked ? 'shield' : null} : {main:'bow',off:null});
      if (disposed) return;
      player!.equipment.commit(prepared); player!.idle.setEffectiveWeight(0); player!.idle=next!=='arrow-rain' ? swordIdle : bowIdle;
      targets.forEach((target,index)=>target.location.copy(at(next!=='arrow-rain' && index===0 ? new THREE.Vector3(0,0,1.6) : ultimateTargets[index])));
      if (next === 'arrow-rain') {
        pose(player!, ultimateSequences['arrow-rain'].release, player!.actions.get('arrow-rain'));
        updateBowFrame(true);
      }
      kind = next; select.value = kind; seconds = 0; playing = true; pause.textContent = 'Pause'; effects?.set(kind); timeline.max = String(ultimateSequences[kind].duration); graphics?.resetHistory(); setView(); invalidate();
    } catch (error) { select.value = previous; throw error; }
    finally { changing = false; select.disabled = replay.disabled = pause.disabled = timeline.disabled = false; status.hidden = true; }
  }
  frame = requestAnimationFrame(tick);
  const diagnostics = {
    setKind: changeKind,
    setTime(value: number) { playing = false; pause.textContent = 'Play'; seconds = THREE.MathUtils.clamp(value, 0, ultimateSequences[kind].duration); renderPose(); graphics!.resetHistory(); invalidate(); },
    snapshot: () => ({ kind, seconds, playing, hands: ['Hand_L','Hand_R'].map(name=>({name,y:player!.root.getObjectByName(name)?.getWorldPosition(new THREE.Vector3()).y})), feet: ['Ball_L','Ball_R','Ankle_L','Ankle_R'].map(name => ({ name, y: player!.root.getObjectByName(name)?.getWorldPosition(new THREE.Vector3()).y })), effects: effects!.snapshot(), targets: targets.map((target, index) => ({ hitTime: effects!.hitTime(index), hitWeight: target.hit?.getEffectiveWeight() ?? 0 })), pipeline: graphics!.pipelineDiagnostics() }),
  };
  (window as Window & { lanternUltimateStudy?: typeof diagnostics }).lanternUltimateStudy = diagnostics;
}
function pose(actor: PreviewActor, time: number, stroke?: THREE.AnimationAction, reaction = false): void {
  const duration = stroke?.getClip().duration ?? 0;
  const weight = stroke && time >= 0 && time < duration ? Math.min(THREE.MathUtils.smoothstep(time, 0, .06), 1 - THREE.MathUtils.smoothstep(time, duration - .12, duration)) : 0;
  actor.idle.time = seconds % actor.idle.getClip().duration; actor.idle.setEffectiveWeight(1 - weight);
  if (stroke) { stroke.time = THREE.MathUtils.clamp(time, 0, duration); stroke.setEffectiveWeight(weight); }
  actor.mixer.update(0);
  if (reaction) actor.root.position.copy(actor.location).addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(forward), Math.sin(THREE.MathUtils.clamp(time / .3, 0, 1) * Math.PI) * .12);
}
function renderPose(): void {
  if (!player || !effects || !cameraOwner) return;
  for (const [id, stroke] of player.actions) if (id !== kind) stroke.setEffectiveWeight(0);
  pose(player, seconds, player.actions.get(kind));
  player.root.position.copy(origin);
  player.root.updateMatrixWorld(true);
  if (kind === 'arrow-rain') updateBowFrame();
  targets.forEach((target, index) => pose(target, seconds - effects!.lastHit(index, seconds), target.hit, true));
  effects.enabled = enabled.checked; effects.seek(seconds, cameraOwner.camera);
  timeline.value = String(seconds); clock.value = `${seconds.toFixed(2)} / ${ultimateSequences[kind].duration.toFixed(1)} s`;
}
function updateBowFrame(release = false): void {
  if (!player || !effects) return;
  player.root.updateMatrixWorld(true);
  const bow = player.root.getObjectByName('equipment-bow'), hand = player.root.getObjectByName('Hand_R');
  if (!bow || !hand) throw new Error('Arrow Rain requires the equipped bow and draw hand.');
  const nock = hand.getWorldPosition(new THREE.Vector3());
  const rest = bow.getWorldPosition(new THREE.Vector3());
  const direction = rest.sub(nock).normalize();
  effects.setBowFrame(nock, direction, release);
}
function setView(): void {
  if (!cameraOwner) return;
  const target = at(new THREE.Vector3(0, .86, 2.5));
  const zoom = 1 / cameraDistanceMultipliers[readSettings().cameraDistance]; cameraOwner.restoreView({ target: target.toArray(), zoom: zoom * (closeView ? 1.2 : 1) });
  graphics?.resetHistory(); invalidate();
}
function resize(): void { if (disposed || !renderer || !cameraOwner) return; const width = Math.max(1, mount.clientWidth), height = Math.max(1, mount.clientHeight); resizeDisplay(renderer, width, height); cameraOwner.resize(width, height); graphics?.resize(); invalidate(); }
function failed(error: unknown): void { console.error(error); status.hidden = false; status.textContent = `Unable to prepare ability: ${String(error)}`; }
replay.onclick = () => { seconds = 0; playing = true; pause.textContent = 'Pause'; graphics?.resetHistory(); renderPose(); invalidate(); };
pause.onclick = () => { playing = !playing; pause.textContent = playing ? 'Pause' : 'Play'; invalidate(); };
timeline.oninput = () => { seconds = Number(timeline.value); playing = false; pause.textContent = 'Play'; renderPose(); graphics?.resetHistory(); invalidate(); };
enabled.onchange = () => { renderPose(); graphics?.resetHistory(); invalidate(); };
sound.onchange = () => { audio.update(origin, !playing || !sound.checked); invalidate(); };
element<HTMLButtonElement>('ultimate-view').onclick = () => { closeView = !closeView; element('ultimate-view').textContent = closeView ? 'Gameplay view' : 'Close view'; setView(); };
window.addEventListener('keydown', event => { if (event.code === 'Space' && !event.repeat && !(event.target instanceof HTMLElement && event.target.closest('input,select,button'))) { event.preventDefault(); pause.click(); } });
let cleaned = false;
async function cleanup(): Promise<void> {
  if (cleaned) return; cleaned = true;
  observer?.disconnect(); window.removeEventListener('resize', resize); cancelAnimationFrame(frame); audio.dispose();
  for (const actor of [player, ...targets]) if (actor) { actor.lantern?.dispose(); actor.equipment.dispose(); actor.mixer.stopAllAction(); actor.mixer.uncacheRoot(actor.mixer.getRoot()); disposeSceneInstances(actor.root, { skeletons: true }); actor.root.removeFromParent(); }
  effects?.dispose(); graphics?.dispose(); area?.dispose(); cameraOwner?.controls.dispose(); sources.forEach(disposeSceneResources); motionSources.forEach(releaseCombatMotions);
  await renderer?.dispose();
}
const preparing = initialize();
window.addEventListener('pagehide', () => { disposed = true; void preparing.then(cleanup, cleanup).catch((error: unknown) => console.error('Unable to release Ultimate study.', error)); }, { once: true });
try { await preparing; } catch (error) { disposed = true; await cleanup(); throw error; }
