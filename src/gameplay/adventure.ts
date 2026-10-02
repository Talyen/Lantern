import { rollGold, shopStock, sellPrices, buybackLimit } from './economy';
import { validBar, type ActionBar, type WeaponSet } from './abilities';
import { applyEquipment, createEncounter, enemyIds, type Encounter, type EnemyId } from './encounter';
import type { Point, Spawn } from './area';
import type { AreaDefinition, Campfire, Chest } from '../levels/types';
import { isEquipmentSlot, itemIds, type ItemId } from './equipment';
import { character, type CharacterSave } from './character-save';
import { CharacterPersistence, type StorageSource } from './character-persistence';
export { characterSaveKey } from './character-save';
export type { CharacterSave } from './character-save';
import { countItem, lootDefinitions, receive, validItems, transferItem, stackLimit, type InventoryItem, type LootItem } from './inventory';

import { progression, progressMultiplier, shelterRecipe, type Skill, type GatheringSkill } from './skills';

export const scrollLimit = stackLimit;
export const homeArea = 'homestead';
export const dropLandingSeconds = .55, pickupRadius = 1.5;
export type GroundItem = LootItem | 'gold';
export type GroundDrop = { id: string; item: GroundItem; quantity: number; position: Point; origin: Point; height: number; age: number; claim?: ItemId; instanceId?: string; blocked?: boolean; harvestXp?: { skill: GatheringSkill; perUnit: number } };
export type ReturnSpawn = Spawn & { height?: number };
export type PortalLink = { area: string; departure: ReturnSpawn };
type AreaSession = { encounter?: Encounter; drops: GroundDrop[]; dropRolled: Partial<Record<EnemyId, boolean>>; chests: Record<string, { opened: boolean; remaining: number }> };
export const chestUnlocked = (encounter: Encounter, chest: Chest) => chest.guard === null || encounter.enemies[chest.guard ?? 'enemy'].hp <= 0;
export const fireKey = (area: string, fire: string) => `${area}/${fire}`;
export const near = (point: Point, target: Point, radius: number) => Math.hypot(point[0] - target[0], point[1] - target[1]) <= radius;

