import { DoubleSide, FrontSide } from 'three';
import { yUpBounds } from './validate.mjs';

/** Delivery-specific schemas stay beside their explicit import recipe. */
export const packs = {
  'autumn-atlas': { archive: 'Autumn_Atlas_Botanical_Expansion_Compact.zip', prefix: 'Autumn_Atlas_Botanical_Expansion/', count: 24, compact: true,
    demos: ['glb/demo_amber_glade.glb'], triangleTotal: 86902 },
  hearthsteel: { archive: 'Hearthsteel_Traditional_11_Weapons_Compact.zip', prefix: 'Hearthsteel_Armory/', count: 11, compact: true, triangleTotal: 37098 },
  'ashen-veil-lights': { archive: 'Ashen_Veil_Light_Source_Variants.zip', prefix: 'light_source_variants_final_v3/', count: 12 },
  'full-autumn-trees': { archive: 'full_autumn_trees.zip', prefix: 'full_autumn_trees/', count: 6, demos: ['glb/demo_amber_woods.glb'] },
  'dungeon-tiles': { archive: 'dungeon_tile_expansion.zip', prefix: 'dungeon_tile_expansion_refined/', count: 24,
    demos: ['glb/demo_worn_crypt.glb', 'glb/demo_mossy_ruins.glb', 'glb/demo_dark_fortress.glb'] },
  'gothic-lootables': { archive: 'Warm_Fantasy_Chests_Breakables.zip', prefix: 'Gothic_Earthbound_Chests_Breakables/', count: 10 },
  'hearthwood-furniture': { archive: 'Hearthwood_Racks_Furniture.zip', prefix: 'Hearthwood_Racks_Furniture_Gothic/', count: 6,
    supporting: ['source/resources/axe.glb', 'source/resources/bow.glb', 'source/resources/mace.glb', 'source/resources/sword.glb'] },
  'outdoor-crypt-lootables': { archive: 'Outdoor_Crypt_Lootables.zip', prefix: 'Outdoor_Crypt_Lootables/', count: 7 },
};
export const defaultPacks = ['autumn-atlas', 'hearthsteel'];
const gltfPosition = ([x, y, z]) => [x, z, -y];
const boundsArray = bounds => [bounds.min, bounds.max];
const dimensions = ([min, max]) => max.map((value, axis) => value - min[axis]);
const json = (files, path) => JSON.parse(files.get(path));

