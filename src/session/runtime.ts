import type { ResourceDefinition } from '../levels/resources';
import type { Point } from '../gameplay/area';
import type { CharacterView, EncounterView } from '../gameplay/state-view';
import { CombatCommands } from '../gameplay/combat-commands';
import { homeArea, type PortalLink } from '../gameplay/adventure';
import { progression } from '../gameplay/skills';
import type { AbilityId, ActionBar, WeaponSet } from '../gameplay/abilities';
import { sameEquipment, validItems, type InventoryItem, type LootItem } from '../gameplay/inventory';
import type { ItemId } from '../gameplay/equipment';
import type { SmithingContainer } from '../gameplay/smithing';
import type { Adventure, AdventureEvent } from '../gameplay/adventure';
import { near, GateTravel, type Gate, type Spawn } from '../gameplay/area';
import { inCombat, resetEncounter, stepEncounter, stepExploration, type Encounter, type EncounterEvent, type Input, type Movement, type Timings, type AimPoint } from '../gameplay/encounter';
import type { GatheringAction, GatheringEvent } from '../gameplay/gathering-action';
import type { AreaDefinition, Chest, Campfire } from '../levels/types';

export type SessionFeedback = { combat: EncounterEvent[]; gathering: GatheringEvent[]; adventure: AdventureEvent[] };
type RuntimeContext = {
  paused(): boolean;
  impactHolding(): boolean;
  equipmentBlocked(): boolean;
  area(): AreaDefinition;
  movement(): Movement | undefined;
  timings(): Timings;
  interruptApproach(releaseLock?: boolean): void;
  defeated(): void;
};

/** Authoritative tick and immediate command commits; no DOM, actor, audio or renderer dependencies. */
export class SessionRuntime {
  private events: EncounterEvent[] = [];
  private pendingUtility: 'potion' | 'portal' | null = null;
  private readonly combat: CombatCommands;
  private readonly travel = new GateTravel();
  constructor(private readonly encounter: Encounter, private readonly adventure: Adventure,
    private readonly gathering: GatheringAction, private readonly context: RuntimeContext) {
    this.combat = new CombatCommands(encounter, adventure, { ...context, complete: events => this.complete(events) });
  }

  get character(): CharacterView { return this.adventure.character; }
  get state(): EncounterView { return this.encounter; }

  registerResources(resources: ResourceDefinition[], navigation: { setTreeFelled(id: string, felled: boolean): void }): void {
    const area = this.context.area();
    this.adventure.harvesting.register(area.id, resources);
    for (const resource of resources) navigation.setTreeFelled(resource.id, this.adventure.harvesting.state(area.id, resource.id)?.felled ?? false);
  }
  advanceRenewal(seconds: number): void { this.adventure.advanceRenewal(this.encounter, this.context.area(), seconds); this.gathering.advance(0); }
  placePlayer(x: number, z: number, yaw: number): void { this.encounter.player.x = x; this.encounter.player.z = z; this.encounter.player.yaw = yaw; }
  prepareComparisonFixture(): void {
    this.encounter.phase = 'won'; for (const enemy of Object.values(this.encounter.enemies)) enemy.hp = 0;
    this.placePlayer(1, -5.6, Math.PI);
  }

  arrive(gate: string): void { this.travel.arrive(gate); }
  interruptGathering(movement: { x: number; z: number }, blocking: boolean): void { this.gathering.cancelIfInterrupted(movement, blocking); }

  selectGathering(resource: ResourceDefinition): void { this.gathering.select(resource); }
  cancelGathering(releaseLock = true): void { this.gathering.cancel(releaseLock); }
  selectPickup(id: string | null): void { this.adventure.pickupTarget = id; }
  pickup(id: string, point: Point): void { this.adventure.pickup(id, point, true); }

  startAbility(id: AbilityId, aim: AimPoint | undefined, holdingShield: boolean): void { this.combat.startAbility(id, aim, holdingShield); }
  swap(): boolean { return this.combat.swap(); }
  dodge(movement: { x: number; z: number }, aim?: AimPoint): boolean { return this.combat.dodge(movement, aim); }

