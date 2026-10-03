import { FrontSide, PropertyBinding } from 'three';
import { parseGlb } from '../../lib/glb.mjs';
import { yUpBounds } from './validate.mjs';

const json = (files, path) => JSON.parse(files.get(path));
const gltfPosition = ([x, y, z]) => [x, z, -y];
const sourceBounds = entry => entry.bounds_blender_m ?? (entry.bounds_source
  ? { min: entry.bounds_source[0], max: entry.bounds_source[1] }
  : { min: entry.bounds_source_min, max: entry.bounds_source_max });

/** Explicit adapters for the five environment deliveries; preserve their placement datums. */
export function environmentEntries(id, files, count) {
  const manifest = json(files, 'manifest.json');
  if (!['metres', 'meters'].includes(manifest.units ?? manifest.conventions?.units)
    || manifest.assets?.length !== count) throw new Error(`Unexpected manifest: ${id}`);
  return manifest.assets.map(entry => {
    const file = entry.file ?? entry.glb ?? `glb/${entry.id}.glb`;
    const village = id === 'sootward-village', water = id === 'stillwater-deepstone', terrain = id === 'hollowmere-terrain';
    const triangles = entry.actual_triangles ?? entry.triangles_exported ?? entry.triangles;
    const primitives = entry.actual_primitives ?? entry.gltf_primitive_count ?? entry.material_primitives ?? entry.primitives
      ?? (terrain ? manifest.materials.primitives_per_asset : undefined);
    const source = sourceBounds(entry);
    if (!entry.id || !Number.isInteger(triangles) || triangles <= 0 || !Number.isInteger(primitives) || primitives <= 0
      || !source.min || !source.max) throw new Error(`Incomplete model manifest: ${file}`);
    const bounds = entry.bounds_gltf_m ? [entry.bounds_gltf_m.min, entry.bounds_gltf_m.max] : yUpBounds(source);
    const root = village ? `${entry.id}__root` : terrain ? `${entry.id}_root` : entry.id;
    const pivots = [];
    const sockets = entry.sockets_gltf_m;
    if (village) {
      const model = parseGlb(files.get(file), file).json;
      if (!sockets || Object.keys(sockets).length !== Object.keys(entry.sockets_blender_m ?? {}).length) throw new Error(`Incomplete sockets: ${file}`);
      for (const [key, position] of Object.entries(sockets)) {
        const matches = model.nodes.filter(node => node.extras?.socket_name === key);
        if (matches.length !== 1 || position.some((value, axis) => Math.abs(value - gltfPosition(entry.sockets_blender_m[key])[axis]) > .001)) throw new Error(`Invalid socket: ${file}/${key}`);
        pivots.push({ name: PropertyBinding.sanitizeNodeName(matches[0].name), position });
      }
    }
    const anchors = entry.anchors_source && Object.fromEntries(Object.entries(entry.anchors_source).map(([key, point]) => [key, gltfPosition(point)]));
    if (anchors) for (const [name, position] of Object.entries(anchors)) pivots.push({ name, position });
    if (water) {
      const solids = parseGlb(files.get(file), file).json.nodes.filter(node => /^Solid_Geometry(?:\.\d+)?$/.test(node.name));
      if (solids.length !== 1) throw new Error(`Missing or ambiguous solid geometry: ${file}`);
      pivots.push({ name: PropertyBinding.sanitizeNodeName(solids[0].name) });
      if (entry.water_optional) pivots.push({ name: 'Water_Surface' });
    }
    const connectors = entry.connectors_source?.map(gltfPosition);
    const pivotRole = entry.pivot_role ?? (village || terrain ? 'module_datum' : water
      ? entry.id === 'stalactite_cluster' ? 'ceiling_attachment' : 'authored_datum'
      : 'ground_center');
    return {
      file, slug: entry.id.replaceAll('_', '-'), name: entry.label ?? entry.name ?? entry.id.replaceAll('_', ' '),
      category: entry.category ?? (terrain ? 'terrain' : village ? 'structures' : water ? 'terrain' : 'props'), description: entry.description,
      metadata: {
        dimensions: bounds[1].map((value, axis) => value - bounds[0][axis]),
        placement: { units: 'metres', root, pivotRole },
        ...(village || terrain || connectors?.length ? { modular: { gridMeters: manifest.grid_m, sockets, anchors, connectors, nominal: entry.nominal } } : {}),
        ...(water ? { water: { optional: entry.water_optional, node: entry.water_optional ? 'Water_Surface' : undefined,
          heightMeters: entry.water_z, previewOnly: true } } : {}),
      },
      expected: { triangles, primitives, bounds, root, pivots,
        ground: terrain ? source.min[2] === 0 : ['floor_center', 'ground_center'].includes(pivotRole),
        vertexColors: !village && !water, ...(id === 'silent-roads' || water ? {} : { side: FrontSide }) },
    };
  });
}

export function environmentDemoExpected(id, file, files) {
  if (id === 'sootward-village') {
    const demo = json(files, 'manifest.json').demos.find(entry => `glb/${entry.id}.glb` === file);
    return { triangles: demo.triangles_exported, bounds: yUpBounds(demo.bounds_blender_m) };
  }
  // These reports count unique mesh data; inspectModel counts all scene instances.
  // Source demo bounds/expanded counts are not declared by these deliveries.
  return {};
}
