import { enterAreaEncounter } from './area-encounter';
import { chestRewards, enemyRewards } from './adventure-rewards';
import {
  advanceGroundDrops, collectGroundDrop, lootEvent,
  type DropOptions, type GroundDrop, type GroundItem, type LootEvent,
} from './ground-loot';
import { purchase, sale, repurchase } from './shop-transactions';
import { canRepairShelter, restoredShelter, validatedContainers } from './homestead-transactions';
import { validBar, abilityUnlocked, weaponTrees, axeProgression, type AbilityId, type ActionBar, type WeaponSet } from './abilities';
import { createEncounter, type Encounter, type EnemyId } from './encounter';
import { near, type Point, type Spawn } from './area';
import type { AreaDefinition, Campfire, Chest } from '../levels/types';
import { isEquipmentSlot } from './equipment';
import { character, type CharacterSave } from './character';
import { CharacterPersistence, type StorageSource } from './character-persistence';
export { characterSaveKey } from './character-save';
export type { CharacterSave } from './character';
import { lootDefinitions, receive, transferItem, type InventoryItem, type LootItem } from './inventory';

import { progression, progressMultiplier, type Skill, type GatheringSkill } from './skills';

export const homeArea = 'homestead';
export { dropLandingSeconds, pickupRadius, type GroundDrop, type GroundItem } from './ground-loot';
export { near } from './area';
export type ReturnSpawn = Spawn & { height?: number };
export type PortalLink = { area: string; departure: ReturnSpawn };
type AreaSession = {
  encounter?: Encounter;
  drops: GroundDrop[];
  dropRolled: Partial<Record<EnemyId, boolean>>;
  chests: Record<string, { opened: boolean; remaining: number }>;
};
export const chestUnlocked = (encounter: Encounter, chest: Chest) => chest.guard === null
  || (chest.guards ?? [chest.guard ?? 'enemy']).every(id => !!encounter.enemies[id] && encounter.enemies[id].hp <= 0);
const fireKey = (area: string, fire: string) => `${area}/${fire}`;

export type AdventureEvent =
  | {
    type: 'chestOpen' | 'returnCast' | 'portalOpen' | 'portalClose' | 'fireDiscovered' | 'healing' | 'potionUse';
    position?: { x: number; z: number };
  }
  | {
    type: 'healthRecovered';
    source: 'potion' | 'campfire';
    amount: number;
    elapsed: number;
    finished: boolean;
    position: { x: number; y: number; z: number };
  }
  | {type:'abilityLearned'; ability:AbilityId; slot:number | null}
  | LootEvent;

/** Continuing character state and inactive area snapshots; no rendering/browser dependencies. */
export class Adventure {
  private events: AdventureEvent[] = [];
  private healing = false;
  takeEvents(): AdventureEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  character = character();
  portal: PortalLink | null = null;
  castRemaining = 0;
  private castItemId: string | undefined;
  notice = '';
  private noticeTime = 0;
  private atShelter = false;
  private checkpoint = 0;
  currentArea: string | null = null;
  pickupTarget: string | null = null;
  placeGround: (origin: Point, index: number) => { position: Point; height: number } = origin => ({ position: [...origin], height: 0 });
  canCollectGround: (drop: GroundDrop) => boolean = () => true;
  private sessions = new Map<string, AreaSession>();
  private inactiveOccupants: { areaId: string; position: Point }[] = [];
  inactiveEnemyOccupants(): readonly { areaId: string; position: Point }[] { return this.inactiveOccupants; }
  private sequence = 3;
  newId = (): string => `item-${++this.sequence}`;
  private readonly persistence: CharacterPersistence;
  constructor(storage?: StorageSource, private random = Math.random) {
    this.persistence = new CharacterPersistence(storage);
    const loaded = this.persistence.load();
    if (loaded) {
      this.adoptCharacter(loaded);
      this.save();
    }
  }

  private adoptCharacter(value: CharacterSave): void {
    this.character = value;
    for (const entry of [...value.items, ...value.stash, ...value.buyback]) {
      this.sequence = Math.max(this.sequence, Number(entry.id.match(/^item-(\d+)$/)?.[1] ?? 0));
    }
  }

