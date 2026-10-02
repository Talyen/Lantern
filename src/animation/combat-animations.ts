import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import characters from '../../assets/playable-characters.json';
import type { Motion } from '../gameplay/encounter';
import type { Loadout } from '../gameplay/equipment';

export type RigId = 'player' | 'enemy';
export const motionStates = ['idle', 'run', 'attack', 'hit', 'death'] as const;
export type MotionState = typeof motionStates[number];
export type AnimationRole = Motion | 'backward' | 'left' | 'right' | 'blockForward' | 'blockBackward' | 'blockLeft' | 'blockRight' | 'grip';
export type MotionClip = { id: string; name: string; description?: string; category: string; url: string; duration: number; contact?: number; speed?: number; sourceId?: string; audit?: boolean; phaseOffset?: number };
export type MotionPack = { id: string; label: string; clips: MotionClip[] };
export type MotionCatalog = { version: number; packs: MotionPack[]; defaults: Record<AnimationRole, string>; profiles: Record<string, Partial<Record<AnimationRole, string>>> };
export type CombatMotions = { clips: Record<MotionState, THREE.AnimationClip> & Partial<Record<AnimationRole, THREE.AnimationClip>>; contacts: number[]; runSpeed: number; speeds: Partial<Record<AnimationRole, number>>; chopContact: number; phases: Partial<Record<AnimationRole, number>> };
const cache = new Map<string, Promise<THREE.AnimationClip>>();
const catalogs = new Map<string, Promise<MotionCatalog>>();
export function getMotionCatalog(who: RigId): Promise<MotionCatalog> {
  const url = characters[who].catalog;
  if (!catalogs.has(url)) catalogs.set(url, fetch(url).then(async response => {
    if (!response.ok) throw new Error('Prepare compatible Mixamo motions with npm run assets:export-character.');
    const catalog = await response.json() as MotionCatalog;
    if (catalog.version !== 1 || !catalog.profiles || !catalog.packs?.some(pack => pack.id === 'mixamo')) throw new Error('Prepare the curated Mixamo motion profiles with npm run assets:export-character.');
    return catalog;
  }).catch(error => { catalogs.delete(url); throw error; }));
  return catalogs.get(url)!;
}
async function loadClip(loader: GLTFLoader, clip: MotionClip): Promise<THREE.AnimationClip> {
  const url = clip.url;
  if (!cache.has(url)) cache.set(url, loader.loadAsync(url).then(gltf => {
    if (gltf.animations.length !== 1) throw new Error(`Invalid motion: ${clip.name}`);
    return gltf.animations[0];
  }).catch((error: unknown) => { cache.delete(url); throw error; }));
  return (await cache.get(url)!).clone();
}
export async function loadEquipmentMotions(loader: GLTFLoader, who: RigId, loadout: Loadout): Promise<CombatMotions> {
  const catalog = await getMotionCatalog(who);
  const profile = catalog.profiles[`${loadout.main ?? 'unarmed'}${loadout.off ? '-shield' : ''}`];
  const pack = catalog.packs.find(item => item.id === 'mixamo');
  if (!profile || !pack) throw new Error('Compatible weapon motions are unavailable.');
  const base = Object.fromEntries(motionStates.map(role => {
    const clip = pack.clips.find(item => item.id === profile[role] && item.category === role && !item.audit);
    if (!clip) throw new Error(`Unavailable ${role} motion`);
    return [role, clip];
  })) as Record<MotionState, MotionClip>;
  const all: Partial<Record<AnimationRole, MotionClip>> = { ...base };
  for (const role of ['dodge', 'block', 'chop', 'backward', 'left', 'right', 'blockForward', 'blockBackward', 'blockLeft', 'blockRight', 'grip'] as const) {
    const clip = pack.clips.find(item => item.id === profile[role]);
    if (clip) all[role] = clip;
  }
  const clips = Object.fromEntries(await Promise.all(Object.entries(all).map(async ([role, source]) => {
    const clip = await loadClip(loader, source); clip.name = role; return [role, clip];
  }))) as CombatMotions['clips'];
  const contact = base.attack.contact;
  if (contact === undefined || contact <= 0 || contact >= clips.attack.duration) throw new Error('Attack has no reviewed contact marker. Prepare the curated motion profiles.');
  const motions: CombatMotions = { clips, contacts: [contact], runSpeed: base.run.speed ?? 4,
    speeds: Object.fromEntries(Object.entries(all).map(([role, source]) => [role, source.speed ?? 4])),
    chopContact: all.chop?.contact ?? .32,
    phases: Object.fromEntries(Object.entries(all).map(([role, source]) => [role, source.phaseOffset ?? 0])) };
  if (loadout.main==='staff') {
    const gripPose = motions.clips.grip;
    if (!gripPose) throw new Error('Compatible staff grip is unavailable. Prepare the curated motion profiles.');
    for (const [role,clip] of Object.entries(motions.clips)) if (!['death','dodge','grip'].includes(role)) holdStaffArm(clip,motions.clips.idle,gripPose);
  }
  return motions;
}

/** A Mixamo carrying arm keeps the staff steady while the free arm casts. */
export function holdStaffArm(clip: THREE.AnimationClip, carrying: THREE.AnimationClip, gripPose = carrying): void {
  for (const track of clip.tracks) {
    const finger=/^(Thumb|IndexFinger|Finger).*_L\.|^mixamorigLeftHand(Ring|Pinky)/.test(track.name);
    if (!finger && !/^(Clavicle|Shoulder|Elbow|Hand).*_L\./.test(track.name)) continue;
    const pose=(finger ? gripPose : carrying).tracks.find(item=>item.name===track.name); if (!pose) continue;
    const size=track.getValueSize();
    for (let i=0;i<track.values.length;i++) track.values[i]=pose.values[i%size];
  }
}