  clearInput(preserveAccepted = false): void {
    this.pendingUtility = null;
    if (!preserveAccepted) { this.encounter.pending = null; this.encounter.blocking = false; this.context.interruptApproach(); }
  }

  usePotion(id?: string, fromMenu = false): boolean {
    if (fromMenu && this.context.equipmentBlocked()) throw new Error('Potion is not ready.');
    if (!fromMenu && this.context.paused()) return false;
    if (!fromMenu && this.context.impactHolding()) { this.pendingUtility = 'potion'; return true; }
    if (this.adventure.usePotion(this.encounter, id)) { this.context.interruptApproach(); return true; }
    if (fromMenu) throw new Error(this.encounter.player.hp >= this.encounter.stats.maxHealth ? 'Health is full.' : 'Potion is not ready.');
    if (this.encounter.player.hp > 0) this.adventure.message(this.encounter.player.hp >= this.encounter.stats.maxHealth ? 'Health is full' : this.adventure.character.potions === 0 ? 'No Health Potions' : 'Potion is not ready');
    return false;
  }

  castReturn(id?: string): void {
    if (this.context.paused()) return;
    if (this.context.impactHolding()) { this.pendingUtility = 'portal'; return; }
    this.context.interruptApproach();
    if (!this.adventure.beginCast(this.encounter.player.hp > 0, id) && this.encounter.player.hp > 0)
      this.adventure.message(this.context.area().id === homeArea ? 'Already at Homestead' : this.adventure.castRemaining > 0 ? 'Scroll of Return is casting' : 'No Scrolls of Return');
  }

  flushUtility(): void {
    if (this.pendingUtility && !this.context.paused() && !this.context.impactHolding()) {
      const command = this.pendingUtility; this.pendingUtility = null;
      if (command === 'potion') this.usePotion(); else this.castReturn();
    }
  }

  canEditEquipment(): boolean {
    const { player, phase, dodgeRemaining } = this.encounter;
    return phase !== 'loading' && player.hp > 0 && !inCombat(this.encounter) && player.lock === 0 && dodgeRemaining === 0 && !this.context.equipmentBlocked();
  }

  commitItems(items: InventoryItem[], expected?: readonly InventoryItem[]): void {
    if (!validItems(items)) throw new Error('Item does not fit.');
    if (expected && expected !== this.adventure.character.items) throw new Error('Inventory changed while equipment was preparing.');
    if (!sameEquipment(items, this.adventure.character.items) && !this.canEditEquipment()) throw new Error('Equipment cannot change during combat or an action.');
    this.adventure.commit(() => { this.adventure.replaceItems(structuredClone(items)); this.syncLoadout(); });
  }

  activateSet(set: WeaponSet): boolean {
    if (set === this.adventure.character.activeSet) return false;
    const { player, phase, dodgeRemaining, attackCooldown } = this.encounter;
    if (!['playing', 'won'].includes(phase) || player.hp <= 0 || player.lock > 0 || dodgeRemaining > 0 || attackCooldown > 0 || this.context.equipmentBlocked()) throw new Error('Weapon set cannot change during an action.');
    this.clearInput();
    this.encounter.player.attackTime = -1;
    this.adventure.commit(() => { this.adventure.setWeaponSet(set); this.syncLoadout(); });
    return true;
  }

  drop(id: string, quantity: number, expected?: readonly InventoryItem[]): void {
    if (expected && expected !== this.adventure.character.items) throw new Error('Inventory changed while equipment was preparing.');
    const entry = this.adventure.character.items.find(item => item.id === id);
    if (!entry) throw new Error('Item is no longer available.');
    if (!['bag', 'overflow'].includes(entry.slot) && !this.canEditEquipment()) throw new Error('Equipment cannot change during combat or an action.');
    const { player } = this.encounter;
    this.adventure.commit(() => { this.adventure.dropItem(id, quantity, [player.x, player.z]); this.syncLoadout(); });
  }