  async prepareSave(): Promise<void> {
    const loaded = await this.persistence.initialize();
    if (loaded) this.adoptCharacter(loaded);
    this.save();
  }

  save(): void { this.persistence.request(this.character); }
  closeSave(): void { this.persistence.close(this.character); }
  saveDiagnostics() { return this.persistence.diagnostics(); }
  setActionBar(bar: ActionBar): void {
    if (!validBar(bar) || bar.some(id=>id && !abilityUnlocked(id,this.character.xp))) throw new Error('Invalid action bar');
    this.character.actionBar = [...bar];
    this.save();
  }

  setWeaponSet(set: WeaponSet): void {
    this.character.activeSet = set;
    this.save();
  }

  usePotion(encounter: Encounter, id?: string): boolean {
    const entry = this.character.items.find(entry => entry.item === 'potion' && entry.slot === 'bag' && (id === undefined || entry.id === id));
    if (!entry || encounter.player.hp <= 0 || encounter.player.hp >= encounter.stats.maxHealth
      || encounter.potionCooldown > 0 || !['playing', 'won'].includes(encounter.phase)) return false;
    const previousHealth = encounter.player.hp;
    encounter.player.hp = Math.min(encounter.stats.maxHealth, encounter.player.hp + 40);
    encounter.potionCooldown = 8;
    entry.quantity--;
    this.character.items = this.character.items.filter(entry => entry.quantity > 0);
    this.events.push({ type: 'potionUse' }, { type: 'healthRecovered', source: 'potion', amount: encounter.player.hp - previousHealth, elapsed: 0, finished: true, position: { x: encounter.player.x, y: encounter.player.y, z: encounter.player.z } });
    this.save();
    return true;
  }

  replaceItems(items: InventoryItem[]): void {
    this.character.items = items;
    this.save();
  }

  message(text: string, seconds=2): void { this.notice = text; this.noticeTime = seconds; }
  cancelPickup(): void { this.pickupTarget = null; }
  /** Restart refreshes the outing while retaining permanent character progress. */
  restart(): void {
    this.sessions.clear();
    this.inactiveOccupants = [];
    this.portal = null;
    this.castRemaining = 0;
    this.cancelPickup();
    this.notice = '';
    this.noticeTime = 0;
    this.healing = false;
    this.atShelter = false;
    this.checkpoint = 0;
    this.events = [];
  }

  spawnDrop(item: GroundItem, quantity: number, origin: Point, options: DropOptions = {}): GroundDrop {
    const point = this.placeGround(origin, this.session().drops.length);
    const drop: GroundDrop = { id: this.newId(), item, quantity, origin: [...origin], ...point, age: 0, ...options };
    this.session().drops.push(drop);
    this.events.push(lootEvent('lootDrop', drop));
    return drop;
  }

  dropItem(id: string, quantity: number, origin: Point): void {
    const entry = this.character.items.find(i => i.id === id);
    if (!entry || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > entry.quantity) throw new Error('Item is no longer available.');
    if (entry.item === 'scroll' && entry.slot === 'bag' && this.castRemaining > 0 && this.character.scrolls - quantity < 1) throw new Error('Scroll is in use.');
    if (isEquipmentSlot(entry.slot)) throw new Error('Move equipped gear into the bag before dropping it.');
    this.spawnDrop(entry.item, quantity, origin, {
      blocked: lootDefinitions[entry.item].stackable,
      instanceId: lootDefinitions[entry.item].stackable ? undefined : entry.id,
    });
    entry.quantity -= quantity;
    this.replaceItems(this.character.items.filter(i => i.quantity > 0));
  }

  recoverItem(id: string): void {
    const next = structuredClone(this.character.items);
    const entry = next.find(i => i.id === id && i.slot === 'overflow');
    if (!entry) return;
    next.splice(next.indexOf(entry), 1);
    entry.quantity -= receive(next, entry.item, entry.quantity, this.newId, lootDefinitions[entry.item].stackable ? undefined : entry.id);
    if (entry.quantity) next.push(entry);
    if (entry.quantity === this.character.items.find(i => i.id === id)?.quantity) throw new Error('Inventory full.');
    this.replaceItems(next);
  }

