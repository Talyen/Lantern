import { createEncounter, playerMaxHealth, enemyIds, type Encounter, type EnemyId } from './encounter';
import type { Point, Spawn } from './area';
import type { AreaDefinition, Campfire, Chest } from '../levels/types';
import { itemIds, normalizeLoadout, type ItemId, type Loadout } from './equipment';
import { countItem, itemLoadout, lootDefinitions, receive, validItems, transferItem, type InventoryItem, type LootItem } from './inventory';

import { progression, progressMultiplier, shelterRecipe, type Skill, type GatheringSkill } from './skills';

export const characterSaveKey = 'lantern.character.v1';
export const scrollLimit = 99;
export const homeArea = 'homestead';
export type CharacterSave = { version: 4; items: InventoryItem[]; stash: InventoryItem[]; shelterRestored: boolean; restedSeconds: number; campfires: string[]; xp: { woodcutting: number; mining: number; axeCombat: number }; campClaims: ItemId[]; readonly scrolls: number; readonly wood: number; readonly equipment: ItemId[]; readonly loadout: Loadout };
export type GroundDrop = { id: string; item: LootItem; quantity: number; position: Point; origin: Point; height: number; age: number; claim?: ItemId; instanceId?: string; blocked?: boolean; harvestXp?: { skill: GatheringSkill; perUnit: number } };
export type PortalLink = { area: string; departure: Spawn };
type AreaSession = { encounter?: Encounter; drops: GroundDrop[]; dropRolled: Partial<Record<EnemyId, boolean>>; chests: Record<string, { opened: boolean; remaining: number }> };
function character(items: InventoryItem[] = [{ id: 'item-1', item: 'axe', quantity: 1, slot: 'main', x: 0, y: 0 }, { id: 'item-2', item: 'scroll', quantity: 3, slot: 'bag', x: 0, y: 0 }]): CharacterSave {
  const value = { version: 4 as const, items, stash: [] as InventoryItem[], shelterRestored: false, restedSeconds: 0, campfires: ['homestead/camp'], xp: { woodcutting: 0, mining: 0, axeCombat: 0 }, campClaims: [] as ItemId[] };
  return Object.defineProperties(value, {
    scrolls: { get: () => countItem(value.items.filter(i => i.slot !== 'overflow'), 'scroll') },
    wood: { get: () => countItem(value.items, 'wood') },
    equipment: { get: () => value.items.filter(i => itemIds.includes(i.item as ItemId)).map(i => i.item as ItemId) },
    loadout: { get: () => itemLoadout(value.items) },
  }) as CharacterSave;
}
export type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
export const chestUnlocked = (encounter: Encounter, chest: Chest) => encounter.enemies[chest.guard ?? 'enemy'].hp <= 0;
export const fireKey = (area: string, fire: string) => `${area}/${fire}`;
export const near = (point: Point, target: Point, radius: number) => Math.hypot(point[0] - target[0], point[1] - target[1]) <= radius;

