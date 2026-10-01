import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { motionStates, type CombatMotions } from '../animation/combat-animations';
import { dodgeDuration, type ActorState, type Motion } from '../gameplay/encounter';

type ClipName = Motion;
export type Actor = { root: THREE.Group; mixer: THREE.AnimationMixer | null; actions: Partial<Record<ClipName, THREE.AnimationAction>>; current: ClipName | null; moveSpeed: number; runSpeed: number; contacts: number[] };
export function makeActor(scene: THREE.Scene, state: ActorState): Actor {
  const root = new THREE.Group();
  root.position.set(state.x, 0.04, state.z);
  scene.add(root);
  return { root, mixer: null, actions: {}, current: null, moveSpeed: state.speed, runSpeed: 3, contacts: [] };
}
export function play(actor: Actor, name: ClipName): void {
  if (actor.current === name && (name === 'idle' || name === 'run')) return;
  const next = actor.actions[name];
  if (!next) return;
  if (actor.current) actor.actions[actor.current]?.fadeOut(0.12);
  next.reset().setEffectiveTimeScale(name === 'run' ? actor.moveSpeed / actor.runSpeed : name === 'dodge' ? next.getClip().duration / dodgeDuration : 1).fadeIn(0.12).play();
  actor.current = name;
}
export function attachCharacter(actor: Actor, source: THREE.Group, clips: THREE.AnimationClip[], height = 1.8): void {
  const model = cloneSkeleton(source);
  model.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;

    }
  });
  // A parent preserves authored rig transforms when animation replaces root tracks.
  const wrapper = new THREE.Group(); wrapper.add(model); wrapper.updateMatrixWorld(true);
  const sourceHeight = new THREE.Box3().setFromObject(wrapper).getSize(new THREE.Vector3()).y;
  if (!Number.isFinite(sourceHeight) || sourceHeight <= 0) throw new Error('Character has no visible body');
  wrapper.scale.setScalar(height / sourceHeight); wrapper.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(wrapper), center = bounds.getCenter(new THREE.Vector3());
  wrapper.position.set(-center.x, -bounds.min.y, -center.z);
  actor.root.add(wrapper);
  actor.mixer = new THREE.AnimationMixer(model);
  installActions(actor, Object.fromEntries(motionStates.map((state) => {
    const clip = clips.find((item) => item.name === state);
    if (!clip) throw new Error(`Missing character animation: ${state}`);
    return [state, clip];
  })) as Record<typeof motionStates[number], THREE.AnimationClip>);
  const dodgeClip = clips.find(clip => clip.name === 'dodge');
  if (dodgeClip) installDodge(actor, dodgeClip);
  actor.contacts = [duration(actor, 'attack') * 0.42];
  play(actor, 'idle');
}
export function duration(actor: Actor, state: ClipName): number { return actor.actions[state]?.getClip().duration ?? 0; }
function installActions(actor: Actor, clips: Record<typeof motionStates[number], THREE.AnimationClip>): void {
  const mixer = actor.mixer!;
  for (const clip of Object.values(clips)) for (const track of clip.tracks) {
    const binding = THREE.PropertyBinding.parseTrackName(track.name);
    if (!THREE.PropertyBinding.findNode(mixer.getRoot(), binding.nodeName)) throw new Error(`Motion does not match character: ${binding.nodeName}`);
  }
  const dodgeClip = actor.actions.dodge?.getClip();
  mixer.stopAllAction();
  for (const action of Object.values(actor.actions)) if (action) mixer.uncacheClip(action.getClip());
  actor.actions = {};
  actor.current = null;
  for (const state of motionStates) {
    const action = mixer.clipAction(clips[state]);
    if (state !== 'idle' && state !== 'run') { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; }
    actor.actions[state] = action;
  }
  if (dodgeClip) installDodge(actor, dodgeClip);
}
function installDodge(actor: Actor, clip: THREE.AnimationClip): void {
  const action = actor.mixer!.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true;
  actor.actions.dodge = action;
}
export function installMotions(actor: Actor, motions: CombatMotions): void {
  installActions(actor, motions.clips);
  actor.contacts = motions.contacts;
  actor.runSpeed = motions.runSpeed;
}