  pickup(id: string, point: Point, manual = false): boolean {
    const result = collectGroundDrop(this.session().drops, id, point, this.character, this.newId, this.canCollectGround, manual);
    if (!result.collected) {
      if (result.notice) this.message(result.notice);
      return false;
    }
    const { drop, amount } = result;
    this.events.push(lootEvent('lootPickup', drop));
    if (drop.harvestXp) this.awardXp(drop.harvestXp.skill, amount * drop.harvestXp.perUnit);
    this.save();
    return true;
  }

  private assertShop(encounter: Encounter, area: AreaDefinition): void {
    if (this.currentArea !== homeArea || area.id !== this.currentArea || area.kind !== 'safe' || !area.shop || encounter.player.hp <= 0
      || encounter.player.lock > 0 || encounter.dodgeRemaining > 0 || !['playing', 'won'].includes(encounter.phase)
      || this.castRemaining > 0 || !near([encounter.player.x, encounter.player.z], area.shop.position, 1.8))
      throw new Error('Shop is out of reach.');
  }

  buy(encounter: Encounter, area: AreaDefinition, item: LootItem): void {
    this.assertShop(encounter, area);
    Object.assign(this.character, purchase(this.character, item, this.newId));
    this.save();
  }

  sell(encounter: Encounter, area: AreaDefinition, id: string): void {
    this.assertShop(encounter, area);
    Object.assign(this.character, sale(this.character, id));
    this.save();
  }

  buyBack(encounter: Encounter, area: AreaDefinition, id: string): void {
    this.assertShop(encounter, area);
    Object.assign(this.character, repurchase(this.character, id, this.newId));
    this.save();
  }

  grantHarvest(item: 'wood' | 'stone' | 'iron', quantity: number, skill: GatheringSkill, xpPerUnit: number, position: Point): void {
    this.spawnDrop(item, quantity, position, { harvestXp: { skill, perUnit: xpPerUnit } });
  }

  awardXp(skill: Skill, amount: number): void {
    this.character.xp[skill] = Math.round(
      (this.character.xp[skill] + amount * progressMultiplier(this.character.restedSeconds)) * 1e6,
    ) / 1e6;
  }

  grantWeaponXp(family: 'sword' | 'bow', amount: number): void {
    if (!Number.isFinite(amount) || amount<=0) return;
    const locked=weaponTrees[family].filter(id=>!abilityUnlocked(id,this.character.xp));
    this.awardXp(family,amount);
    for (const id of locked) if (abilityUnlocked(id,this.character.xp)) {
      const empty=this.character.actionBar.indexOf(null);
      if (empty>=0) this.character.actionBar[empty]=id;
      this.events.push({type:'abilityLearned',ability:id,slot:empty>=0 ? empty : null});
    }
    this.save();
  }

  grantAxeCombatXp(amount=10): void {this.grantProficiency('axe',amount);}
  grantProficiency(family:'axe' | 'sword' | 'bow',amount:number): void {
    if (family!=='axe') {this.grantWeaponXp(family,amount); return;}
    const previous=this.character.xp.axeCombat;
    this.awardXp('axeCombat',amount);
    if (previous<axeProgression.ultimateXp && this.character.xp.axeCombat>=axeProgression.ultimateXp) {
      if (this.character.actionBar[2]===null) this.character.actionBar[2]='berserking';
      this.message('Berserking unlocked');
    }
    this.save();
  }

  canRepair(): boolean { return canRepairShelter(this.character); }

  repairShelter(): void {
    if (this.currentArea !== homeArea) throw new Error('Not enough materials.');
    Object.assign(this.character, restoredShelter(this.character));
    this.save();
  }

  replaceContainers(items: InventoryItem[], stash: InventoryItem[]): void {
    if (!this.character.shelterRestored || this.currentArea !== homeArea)
      throw new Error('Item does not fit.');
    Object.assign(this.character, validatedContainers(items, stash));
    this.save();
  }

  transferStash(id: string, quantity: number, toStash: boolean, point?: { x: number; y: number }): void {
    const { items, stash } = this.character;
    const next = transferItem(
      toStash ? items : stash, toStash ? stash : items, id, quantity, this.newId, point,
    );
    this.replaceContainers(toStash ? next.source : next.destination, toStash ? next.destination : next.source);
  }

