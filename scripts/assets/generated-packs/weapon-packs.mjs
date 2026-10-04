import { parseGlb } from '../../lib/glb.mjs';
import { yUpBounds } from './validate.mjs';

/** The ten owner-supplied weapon deliveries use manifest or standalone stats records. */
export const weaponPacks = {
  'ashenforge-axe': { archive: 'Ashenforge_Gothic_Axe_6_Variants.zip', prefix: 'Ashenforge_Axe/', weapon: 'Axe', count: 6 },
  'ashenforge-mace': { archive: 'Ashenforge_Gothic_Mace_6_Variants.zip', prefix: 'Ashenforge_Mace/', weapon: 'Mace', count: 6 },
  'ashenforge-greathammer': { archive: 'Ashenforge_Gothic_Greathammer_6_Variants.zip', prefix: 'Ashenforge_Greathammer/', weapon: 'Greathammer', count: 6 },
  'gothic-bow': { archive: 'Gothic_Bow_Variants.zip', prefix: 'Gothic_Bow_Variants_Revised/', weapon: 'Bow', count: 6 },
  'gothic-crossbow': { archive: 'Gothic_Crossbow_Variants.zip', prefix: 'Gothic_Crossbow_Variants_Revised/', weapon: 'Crossbow', count: 6 },
  'gothic-staff': { archive: 'Gothic_Earthbound_Staff_Variants.zip', prefix: 'Gothic_Earthbound_Staff_Variants/', weapon: 'Staff', count: 6 },
  'gothic-wand': { archive: 'Gothic_Earthbound_Wand_Variants.zip', prefix: 'Gothic_Earthbound_Wand_Variants/', weapon: 'Wand', count: 6 },
  'gothic-sword': { archive: 'Gothic_Sword_Six_Variants.zip', prefix: 'Gothic_Sword_Six_Variants_Revised/', weapon: 'Sword', count: 6 },
  'gothic-greatsword': { archive: 'Gothic_Greatsword_Six_Variants.zip', prefix: 'Gothic_Greatsword_Six_Variants_Revised/', weapon: 'Greatsword', count: 6 },
  'sepulchral-shields': { archive: 'Sepulchral_Armory_Gothic_Shields.zip', prefix: 'Sepulchral_Armory_Shields/', weapon: 'Shield', count: 6 },
};

export function weaponEntries(id, files) {
  const pack = weaponPacks[id];
  const manifest = files.has('manifest.json') ? JSON.parse(files.get('manifest.json')) : {};
  const entries = files.has('stats.json') ? JSON.parse(files.get('stats.json')) : manifest.assets;
  if (!Array.isArray(entries) || entries.length !== pack.count
    || (manifest.asset_count ?? (Number.isInteger(manifest.assets) ? manifest.assets : pack.count)) !== pack.count) throw new Error(`Unexpected weapon inventory: ${id}`);
  return entries.map(entry => {
    const slug = entry.id ?? entry.slug;
    const file = entry.file ?? `glb/${slug}.glb`;
    const triangles = entry.triangles, primitives = entry.material_primitives ?? entry.materials;
    if (!slug || !entry.name || !Number.isInteger(triangles) || triangles <= 0 || !Number.isInteger(primitives) || primitives <= 0
      || !entry.bounds_blender_m || !files.has(file)) throw new Error(`Incomplete weapon record: ${id}/${file}`);
    const model = parseGlb(files.get(file), file).json;
    const roots = model.scenes?.[model.scene ?? 0]?.nodes;
    const root = roots?.length === 1 ? model.nodes[roots[0]] : undefined;
    if (!root || root.name !== slug || !['metres', 'meters'].includes(root.extras?.units)) throw new Error(`Unexpected weapon grip root or units: ${file}`);
    const primary = entry.primary_grip_gltf_m ?? [0, 0, 0];
    if (primary.length !== 3 || primary.some(value => value !== 0)) throw new Error(`Unexpected primary grip: ${file}`);
    const secondary = entry.second_hand_gltf_m ?? root.extras?.second_hand_glb_xyz
      ?? (root.extras?.suggested_secondary_hand_gltf_Y !== undefined ? [0, root.extras.suggested_secondary_hand_gltf_Y, 0] : undefined);
    if (secondary && (secondary.length !== 3 || !secondary.every(Number.isFinite))) throw new Error(`Invalid secondary grip: ${file}`);
    const bounds = yUpBounds(entry.bounds_blender_m);
    return {
      file, slug: slug.replaceAll('_', '-'), name: entry.name, category: 'weapon', description: entry.description ?? entry.construction,
      metadata: {
        dimensions: bounds[1].map((value, axis) => value - bounds[0][axis]),
        placement: { units: 'metres', root: slug, pivotRole: 'primary_grip_center' },
        equipment: { family: pack.weapon, primaryGrip: primary, ...(secondary ? { secondaryGrip: secondary } : {}) },
      },
      expected: { triangles, primitives, bounds, identityMesh: true, root: slug },
    };
  });
}
