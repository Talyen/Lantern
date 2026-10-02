import { prepareStandardMaterials } from '../rendering/surface-detail';
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { motionStates, type CombatMotions, type AnimationRole } from '../animation/combat-animations';
import { dodgeDuration, type ActorState, type Motion } from '../gameplay/encounter';
import { markOutline } from '../rendering/outlines';

type PlaybackRole = AnimationRole | 'blockUpper' | 'lower_run' | 'lower_left' | 'lower_right' | 'lower_backward';
export type Actor = { root: THREE.Group; mixer: THREE.AnimationMixer | null; actions: Partial<Record<PlaybackRole, THREE.AnimationAction>>; current: Motion | null; moveSpeed: number; rigScale: number; blockBlend: number; runSpeed: number; speeds: Partial<Record<AnimationRole, number>>; contacts: number[]; commitLead: number; chopContact: number; mineContact: number; phases: Partial<Record<AnimationRole, number>>; gait: number; velocity: THREE.Vector2; previous: THREE.Vector2 | null };
// Mixamo faces +Z here: its anatomical left travels +X, and right travels -X.
const directions = ['run', 'left', 'backward', 'right'] as const;
const blockDirections = ['blockForward', 'blockLeft', 'blockBackward', 'blockRight'] as const;
export function makeActor(scene: THREE.Scene, state: ActorState): Actor {
  const root = new THREE.Group(); root.position.set(state.x, .04, state.z); scene.add(root);
  return { root, mixer: null, actions: {}, current: null, moveSpeed: state.speed, rigScale: 1, blockBlend: 0, runSpeed: 4, speeds: {}, contacts: [], commitLead: 0, chopContact: .32, mineContact: .36, phases: {}, gait: 0, velocity: new THREE.Vector2(), previous: null };
}
export function play(actor: Actor, name: Motion): void {
  if (actor.current === name && ['idle', 'run', 'block', 'chop', 'mine'].includes(name)) return;
  const next = actor.actions[name]; if (!next) return;
  const starting = actor.current===null;
  const blend = name === 'dodge' ? .035 : name === 'hit' ? .045 : name === 'attack' || name === 'chop' || name === 'mine' ? .055 : .10;
  for (const action of Object.values(actor.actions)) if (action && action !== next && action.isScheduled()) action.fadeOut(blend);
  next.reset().stopFading().setEffectiveWeight(1).setEffectiveTimeScale(name === 'dodge' ? next.getClip().duration / dodgeDuration : 1);
  if (!starting) next.fadeIn(blend);
  next.play();
  actor.current = name;
  if (name === 'run') for (const role of [...directions, ...directions.map(role=>`lower_${role}` as PlaybackRole), 'blockUpper'] as PlaybackRole[]) {
    const action = actor.actions[role];
    action?.reset().stopFading().setEffectiveTimeScale(0).setEffectiveWeight(0).play();
  }
}
export function attachCharacter(actor: Actor, source: THREE.Group, clips: THREE.AnimationClip[], height = 1.8): void {
  const model = cloneSkeleton(source); prepareStandardMaterials(model); markOutline(model, 'actor');
  model.traverse(object => { if (object instanceof THREE.Mesh) object.castShadow = object.receiveShadow = true; });
  const wrapper = new THREE.Group(); wrapper.add(model); wrapper.updateMatrixWorld(true);
  const sourceHeight = new THREE.Box3().setFromObject(wrapper).getSize(new THREE.Vector3()).y;
  if (!Number.isFinite(sourceHeight) || sourceHeight <= 0) throw new Error('Character has no visible body');
  actor.rigScale=height/sourceHeight; wrapper.scale.setScalar(actor.rigScale); wrapper.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(wrapper), center = bounds.getCenter(new THREE.Vector3());
  wrapper.position.set(-center.x, -bounds.min.y, -center.z); actor.root.add(wrapper); actor.mixer = new THREE.AnimationMixer(model);
  const embedded = Object.fromEntries(clips.filter(clip => [...motionStates, 'dodge', 'backward', 'left', 'right', 'block', 'chop', 'mine'].includes(clip.name)).map(clip => [clip.name, clip]));
  for (const role of motionStates) if (!embedded[role]) throw new Error(`Missing character animation: ${role}`);
  installActions(actor, embedded); play(actor, 'idle');
}
export function duration(actor: Actor, state: AnimationRole): number { return actor.actions[state]?.getClip().duration ?? 0; }
function installActions(actor: Actor, clips: Partial<Record<AnimationRole, THREE.AnimationClip>>): void {
  const mixer = actor.mixer!;
  for (const clip of Object.values(clips)) for (const track of clip.tracks) {
    const binding = THREE.PropertyBinding.parseTrackName(track.name);
    if (!THREE.PropertyBinding.findNode(mixer.getRoot(), binding.nodeName)) throw new Error(`Motion does not match character: ${binding.nodeName}`);
  }
  mixer.stopAllAction();
  for (const action of Object.values(actor.actions)) if (action) mixer.uncacheClip(action.getClip());
  actor.actions = {}; actor.current = null; actor.previous = null; actor.velocity.set(0, 0);
  const playback: Partial<Record<PlaybackRole, THREE.AnimationClip>> = {...clips};
  if (clips.block) {
    const upper=clips.block.clone(); upper.name='blockUpper'; upper.tracks=upper.tracks.filter(track=>/^(Spine|Neck|Head|Clavicle|Shoulder|Elbow|Hand|Thumb|Finger|Index|mixamorigLeftHand|mixamorigRightHand)/.test(track.name)); playback.blockUpper=upper;
    for (const [i,role] of directions.entries()) if (clips[role]) { const lower=(clips[blockDirections[i]] ?? clips[role])!.clone(); lower.name=`lower_${role}`; lower.tracks=lower.tracks.filter(track=>/^(Hips|UpperLeg|LowerLeg|Ankle|Ball)/.test(track.name)); playback[`lower_${role}`]=lower; }
  }
  for (const [role, clip] of Object.entries(playback)) {
    const action = mixer.clipAction(clip);
    if (!['idle', 'run', 'backward', 'left', 'right', 'block', 'blockUpper', 'lower_run', 'lower_right', 'lower_backward', 'lower_left'].includes(role)) { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; }
    actor.actions[role as PlaybackRole] = action;
  }
}
export function installMotions(actor: Actor, motions: CombatMotions): void {
  installActions(actor, motions.clips); actor.contacts = motions.contacts; actor.commitLead = motions.commitLead ?? 0; actor.runSpeed = motions.runSpeed * actor.rigScale; actor.speeds = Object.fromEntries(Object.entries(motions.speeds).map(([role,speed])=>[role,speed! * actor.rigScale])); actor.chopContact = motions.chopContact; actor.mineContact = motions.mineContact; actor.phases=motions.phases;
}
/** Locomotion follows actual displacement, with a shared normalized foot cycle across directions. */
export function updateActor(actor: Actor, state: ActorState, dt: number, paused: boolean, blocking = false): void {
  const now = new THREE.Vector2(state.x, state.z);
  if (paused || !actor.previous || dt <= 0) { actor.previous = now; actor.velocity.set(0, 0); actor.mixer?.update(0); return; }
  const actual = now.clone().sub(actor.previous).divideScalar(dt); actor.previous = now;
  actor.velocity.lerp(actual, 1 - Math.exp(-24 * dt));
  actor.blockBlend=THREE.MathUtils.damp(actor.blockBlend,blocking ? 1 : 0,24,dt);
  if (actor.current === 'run') {
    const speed = actor.velocity.length();
    if (actual.length() < .015) { play(actor, 'idle'); }
    else {
      const angle = Math.atan2(actor.velocity.x, actor.velocity.y) - state.yaw;
      const sector = ((angle / (Math.PI / 2)) % 4 + 4) % 4, first = Math.floor(sector), fraction = sector - first;
      const weights = directions.map((_, i) => i === first ? 1 - fraction : i === (first + 1) % 4 ? fraction : 0);
      if (!actor.actions.left) { weights.fill(0); weights[0]=1; }
      let stride = 0;
      directions.forEach((role, i) => { const action = actor.actions[role], lower=actor.actions[`lower_${role}`]; if (action) stride += weights[i] * ((1-actor.blockBlend)*(actor.speeds[role] ?? actor.runSpeed)*action.getClip().duration + actor.blockBlend*(actor.speeds[blockDirections[i]] ?? actor.runSpeed)*(lower?.getClip().duration ?? action.getClip().duration)); });
      actor.gait = (actor.gait + dt * speed / Math.max(.2, stride)) % 1;
      directions.forEach((role, i) => {
        const action = actor.actions[role]; if (!action) return;
        action.stopFading().setEffectiveWeight(weights[i] * (1-actor.blockBlend)).setEffectiveTimeScale(0); action.time = ((actor.gait+(actor.phases[role] ?? 0))%1)*action.getClip().duration;
        const lower=actor.actions[`lower_${role}`]; if (lower) { lower.stopFading().setEffectiveWeight(weights[i]*actor.blockBlend).setEffectiveTimeScale(0); lower.time=((actor.gait+(actor.phases[blockDirections[i]] ?? actor.phases[role] ?? 0))%1)*lower.getClip().duration; }
      });
      actor.actions.blockUpper?.setEffectiveWeight(actor.blockBlend).setEffectiveTimeScale(1);
    }
  }
  if (actor.current!=='run') actor.actions.blockUpper?.setEffectiveWeight(0);
  actor.mixer?.update(dt);
}