/** Continuing character state and inactive area snapshots; no rendering/browser dependencies. */
export type AdventureEvent = { type: 'chestOpen' | 'returnCast' | 'portalOpen' | 'portalClose' | 'fireDiscovered' | 'healing' | 'potionUse'; position?: {x:number;z:number} } | {type:'lootDrop' | 'lootLand' | 'lootPickup'; item:GroundItem; position:{x:number;z:number}};
export class Adventure {
  private events: AdventureEvent[] = [];
  private healing = false;
  takeEvents(): AdventureEvent[] { const events = this.events; this.events = []; return events; }
  character = character();
  portal: PortalLink | null = null;
  castRemaining = 0;
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
  constructor(storage?: StorageSource, private random = Math.random) {
    this.persistence = new CharacterPersistence(storage);
    const loaded = this.persistence.load();
    if (loaded) { this.adoptCharacter(loaded); this.save(); }
  }
  private adoptCharacter(value: CharacterSave): void {
    this.character = value;
    for (const entry of [...value.items, ...value.stash, ...value.buyback]) this.sequence = Math.max(this.sequence, Number(entry.id.match(/^item-(\d+)$/)?.[1] ?? 0));
  }
  async prepareSave(): Promise<void> {
    const loaded = await this.persistence.initialize();
    if (loaded) this.adoptCharacter(loaded);
    this.save();
  }
  save(): void { this.persistence.request(this.character); }
  closeSave(): void { this.persistence.close(this.character); }
  saveDiagnostics() { return this.persistence.diagnostics(); }
  setActionBar(bar: ActionBar): void { if (!validBar(bar)) throw new Error('Invalid action bar'); this.character.actionBar=[...bar]; this.save(); }
  setWeaponSet(set: WeaponSet): void { this.character.activeSet=set; this.save(); }
  usePotion(encounter: Encounter): boolean {
    const entry=this.character.items.find(i=>i.item==='potion' && i.slot==='bag');
    if (!entry || encounter.player.hp<=0 || encounter.player.hp>=encounter.stats.maxHealth || encounter.potionCooldown>0 || !['playing','won'].includes(encounter.phase)) return false;
    encounter.player.hp=Math.min(encounter.stats.maxHealth,encounter.player.hp+40); encounter.potionCooldown=8;
    entry.quantity--; this.character.items=this.character.items.filter(i=>i.quantity>0);
    this.events.push({type:'potionUse'}); this.save(); return true;
  }
  replaceItems(items: InventoryItem[]): void { this.character.items = items; this.save(); }
  message(text: string): void { this.notice = text; this.noticeTime = 2; }
  cancelPickup(): void { this.pickupTarget = null; }
  /** Restart refreshes the outing while retaining permanent character progress. */
  restart(): void {
    this.sessions.clear(); this.portal = null; this.castRemaining = 0; this.cancelPickup();
    this.notice = ''; this.noticeTime = 0; this.healing = false; this.atShelter = false;
    this.checkpoint = 0; this.events = [];
  }
  spawnDrop(item: GroundItem, quantity: number, origin: Point, options: Partial<Pick<GroundDrop, 'claim' | 'instanceId' | 'blocked' | 'harvestXp'>> = {}): GroundDrop {
    const point = this.placeGround(origin, this.session().drops.length);
    const drop: GroundDrop = { id: this.newId(), item, quantity, origin: [...origin], ...point, age: 0, ...options };
    this.session().drops.push(drop); this.events.push({type:'lootDrop',item,position:{x:drop.position[0],z:drop.position[1]}}); return drop;
  }
  dropItem(id: string, quantity: number, origin: Point): void {
    const entry = this.character.items.find(i => i.id === id);
    if (!entry || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > entry.quantity) throw new Error('Item is no longer available.');
    if (entry.item === 'scroll' && this.castRemaining > 0 && this.character.scrolls - quantity < 1) throw new Error('Scroll is in use.');
    if (isEquipmentSlot(entry.slot)) throw new Error('Move equipped gear into the bag before dropping it.');
    this.spawnDrop(entry.item, quantity, origin, { blocked: lootDefinitions[entry.item].stackable, instanceId: lootDefinitions[entry.item].stackable ? undefined : entry.id });
    entry.quantity -= quantity; this.replaceItems(this.character.items.filter(i => i.quantity > 0));
  }
  recoverItem(id: string): void {
    const next = structuredClone(this.character.items), entry = next.find(i => i.id === id && i.slot === 'overflow'); if (!entry) return;
    next.splice(next.indexOf(entry), 1);
    entry.quantity -= receive(next, entry.item, entry.quantity, this.newId, lootDefinitions[entry.item].stackable ? undefined : entry.id);
    if (entry.quantity) next.push(entry);
    if (entry.quantity === this.character.items.find(i => i.id === id)?.quantity) throw new Error('Inventory full.');
    this.replaceItems(next);
  }
  pickup(id: string, point: Point, manual = false): boolean {
    const drop = this.session().drops.find(d => d.id === id);
    if (!drop || drop.age < dropLandingSeconds || !near(point, drop.position, pickupRadius)) return false;
    if (!this.canCollectGround(drop)) { if (manual) this.message('Can’t reach item'); return false; }
    if (drop.blocked && !manual) return false;
    const amount = drop.item === 'gold' ? Math.min(drop.quantity, Number.MAX_SAFE_INTEGER - this.character.gold) : receive(this.character.items, drop.item, drop.quantity, this.newId, drop.instanceId);
    if (drop.item === 'gold') this.character.gold += amount;
    if (!amount) { if (manual) this.message(drop.item === 'gold' ? 'Gold wallet is full' : 'Inventory full'); return false; }
    this.events.push({type:'lootPickup',item:drop.item,position:{x:drop.position[0],z:drop.position[1]}});
    if (drop.harvestXp) this.awardXp(drop.harvestXp.skill, amount * drop.harvestXp.perUnit);
    drop.quantity -= amount;
    if (drop.claim) this.character.campClaims = [...new Set([...this.character.campClaims, drop.claim])];
    if (!drop.quantity) this.session().drops.splice(this.session().drops.indexOf(drop), 1);
    this.save(); return true;
  }
  private assertShop(encounter: Encounter, area: AreaDefinition): void {
    if (this.currentArea !== homeArea || area.id !== this.currentArea || area.kind !== 'safe' || !area.shop || encounter.player.hp <= 0
      || encounter.player.lock > 0 || encounter.dodgeRemaining > 0 || !['playing','won'].includes(encounter.phase)
      || this.castRemaining > 0 || !near([encounter.player.x, encounter.player.z], area.shop.position, 1.8))
      throw new Error('Shop is out of reach.');
  }
  buy(encounter: Encounter, area: AreaDefinition, item: LootItem): void {
    this.assertShop(encounter, area);
    const offer = shopStock.find(offer => offer.item === item);
    if (!offer) throw new Error('Item is not for sale.');
    if (this.character.gold < offer.price) throw new Error('Not enough gold.');
    const items = structuredClone(this.character.items);
    if (receive(items, item, 1, this.newId) !== 1) throw new Error('Inventory full.');
    this.character.items = items; this.character.gold -= offer.price; this.save();
  }
  sell(encounter: Encounter, area: AreaDefinition, id: string): void {
    this.assertShop(encounter, area);
    const entry = this.character.items.find(entry => entry.id === id);
    if (!entry || entry.slot !== 'bag' || !itemIds.includes(entry.item as ItemId)) throw new Error('Select equipment from your bag.');
    const item = entry.item as ItemId, price = sellPrices[item];
    if (!Number.isSafeInteger(this.character.gold + price)) throw new Error('Gold wallet is full.');
    this.character.items = this.character.items.filter(entry => entry.id !== id);
    this.character.gold += price;
    this.character.buyback = [{ id, item, price }, ...this.character.buyback].slice(0, buybackLimit);
    this.save();
  }
  buyBack(encounter: Encounter, area: AreaDefinition, id: string): void {
    this.assertShop(encounter, area);
    const entry = this.character.buyback.find(entry => entry.id === id);
    if (!entry) throw new Error('Item is no longer available.');
    if (this.character.gold < entry.price) throw new Error('Not enough gold.');
    const items = structuredClone(this.character.items);
    if (receive(items, entry.item, 1, this.newId, entry.id) !== 1) throw new Error('Inventory full.');
    this.character.items = items; this.character.gold -= entry.price;
    this.character.buyback = this.character.buyback.filter(other => other.id !== id); this.save();
  }
  grantHarvest(item: 'wood' | 'stone' | 'iron', quantity: number, skill: GatheringSkill, xpPerUnit: number, position: Point): void {
    this.spawnDrop(item,quantity,position,{harvestXp:{skill,perUnit:xpPerUnit}});
  }
  awardXp(skill: Skill, amount: number): void { this.character.xp[skill] = Math.round((this.character.xp[skill] + amount * progressMultiplier(this.character.restedSeconds)) * 1e6) / 1e6; }
  grantAxeCombatXp(amount = 10): void { this.awardXp('axeCombat',amount); this.save(); }
  canRepair(): boolean { return !this.character.shelterRestored && Object.entries(shelterRecipe).every(([item,cost]) => countItem(this.character.items.filter(i => i.slot === 'bag'),item as LootItem) >= cost); }
  repairShelter(): void {
    if (this.currentArea !== homeArea || !this.canRepair()) throw new Error('Not enough materials.');
    const next = structuredClone(this.character.items);
    for (const [item,cost] of Object.entries(shelterRecipe)) {
      let remaining = cost;
      for (const entry of next.filter(i => i.slot === 'bag' && i.item === item)) { const amount = Math.min(remaining,entry.quantity); entry.quantity -= amount; remaining -= amount; }
    }
    this.character.items = next.filter(i => i.quantity > 0); this.character.shelterRestored = true; this.character.restedSeconds = progression.restedSeconds;
    this.save();
  }
  replaceContainers(items: InventoryItem[], stash: InventoryItem[]): void {
    if (!this.character.shelterRestored || this.currentArea !== homeArea || !validItems(items) || !validItems(stash) || stash.some(i => i.slot !== 'bag') || new Set([...items,...stash].map(i=>i.id)).size !== items.length + stash.length) throw new Error('Item does not fit.');
    this.character.items = items; this.character.stash = stash; this.save();
  }
  transferStash(id: string, quantity: number, toStash: boolean, point?: {x:number;y:number}): void {
    const {items,stash} = this.character;
    const next = transferItem(toStash ? items : stash,toStash ? stash : items,id,quantity,this.newId,point);
    this.replaceContainers(toStash ? next.source : next.destination,toStash ? next.destination : next.source);
  }
  session(id = this.currentArea!): AreaSession {
    let session = this.sessions.get(id);
    if (!session) { session = { drops: [], dropRolled: {}, chests: {} }; this.sessions.set(id, session); }
    return session;
  }
  /** Call only after destination resources are ready; failed loads cannot change these states. */
  enter(encounter: Encounter, area: AreaDefinition, arrival: ReturnSpawn = area.layout.player, recover = false): void {
    const health = this.currentArea ? encounter.player.hp : null;
    const resources={weapon:encounter.weapon,shield:encounter.shield,playerMana:encounter.playerMana,abilityCooldowns:{...encounter.abilityCooldowns},potionCooldown:encounter.potionCooldown,dodgeCooldown:encounter.dodgeCooldown,weaponSets:encounter.weaponSets,activeSet:encounter.activeSet};
    if (this.currentArea) this.session().encounter = structuredClone(encounter);
    this.currentArea = area.id;
    const previous = this.session().encounter;
    const next = createEncounter('playing', area.layout);
    if (previous && area.kind !== 'safe') {
      for (const id of enemyIds) {
        if (next.enemies[id].home && previous.enemies[id].home) next.enemies[id] = { ...previous.enemies[id], home: next.enemies[id].home, lock: 0, attackTime: -1, contactIndex: 0 };
      }
      next.phase = enemyIds.every(id => next.enemies[id].hp <= 0) ? 'won' : 'playing';
    }
    next.player.x = arrival.position[0]; next.player.z = arrival.position[1]; next.player.yaw = arrival.yaw;
    next.player.y = arrival.height ?? 0;
    Object.assign(encounter, next, resources);
    applyEquipment(encounter,this.character.items,this.character.activeSet);
    encounter.player.hp = recover || health === null ? encounter.stats.maxHealth : Math.min(health,encounter.stats.maxHealth);
    if (health === null) encounter.playerMana = encounter.stats.maxMana;
    this.castRemaining = 0; this.cancelPickup(); this.healing = false; this.atShelter = false; this.events = [];
    if (recover) this.portal = null;
  }
  discover(area: AreaDefinition, point: Point): void {
    for (const fire of area.campfires ?? []) {
      const key = fireKey(area.id, fire.id);
      if (near(point, fire.position, 3) && !this.character.campfires.includes(key)) { this.character.campfires.push(key); this.save(); this.events.push({type:'fireDiscovered',position:{x:fire.position[0],z:fire.position[1]}}); }
    }
  }
  fireSafe(area: AreaDefinition, fire: Campfire, active?: Encounter): boolean {
    if (area.kind === 'safe') return true;
    const encounter = active ?? this.session(area.id).encounter ?? createEncounter('playing', area.layout);
    return enemyIds.every(id => { const enemy = encounter.enemies[id]; return enemy.hp <= 0 || (!enemy.engaged && !enemy.returning && !near([enemy.x, enemy.z], fire.position, 10)); });
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
    if (this.currentArea !== area.id || encounter.player.hp <= 0 || !chestUnlocked(encounter,chest) || this.castRemaining > 0 || !near([encounter.player.x, encounter.player.z], chest.position, 1.8)) return false;
    const state = this.chest(area, chest); if (state.opened) return false;
    this.events.push({type:'chestOpen',position:{x:chest.position[0],z:chest.position[1]}});
    const gold = rollGold({ kind: 'chest', areaLevel: area.level, level: chest.level, gold: chest.gold }, this.random);
    if (gold) this.spawnDrop('gold', gold, chest.position);
    if (state.remaining) this.spawnDrop('scroll', state.remaining, chest.position);
    if (chest.potions) this.spawnDrop('potion',chest.potions,chest.position);
    this.guaranteedEquipment(chest.equipment ?? [],chest.position);
    state.opened = true; state.remaining = 0; return true;
  }

