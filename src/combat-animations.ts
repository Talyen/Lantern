import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const motionStates = ['idle', 'run', 'attack', 'hit', 'death'] as const;
export type MotionState = typeof motionStates[number];
export type MotionClip = { id: string; name: string; description?: string; category: string; url: string; duration: number };
export type MotionPack = { id: string; label: string; clips: MotionClip[] };
export type MotionCatalog = { version: number; packs: MotionPack[] };
export type MotionChoice = { pack: MotionPack; clip: MotionClip; value: string };
export type MotionSelection = Record<MotionState, string>;
export type CombatMotions = { clips: Record<MotionState, THREE.AnimationClip>; contacts: number[]; runSpeed: number; choices: Record<MotionState, MotionChoice> };
const defaults: Record<string, Record<MotionState, string>> = {
  mixamo: { idle: 'sword and shield idle', run: 'sword and shield run', attack: 'sword and shield slash', hit: 'sword and shield impact', death: 'sword and shield death' },
};
const cache = new Map<string, Promise<THREE.AnimationClip>>();
export function stateChoices(catalog: MotionCatalog, packId: string, state: MotionState): MotionChoice[] {
  const selected = catalog.packs.find((pack) => pack.id === packId);
  const pack = selected;
  return (pack?.clips.filter((clip) => clip.category === state && (state !== 'attack' || !clip.name.endsWith('_Rec'))) ?? []).map((clip) => ({ pack: pack!, clip, value: `${pack!.id}:${clip.id}` }));
}
export function defaultSelection(catalog: MotionCatalog, packId: string): MotionSelection {
  const preferred = defaults[packId];
  if (!preferred) throw new Error('Unknown motion set');
  return Object.fromEntries(motionStates.map((state) => {
    const choices = stateChoices(catalog, packId, state);
    const match = choices.find((choice) => choice.clip.name === preferred[state]) ?? choices[0];
    if (!match) throw new Error(`No ${state} motion available`);
    return [state, match.value];
  })) as MotionSelection;
}
async function loadClip(loader: GLTFLoader, choice: MotionChoice): Promise<THREE.AnimationClip> {
  const url = choice.clip.url;
  if (!cache.has(url)) cache.set(url, loader.loadAsync(url).then((gltf) => {
    if (gltf.animations.length !== 1) throw new Error(`Invalid motion: ${choice.clip.name}`);
    return gltf.animations[0];
  }).catch((error: unknown) => { cache.delete(url); throw error; }));
  return (await cache.get(url)!).clone();
}
export async function loadCombatMotions(loader: GLTFLoader, catalog: MotionCatalog, packId: string, selection: MotionSelection): Promise<CombatMotions> {
  const choices = Object.fromEntries(motionStates.map((state) => {
    const choice = stateChoices(catalog, packId, state).find((item) => item.value === selection[state]);
    if (!choice) throw new Error(`Unavailable ${state} motion`);
    return [state, choice];
  })) as Record<MotionState, MotionChoice>;
  const clips = Object.fromEntries(await Promise.all(motionStates.map(async (state) => [state, await loadClip(loader, choices[state])]))) as Record<MotionState, THREE.AnimationClip>;
  const contacts = [clips.attack.duration * 0.42];
  const runName = choices.run.clip.name;
  const runSpeed = runName.toLowerCase().includes('sprint') ? 5 : 3.6;
  for (const state of motionStates) clips[state].name = state;
  return { clips, contacts, runSpeed, choices };
}
