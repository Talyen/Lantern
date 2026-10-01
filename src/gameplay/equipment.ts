export type Weapon = 'axe' | 'sword' | 'bow' | 'staff';
export type ItemId = Weapon | 'shield';
export type Loadout = { main: Weapon | null; off: 'shield' | null };
type ItemDefinition = { name: string; asset: string; hands: 1 | 2; hand: 'Hand_R' | 'Hand_L'; length: number; grip: { position: [number, number, number]; rotation: [number, number, number] } };

/** Shared item identity and authored local grips; model pivots remain untouched. */
export const itemDefinitions: Record<ItemId, ItemDefinition> = {
  axe: { name: 'Axe', asset: 'goblin-war-camp:model:weapons-sm-wep-axe-02', hands: 1, hand: 'Hand_R', length: .74, grip: { position: [0, .075, .015], rotation: [0, 0, -Math.PI / 2] } },
  sword: { name: 'Sword', asset: 'goblin-war-camp:model:weapons-sm-wep-sword-01', hands: 1, hand: 'Hand_R', length: .94, grip: { position: [0, .075, .015], rotation: [0, 0, -Math.PI / 2] } },
  shield: { name: 'Shield', asset: 'goblin-war-camp:model:weapons-sm-wep-shield-02', hands: 1, hand: 'Hand_L', length: .58, grip: { position: [.015, .08, .015], rotation: [3.11647, .08135, 1.53998] } },
  bow: { name: 'Bow', asset: 'goblin-war-camp:model:weapons-sm-wep-bow-02', hands: 2, hand: 'Hand_L', length: 1.1, grip: { position: [0, .08, .01], rotation: [0, 0, -Math.PI / 2] } },
  staff: { name: 'Staff', asset: 'goblin-war-camp:model:weapons-sm-wep-staff-01', hands: 2, hand: 'Hand_L', length: 1.65, grip: { position: [0, .075, .015], rotation: [-2.01924, .20718, .32637] } },
};
export const itemIds = Object.keys(itemDefinitions) as ItemId[];
export const arrowAsset = 'viking-realm:model:sm-wep-arrow-01';
export const supportsShield = (weapon: Weapon | null) => weapon === 'axe' || weapon === 'sword';
export function normalizeLoadout(loadout: Loadout): Loadout {
  return { main: loadout.main, off: supportsShield(loadout.main) ? loadout.off : null };
}
export function equipItem(loadout: Loadout, item: ItemId): Loadout {
  return normalizeLoadout(item === 'shield' ? { main: loadout.main, off: 'shield' } : { main: item, off: loadout.off });
}