  private guaranteedEquipment(items: readonly ItemId[], position: Point): void {
    for (const item of items) if (!this.character.campClaims.includes(item)) this.spawnDrop(item,1,position,{claim:item});
  }

  destinations(areas: Record<string, AreaDefinition>): { area: AreaDefinition; fire: Campfire; available: boolean }[] {
    return Object.values(areas).flatMap(area => (area.campfires ?? []).filter(fire => area.id !== this.currentArea && this.character.campfires.includes(fireKey(area.id, fire.id))).map(fire => ({ area, fire, available: this.fireSafe(area, fire) })));
  }
  beginCast(alive: boolean): boolean {
    if (!alive || this.currentArea === homeArea || this.character.scrolls === 0 || this.castRemaining > 0) return false;
    this.castRemaining = 2; this.events.push({type:'returnCast'}); return true;
  }
  step(encounter: Encounter, area: AreaDefinition, dt: number): void {
    if (encounter.player.hp <= 0) { if (this.portal) this.events.push({type:'portalClose'}); this.castRemaining = 0; this.portal = null; this.cancelPickup(); this.healing = false; return; }
    this.noticeTime = Math.max(0, this.noticeTime - dt); if (!this.noticeTime) this.notice = '';
    const point: Point = [encounter.player.x, encounter.player.z];
    this.character.restedSeconds = Math.max(0,this.character.restedSeconds - dt);
    const atShelter = !!area.shelter && this.character.shelterRestored && near(point,area.shelter.position,progression.restedRadius);
    if (atShelter && !this.atShelter) { this.character.restedSeconds = progression.restedSeconds; this.save(); }
    this.atShelter = atShelter;
    this.checkpoint += dt;
    if (this.checkpoint >= progression.checkpointSeconds) { this.checkpoint = 0; if (this.character.shelterRestored) this.save(); }
    this.discover(area, point);
    const healing = encounter.player.hp < encounter.stats.maxHealth && !!area.campfires?.some(fire => fire.heals && near(point, fire.position, 3) && this.fireSafe(area, fire, encounter));
    if (healing && !this.healing) this.events.push({type:'healing'});
    this.healing = healing;
    if (healing) encounter.player.hp = Math.min(encounter.stats.maxHealth, encounter.player.hp + encounter.stats.maxHealth * .03 * dt);
    const session = this.session();
    if (area.kind !== 'safe') for (const id of enemyIds) {
      const enemy = encounter.enemies[id];
      if (enemy.home && enemy.hp <= 0 && !session.dropRolled[id]) {
        session.dropRolled[id] = true;
        if (this.random() < .5) this.spawnDrop('scroll', 1, [enemy.x, enemy.z]);
        const gold = rollGold({ ...area.layout[id], kind: 'enemy', areaLevel: area.level }, this.random);
        if (gold) this.spawnDrop('gold', gold, [enemy.x, enemy.z]);
        this.guaranteedEquipment(area.enemyEquipment?.[id] ?? [],[enemy.x,enemy.z]);
      }
    }
    for (const drop of [...session.drops]) {
      if (drop.age < dropLandingSeconds && drop.age + dt >= dropLandingSeconds) this.events.push({type:'lootLand',item:drop.item,position:{x:drop.position[0],z:drop.position[1]}});
      drop.age += dt;
      if (drop.blocked && !near(point, drop.position, pickupRadius)) drop.blocked = false;
      if (drop.item === 'gold' || lootDefinitions[drop.item].stackable) this.pickup(drop.id, point);
    }
    if (this.castRemaining > 0) {
      this.castRemaining = Math.max(0, this.castRemaining - dt);
      if (this.castRemaining === 0) {
        const scroll = this.character.items.find(i => i.item === 'scroll' && i.slot === 'bag');
        if (!scroll) return;
        scroll.quantity--; this.character.items = this.character.items.filter(i => i.quantity > 0);
        this.events.push({type:'portalOpen',position:{x:point[0],z:point[1]}});
        this.portal = { area: area.id, departure: { position: [...point], yaw: encounter.player.yaw, height: encounter.player.y } };
        this.save();
      }
    }
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
