import { createEncounter, playerMaxHealth, type Encounter } from './encounter';
import type { Point, Spawn } from './area';
import type { AreaDefinition, Campfire, Chest } from '../levels/types';

export const characterSaveKey = 'lantern.character.v1';
export const scrollLimit = 99;
export const homeArea = 'homestead';
export type CharacterSave = { version: 1; scrolls: number; campfires: string[] };
export type ScrollDrop = { id: string; position: Point };
export type PortalLink = { area: string; departure: Spawn };
type AreaSession = { encounter?: Encounter; drops: ScrollDrop[]; dropRolled: boolean; chests: Record<string, { opened: boolean; remaining: number }> };
export type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
export const fireKey = (area: string, fire: string) => `${area}/${fire}`;
export const near = (point: Point, target: Point, radius: number) => Math.hypot(point[0] - target[0], point[1] - target[1]) <= radius;

/** Continuing character state and inactive area snapshots; no rendering/browser dependencies. */
export class Adventure {
  character: CharacterSave = { version: 1, scrolls: 3, campfires: ['homestead/camp'] };
  portal: PortalLink | null = null;
  castRemaining = 0;
  saveError = '';
  currentArea: string | null = null;
  private sessions = new Map<string, AreaSession>();
  constructor(private storage?: Storage, private random = Math.random) {
    if (!storage) return;
    try {
      const raw = storage.getItem(characterSaveKey);
      if (raw) {
        const value = JSON.parse(raw);
        if (value?.version !== 1 || !Number.isInteger(value.scrolls) || value.scrolls < 0 || value.scrolls > scrollLimit || !Array.isArray(value.campfires) || !value.campfires.every((id: unknown) => typeof id === 'string')) throw new Error('Invalid character save');
        this.character = { version: 1, scrolls: value.scrolls, campfires: [...new Set<string>([...this.character.campfires, ...value.campfires])] };
      }
    } catch { this.saveError = 'Unable to load progress. Check local storage before restarting.'; }
  }
  save(): void {
    if (!this.storage) return;
    try { this.storage?.setItem(characterSaveKey, JSON.stringify(this.character)); this.saveError = ''; }
    catch { this.saveError = 'Unable to save progress. Allow local storage before restarting.'; }
  }
  session(id = this.currentArea!): AreaSession {
    let session = this.sessions.get(id);
    if (!session) { session = { drops: [], dropRolled: false, chests: {} }; this.sessions.set(id, session); }
    return session;
  }
  /** Call only after destination resources are ready; failed loads cannot change these states. */
  enter(encounter: Encounter, area: AreaDefinition, arrival = area.layout.player, recover = false): void {
    const health = this.currentArea ? encounter.player.hp : playerMaxHealth;
    if (this.currentArea) this.session().encounter = structuredClone(encounter);
    this.currentArea = area.id;
    const previous = this.session().encounter;
    const next = createEncounter('playing', area.layout);
    if (previous && area.kind !== 'safe') {
      next.enemy = { ...previous.enemy, lock: 0, attackTime: -1, contactIndex: 0 };
      next.enemyCooldown = previous.enemyCooldown;
      next.engaged = previous.engaged; next.returning = previous.returning;
      next.phase = next.enemy.hp <= 0 ? 'won' : 'playing';
    }
    next.player.x = arrival.position[0]; next.player.z = arrival.position[1]; next.player.yaw = arrival.yaw;
    next.player.hp = recover ? playerMaxHealth : health;
    Object.assign(encounter, next);
    this.castRemaining = 0;
    if (recover) this.portal = null;
  }
  discover(area: AreaDefinition, point: Point): void {
    for (const fire of area.campfires ?? []) {
      const key = fireKey(area.id, fire.id);
      if (near(point, fire.position, 3) && !this.character.campfires.includes(key)) { this.character.campfires.push(key); this.save(); }
    }
  }
  fireSafe(area: AreaDefinition, fire: Campfire, active?: Encounter): boolean {
    if (area.kind === 'safe' || !area.layout.enemy) return true;
    const encounter = active ?? this.session(area.id).encounter ?? createEncounter('playing', area.layout);
    return encounter.enemy.hp <= 0 || (!encounter.engaged && !encounter.returning && !near([encounter.enemy.x, encounter.enemy.z], fire.position, 10));
  }
  canTravel(encounter: Encounter, sourceArea: AreaDefinition, source: Campfire, targetArea: AreaDefinition, target: Campfire): boolean {
    return this.currentArea === sourceArea.id && encounter.player.hp > 0 && this.castRemaining === 0
      && near([encounter.player.x, encounter.player.z], source.position, 3) && this.fireSafe(sourceArea, source, encounter)
      && this.character.campfires.includes(fireKey(targetArea.id, target.id)) && this.fireSafe(targetArea, target);
  }
  chest(area: AreaDefinition, chest: Chest): { opened: boolean; remaining: number } {
    return this.session(area.id).chests[chest.id] ??= { opened: false, remaining: chest.scrolls };
  }
  openChest(encounter: Encounter, area: AreaDefinition, chest: Chest): boolean {
    if (this.currentArea !== area.id || encounter.player.hp <= 0 || encounter.enemy.hp > 0 || this.castRemaining > 0 || !near([encounter.player.x, encounter.player.z], chest.position, 1.8)) return false;
    const state = this.chest(area, chest), collected = Math.min(state.remaining, scrollLimit - this.character.scrolls);
    const changed = !state.opened || collected > 0;
    state.opened = true; state.remaining -= collected; this.character.scrolls += collected;
    if (collected) this.save();
    return changed;
  }
  destinations(areas: Record<string, AreaDefinition>): { area: AreaDefinition; fire: Campfire; available: boolean }[] {
    return Object.values(areas).flatMap(area => (area.campfires ?? []).filter(fire => area.id !== this.currentArea && this.character.campfires.includes(fireKey(area.id, fire.id))).map(fire => ({ area, fire, available: this.fireSafe(area, fire) })));
  }
  beginCast(alive: boolean): boolean {
    if (!alive || this.currentArea === homeArea || this.character.scrolls === 0 || this.castRemaining > 0) return false;
    this.castRemaining = 2; return true;
  }
  step(encounter: Encounter, area: AreaDefinition, dt: number): void {
    if (encounter.player.hp <= 0) { this.castRemaining = 0; this.portal = null; return; }
    const point: Point = [encounter.player.x, encounter.player.z];
    this.discover(area, point);
    if (area.campfires?.some(fire => fire.heals && near(point, fire.position, 3) && this.fireSafe(area, fire, encounter))) encounter.player.hp = Math.min(playerMaxHealth, encounter.player.hp + playerMaxHealth * .03 * dt);
    const session = this.session();
    if (area.kind !== 'safe' && encounter.enemy.hp <= 0 && !session.dropRolled) {
      session.dropRolled = true;
      if (this.random() < .5) session.drops.push({ id: 'raider-scroll', position: [encounter.enemy.x, encounter.enemy.z] });
    }
    if (this.character.scrolls < scrollLimit) {
      const index = session.drops.findIndex(drop => near(point, drop.position, 1.5));
      if (index >= 0) { session.drops.splice(index, 1); this.character.scrolls++; this.save(); }
    }
    if (this.castRemaining > 0) {
      this.castRemaining = Math.max(0, this.castRemaining - dt);
      if (this.castRemaining === 0) {
        this.character.scrolls--;
        this.portal = { area: area.id, departure: { position: [...point], yaw: encounter.player.yaw } };
        this.save();
      }
    }
  }
  portalPosition(area: AreaDefinition): Point | null {
    if (!this.portal) return null;
    if (area.id === homeArea) return area.portalArrival?.position ?? null;
    return area.id === this.portal.area ? this.portal.departure.position : null;
  }
}
