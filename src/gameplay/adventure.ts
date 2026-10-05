import { advanceWeather } from './weather';
import { resourceDefinitions, type ResourceDefinition } from '../levels/resources';
import { Harvesting, type TreeChange } from './harvesting';
import { renewalSeconds, renewalDistance, sameSource, type RewardSource, type SavedEnemy, type SavedChest, type OutingSave } from './outing';
import { enterAreaEncounter } from './area-encounter';
import { chestRewards, enemyRewards } from './adventure-rewards';
import {
  advanceGroundDrops, collectGroundDrop, lootEvent,
  type DropOptions, type GroundDrop, type GroundItem, type LootEvent,
} from './ground-loot';
import { purchase, sale, repurchase } from './shop-transactions';
import { forged, reclaimed, learnedRecipes, smithing, type SmithingContainer } from './smithing';
import { canRepairShelter, restoredShelter } from './homestead-transactions';
import { validBar, abilityUnlocked, weaponTrees, type AbilityId, type ActionBar, type WeaponSet } from './abilities';
import { createEncounter, healthRegeneration, inCombat, type Encounter, type EnemyId } from './encounter';
import { near, type Point, type Spawn } from './area';
import type { AreaDefinition, Campfire, Chest } from '../levels/types';
import { equipmentCatalog, type ItemId } from './equipment';
import { character, type CharacterSave } from './character';
import { CharacterPersistence, type StorageSource } from './character-persistence';
export { characterSaveKey } from './character-save';
export type { CharacterSave } from './character';
import { lootDefinitions, removeQuantity, transferItem, validatedContainers, type InventoryItem, type LootItem } from './inventory';

import { progression, withSkillXp, combatSkills, type Skill, type GatheringSkill } from './skills';

export const homeArea = 'homestead';
export { dropLandingSeconds, pickupRadius, type GroundDrop, type GroundItem } from './ground-loot';
export { near } from './area';
export type ReturnSpawn = Spawn & { height?: number };
export type PortalLink = { area: string; departure: ReturnSpawn };
type AreaSession = {
  encounter?: Encounter;
  drops: GroundDrop[];
  dropRolled: Partial<Record<EnemyId, boolean>>;
  chests: Record<string, SavedChest>;
  enemies: Record<string, SavedEnemy>;
};
const fireKey = (area: string, fire: string) => `${area}/${fire}`;

