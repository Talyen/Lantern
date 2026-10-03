export type Weapon = 'axe' | 'sword' | 'bow' | 'staff';
export type WeaponItem = Weapon | 'iron-broadsword' | 'yew-longbow';
export type HandItem = WeaponItem | 'shield';
const sharedSlots = ['helmet','body','gloves','boots','ring-left','ring-right','amulet','belt'] as const;
export type SharedSlot = typeof sharedSlots[number];
export type EquipmentSlot = 'main' | 'off' | SharedSlot;
export type ItemId = HandItem | 'guard-helm' | 'weathered-mail' | 'quilted-coat' | 'duelist-gloves' | 'trail-boots' | 'iron-signet' | 'hearth-ring' | 'amber-amulet' | 'leather-belt';
export type Loadout = { main: WeaponItem | null; off: 'shield' | null };
type ItemDefinition = { name: string; asset: string; hands: 1 | 2; hand: 'Hand_R' | 'Hand_L'; length: number; grip: { position: [number, number, number]; rotation: [number, number, number] } };

/** Shared item identity and authored local grips; model pivots remain untouched. */
const handDefinitions: Record<Weapon | 'shield', ItemDefinition> = {
  axe: { name: 'Axe', asset: 'goblin-war-camp:model:weapons-sm-wep-axe-02', hands: 1, hand: 'Hand_R', length: .74, grip: { position: [0, .075, .015], rotation: [0, 0, -Math.PI / 2] } },
  sword: { name: 'Sword', asset: 'goblin-war-camp:model:weapons-sm-wep-sword-01', hands: 1, hand: 'Hand_R', length: .94, grip: { position: [0, .075, .015], rotation: [0, 0, -Math.PI / 2] } },
  shield: { name: 'Shield', asset: 'goblin-war-camp:model:weapons-sm-wep-shield-02', hands: 1, hand: 'Hand_L', length: .58, grip: { position: [.015, .08, .015], rotation: [3.11647, .08135, 1.53998] } },
  // Synty bows lie in YZ. Align that plane with the draw; the generic grip faced it across the shot.
  bow: { name: 'Bow', asset: 'goblin-war-camp:model:weapons-sm-wep-bow-02', hands: 2, hand: 'Hand_L', length: 1.1, grip: { position: [0, .08, .01], rotation: [-104 * Math.PI / 180, 0, -Math.PI / 2] } },
  staff: { name: 'Staff', asset: 'goblin-war-camp:model:weapons-sm-wep-staff-01', hands: 2, hand: 'Hand_L', length: 1.65, grip: { position: [0, .075, .015], rotation: [-2.01924, .20718, .32637] } },
};
export const itemDefinitions: Record<HandItem,ItemDefinition> = {
  ...handDefinitions,
  'iron-broadsword': {...handDefinitions.sword,name:'Iron Broadsword',asset:'goblin-war-camp:model:weapons-sm-wep-sword-02',length:1.06},
  'yew-longbow': {...handDefinitions.bow,name:'Yew Longbow',asset:'goblin-war-camp:model:weapons-sm-wep-bow-01',length:1.25},
};