  session(id = this.currentArea!): AreaSession {
    let session = this.sessions.get(id);
    if (!session) {
      session = { drops: [], dropRolled: {}, chests: {} };
      this.sessions.set(id, session);
    }

    return session;
  }

  /** Call only after destination resources are ready; failed loads cannot change these states. */
  enter(encounter: Encounter, area: AreaDefinition, arrival: ReturnSpawn = area.layout.player, recover = false): void {
    const health = this.currentArea ? encounter.player.hp : null;
    if (this.currentArea) this.session().encounter = structuredClone(encounter);
    this.currentArea = area.id;
    // Inactive snapshots remain fixed until re-entry; cache their living occupants for renewal.
    this.inactiveOccupants = [...this.sessions].flatMap(([areaId, session]) =>
      areaId === this.currentArea || !session.encounter ? [] : session.encounter.enemyIds.flatMap(id => {
        const enemy = session.encounter!.enemies[id];
        return enemy.home && enemy.hp > 0 ? [{ areaId, position: [enemy.x, enemy.z] as Point }] : [];
      }));
    enterAreaEncounter(encounter, area, {
      previous: this.session().encounter, character: this.character, arrival, recover, health,
    });
    this.castRemaining = 0;
    this.cancelPickup();
    this.healing = false;
    this.atShelter = false;
    this.events = [];
    if (recover) this.portal = null;
  }

  discover(area: AreaDefinition, point: Point): void {
    for (const fire of area.campfires ?? []) {
      const key = fireKey(area.id, fire.id);
      if (near(point, fire.position, 3) && !this.character.campfires.includes(key)) {
        this.character.campfires.push(key);
        this.save();
        this.events.push({ type: 'fireDiscovered', position: { x: fire.position[0], z: fire.position[1] } });
      }
    }
  }

  fireSafe(area: AreaDefinition, fire: Campfire, active?: Encounter): boolean {
    if (area.kind === 'safe') return true;
    const encounter = active ?? this.session(area.id).encounter ?? createEncounter('playing', area.layout);
    return encounter.enemyIds.every(id => {
      const enemy = encounter.enemies[id];
      return enemy.hp <= 0 || (!enemy.engaged && !enemy.returning && !near([enemy.x, enemy.z], fire.position, 10));
    });
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
    if (this.currentArea !== area.id || encounter.player.hp <= 0 || !chestUnlocked(encounter, chest)
      || this.castRemaining > 0 || !near([encounter.player.x, encounter.player.z], chest.position, 1.8)) return false;
    const state = this.chest(area, chest);
    if (state.opened) return false;
    this.events.push({ type: 'chestOpen', position: { x: chest.position[0], z: chest.position[1] } });
    for (const reward of chestRewards(chest, state.remaining, area.level, this.character.campClaims, this.random))
      this.spawnDrop(reward.item, reward.quantity, chest.position, reward.options);
    state.opened = true;
    state.remaining = 0;
    return true;
  }

  destinations(areas: Record<string, AreaDefinition>): { area: AreaDefinition; fire: Campfire; available: boolean }[] {
    return Object.values(areas).flatMap(area => (area.campfires ?? [])
      .filter(fire => area.id !== this.currentArea && this.character.campfires.includes(fireKey(area.id, fire.id)))
      .map(fire => ({ area, fire, available: this.fireSafe(area, fire) })));
  }

  beginCast(alive: boolean, id?: string): boolean {
    if (!alive || this.currentArea === homeArea || this.character.scrolls === 0 || this.castRemaining > 0) return false;
    if (id !== undefined && !this.character.items.some(entry => entry.id === id && entry.item === 'scroll' && entry.slot === 'bag')) return false;
    this.castItemId = id;
    this.castRemaining = 2;
    this.events.push({ type: 'returnCast' });
    return true;
  }