export function entriesFor(id, files) {
  const manifest = json(files, 'manifest.json');
  if (id === 'autumn-atlas') {
    if (manifest.units !== 'metres' || manifest.assets?.length !== 24) throw new Error('Unexpected botanical manifest');
    return manifest.assets.map(entry => ({ file: entry.glb, name: entry.title, slug: entry.id.replaceAll('_', '-'), category: entry.category,
      description: entry.description, expected: { triangles: entry.triangles, primitives: 1, bounds: yUpBounds(entry.bounds_blender), ground: true, vertexColors: true, side: DoubleSide } }));
  }
  if (id === 'hearthsteel') {
    const stats = json(files, 'stats.json');
    if (manifest.units !== 'metres' || manifest.asset_count !== 11 || stats.length !== 11) throw new Error('Unexpected weapon manifest');
    return stats.map(entry => ({ file: entry.file, name: entry.name, slug: entry.name.toLowerCase(), category: 'weapons',
      expected: { triangles: entry.triangles, primitives: entry.material_primitives, bounds: yUpBounds(entry.bounds_blender_m), identityMesh: true } }));
  }
  if (!['metres', 'meters'].includes(manifest.units ?? manifest.authored_units) || manifest.assets?.length !== packs[id].count) throw new Error(`Unexpected manifest: ${id}`);
  return manifest.assets.map(entry => {
    const file = entry.file ?? entry.glb ?? `glb/${entry.id}.glb`;
    const triangles = entry.actual_glb_triangles ?? entry.actual_triangles ?? entry.triangles;
    const primitives = entry.actual_glb_material_primitives ?? entry.actual_primitives ?? entry.exported_primitives ?? entry.material_primitives ?? entry.draw_primitives;
    const bounds = entry.bounds_gltf_m ?? entry.bounds_gltf;
    const sourceBounds = entry.bounds_blender_m ?? entry.bounds_blender;
    const articulation = entry.pivots ?? entry.articulated_or_hideable_children ?? entry.parts ?? [];
    const pivots = articulation.map(pivot => ({ name: pivot.gltf_name ?? pivot.name ?? pivot.node,
      position: pivot.gltf_m ?? pivot.pivot_glTF_m ?? gltfPosition(pivot.blender_m ?? pivot.pivot_blender_m) }));
    if (entry.emitter_node) {
      pivots.push({ name: entry.emitter_node, position: entry.emitter_gltf_m }, { name: entry.body_node }, { name: entry.flame_node });
    }
    const connectors = entry.connectors_gltf_m;
    if (connectors) {
      if (!entry.connectors_blender_m || connectors.length !== entry.connectors_blender_m.length
        || connectors.some((point, i) => point.length !== 3 || point.some((value, axis) => !Number.isFinite(value)
          || Math.abs(value - gltfPosition(entry.connectors_blender_m[i])[axis]) > .001))) throw new Error(`Invalid modular connectors: ${file}`);
    }
    if (!Number.isInteger(triangles) || triangles <= 0 || !Number.isInteger(primitives) || primitives <= 0
      || !sourceBounds || !entry.id || !Array.isArray(articulation)) throw new Error(`Incomplete model manifest: ${file}`);
    return {
      file, name: entry.label ?? entry.title ?? entry.id.replaceAll('_', ' '), slug: entry.id.replaceAll('_', '-'),
      category: entry.category ?? entry.role ?? (id === 'ashen-veil-lights' ? 'lights' : id === 'full-autumn-trees' ? 'trees' : 'furniture'),
      description: entry.description,
      metadata: {
        dimensions: dimensions(bounds ? boundsArray(bounds) : yUpBounds(sourceBounds)),
        placement: { units: 'metres', root: entry.root_node ?? entry.id, pivotRole: entry.pivot_role ?? (id === 'dungeon-tiles' ? 'module_datum' : 'ground_center') },
        ...(articulation.length ? { articulation } : {}),
        ...(entry.hinge ? { hinge: { axis: 'X', openDegrees: entry.hinge.open_rotation_x_degrees, interiorDimensions: entry.hinge.usable_interior_dimensions_m } } : {}),
        ...(entry.emitter_node ? { emitter: { node: entry.emitter_node, position: entry.emitter_gltf_m, bodyNode: entry.body_node, flameNode: entry.flame_node } } : {}),
        ...(connectors ? { modular: { gridMeters: entry.nominal_grid_m, style: entry.style, role: entry.role, rotationSnapDegrees: entry.rotation_snap_degrees, connectors } } : {}),
      },
      expected: { triangles, primitives, bounds: bounds ? boundsArray(bounds) : yUpBounds(sourceBounds), root: entry.root_node ?? entry.id, pivots,
        ground: id !== 'dungeon-tiles' && (id !== 'ashen-veil-lights' || entry.pivot_role === 'floor_center'),
        vertexColors: id !== 'outdoor-crypt-lootables', ...(id === 'full-autumn-trees' ? { side: FrontSide } : {}) },
    };
  });
}

export function demoExpected(id, file, files) {
  if (id === 'full-autumn-trees') return { triangles: json(files, 'validation/demo_structure.json').triangles_across_all_placements };
  if (id === 'dungeon-tiles') return { triangles: json(files, 'manifest.json').demos.find(demo => demo.file === file)?.triangles_expanded };
  return {};
}
export function packWarnings(id) {
  if (id === 'hearthsteel') return ['Static grip-centred prop; author rig-specific hand rotation, secondary grip and any bow/reload animation before equipping.'];
  if (id === 'autumn-atlas') return ['Static visual geometry only; author collision, navigation, wind and interactions when placing.'];
  if (id === 'ashen-veil-lights') return ['Static visual geometry and emitter markers only; use shared Golden lighting and local flame recipes when placing. No runtime lights or animation supplied.'];
  return ['Static visual geometry only; author collision, navigation and gameplay interactions when placing. No wind, LODs or opening/breaking behavior supplied.'];
}