export type Bonuses = Partial<Record<'armor' | 'health' | 'mana' | 'manaRegen' | 'damage' | 'attackRate' | 'moveSpeed', number>>;
export type EquipmentDefinition = { name: string; slot: 'main' | 'off' | 'ring' | Exclude<SharedSlot,'ring-left'|'ring-right'>; width: number; height: number; bonuses: Bonuses; weapon?: { family: Weapon; damage: number; rate: number; reach: number } };
/** Weapon identities must provide main-hand combat values; other gear cannot claim a hand slot. */
type EquipmentCatalog = {
  [Id in ItemId]: EquipmentDefinition & (
    Id extends WeaponItem
      ? { slot: 'main'; weapon: NonNullable<EquipmentDefinition['weapon']> }
      : Id extends 'shield'
        ? { slot: 'off' }
        : { slot: Exclude<EquipmentDefinition['slot'], 'main' | 'off'> }
  );
};
/** Fixed identities, footprints and properties; no generated affixes or stored stat copies. */
export const equipmentCatalog: EquipmentCatalog = {
  axe: {name:'Axe',slot:'main',width:2,height:3,bonuses:{},weapon:{family:'axe',damage:50,rate:1,reach:1.95}},
  sword: {name:'Sword',slot:'main',width:1,height:3,bonuses:{},weapon:{family:'sword',damage:50,rate:1,reach:1.95}},
  'iron-broadsword': {name:'Iron Broadsword',slot:'main',width:1,height:3,bonuses:{},weapon:{family:'sword',damage:70,rate:.8,reach:2.2}},
  bow: {name:'Bow',slot:'main',width:2,height:4,bonuses:{},weapon:{family:'bow',damage:45,rate:1,reach:12}},
  'yew-longbow': {name:'Yew Longbow',slot:'main',width:2,height:4,bonuses:{},weapon:{family:'bow',damage:60,rate:.85,reach:16}},
  staff: {name:'Staff',slot:'main',width:2,height:4,bonuses:{},weapon:{family:'staff',damage:50,rate:1,reach:12}},
  shield: {name:'Shield',slot:'off',width:2,height:3,bonuses:{}},
  'guard-helm': {name:'Guard Helm',slot:'helmet',width:2,height:2,bonuses:{armor:8}},
  'weathered-mail': {name:'Weathered Mail',slot:'body',width:2,height:3,bonuses:{armor:12}},
  'quilted-coat': {name:'Quilted Coat',slot:'body',width:2,height:3,bonuses:{mana:20,manaRegen:2}},
  'duelist-gloves': {name:'Duelist Gloves',slot:'gloves',width:2,height:2,bonuses:{attackRate:.08}},
  'trail-boots': {name:'Trail Boots',slot:'boots',width:2,height:2,bonuses:{moveSpeed:.05}},
  'iron-signet': {name:'Iron Signet',slot:'ring',width:1,height:1,bonuses:{damage:.1}},
  'hearth-ring': {name:'Hearth Ring',slot:'ring',width:1,height:1,bonuses:{health:15}},
  'amber-amulet': {name:'Amber Amulet',slot:'amulet',width:1,height:1,bonuses:{mana:20}},
  'leather-belt': {name:'Leather Belt',slot:'belt',width:2,height:1,bonuses:{health:10}},
};
export const itemIds = Object.keys(equipmentCatalog) as ItemId[];
/** Catalog membership is checked before indexing untrusted save or loot values. */
export function isItemId(value: unknown): value is ItemId {
  return typeof value === 'string' && Object.hasOwn(equipmentCatalog, value);
}
export function isWeaponItem(value: unknown): value is WeaponItem {
  return isItemId(value) && equipmentCatalog[value].slot === 'main';
}
export const weaponFamily = (item: WeaponItem | null): Weapon | null => item ? equipmentCatalog[item].weapon.family : null;
export const isEquipmentSlot = (slot: unknown): slot is EquipmentSlot => slot === 'main' || slot === 'off' || sharedSlots.some(value => value === slot);
export const slotAccepts = (item: ItemId, slot: EquipmentSlot): boolean => equipmentCatalog[item].slot === slot || equipmentCatalog[item].slot === 'ring' && (slot === 'ring-left' || slot === 'ring-right');
export const arrowAsset = 'viking-realm:model:sm-wep-arrow-01';
export function supportsShield(weapon: WeaponItem | null): boolean {
  const family = weaponFamily(weapon);
  return family === 'axe' || family === 'sword';
}
export function normalizeLoadout(loadout: Loadout): Loadout {
  return { main: loadout.main, off: supportsShield(loadout.main) ? loadout.off : null };
}

/** Fill the free ring slot first; otherwise replace the left ring. Explicit drags choose their own slot. */
export function preferredEquipmentSlot(item: ItemId, occupied: readonly EquipmentSlot[]): EquipmentSlot {
  const slot = equipmentCatalog[item].slot;
  return slot === 'ring'
    ? occupied.includes('ring-left') && !occupied.includes('ring-right') ? 'ring-right' : 'ring-left'
    : slot;
}
