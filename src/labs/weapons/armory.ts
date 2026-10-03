import * as THREE from 'three';
import { AssetLibrary } from '../../assets/asset-library';
import { itemDefinitions } from '../../gameplay/equipment';
import type { HandItem } from '../../gameplay/equipment';

export const asterfallLibrary = new AssetLibrary('/vendor/asterfall/catalog.json');
export const weaponNames = { sword: 'Sword', axe: 'Axe', mace: 'Mace', pickaxe: 'Pickaxe', bow: 'Bow', shield: 'Shield', greatsword: 'Greatsword', greathammer: 'Greathammer', crossbow: 'Crossbow', staff: 'Staff', wand: 'Wand' };
export type ArmoryWeapon = keyof typeof weaponNames;
export const counterparts: Partial<Record<ArmoryWeapon, string>> = {
  sword: itemDefinitions.sword.asset, axe: itemDefinitions.axe.asset, bow: itemDefinitions.bow.asset,
  shield: itemDefinitions.shield.asset, staff: itemDefinitions.staff.asset,
  pickaxe: 'generic:model:sm-gen-wep-pickaxe-01', greathammer: 'viking-realm:model:sm-wep-hammer-01',
};
/** Lab-only model definitions preserve gameplay identities and authored attachment pivots. */
export async function armoryDefinitions(authored: boolean): Promise<typeof itemDefinitions> {
  const catalog = await asterfallLibrary.getCatalog();
  const definitions = { ...itemDefinitions };
  for (const item of ['axe','sword','bow','staff','shield'] as HandItem[]) {
    const entry = catalog.assets[`asterfall:${item}`];
    if (!entry?.bounds) throw new Error('Asterfall weapons missing. Run npm run assets:import-asterfall, then reload.');
    const length = Math.max(...entry.bounds[1].map((value, axis) => value - entry.bounds![0][axis]));
    // Synty Sword/Axe faces and Bow strings occupy a different local plane.
    const rotation = new THREE.Euler(...itemDefinitions[item].grip.rotation, 'XYZ');
    if (item === 'sword' || item === 'axe' || item === 'bow') {
      const orientation = new THREE.Quaternion().setFromEuler(rotation);
      orientation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2));
      rotation.setFromQuaternion(orientation, 'XYZ');
    }
    definitions[item] = { ...itemDefinitions[item], asset: entry.id, length: authored ? length : itemDefinitions[item].length, grip: { ...itemDefinitions[item].grip, rotation: [rotation.x, rotation.y, rotation.z] } };
  }
  return definitions;
}
