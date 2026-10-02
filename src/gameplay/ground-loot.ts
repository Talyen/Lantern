import { near, type Point } from './area';
import type { ItemId } from './equipment';
import type { CharacterSave } from './character-save';
import { lootDefinitions, receive, type LootItem } from './inventory';
import type { GatheringSkill } from './skills';

export const dropLandingSeconds = .55;
export const pickupRadius = 1.5;
export type GroundItem = LootItem | 'gold';
export type GroundDrop = {
  id: string;
  item: GroundItem;
  quantity: number;
  position: Point;
  origin: Point;
  height: number;
  age: number;
  claim?: ItemId;
  instanceId?: string;
  blocked?: boolean;
  harvestXp?: { skill: GatheringSkill; perUnit: number };
};

export type DropOptions = Partial<Pick<GroundDrop, 'claim' | 'instanceId' | 'blocked' | 'harvestXp'>>;
export type LootEvent = {
  type: 'lootDrop' | 'lootLand' | 'lootPickup';
  item: GroundItem;
  position: { x: number; z: number };
};
export const lootEvent = (type: LootEvent['type'], drop: GroundDrop): LootEvent =>
  ({ type, item: drop.item, position: { x: drop.position[0], z: drop.position[1] } });

/** Commit only the quantity that fits. The coordinator owns XP, events and persistence. */
export function collectGroundDrop(
  drops: GroundDrop[], id: string, point: Point,
  character: Pick<CharacterSave, 'items' | 'gold' | 'campClaims'>,
  newId: () => string, reachable: (drop: GroundDrop) => boolean, manual: boolean,
): { collected: true; drop: GroundDrop; amount: number } | { collected: false; notice?: string } {
  const drop = drops.find(drop => drop.id === id);
  if (!drop || drop.age < dropLandingSeconds || !near(point, drop.position, pickupRadius)) return { collected: false };
  if (!reachable(drop)) return { collected: false, notice: manual ? 'Can’t reach item' : undefined };
  if (drop.blocked && !manual) return { collected: false };
  const amount = drop.item === 'gold'
    ? Math.min(drop.quantity, Number.MAX_SAFE_INTEGER - character.gold)
    : receive(character.items, drop.item, drop.quantity, newId, drop.instanceId);
  if (drop.item === 'gold') character.gold += amount;
  if (!amount) {
    const notice = drop.item === 'gold' ? 'Gold wallet is full' : 'Inventory full';
    return { collected: false, notice: manual ? notice : undefined };
  }
  drop.quantity -= amount;
  if (drop.claim) character.campClaims = [...new Set([...character.campClaims, drop.claim])];
  if (!drop.quantity) drops.splice(drops.indexOf(drop), 1);
  return { collected: true, drop, amount };
}

export function advanceGroundDrops(
  drops: GroundDrop[], point: Point, dt: number,
  emit: (event: LootEvent) => void, pickup: (id: string, point: Point) => boolean,
): void {
  // Collection removes entries, so iterate a snapshot of this frame's drops.
  for (const drop of [...drops]) {
    if (drop.age < dropLandingSeconds && drop.age + dt >= dropLandingSeconds) emit(lootEvent('lootLand', drop));
    drop.age += dt;
    if (drop.blocked && !near(point, drop.position, pickupRadius)) drop.blocked = false;
    if (drop.item === 'gold' || lootDefinitions[drop.item].stackable) pickup(drop.id, point);
  }
}
