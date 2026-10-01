import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import characters from '../../assets/playable-characters.json';
import type { ActorId, Motion } from '../gameplay/encounter';
import type { Loadout } from '../gameplay/equipment';

export const motionStates = ['idle', 'run', 'attack', 'hit', 'death'] as const;
export type MotionState = typeof motionStates[number];
export type AnimationRole = Motion | 'backward' | 'left' | 'right' | 'blockForward' | 'blockBackward' | 'blockLeft' | 'blockRight';
export type MotionClip = { id: string; name: string; description?: string; category: string; url: string; duration: number; contact?: number; speed?: number; sourceId?: string; audit?: boolean; phaseOffset?: number };
export type MotionPack = { id: string; label: string; clips: MotionClip[] };
export type MotionCatalog = { version: number; packs: MotionPack[]; defaults: Record<AnimationRole, string>; profiles: Record<string, Partial<Record<AnimationRole, string>>> };
export type MotionChoice = { pack: MotionPack; clip: MotionClip; value: string };
export type MotionSelection = Record<MotionState, string>;
export type CombatMotions = { clips: Record<MotionState, THREE.AnimationClip> & Partial<Record<AnimationRole, THREE.AnimationClip>>; contacts: number[]; runSpeed: number; speeds: Partial<Record<AnimationRole, number>>; chopContact: number; phases: Partial<Record<AnimationRole, number>>; choices: Record<MotionState, MotionChoice> };
const cache = new Map<string, Promise<THREE.AnimationClip>>();
const catalogs = new Map<string, Promise<MotionCatalog>>();
export function getMotionCatalog(who: ActorId): Promise<MotionCatalog> {
  const url = characters[who].catalog;
  if (!catalogs.has(url)) catalogs.set(url, fetch(url).then(async response => {
    if (!response.ok) throw new Error('Prepare compatible Mixamo motions with npm run assets:export-character.');
    const catalog = await response.json() as MotionCatalog;
    if (catalog.version !== 1 || !catalog.profiles || !catalog.packs?.some(pack => pack.id === 'mixamo')) throw new Error('Prepare the curated Mixamo motion profiles with npm run assets:export-character.');
    return catalog;
  }).catch(error => { catalogs.delete(url); throw error; }));
  return catalogs.get(url)!;
}
export function stateChoices(catalog: MotionCatalog, packId: string, state: MotionState): MotionChoice[] {
  const pack = catalog.packs.find(item => item.id === packId);
  return (pack?.clips.filter(clip => clip.category === state && !clip.audit) ?? []).map(clip => ({ pack: pack!, clip, value: `${pack!.id}:${clip.id}` }));
}
export function defaultSelection(catalog: MotionCatalog, packId: string): MotionSelection {
  return Object.fromEntries(motionStates.map(state => {
    const match = stateChoices(catalog, packId, state).find(choice => choice.clip.id === catalog.defaults[state]);
    if (!match) throw new Error(`Missing curated ${state} motion`);
    return [state, match.value];
  })) as MotionSelection;
}
async function loadClip(loader: GLTFLoader, choice: MotionChoice): Promise<THREE.AnimationClip> {
  const url = choice.clip.url;
  if (!cache.has(url)) cache.set(url, loader.loadAsync(url).then(gltf => {
    if (gltf.animations.length !== 1) throw new Error(`Invalid motion: ${choice.clip.name}`);
    return gltf.animations[0];
  }).catch((error: unknown) => { cache.delete(url); throw error; }));
  return (await cache.get(url)!).clone();
}
export async function loadCombatMotions(loader: GLTFLoader, catalog: MotionCatalog, packId: string, selection: MotionSelection, roles: Partial<Record<AnimationRole, string>> = catalog.defaults): Promise<CombatMotions> {
  const pack = catalog.packs.find(item => item.id === packId);
  if (!pack) throw new Error('Mixamo catalog unavailable');
  const choices = Object.fromEntries(motionStates.map(state => {
    const choice = stateChoices(catalog, packId, state).find(item => item.value === selection[state]);
    if (!choice) throw new Error(`Unavailable ${state} motion`);
    return [state, choice];
  })) as Record<MotionState, MotionChoice>;
  const all: Partial<Record<AnimationRole, MotionChoice>> = { ...choices };
  for (const role of ['dodge', 'block', 'chop', 'backward', 'left', 'right', 'blockForward', 'blockBackward', 'blockLeft', 'blockRight'] as const) {
    const clip = pack.clips.find(item => item.id === roles[role]);
    if (clip) all[role] = { pack, clip, value: `${pack.id}:${clip.id}` };
  }
  const clips = Object.fromEntries(await Promise.all(Object.entries(all).map(async ([role, choice]) => {
    const clip = await loadClip(loader, choice); clip.name = role; return [role, clip];
  }))) as CombatMotions['clips'];
  const contact = choices.attack.clip.contact;
  if (contact === undefined || contact <= 0 || contact >= clips.attack.duration) throw new Error('Attack has no reviewed contact marker. Prepare the curated motion profiles.');
  return { clips, contacts: [contact], runSpeed: choices.run.clip.speed ?? 4, speeds: Object.fromEntries(Object.entries(all).map(([role, choice]) => [role, choice.clip.speed ?? 4])), chopContact: all.chop?.clip.contact ?? .32, phases: Object.fromEntries(Object.entries(all).map(([role,choice])=>[role,choice.clip.phaseOffset ?? 0])), choices };
}
export async function loadEquipmentMotions(loader: GLTFLoader, who: ActorId, loadout: Loadout): Promise<CombatMotions> {
  const catalog = await getMotionCatalog(who);
  const profile = catalog.profiles[`${loadout.main ?? 'unarmed'}${loadout.off ? '-shield' : ''}`];
  if (!profile) throw new Error('Compatible weapon motions are unavailable.');
  const selection = Object.fromEntries(motionStates.map(role => [role, `mixamo:${profile[role]}`])) as MotionSelection;
  const motions=await loadCombatMotions(loader,catalog,'mixamo',selection,profile);
  if (loadout.main==='staff') {
    const pack=catalog.packs.find(item=>item.id==='mixamo')!, grip=pack.clips.find(clip=>clip.id==='bow-idle')!;
    const gripPose=await loadClip(loader,{pack,clip:grip,value:`mixamo:${grip.id}`});
    for (const [role,clip] of Object.entries(motions.clips)) if (!['death','dodge'].includes(role)) holdStaffArm(clip,motions.clips.idle,gripPose);
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