  step(encounter: Encounter, area: AreaDefinition, dt: number): void {
    // Death takes precedence over landing, rewards and cast completion.
    if (encounter.player.hp <= 0) {
      if (this.portal) this.events.push({ type: 'portalClose' });
      this.castRemaining = 0;
      this.portal = null;
      this.cancelPickup();
      this.healing = false;
      return;
    }

    this.noticeTime = Math.max(0, this.noticeTime - dt);
    if (!this.noticeTime) this.notice = '';
    const point: Point = [encounter.player.x, encounter.player.z];

    this.updateRested(area, point, dt);
    this.discover(area, point);
    this.updateHealing(encounter, area, point, dt);
    const session = this.session();
    this.rollEnemyDrops(encounter, area, session);
    advanceGroundDrops(session.drops, point, dt, event => this.events.push(event), (id, point) => this.pickup(id, point));
    this.advanceReturnCast(encounter, area, point, dt);
  }

  private updateRested(area: AreaDefinition, point: Point, dt: number): void {
    this.character.restedSeconds = Math.max(0, this.character.restedSeconds - dt);
    const atShelter = !!area.shelter && this.character.shelterRestored
      && near(point, area.shelter.position, progression.restedRadius);
    if (atShelter && !this.atShelter) {
      this.character.restedSeconds = progression.restedSeconds;
      this.save();
    }

    this.atShelter = atShelter;
    this.checkpoint += dt;
    if (this.checkpoint >= progression.checkpointSeconds) {
      this.checkpoint = 0;
      if (this.character.shelterRestored) this.save();
    }
  }

  private updateHealing(encounter: Encounter, area: AreaDefinition, point: Point, dt: number): void {
    const healing = encounter.player.hp < encounter.stats.maxHealth && !!area.campfires?.some(
      fire => fire.heals && near(point, fire.position, 3) && this.fireSafe(area, fire, encounter),
    );
    if (healing && !this.healing) this.events.push({ type: 'healing' });
    if (!healing && this.healing) this.events.push({ type: 'healthRecovered', source: 'campfire', amount: 0, elapsed: 0, finished: true, position: { x: encounter.player.x, y: encounter.player.y, z: encounter.player.z } });
    this.healing = healing;
    if (healing) {
      const previousHealth = encounter.player.hp;
      encounter.player.hp = Math.min(
        encounter.stats.maxHealth,
        encounter.player.hp + encounter.stats.maxHealth * .03 * dt,
      );
      this.events.push({ type: 'healthRecovered', source: 'campfire', amount: encounter.player.hp - previousHealth, elapsed: dt, finished: encounter.player.hp >= encounter.stats.maxHealth, position: { x: encounter.player.x, y: encounter.player.y, z: encounter.player.z } });
    }
  }

  private rollEnemyDrops(encounter: Encounter, area: AreaDefinition, session: AreaSession): void {
    if (area.kind === 'safe') return;
    for (const id of encounter.enemyIds) {
      const enemy = encounter.enemies[id];
      if (!(enemy.home && enemy.hp <= 0 && !session.dropRolled[id])) continue;
      session.dropRolled[id] = true;
      const point: Point = [enemy.x, enemy.z];
      for (const reward of enemyRewards(area, id, this.character.campClaims, this.random))
        this.spawnDrop(reward.item, reward.quantity, point, reward.options);
    }
  }

  private advanceReturnCast(encounter: Encounter, area: AreaDefinition, point: Point, dt: number): void {
    if (!(this.castRemaining > 0)) return;
    this.castRemaining = Math.max(0, this.castRemaining - dt);
    if (this.castRemaining !== 0) return;
    const scroll = this.character.items.find(entry => entry.id === this.castItemId && entry.item === 'scroll' && entry.slot === 'bag')
      ?? this.character.items.find(entry => entry.item === 'scroll' && entry.slot === 'bag');
    this.castItemId = undefined;
    if (!scroll) return;
    scroll.quantity--;
    this.character.items = this.character.items.filter(entry => entry.quantity > 0);
    this.events.push({ type: 'portalOpen', position: { x: point[0], z: point[1] } });
    this.portal = {
      area: area.id,
      departure: { position: [...point], yaw: encounter.player.yaw, height: encounter.player.y },
    };
    this.save();
  }

  portalPosition(area: AreaDefinition): Point | null {
    if (!this.portal) return null;
    if (area.id === homeArea) return area.portalArrival?.position ?? null;
    return area.id === this.portal.area ? this.portal.departure.position : null;
  }

  portalHeight(area: AreaDefinition): number {
    return area.id === this.portal?.area ? this.portal.departure.height ?? 0 : 0;
  }
}
