import { disposeSceneResources } from '../assets/resource-ownership';
import { skywardShot } from './arrow-rain-motion';
import { heldShot } from './held-shot';
import type { AbilityMotion } from '../gameplay/abilities';
import * as THREE from 'three';
import motionProfiles from '../../assets/motion-profiles.json';
import { type GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import characters from '../../assets/playable-characters.json';
import { assetsForLoader } from '../assets/runtime-assets';
import { ArtCache, type ArtResource } from '../assets/art-cache';
import type { Motion } from '../gameplay/encounter';
import { weaponFamily, type Loadout } from '../gameplay/equipment';

export type RigId = keyof typeof characters;
export const motionStates = ['idle', 'run', 'attack', 'hit', 'death'] as const;
export type MotionState = typeof motionStates[number];
export type AnimationRole = Motion | 'backward' | 'left' | 'right' | 'blockForward' | 'blockBackward' | 'blockLeft' | 'blockRight' | 'grip' | 'pierceDraw' | 'pierceRelease';
export type MotionClip = { id: string; name: string; description?: string; category: string; url: string; duration: number; contact?: number; contacts?: number[]; speed?: number; sourceId?: string; audit?: boolean; phaseOffset?: number };
export type MotionPack = { id: string; label: string; clips: MotionClip[] };
export type MotionCatalog = { version: number; packs: MotionPack[]; defaults: Record<AnimationRole, string>; profiles: Record<string, Partial<Record<AnimationRole, string>>> };
export type CombatMotions = { clips: Record<MotionState, THREE.AnimationClip> & Partial<Record<AnimationRole, THREE.AnimationClip>>; contacts: number[]; commitLead?: number; runSpeed: number; speeds: Partial<Record<AnimationRole, number>>; chopContact: number; mineContact: number; skillContacts: Partial<Record<AbilityMotion,number[]>>; phases: Partial<Record<AnimationRole, number>> };
const fallbackCaches = new WeakMap<GLTFLoader, ArtCache>();
const clipReleases = new WeakMap<THREE.AnimationClip, () => void>();
function motionCache(loader: GLTFLoader): ArtCache {
  const resources = assetsForLoader(loader); if (resources) return resources.cache;
  let cache = fallbackCaches.get(loader); if (!cache) { cache = new ArtCache(); fallbackCaches.set(loader, cache); } return cache;
}
function clipResources(clip: THREE.AnimationClip): ArtResource[] {
  return clip.tracks.flatMap(track => [track.times.buffer, track.values.buffer].map(buffer => ({ identity: buffer, kind: 'motion' as const, bytes: buffer.byteLength })));
}
export function releaseMotionClip(clip: THREE.AnimationClip): void { const release = clipReleases.get(clip); clipReleases.delete(clip); release?.(); }
export function releaseCombatMotions(motions: CombatMotions): void { new Set(Object.values(motions.clips)).forEach(releaseMotionClip); }
export function getMotionCatalog(who: RigId, loader: GLTFLoader): Promise<MotionCatalog> {
  const url = characters[who].catalog;
  const resources = assetsForLoader(loader);
  const read = async () => {
    const transfer = async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Prepare compatible Mixamo motions with npm run assets:export-character.');
      return response.json() as Promise<MotionCatalog>;
    };
    const catalog = resources ? await resources.transfers.run(transfer) : await transfer();
    if (catalog.version !== 1 || !catalog.profiles || !catalog.packs?.some(pack => pack.id === 'mixamo')) throw new Error('Prepare the curated Mixamo motion profiles with npm run assets:export-character.');
    return catalog;
  };
  const lease = motionCache(loader).acquire(`motion-catalog:${url}`, read,
    catalog => [{ identity: catalog, kind: 'metadata', bytes: JSON.stringify(catalog).length * 2 }], () => {});
  return lease.ready.finally(lease.release);
}
export async function loadMotionClip(loader: GLTFLoader, clip: MotionClip): Promise<THREE.AnimationClip> {
  const url = clip.url;
  const lease = motionCache(loader).acquire(`motion:${url}`, () => loader.loadAsync(url).then(gltf => {
    try {
      if (gltf.animations.length !== 1) throw new Error(`Invalid motion: ${clip.name}`);
      return gltf.animations[0];
    } finally { disposeSceneResources(gltf.scene); }
  }), clipResources, () => {});
  // Playback state belongs to each clip/action; keyframe buffers stay read-only.
  try { const clip = independentClip(await lease.ready); clipReleases.set(clip, lease.release); return clip; }
  catch (error) { lease.release(); throw error; }
}
function independentClip(source: THREE.AnimationClip): THREE.AnimationClip {
  return new THREE.AnimationClip(source.name, source.duration, source.tracks.slice(), source.blendMode);
}
export async function loadEquipmentMotions(loader: GLTFLoader, who: RigId, loadout: Loadout, sourceRig?: THREE.Object3D): Promise<CombatMotions> {
  const catalog = await getMotionCatalog(who, loader);
  const profile = catalog.profiles[`${weaponFamily(loadout.main) ?? 'unarmed'}${loadout.off ? '-shield' : ''}`];
  const pack = catalog.packs.find(item => item.id === 'mixamo');
  if (!profile || !pack) throw new Error('Compatible weapon motions are unavailable.');
  const base = Object.fromEntries(motionStates.map(role => {
    const clip = pack.clips.find(item => item.id === profile[role] && item.category === role && !item.audit);
    if (!clip) throw new Error(`Unavailable ${role} motion`);
    return [role, clip];
  })) as Record<MotionState, MotionClip>;
  const all: Partial<Record<AnimationRole, MotionClip>> = { ...base };
  for (const role of ['dodge', 'block', 'chop', 'mine', 'backward', 'left', 'right', 'blockForward', 'blockBackward', 'blockLeft', 'blockRight', 'grip', 'sweep', 'crush', 'battleCry', 'thrust', 'executioner', 'onslaught', 'riposte', 'pierceDraw', 'pierceRelease'] as const) {
    const clip = pack.clips.find(item => item.id === profile[role]);
    if(profile[role] && !clip)throw new Error(`Unavailable ${role} motion. Prepare compatible Mixamo motions.`);
    if (clip) all[role] = clip;
  }
  const loaded = await Promise.allSettled(Object.entries(all).map(async ([role, source]) => {
    const clip = await loadMotionClip(loader, source); clip.name = role; return [role, clip];
  }));
  const fulfilled = loaded.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
  const failure = loaded.find(result => result.status === 'rejected');
  if (failure) { fulfilled.forEach(([, clip]) => releaseMotionClip(clip as THREE.AnimationClip)); throw failure.reason; }
  const clips = Object.fromEntries(fulfilled) as CombatMotions['clips'];
  try {
  // Every contact owner uses the same numeric/clip-boundary check before gameplay can consume it.
  const contactsFor = (role: AnimationRole, multiple = false): number[] => {
    const source = all[role], clip = clips[role];
    const contacts = multiple && source?.contacts ? source.contacts : source?.contact === undefined ? [] : [source.contact];
    if (!clip || !Number.isFinite(clip.duration) || !contacts.length || contacts.some(time => !Number.isFinite(time) || time <= 0 || time >= clip.duration))
      throw new Error(`Unavailable reviewed contacts for ${role}. Prepare compatible Mixamo motions with npm run assets:export-character.`);
    return contacts;
  };
  const contacts = contactsFor('attack');
  if (who === 'player') for (const role of ['chop', 'mine'] as const) contactsFor(role);
  const skillContacts: CombatMotions['skillContacts'] = {};
  for (const role of ['sweep', 'crush', 'thrust', 'executioner', 'onslaught', 'riposte'] as const)
    if (clips[role]) skillContacts[role] = contactsFor(role, role !== 'sweep');
  if (clips.pierceRelease) contactsFor('pierceRelease');
  if (clips.pierceDraw && clips.pierceRelease) {
    // Joining is deterministic for the cached source pair. Retain its keyframes
    // once, with a separate wrapper/action for each prepared equipment profile.
    const key = JSON.stringify([all.pierceDraw!.url, all.pierceRelease!.url]);
    const draw = clips.pierceDraw, release = clips.pierceRelease;
    const lease = motionCache(loader).acquire(`joined:${key}`, async () => joinShot(draw, release), clipResources, () => {});
    try { clips.pierce = independentClip(await lease.ready); clipReleases.set(clips.pierce, lease.release); } catch (error) { lease.release(); throw error; }
    skillContacts.pierce = [clips.pierceDraw.duration + contactsFor('pierceRelease')[0]];
  }
  const motions: CombatMotions = { clips, contacts, commitLead: (motionProfiles.clips as Record<string,{commitLead?:number}>)[base.attack.id]?.commitLead ?? 0, runSpeed: base.run.speed ?? 4,
    speeds: Object.fromEntries(Object.entries(all).map(([role, source]) => [role, source.speed ?? 4])),
    chopContact: all.chop?.contact ?? 0, mineContact: all.mine?.contact ?? 0,
    skillContacts,
    phases: Object.fromEntries(Object.entries(all).map(([role, source]) => [role, source.phaseOffset ?? 0])) };
  if (clips.riposte) clips['riposte-stance']=riposteStance(clips.riposte,motions.skillContacts.riposte![0]);
  if (who==='player' && clips.pierce && clips.pierceDraw) {
    if (!sourceRig) throw new Error('Derived Bow motions require the prepared player rig.');
    clips['arrow-rain']=skywardShot(sourceRig,clips.pierce,clips.pierceDraw.duration,motions.skillContacts.pierce![0]-clips.pierceDraw.duration);
    clips.deadeye=heldShot(clips.pierce,clips.pierceDraw.duration,motions.skillContacts.pierce![0],1.05,1.4);
    motions.skillContacts['arrow-rain']=[.93]; motions.skillContacts.deadeye=[1.05];
  }
  if (loadout.main==='staff') {
    const gripPose = motions.clips.grip;
    if (!gripPose) throw new Error('Compatible staff grip is unavailable. Prepare the curated motion profiles.');
    for (const [role,clip] of Object.entries(motions.clips)) if (!['death','dodge','grip','chop','mine'].includes(role)) holdStaffArm(clip,motions.clips.idle,gripPose);
  }
  return motions;
  } catch (error) { Object.values(clips).forEach(releaseMotionClip); throw error; }
}

