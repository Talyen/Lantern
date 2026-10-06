import type { CharacterSave } from './character';
import type { Encounter } from './encounter-model';

/** Live borrowed views: presentation may read nested state, never mutate it. */
export type StateView<T> = T extends object ? { readonly [K in keyof T]: StateView<T[K]> } : T;
export type CharacterView = StateView<CharacterSave>;
export type EncounterView = StateView<Encounter>;