export type AdventureEvent =
  | { type: 'enemyRenewed'; id: string }
  | {
    type: 'chestOpen' | 'returnCast' | 'portalOpen' | 'portalClose' | 'fireDiscovered' | 'healing' | 'potionUse';
    position?: { x: number; z: number };
  }
  | {
    type: 'healthRecovered';
    source: 'potion' | 'campfire' | 'regeneration';
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
  private healing: 'campfire' | 'regeneration' | null = null;
  takeEvents(): AdventureEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  readonly harvesting = new Harvesting();
  private definitions: Record<string, AreaDefinition> = {};
  private templates = new Map<string, Encounter>();
  private liveEncounter?: Encounter;
  private elapsed = 0;
  private nextRenewalAt = Infinity;
  private resourceChanges: TreeChange[] = [];
  /** Presentation supplies conservative restored bounds; inactive areas need no camera query. */
  canRenew: (source: RewardSource, position: Point, height: number, radius: number, arriving: boolean) => boolean = (_source, point, _height, radius, arriving) =>
    arriving && !!this.liveEncounter && Math.hypot(point[0] - this.liveEncounter.player.x, point[1] - this.liveEncounter.player.z) >= renewalDistance + radius;
  takeResourceChanges(): TreeChange[] { const changes = this.resourceChanges; this.resourceChanges = []; return changes; }
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
  private sequence = 3;
  newId = (): string => `item-${++this.sequence}`;
  private readonly persistence: CharacterPersistence;
  constructor(storage?: StorageSource, private random = Math.random, private readonly sessionSave?: { character: CharacterSave; save(value: CharacterSave): void; diagnostics(): { pending: boolean; error: string } }) {
    this.persistence = new CharacterPersistence(storage);
    if (sessionSave) { this.adoptCharacter(sessionSave.character); return; }
    const loaded = this.persistence.load();
    if (loaded) {
      this.adoptCharacter(loaded);
      this.save();
    }
  }

  private adoptCharacter(value: CharacterSave): void {
    this.character = value;
    this.elapsed = value.outing.elapsed;
    this.portal = value.outing.portal;
    this.sessions.clear();
    for (const [id, area] of Object.entries(value.outing.areas)) {
      this.sessions.set(id, { enemies: structuredClone(area.enemies), chests: structuredClone(area.chests), drops: structuredClone(area.drops), dropRolled: Object.fromEntries(Object.entries(area.enemies).filter(([, enemy]) => enemy.rewarded).map(([id]) => [id, true])) });
      for (const drop of area.drops) for (const id of [drop.id, drop.instanceId])
        this.sequence = Math.max(this.sequence, Number(id?.match(/^item-(\d+)$/)?.[1] ?? 0));
    }
    this.nextRenewalAt = this.elapsed;
    for (const entry of [...value.items, ...value.stash, ...value.buyback]) {
      this.sequence = Math.max(this.sequence, Number(entry.id.match(/^item-(\d+)$/)?.[1] ?? 0));
    }
  }

  async prepareSave(): Promise<void> {
    if (this.sessionSave) return;
    const loaded = await this.persistence.initialize();
    if (loaded) this.adoptCharacter(loaded);
    this.save();
  }

  configureAreas(definitions: Record<string, AreaDefinition>): void {
    this.definitions = definitions;
    this.templates.clear();
    for (const area of Object.values(definitions)) {
      this.templates.set(area.id, createEncounter('playing', area.layout));
      this.harvesting.register(area.id, resourceDefinitions(area));
      const session = this.sessions.get(area.id);
      if (session) {
        const valid = this.templates.get(area.id)!;
        session.enemies = Object.fromEntries(Object.entries(session.enemies).filter(([id]) => !!valid.enemies[id]?.home));
        session.chests = Object.fromEntries(Object.entries(session.chests).filter(([id]) => area.chests?.some(chest => chest.id === id)));
      }
    }
    for (const id of this.sessions.keys()) if (!definitions[id]) this.sessions.delete(id);
    this.harvesting.restore(this.elapsed, Object.fromEntries(Object.entries(this.character.outing.areas).map(([id, area]) => [id, area.resources])));
    if (this.portal && !definitions[this.portal.area]) this.portal = null;
  }

  resume(areas: Record<string, AreaDefinition>): { area: AreaDefinition; spawn: ReturnSpawn } {
    const key = this.character.outing.checkpoint;
    const area = Object.values(areas).find(area => area.campfires?.some(fire => fireKey(area.id, fire.id) === key));
    const fire = area?.campfires?.find(fire => fireKey(area.id, fire.id) === key);
    if (area && fire && this.character.campfires.includes(key) && this.fireSafe(area, fire)) return { area, spawn: fire.arrival };
    const home = areas[homeArea];
    this.character.outing.checkpoint = fireKey(homeArea, home.campfires![0].id);
    return { area: home, spawn: home.campfires![0].arrival };
  }

  private snapshot(): void {
    const previous = this.character.outing;
    const areas: OutingSave['areas'] = {};
    for (const area of Object.values(this.definitions)) this.session(area.id);
    for (const [id, session] of this.sessions) {
      const encounter = id === this.currentArea ? this.liveEncounter : session.encounter;
      if (encounter) for (const enemyId of encounter.enemyIds) {
        const enemy = encounter.enemies[enemyId];
        if (!enemy.home) continue;
        const old = session.enemies[enemyId];
        session.enemies[enemyId] = { hp: Math.max(0, enemy.hp), lowestHp: enemy.lowestHp, rewarded: !!session.dropRolled[enemyId],
          renewAt: enemy.hp <= 0 ? old?.renewAt ?? this.elapsed + renewalSeconds : undefined };
      }
      areas[id] = { enemies: structuredClone(session.enemies), chests: structuredClone(session.chests), drops: structuredClone(session.drops), resources: this.definitions[id] ? this.harvesting.snapshot(id) : previous.areas[id]?.resources ?? {} };
    }
    const e = this.liveEncounter;
    this.character.outing = { weather: structuredClone(previous.weather), elapsed: this.elapsed, checkpoint: previous.checkpoint, portal: structuredClone(this.portal), areas,
      cooldowns: e ? { abilityCooldowns: { ...e.abilityCooldowns }, ultimateCooldown: e.ultimateCooldown, potionCooldown: e.potionCooldown, dodgeCooldown: e.dodgeCooldown, attackCooldown: e.attackCooldown } : previous.cooldowns };
  }
  advanceWeather(seconds: number): void { advanceWeather(this.character.outing.weather, seconds); }
  capture(): CharacterSave { this.snapshot(); return this.character; }
  save(): void { this.snapshot(); if (this.sessionSave) this.sessionSave.save(this.character); else this.persistence.request(this.character); }
  closeSave(): void { this.snapshot(); this.persistence.close(this.character); }
  saveDiagnostics() { return this.sessionSave ? { loaded: true, failures: 0, blockedByExisting: false, ...this.sessionSave.diagnostics() } : this.persistence.diagnostics(); }
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
    this.harvesting.reset();
    this.elapsed = 0;
    this.nextRenewalAt = Infinity;
    this.portal = null;
    this.castRemaining = 0;
    this.cancelPickup();
    this.notice = '';
    this.noticeTime = 0;
    this.healing = null;
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
    const items = removeQuantity(this.character.items, id, quantity);
    this.spawnDrop(entry.item, quantity, origin, {
      blocked: lootDefinitions[entry.item].stackable,
      instanceId: lootDefinitions[entry.item].stackable ? undefined : entry.id,
    });
    this.replaceItems(items);
  }

  recoverItem(id: string): void {
    const entry = this.character.items.find(item => item.id === id && item.slot === 'overflow');
    if (!entry) return;
    const next = transferItem([entry], this.character.items.filter(item => item.id !== id), id, entry.quantity, this.newId);
    this.replaceItems([...next.destination, ...next.source]);
  }

  pickup(id: string, point: Point, manual = false): boolean {
    let nextXp=this.character.xp;
    const prepare = this.session().drops.find(drop=>drop.id===id)?.harvestXp
      ? (drop: GroundDrop, amount: number) => {
        const harvest=drop.harvestXp!;
        nextXp=withSkillXp(this.character.xp,harvest.skill,amount*harvest.perUnit,this.character.restedSeconds);
      } : undefined;
    const result = collectGroundDrop(this.session().drops, id, point, this.character, this.newId, this.canCollectGround, manual, prepare);
    if (!result.collected) {
      if (result.notice) this.message(result.notice);
      return false;
    }
    const { drop } = result;
    this.character.xp=nextXp;
    this.events.push(lootEvent('lootPickup', drop));
    this.save();
    return true;
  }

  private assertService(encounter: Encounter, area: AreaDefinition, service: 'shop' | 'smithing'): void {
    const station = area[service], reach = service === 'smithing' ? smithing.reach : 1.8;
    if (this.currentArea !== homeArea || area.id !== homeArea || area.kind !== 'safe' || !station || encounter.player.hp <= 0
      || encounter.player.lock > 0 || encounter.dodgeRemaining > 0 || !['playing', 'won'].includes(encounter.phase)
      || this.castRemaining > 0 || !near([encounter.player.x, encounter.player.z], station.position, reach))
      throw new Error(service === 'shop' ? 'Shop is out of reach.' : 'Smithing is out of reach.');
  }

  buy(encounter: Encounter, area: AreaDefinition, item: LootItem): void {
    this.assertService(encounter, area, 'shop');
    Object.assign(this.character, purchase(this.character, item, this.newId));
    this.save();
  }

  sell(encounter: Encounter, area: AreaDefinition, id: string): void {
    this.assertService(encounter, area, 'shop');
    Object.assign(this.character, sale(this.character, id));
    this.save();
  }

  buyBack(encounter: Encounter, area: AreaDefinition, id: string): void {
    this.assertService(encounter, area, 'shop');
    Object.assign(this.character, repurchase(this.character, id, this.newId));
    this.save();
  }

  private commitSmithing(next: ReturnType<typeof forged>): string[] {
    const learned=new Set(learnedRecipes(this.character.xp.smithing).map(recipe=>recipe.item));
    Object.assign(this.character,next);
    this.save();
    return learnedRecipes(this.character.xp.smithing).filter(recipe=>!learned.has(recipe.item)).map(recipe=>equipmentCatalog[recipe.item].name);
  }

  forge(encounter:Encounter,area:AreaDefinition,item:ItemId):string[] {
    this.assertService(encounter,area,'smithing');
    return this.commitSmithing(forged(this.character,item,this.newId));
  }

  reclaim(encounter:Encounter,area:AreaDefinition,id:string,container:SmithingContainer):string[] {
    this.assertService(encounter,area,'smithing');
    return this.commitSmithing(reclaimed(this.character,id,container,this.newId));
  }

  grantHarvest(item: 'wood' | 'stone' | 'iron', quantity: number, skill: GatheringSkill, xpPerUnit: number, position: Point, source?: RewardSource): void {
    this.spawnDrop(item, quantity, position, { harvestXp: { skill, perUnit: xpPerUnit }, source });
    this.save();
  }

  awardXp(skill: Skill, amount: number): void {
    this.character.xp=withSkillXp(this.character.xp,skill,amount,this.character.restedSeconds);
  }

  grantWeaponXp(family: keyof typeof combatSkills, amount: number): void {
    if (!Number.isFinite(amount) || amount<=0) return;
    const locked=weaponTrees[family].filter(id=>!abilityUnlocked(id,this.character.xp));
    this.awardXp(combatSkills[family],amount);
    for (const id of locked) if (abilityUnlocked(id,this.character.xp)) {
      const empty=this.character.actionBar.indexOf(null);
      if (empty>=0) this.character.actionBar[empty]=id;
      this.events.push({type:'abilityLearned',ability:id,slot:empty>=0 ? empty : null});
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
      session = { drops: [], dropRolled: {}, chests: {}, enemies: {} };
      this.sessions.set(id, session);
    }

    return session;
  }

  /** Call only after destination resources are ready; failed loads cannot change these states. */
  enter(encounter: Encounter, area: AreaDefinition, arrival: ReturnSpawn = area.layout.player, recover = false, consumePortal?: PortalLink): void {
    const firstEntry = this.currentArea === null;
    const health = this.currentArea ? encounter.player.hp : null;
    if (this.currentArea) this.session().encounter = structuredClone(encounter);
    this.currentArea = area.id;
    this.liveEncounter = encounter;
    if (!this.templates.has(area.id)) this.templates.set(area.id, createEncounter('playing', area.layout));
    const retained = this.session();
    if (!retained.encounter && Object.keys(retained.enemies).length) {
      retained.encounter = createEncounter('playing', area.layout);
      for (const [id, saved] of Object.entries(retained.enemies)) {
        const enemy = retained.encounter.enemies[id];
        if (enemy?.home) { enemy.hp = saved.hp; enemy.lowestHp = saved.lowestHp; }
      }
    }
    enterAreaEncounter(encounter, area, {
      previous: this.session().encounter, character: this.character, arrival, recover, health,
    });
    if (firstEntry) Object.assign(encounter, structuredClone(this.character.outing.cooldowns));
    this.castRemaining = 0;
    this.cancelPickup();
    this.healing = null;
    this.atShelter = false;
    this.events = [];
    if (recover || consumePortal && this.portal === consumePortal) this.portal = null;
    this.nextRenewalAt = this.elapsed;
    this.renew(encounter, area, 0, true);
    this.save();
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
    const session = this.session(area.id);
    const live = active ?? (this.currentArea === area.id ? this.liveEncounter : undefined);
    const encounter = live ?? session.encounter ?? createEncounter('playing', area.layout);
    if (!live && !session.encounter) for (const [id, saved] of Object.entries(session.enemies)) {
      if (encounter.enemies[id]) encounter.enemies[id].hp = saved.hp;
    }
    return encounter.enemyIds.every(id => {
      const enemy = encounter.enemies[id];
      return enemy.hp <= 0 || (!enemy.engaged && !enemy.returning && !near([enemy.x, enemy.z], fire.position, 10));
    });
  }

  canTravel(encounter: Encounter, sourceArea: AreaDefinition, source: Campfire, targetArea: AreaDefinition, target: Campfire): boolean {
    return this.currentArea === sourceArea.id && encounter.player.hp > 0 && this.castRemaining === 0
      && near([encounter.player.x, encounter.player.z], source.position, 3) && this.fireSafe(sourceArea, source, encounter)
      && this.character.campfires.includes(fireKey(targetArea.id, target.id));
  }

  chest(area: AreaDefinition, chest: Chest): SavedChest {
    return this.session(area.id).chests[chest.id] ??= { opened: false, remaining: chest.scrolls };
  }

  /** Pending discoveries also reserve their identity when authored reward sources move. */
  private unavailableDiscoveries(): ItemId[] {
    return [...this.character.campClaims, ...[...this.sessions.values()].flatMap(session =>
      session.drops.flatMap(drop => drop.claim ? [drop.claim] : []))];
  }

  openChest(encounter: Encounter, area: AreaDefinition, chest: Chest): boolean {
    if (this.currentArea !== area.id || encounter.player.hp <= 0
      || this.castRemaining > 0 || !near([encounter.player.x, encounter.player.z], chest.position, 1.8)) return false;
    const state = this.chest(area, chest);
    if (state.opened) return false;
    this.events.push({ type: 'chestOpen', position: { x: chest.position[0], z: chest.position[1] } });
    for (const reward of chestRewards(chest, state.remaining, area.level, this.unavailableDiscoveries(), this.random))
      this.spawnDrop(reward.item, reward.quantity, chest.position, { ...reward.options, source: { kind: 'chest', id: chest.id } });
    state.opened = true;
    state.remaining = 0;
    state.renewAt = this.elapsed + renewalSeconds;
    this.nextRenewalAt = Math.min(this.nextRenewalAt, state.renewAt);
    this.save();
    return true;
  }

  destinations(areas: Record<string, AreaDefinition>): { area: AreaDefinition; fire: Campfire }[] {
    return Object.values(areas).flatMap(area => (area.campfires ?? [])
      .filter(fire => area.id !== this.currentArea && this.character.campfires.includes(fireKey(area.id, fire.id)))
      .map(fire => ({ area, fire })));
  }

  beginCast(alive: boolean, id?: string): boolean {
    if (!alive || this.currentArea === homeArea || this.character.scrolls === 0 || this.castRemaining > 0) return false;
    if (id !== undefined && !this.character.items.some(entry => entry.id === id && entry.item === 'scroll' && entry.slot === 'bag')) return false;
    this.castItemId = id;
    this.castRemaining = 2;
    this.events.push({ type: 'returnCast' });
    return true;
  }

  /** Development fixtures advance renewal alone; production steps always use gameplay dt. */
  advanceRenewal(encounter: Encounter, area: AreaDefinition, seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid clock advance');
    this.elapsed += seconds;
    this.renew(encounter, area, seconds);
    this.save();
  }

  private sourceSafe(areaId: string, source: RewardSource, position: Point, height = 0, radius = 1, arriving = false): boolean {
    if (areaId !== this.currentArea) return true;
    const eligible = (point: Point, y: number, r: number) => this.canRenew(source, point, y, r, arriving);
    if (!eligible(position, height, radius)) return false;
    return this.session(areaId).drops.filter(drop => sameSource(drop.source, source))
      .every(drop => eligible(drop.position, drop.height, .5));
  }
  private clearSource(areaId: string, source: RewardSource): void {
    const session = this.session(areaId);
    const removed = session.drops.filter(drop => sameSource(drop.source, source));
    session.drops = session.drops.filter(drop => !sameSource(drop.source, source));
    if (removed.some(drop => drop.id === this.pickupTarget)) this.cancelPickup();
  }
  private renew(encounter: Encounter, area: AreaDefinition, dt: number, arriving = false): void {
    const occupants = [{ areaId: area.id, position: [encounter.player.x, encounter.player.z] as Point },
      ...encounter.enemyIds.filter(id => encounter.enemies[id].hp > 0).map(id => ({ areaId: area.id, position: [encounter.enemies[id].x, encounter.enemies[id].z] as Point }))];
    const resources = this.harvesting.advance(dt, occupants, (id, node: ResourceDefinition) => {
      // Inactive resources wait for entry, so restoration cannot alter an arrival around the player.
      return id === area.id && this.sourceSafe(id, { kind: 'resource', id: node.id }, [node.position[0], node.position[2]], node.position[1], node.radius, arriving);
    });
    for (const change of resources) this.clearSource(change.areaId, { kind: 'resource', id: change.id });
    this.resourceChanges.push(...resources);
    let changed = resources.length > 0;
    if (this.elapsed >= this.nextRenewalAt) {
      this.nextRenewalAt = Infinity;
      const session = this.session(area.id), template = this.templates.get(area.id)!;
      for (const [id, saved] of Object.entries(session.enemies)) {
        if (saved.renewAt === undefined) continue;
        const spawn = template.enemies[id];
        if (!spawn?.home) continue;
        if (saved.renewAt <= this.elapsed && this.sourceSafe(area.id, { kind: 'enemy', id }, [spawn.x, spawn.z], spawn.y, 1, arriving)
          && !occupants.some(actor => Math.hypot(actor.position[0] - spawn.x, actor.position[1] - spawn.z) < 1)) {
          encounter.enemies[id] = structuredClone(spawn);
          session.enemies[id] = { hp: spawn.hp, lowestHp: spawn.lowestHp, rewarded: false };
          session.dropRolled[id] = false;
          this.clearSource(area.id, { kind: 'enemy', id });
          encounter.phase = 'playing';
          changed = true;
          this.events.push({ type: 'enemyRenewed', id });
        } else this.nextRenewalAt = Math.min(this.nextRenewalAt, Math.max(this.elapsed + .5, saved.renewAt));
      }
      for (const chest of area.chests ?? []) {
        const state = session.chests[chest.id];
        if (state?.renewAt === undefined) continue;
        if (state.renewAt <= this.elapsed && this.sourceSafe(area.id, { kind: 'chest', id: chest.id }, chest.position, 0, 1, arriving)
          && !occupants.some(actor => Math.hypot(actor.position[0] - chest.position[0], actor.position[1] - chest.position[1]) < 1)) {
          this.clearSource(area.id, { kind: 'chest', id: chest.id });
          session.chests[chest.id] = { opened: false, remaining: chest.scrolls };
          changed = true;
        } else this.nextRenewalAt = Math.min(this.nextRenewalAt, Math.max(this.elapsed + .5, state.renewAt));
      }
    }
    if (changed && !arriving) this.save();
  }

  step(encounter: Encounter, area: AreaDefinition, dt: number): void {
    // Death takes precedence over landing, rewards and cast completion.
    if (encounter.player.hp <= 0) {
      const changed = !!this.portal || this.castRemaining > 0;
      if (this.portal) this.events.push({ type: 'portalClose' });
      this.castRemaining = 0;
      this.portal = null;
      this.cancelPickup();
      this.healing = null;
      if (changed) this.save();
      return;
    }

    this.elapsed += Math.max(0, dt);
    this.renew(encounter, area, dt);
    this.noticeTime = Math.max(0, this.noticeTime - dt);
    if (!this.noticeTime) this.notice = '';
    const point: Point = [encounter.player.x, encounter.player.z];

    this.updateRested(area, point, dt);
    this.discover(area, point);
    for (const fire of area.campfires ?? []) if (near(point, fire.position, 3) && this.fireSafe(area, fire, encounter)) {
      const key = fireKey(area.id, fire.id);
      if (this.character.outing.checkpoint !== key) { this.character.outing.checkpoint = key; this.save(); }
    }
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
      this.save();
    }
  }

  private updateHealing(encounter: Encounter, area: AreaDefinition, point: Point, dt: number): void {
    const atFire = !!area.campfires?.some(
      fire => fire.heals && near(point, fire.position, 3) && this.fireSafe(area, fire, encounter),
    );
    const healing = encounter.player.hp < encounter.stats.maxHealth
      ? atFire ? 'campfire' : encounter.healthRecoveryElapsed > 0 && !inCombat(encounter) ? 'regeneration' : null
      : null;
    if (healing === 'campfire' && this.healing !== 'campfire') this.events.push({ type: 'healing' });
    if (this.healing && healing !== this.healing) this.events.push({ type: 'healthRecovered', source: this.healing, amount: 0, elapsed: 0, finished: true, position: { x: encounter.player.x, y: encounter.player.y, z: encounter.player.z } });
    this.healing = healing;
    if (healing) {
      const previousHealth = encounter.player.hp;
      const elapsed = healing === 'campfire' ? dt : encounter.healthRecoveryElapsed;
      encounter.player.hp = Math.min(
        encounter.stats.maxHealth,
        encounter.player.hp + encounter.stats.maxHealth * (healing === 'campfire' ? .03 : healthRegeneration.rate) * elapsed,
      );
      this.events.push({ type: 'healthRecovered', source: healing, amount: encounter.player.hp - previousHealth, elapsed, finished: encounter.player.hp >= encounter.stats.maxHealth, position: { x: encounter.player.x, y: encounter.player.y, z: encounter.player.z } });
    }
  }

  private rollEnemyDrops(encounter: Encounter, area: AreaDefinition, session: AreaSession): void {
    if (area.kind === 'safe') return;
    for (const id of encounter.enemyIds) {
      const enemy = encounter.enemies[id];
      if (!(enemy.home && enemy.hp <= 0 && !session.dropRolled[id])) continue;
      session.dropRolled[id] = true;
      session.enemies[id] = { hp: 0, lowestHp: enemy.lowestHp, rewarded: true, renewAt: session.enemies[id]?.renewAt ?? this.elapsed + renewalSeconds };
      this.nextRenewalAt = Math.min(this.nextRenewalAt, session.enemies[id].renewAt!);
      const point: Point = [enemy.x, enemy.z];
      for (const reward of enemyRewards(area, id, this.unavailableDiscoveries(), this.random))
        this.spawnDrop(reward.item, reward.quantity, point, { ...reward.options, source: { kind: 'enemy', id } });
      this.save();
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