/** A Mixamo carrying arm keeps the staff steady while the free arm casts. */
export function holdStaffArm(clip: THREE.AnimationClip, carrying: THREE.AnimationClip, gripPose = carrying): void {
  for (let index = 0; index < clip.tracks.length; index++) {
    const track = clip.tracks[index];
    const finger=/^(Thumb|IndexFinger|Finger).*_L\.|^mixamorigLeftHand(Ring|Pinky)/.test(track.name);
    if (!finger && !/^(Clavicle|Shoulder|Elbow|Hand).*_L\./.test(track.name)) continue;
    const pose=(finger ? gripPose : carrying).tracks.find(item=>item.name===track.name); if (!pose) continue;
    // Only the authored carrying-arm edits need independent keyframe storage.
    const held = track.clone(); clip.tracks[index] = held;
    const size=track.getValueSize();
    for (let i=0;i<held.values.length;i++) held.values[i]=pose.values[i%size];
  }
}

/** Join two independently retargeted Mixamo actions, easing only their short pose transition. */
function joinShot(draw: THREE.AnimationClip, release: THREE.AnimationClip): THREE.AnimationClip {
  const duration=draw.duration+release.duration, tracks: THREE.KeyframeTrack[]=[];
  for (const start of draw.tracks) {
    const end=release.tracks.find(track=>track.name===start.name);
    if (!end) throw new Error('Bow release does not match its draw rig.');
    const a=start.InterpolantFactoryMethodLinear(), b=end.InterpolantFactoryMethodLinear(), size=start.getValueSize(), times:number[]=[], values:number[]=[];
    const last=Array.from(a.evaluate(draw.duration) as ArrayLike<number>);
    const samples=Math.max(1,Math.round(duration*30));
    for (let i=0;i<=samples;i++) {
      const t=duration*i/samples, pose=Array.from((t<=draw.duration ? a.evaluate(t) : b.evaluate(t-draw.duration)) as ArrayLike<number>);
      if (t>draw.duration && t-draw.duration<.08) {
        const weight=(t-draw.duration)/.08;
        if (start instanceof THREE.QuaternionKeyframeTrack) new THREE.Quaternion().fromArray(last).slerp(new THREE.Quaternion().fromArray(pose),weight).toArray(pose);
        else for (let j=0;j<size;j++) pose[j]=THREE.MathUtils.lerp(last[j],pose[j],weight);
      }
      times.push(t); values.push(...pose);
    }
    tracks.push(start instanceof THREE.QuaternionKeyframeTrack ? new THREE.QuaternionKeyframeTrack(start.name,times,values) : new THREE.VectorKeyframeTrack(start.name,times,values));
  }
  return new THREE.AnimationClip('pierce',duration,tracks);
}

/** Hold the blade's preparation pose; an empty left hand never pretends to hold a Shield. */
function riposteStance(source: THREE.AnimationClip, contact: number): THREE.AnimationClip {
  const tracks=source.tracks.map(track=> {
    const values=Array.from(track.InterpolantFactoryMethodLinear().evaluate(contact*.5));
    return track instanceof THREE.QuaternionKeyframeTrack ? new THREE.QuaternionKeyframeTrack(track.name,[0,.75],[...values,...values]) : new THREE.VectorKeyframeTrack(track.name,[0,.75],[...values,...values]);
  });
  return new THREE.AnimationClip('riposte-stance',.75,tracks);
}