/** Continuing character state and inactive area snapshots; no rendering/browser dependencies. */
export type AdventureEvent = { type: 'chestOpen' | 'returnCast' | 'portalOpen' | 'portalClose' | 'fireDiscovered' | 'healing'; position?: {x:number;z:number} } | {type:'lootDrop' | 'lootLand' | 'lootPickup'; item:LootItem; position:{x:number;z:number}};
export class Adventure {
  private events: AdventureEvent[] = [];
  private healing = false;
  takeEvents(): AdventureEvent[] { const events = this.events; this.events = []; return events; }
  character = character();
  portal: PortalLink | null = null;
  castRemaining = 0;
  saveError = '';
  notice = '';
  private noticeTime = 0;
  private atShelter = false;
  private checkpoint = 0;
  currentArea: string | null = null;
  pickupTarget: string | null = null;
  placeGround: (origin: Point, index: number) => { position: Point; height: number } = origin => ({ position: [...origin], height: 0 });
  canCollectGround: (drop: GroundDrop) => boolean = () => true;
  private sessions = new Map<string, AreaSession>();
  private sequence = 2;
  newId = (): string => `item-${++this.sequence}`;
  constructor(private storage?: Storage, private random = Math.random) {
    if (!storage) return;
    try {
      const raw = storage.getItem(characterSaveKey); if (!raw) return;
      const value = JSON.parse(raw), counter = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER;
      if (![1, 2, 3, 4].includes(value?.version) || !Array.isArray(value.campfires) || !value.campfires.every((id: unknown) => typeof id === 'string')) throw new Error('Invalid character save');
      if (value.version >= 3) {
        if (!validItems(value.items) || !counter(value.xp?.woodcutting) || !counter(value.xp?.axeCombat) || !Array.isArray(value.campClaims) || !value.campClaims.every((id: ItemId) => itemIds.includes(id))) throw new Error('Invalid inventory save');
        if (value.version === 4 && (!validItems(value.stash) || value.stash.some((i: InventoryItem) => i.slot !== 'bag') || new Set([...value.items,...value.stash].map((i: InventoryItem) => i.id)).size !== value.items.length + value.stash.length || typeof value.shelterRestored !== 'boolean' || !counter(value.restedSeconds) || value.restedSeconds > progression.restedSeconds || !counter(value.xp.mining) || !value.shelterRestored && (value.stash.length || value.restedSeconds))) throw new Error('Invalid Homestead save');
        this.character = character(value.items);
        this.character.xp = { woodcutting: value.xp.woodcutting, axeCombat: value.xp.axeCombat, mining: value.version === 4 ? value.xp.mining : 0 }; this.character.campClaims = [...new Set<ItemId>(value.campClaims)];
        if (value.version === 4) { this.character.stash = value.stash; this.character.shelterRestored = value.shelterRestored; this.character.restedSeconds = value.restedSeconds; }
        for (const entry of [...value.items,...this.character.stash]) this.sequence = Math.max(this.sequence, Number(entry.id.match(/^item-(\d+)$/)?.[1] ?? 0));
      } else {
        if (!Number.isSafeInteger(value.scrolls) || !counter(value.scrolls) || value.scrolls > scrollLimit) throw new Error('Invalid scroll save');
        if (value.version === 2 && (!Array.isArray(value.equipment) || !value.equipment.every((id: ItemId) => itemIds.includes(id)) || !Number.isSafeInteger(value.wood) || !counter(value.wood) || !counter(value.xp?.woodcutting) || !counter(value.xp?.axeCombat) || typeof value.campEquipmentClaimed !== 'boolean'
          || !value.loadout || !(value.loadout.main === null || itemIds.includes(value.loadout.main) && value.loadout.main !== 'shield') || ![null, 'shield'].includes(value.loadout.off)
          || value.loadout.main && !value.equipment.includes(value.loadout.main) || value.loadout.off && !value.equipment.includes(value.loadout.off))) throw new Error('Invalid equipment save');
        const items: InventoryItem[] = [], loadout = value.version === 2 ? normalizeLoadout(value.loadout) : { main: 'axe', off: null };
        for (const item of new Set<ItemId>(value.version === 2 ? value.equipment : ['axe'])) items.push({ id: this.newId(), item, quantity: 1, slot: loadout.main === item ? 'main' : loadout.off === item ? 'off' : 'overflow', x: 0, y: 0 });
        // Recover unequipped legacy gear before supplies, preserving anything beyond capacity.
        for (const entry of [...items]) if (entry.slot === 'overflow') {
          items.splice(items.indexOf(entry), 1);
          if (!receive(items, entry.item, 1, this.newId, entry.id)) items.push(entry);
        }
        for (const [item, quantity] of [['scroll', value.scrolls], ['wood', value.version === 2 ? value.wood : 0]] as [LootItem, number][]) {
          const remainder = quantity - receive(items, item, quantity, this.newId);
          if (remainder) items.push({ id: this.newId(), item, quantity: remainder, slot: 'overflow', x: 0, y: 0 });
        }
        this.character = character(items);
        if (value.version === 2) { this.character.xp = { woodcutting: value.xp.woodcutting, axeCombat: value.xp.axeCombat, mining: 0 }; if (value.campEquipmentClaimed) this.character.campClaims = ['sword', 'shield', 'bow', 'staff']; }
      }
      this.character.campfires = [...new Set<string>(['homestead/camp', ...value.campfires])];
      if (value.version !== 4) this.save();
    } catch { this.saveError = 'Unable to load progress. Check local storage before restarting.'; }
  }
  save(): void {
    if (!this.storage) return;
    try { this.storage.setItem(characterSaveKey, JSON.stringify(this.character)); this.saveError = ''; }
    catch { this.saveError = 'Unable to save progress. Allow local storage before restarting.'; }
  }
  replaceItems(items: InventoryItem[]): void { this.character.items = items; this.save(); }
  message(text: string): void { this.notice = text; this.noticeTime = 2; }
  cancelPickup(): void { this.pickupTarget = null; }
  spawnDrop(item: LootItem, quantity: number, origin: Point, options: Partial<Pick<GroundDrop, 'claim' | 'instanceId' | 'blocked' | 'harvestXp'>> = {}): GroundDrop {
    const point = this.placeGround(origin, this.session().drops.length);
    const drop: GroundDrop = { id: this.newId(), item, quantity, origin: [...origin], ...point, age: 0, ...options };
    this.session().drops.push(drop); this.events.push({type:'lootDrop',item,position:{x:drop.position[0],z:drop.position[1]}}); return drop;
  }
  dropItem(id: string, quantity: number, origin: Point): void {
    const entry = this.character.items.find(i => i.id === id);
    if (!entry || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > entry.quantity) throw new Error('Item is no longer available.');
    if (entry.item === 'scroll' && this.castRemaining > 0 && this.character.scrolls - quantity < 1) throw new Error('Scroll is in use.');
    if (entry.slot === 'main' || entry.slot === 'off') throw new Error('Move equipped gear into the bag before dropping it.');
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
    if (!drop || drop.age < .55 || !near(point, drop.position, 1.5)) return false;
    if (!this.canCollectGround(drop)) { if (manual) this.message('Can’t reach item'); return false; }
    if (drop.blocked && !manual) return false;
    const amount = receive(this.character.items, drop.item, drop.quantity, this.newId, drop.instanceId);
    if (!amount) { if (manual) this.message('Inventory full'); return false; }
    this.events.push({type:'lootPickup',item:drop.item,position:{x:drop.position[0],z:drop.position[1]}});
    if (drop.harvestXp) this.awardXp(drop.harvestXp.skill, amount * drop.harvestXp.perUnit);
    drop.quantity -= amount;
    if (drop.claim) this.character.campClaims = [...new Set([...this.character.campClaims, drop.claim])];
    if (!drop.quantity) this.session().drops.splice(this.session().drops.indexOf(drop), 1);
    this.save(); return true;
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
  enter(encounter: Encounter, area: AreaDefinition, arrival = area.layout.player, recover = false): void {
    const health = this.currentArea ? encounter.player.hp : playerMaxHealth;
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
    next.player.hp = recover ? playerMaxHealth : health;
    Object.assign(encounter, next);
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
    if (state.remaining) this.spawnDrop('scroll', state.remaining, chest.position);
    if (area.id === 'clearing') for (const item of ['sword', 'shield', 'bow', 'staff'] as ItemId[]) if (!this.character.campClaims.includes(item)) this.spawnDrop(item, 1, chest.position, { claim: item });
    state.opened = true; state.remaining = 0; return true;
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
    const healing = encounter.player.hp < playerMaxHealth && !!area.campfires?.some(fire => fire.heals && near(point, fire.position, 3) && this.fireSafe(area, fire, encounter));
    if (healing && !this.healing) this.events.push({type:'healing'});
    this.healing = healing;
    if (healing) encounter.player.hp = Math.min(playerMaxHealth, encounter.player.hp + playerMaxHealth * .03 * dt);
    const session = this.session();
    if (area.kind !== 'safe') for (const id of enemyIds) {
      const enemy = encounter.enemies[id];
      if (enemy.home && enemy.hp <= 0 && !session.dropRolled[id]) {
        session.dropRolled[id] = true;
        if (this.random() < .5) this.spawnDrop('scroll', 1, [enemy.x, enemy.z]);
      }
    }
    for (const drop of [...session.drops]) {
      if (drop.age < .55 && drop.age + dt >= .55) this.events.push({type:'lootLand',item:drop.item,position:{x:drop.position[0],z:drop.position[1]}});
      drop.age += dt;
      if (drop.blocked && !near(point, drop.position, 1.5)) drop.blocked = false;
      if (lootDefinitions[drop.item].stackable) this.pickup(drop.id, point);
    }
    if (this.castRemaining > 0) {
      this.castRemaining = Math.max(0, this.castRemaining - dt);
      if (this.castRemaining === 0) {
        const scroll = this.character.items.find(i => i.item === 'scroll' && i.slot === 'bag');
        if (!scroll) return;
        scroll.quantity--; this.character.items = this.character.items.filter(i => i.quantity > 0);
        this.events.push({type:'portalOpen',position:{x:point[0],z:point[1]}});
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
