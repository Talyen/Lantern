import { skywardShot } from './arrow-rain-motion';
import { heldShot } from './held-shot';
import type { AbilityMotion } from '../gameplay/abilities';
import * as THREE from 'three';
import motionProfiles from '../../assets/motion-profiles.json';
import { type GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import characters from '../../assets/playable-characters.json';
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
const cache = new Map<string, Promise<THREE.AnimationClip>>();
const joinedShots = new Map<string, THREE.AnimationClip>();
const catalogs = new Map<string, Promise<MotionCatalog>>();
export function getMotionCatalog(who: RigId): Promise<MotionCatalog> {
  const url = characters[who].catalog;
  if (!catalogs.has(url)) catalogs.set(url, fetch(url).then(async response => {
    if (!response.ok) throw new Error('Prepare compatible Mixamo motions with npm run assets:export-character.');
    const catalog = await response.json() as MotionCatalog;
    if (catalog.version !== 1 || !catalog.profiles || !catalog.packs?.some(pack => pack.id === 'mixamo')) throw new Error('Prepare the curated Mixamo motion profiles with npm run assets:export-character.');
    return catalog;
  }).catch((error: unknown) => { catalogs.delete(url); throw error; }));
  return catalogs.get(url)!;
}
async function loadClip(loader: GLTFLoader, clip: MotionClip): Promise<THREE.AnimationClip> {
  const url = clip.url;
  if (!cache.has(url)) cache.set(url, loader.loadAsync(url).then(gltf => {
    if (gltf.animations.length !== 1) throw new Error(`Invalid motion: ${clip.name}`);
    return gltf.animations[0];
  }).catch((error: unknown) => { cache.delete(url); throw error; }));
  const source = await cache.get(url)!;
  // Playback state belongs to each clip/action; keyframe buffers stay read-only.
  return independentClip(source);
}
function independentClip(source: THREE.AnimationClip): THREE.AnimationClip {
  return new THREE.AnimationClip(source.name, source.duration, source.tracks.slice(), source.blendMode);
}
export async function loadEquipmentMotions(loader: GLTFLoader, who: RigId, loadout: Loadout, sourceRig?: THREE.Object3D): Promise<CombatMotions> {
  const catalog = await getMotionCatalog(who);
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
  const clips = Object.fromEntries(await Promise.all(Object.entries(all).map(async ([role, source]) => {
    const clip = await loadClip(loader, source); clip.name = role; return [role, clip];
  }))) as CombatMotions['clips'];
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
  for (const role of ['sweep', 'pierceRelease'] as const) if (clips[role]) contactsFor(role);
  if (clips.pierceDraw && clips.pierceRelease) {
    // Joining is deterministic for the cached source pair. Retain its keyframes
    // once, with a separate wrapper/action for each prepared equipment profile.
    const key = JSON.stringify([all.pierceDraw!.url, all.pierceRelease!.url]);
    let joined = joinedShots.get(key);
    if (!joined) { joined = joinShot(clips.pierceDraw, clips.pierceRelease); joinedShots.set(key, joined); }
    clips.pierce = independentClip(joined);
  }
  const motions: CombatMotions = { clips, contacts, commitLead: (motionProfiles.clips as Record<string,{commitLead?:number}>)[base.attack.id]?.commitLead ?? 0, runSpeed: base.run.speed ?? 4,
    speeds: Object.fromEntries(Object.entries(all).map(([role, source]) => [role, source.speed ?? 4])),
    chopContact: all.chop?.contact ?? 0, mineContact: all.mine?.contact ?? 0,
    skillContacts:{sweep:all.sweep?.contact !== undefined ? [all.sweep.contact] : undefined,pierce:clips.pierceDraw && all.pierceRelease?.contact !== undefined ? [clips.pierceDraw.duration+all.pierceRelease.contact] : undefined},
    phases: Object.fromEntries(Object.entries(all).map(([role, source]) => [role, source.phaseOffset ?? 0])) };
  for (const role of ['crush', 'thrust', 'executioner', 'onslaught', 'riposte'] as const)
    if (clips[role]) motions.skillContacts[role] = contactsFor(role, true);
  if (clips.riposte) clips['riposte-stance']=riposteStance(clips.riposte,motions.skillContacts.riposte![0]);
  if (who==='player' && clips.pierce && clips.pierceDraw) {
    const source=sourceRig ?? (await loader.loadAsync(characters.player.model)).scene;
    clips['arrow-rain']=skywardShot(source,clips.pierce,clips.pierceDraw.duration,motions.skillContacts.pierce![0]-clips.pierceDraw.duration);
    clips.deadeye=heldShot(clips.pierce,clips.pierceDraw.duration,motions.skillContacts.pierce![0],1.05,1.4);
    motions.skillContacts['arrow-rain']=[.93]; motions.skillContacts.deadeye=[1.05];
  }
  if (loadout.main==='staff') {
    const gripPose = motions.clips.grip;
    if (!gripPose) throw new Error('Compatible staff grip is unavailable. Prepare the curated motion profiles.');
    for (const [role,clip] of Object.entries(motions.clips)) if (!['death','dodge','grip','chop','mine'].includes(role)) holdStaffArm(clip,motions.clips.idle,gripPose);
  }
  return motions;
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