  changeContainers(items: readonly InventoryItem[], stash: readonly InventoryItem[]): void { this.adventure.replaceContainers(structuredClone([...items]), structuredClone([...stash])); }
  transfer(id: string, quantity: number, toStash: boolean, point?: { x: number; y: number }): void { this.adventure.transferStash(id, quantity, toStash, point); }
  recover(id: string): void { this.adventure.recoverItem(id); }
  setActionBar(bar: ActionBar): void { if (this.canEditEquipment()) this.adventure.setActionBar(bar); }
  buy(item: LootItem): void { this.adventure.buy(this.encounter, this.context.area(), item); }
  sell(id: string): void { this.adventure.sell(this.encounter, this.context.area(), id); }
  buyBack(id: string): void { this.adventure.buyBack(this.encounter, this.context.area(), id); }
  forge(item: ItemId) { const learned = this.adventure.forge(this.encounter, this.context.area(), item); this.syncLoadout(); return learned; }
  reclaim(id: string, container: SmithingContainer) { const learned = this.adventure.reclaim(this.encounter, this.context.area(), id, container); this.syncLoadout(); return learned; }
  canRepair(): boolean {
    const area = this.context.area(), site = area.shelter, player = this.encounter.player;
    return !!site && area.id === homeArea && player.hp > 0 && near([player.x, player.z], site.position, progression.restedRadius) && this.adventure.canRepair();
  }
  repairShelter(): void { if (!this.canRepair()) throw new Error('Unable to repair shelter. Materials were retained.'); this.adventure.repairShelter(); }
  openChest(chest: Chest): void { this.adventure.openChest(this.encounter, this.context.area(), chest); }
  discover(): void { this.adventure.discover(this.context.area(), [this.encounter.player.x, this.encounter.player.z]); }
  canTravel(sourceArea: AreaDefinition, source: Campfire, targetArea: AreaDefinition, target: Campfire): boolean { return this.adventure.canTravel(this.encounter, sourceArea, source, targetArea, target); }
  enter(area: AreaDefinition, spawn?: Spawn & { height?: number }, recover = false, portal?: PortalLink): void { this.adventure.enter(this.encounter, area, spawn, recover, portal); }
  restart(): void { this.clearInput(); this.takeFeedback(); resetEncounter(this.encounter); this.adventure.restart(); }
  syncLoadout(): void { this.adventure.syncLoadout(this.encounter); }


  private complete(events: EncounterEvent[]): void {
    this.adventure.commit(() => this.adventure.applyCombatEvents(this.encounter, events));
    if (events.some(event => event.type === 'hit' && event.actor === 'player')) this.context.interruptApproach(false);
    if (events.some(event => event.type === 'outcome' && !event.won)) { this.pendingUtility = null; this.context.defeated(); }
    this.events.push(...events);
  }

  advance(dt: number, input: Input, weatherDt = dt): Gate | undefined {
    const area = this.context.area();
    this.gathering.cancelIfInterrupted(input, input.block ?? false);
    if (input.paused) return;
    if (this.encounter.pending?.kind === 'ability' && this.encounter.pending.ability === 'shield-basic' && !input.block) this.encounter.pending = null;
    const timing = this.context.timings(), movement = this.context.movement();
    this.complete(this.encounter.phase === 'won' || area.kind === 'safe'
      ? stepExploration(this.encounter, dt, input, movement, timing)
      : stepEncounter(this.encounter, dt, input, timing, movement));
    if (this.encounter.phase !== 'loading' && this.adventure.currentArea) this.adventure.commit(() => this.adventure.step(this.encounter, area, dt));
    if (this.encounter.player.hp > 0) this.adventure.commit(() => this.gathering.advance(dt));
    if (this.encounter.player.hp > 0 && !['lost', 'loading'].includes(this.encounter.phase)) {
      this.advanceWeather(weatherDt);
      if (this.adventure.castRemaining === 0) return this.travel.check(area.gates, [this.encounter.player.x, this.encounter.player.z]);
    }
  }

  advanceWeather(dt: number): void {
    if (this.encounter.player.hp > 0 && !['lost', 'loading'].includes(this.encounter.phase)) this.adventure.advanceWeather(dt);
  }

  takeFeedback(): SessionFeedback {
    const combat = this.events;
    this.events = [];
    return { combat, gathering: this.gathering.takeEvents(), adventure: this.adventure.takeEvents() };
  }
}
