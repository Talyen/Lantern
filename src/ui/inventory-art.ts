import atlas from '../../assets/ui/inventory/item-atlas.png';
import { lootDefinitions, type LootItem } from '../gameplay/inventory';

// Warm the shared art during game startup rather than on the first menu open.
const preload = new Image(); preload.decoding = 'async'; preload.src = atlas;

// Alpha bounds measured from the unchanged original atlas. One renderer and cell
// ruler serve bag, equipment, overflow and carried art; containers never rescale it.
const bounds: Record<LootItem, readonly [number, number, number, number]> = {
  sword: [68, 15, 114, 356], 'iron-broadsword': [301, 4, 125, 385],
  axe: [560, 33, 137, 343], bow: [835, 4, 101, 386], 'yew-longbow': [1077, 3, 91, 387],
  staff: [88, 374, 73, 300], shield: [252, 414, 230, 232],
  'guard-helm': [535, 410, 171, 238], 'weathered-mail': [758, 401, 229, 257],
  'quilted-coat': [1013, 394, 218, 271], 'duelist-gloves': [39, 681, 204, 179],
  'trail-boots': [268, 662, 199, 201], 'iron-signet': [549, 716, 153, 108],
  'hearth-ring': [804, 714, 149, 109], 'amber-amulet': [1063, 667, 129, 195],
  'leather-belt': [21, 906, 233, 112], potion: [321, 874, 122, 172],
  scroll: [511, 884, 229, 152], wood: [765, 874, 222, 174],
  stone: [1018, 883, 214, 162], iron: [26, 1060, 230, 174],
};

export function inventoryArt(item: LootItem): string {
  const [x, y, width, height] = bounds[item], footprint = lootDefinitions[item];
  const scale = Math.min(footprint.width / width, footprint.height / height) * .88;
  const values = { 'art-w': width * scale, 'art-h': height * scale,
    'atlas-w': 1254 * scale, 'atlas-h': 1254 * scale,
    'atlas-x': -x * scale, 'atlas-y': -y * scale };
  const style = Object.entries(values).map(([key, value]) => `--${key}:${value}`).join(';');
  return `<span class="inv-sprite" aria-hidden="true" style="${style};background-image:url('${atlas}')"></span>`;
}
