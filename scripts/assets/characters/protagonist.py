"""Prepare the private male geometry study; keep licensed source and editable output private."""
import argparse
import importlib.util
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[3]
IDENTITY = 'mixamo-a58c06c4-3307-40e6-a02d-bfcd658bdbff'
OUTPUT = ROOT / 'public/vendor/characters/protagonist-male-draft'
PRIVATE = ROOT / '.local/animation-packs/Protagonists/male-draft'
SPEC = importlib.util.spec_from_file_location('motion_baker', ROOT / 'scripts/assets/mixamo/baker.py')
BAKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BAKER)


def material(name, shade):
    value = bpy.data.materials.new(name)
    value.use_nodes = True
    shader = value.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*shade, 1)
    shader.inputs['Roughness'].default_value = .8
    return value


def assign(obj, surface):
    obj.data.materials.clear()
    obj.data.materials.append(surface)
    for face in obj.data.polygons:
        face.material_index = 0
        face.use_smooth = True


def copy_surface(source, name, surface, keep, offset=0, planes=()):
    obj = source.copy()
    obj.data = source.data.copy()
    obj.name = name
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.00001)
    for point, normal in planes:
        bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces), dist=.000001, plane_co=point, plane_no=normal)
    remove = [face for face in bm.faces if not keep(face.calc_center_median())]
    bmesh.ops.delete(bm, geom=remove, context='FACES')
    bm.normal_update()
    for vertex in bm.verts:
        vertex.co += vertex.normal * offset
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    assign(obj, surface)
    return obj


def bind(obj, rig, weights):
    obj.parent = rig
    obj.matrix_parent_inverse = rig.matrix_world.inverted()
    obj.matrix_basis = Matrix.Identity(4)
    modifier = obj.modifiers.new('Character skin', 'ARMATURE')
    modifier.object = rig
    for index, vertex in enumerate(obj.data.vertices):
        for name, weight in weights(vertex.co):
            if weight > 0:
                group = obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name)
                group.add([index], weight, 'REPLACE')
    return obj


def mesh(name, points, faces, surface, rig, weights):
    data = bpy.data.meshes.new(name)
    data.from_pydata(points, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    assign(obj, surface)
    return bind(obj, rig, weights)


def bone_weights(name):
    return lambda point: [(name, 1)]


def tube(name, centers, radii, axis, surface, rig, weights, sides=16):
    points, faces = [], []
    for center, (a, b) in zip(centers, radii):
        for side in range(sides):
            angle = side / sides * math.tau
            delta = (0, a * math.cos(angle), b * math.sin(angle)) if axis == 'x' else (a * math.cos(angle), b * math.sin(angle), 0)
            points.append(tuple(Vector(center) + Vector(delta)))
    for ring in range(len(centers) - 1):
        for side in range(sides):
            nxt = (side + 1) % sides
            faces.append((ring * sides + side, ring * sides + nxt, (ring + 1) * sides + nxt, (ring + 1) * sides + side))
    obj = mesh(name, points, faces, surface, rig, weights)
    obj.modifiers.new('Bounded shell thickness', 'SOLIDIFY').thickness = .003
    return obj


def patch(name, points, faces, surface, rig, weights):
    obj = mesh(name, points, faces, surface, rig, weights)
    solid = obj.modifiers.new('Garment thickness', 'SOLIDIFY')
    solid.thickness = .006
    bevel = obj.modifiers.new('Soft garment edge', 'BEVEL')
    bevel.width = .002
    bevel.segments = 2
    return obj


def rounded_box(name, center, size, surface, rig, bone, bevel=.008):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    # Bake location into coordinates so skinning shares the source's object space.
    for vertex in obj.data.vertices:
        vertex.co += obj.location
    obj.location = (0, 0, 0)
    assign(obj, surface)
    edge = obj.modifiers.new('Rounded edges', 'BEVEL')
    edge.width = bevel
    edge.segments = 3
    bind(obj, rig, bone_weights(bone))
    return obj


def collar(source, surface):
    obj = copy_surface(source, 'Fitted broad collar', surface,
                       lambda p: p.z > 1.465 and abs(p.x) < .14, .004,
                       planes=[((0, 0, 1.465), (0, 0, 1)), ((.14, 0, 0), (1, 0, 0)), ((-.14, 0, 0), (1, 0, 0))])
    for vertex in obj.data.vertices:
        vertex.co.x *= 1.04
        vertex.co.y = .008 + (vertex.co.y - .008) * 1.045
        if abs(vertex.co.x) > .055:
            vertex.co.x *= 1.03
    obj.modifiers.new('Collar thickness', 'SOLIDIFY').thickness = .003
    edge = obj.modifiers.new('Soft collar edge', 'BEVEL')
    edge.width = .0015
    edge.segments = 2
    return obj


def cloth_hems(rig, surface):
    for side in [-1, 1]:
        for front in [True, False]:
            points, faces = [], []
            columns, rows = 8, 6
            for row in range(rows + 1):
                v = row / rows
                z = 1.032 - .148 * v
                radius_x = .193 + .027 * v
                radius_y = (.149 + .005 * v) if front else (.083 + .009 * v)
                for column in range(columns + 1):
                    u = column / columns
                    x = .024 + .006 * v + (.143 + .003 * v) * u
                    y = radius_y * math.sqrt(max(.05, 1 - (x / radius_x) ** 2))
                    points.append((side * x, -y if front else y, z))
            for row in range(rows):
                for column in range(columns):
                    a = row * (columns + 1) + column
                    faces.append((a, a + 1, a + columns + 2, a + columns + 1))
            patch('Curved split cloth panel', points, faces, surface, rig, bone_weights('Hips'))


def hair(rig, surface):
    points, faces = [], []
    sides, rings = 72, 24
    for ring in range(rings + 1):
        for side in range(sides):
            azimuth = math.tau * side / sides
            forward = max(0, -math.sin(azimuth))
            rim = 1.65 - .45 * forward
            latitude = .025 + (rim - .025) * ring / rings
            points.append((.09 * math.sin(latitude) * math.cos(azimuth), .007 + .108 * math.sin(latitude) * math.sin(azimuth), 1.663 + .12 * math.cos(latitude)))
    for ring in range(rings):
        for side in range(sides):
            nxt = (side + 1) % sides
            faces.append((ring * sides + side, ring * sides + nxt, (ring + 1) * sides + nxt, (ring + 1) * sides + side))
    cap = mesh('Sculpted hair foundation', points, faces, surface, rig, bone_weights('Head'))
    cap.modifiers.new('Hair edge thickness', 'SOLIDIFY').thickness = .004
    # Broad, contained sweeps enrich the silhouette without thin strands or physics.
    for lock in range(7):
        x = (lock - 3) * .018
        points, faces = [], []
        steps, section = 12, 8
        for step in range(steps + 1):
            t = step / steps
            y = -.065 + .153 * t
            cx = x + .018 * math.sin(math.pi * t)
            z = 1.663 + .12 * math.sqrt(max(.03, 1 - (cx / .09) ** 2 - ((y - .007) / .108) ** 2))
            width = .002 + .013 * math.sin(math.pi * t) ** .5
            height = .001 + .004 * math.sin(math.pi * t)
            for corner in range(section):
                angle = math.tau * corner / section
                points.append((cx + width * math.cos(angle), y, z + height * math.sin(angle)))
        for step in range(steps):
            for corner in range(section):
                nxt = (corner + 1) % section
                faces.append((step * section + corner, step * section + nxt, (step + 1) * section + nxt, (step + 1) * section + corner))
        faces.extend([tuple(range(section - 1, -1, -1)), tuple(steps * section + i for i in range(section))])
        mesh(f'Hair sweep {lock + 1}', points, faces, surface, rig, bone_weights('Head'))


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    source = ROOT / 'public/vendor/character-gallery' / IDENTITY / 'model.glb'
    bpy.ops.import_scene.gltf(filepath=str(source))
    rig = next(obj for obj in bpy.data.objects if obj.type == 'ARMATURE')
    rig.name = 'Protagonist male rig'
    original = {obj.name: obj for obj in bpy.data.objects if obj.type == 'MESH' and obj.name.startswith('Ch01_')}
    # Imported FBX-derived meshes retain centimetre/Y-up coordinates beneath
    # the armature's transform. Author in world metres without altering the rig.
    for obj in original.values():
        obj.data.transform(obj.matrix_world)
        obj.matrix_parent_inverse = rig.matrix_world.inverted()
        obj.matrix_basis = Matrix.Identity(4)
    skin = material('Neutral skin geometry', (.47, .45, .42))
    cloth = material('Neutral cloth geometry', (.32, .34, .34))
    leather = material('Neutral leather geometry', (.22, .23, .23))
    metal = material('Neutral fittings geometry', (.36, .37, .36))
    hair_surface = material('Neutral hair geometry', (.12, .13, .13))
    for obj in original.values():
        assign(obj, skin)
    body = original['Ch01_Body']
    # Preserve weighted anatomy and UVs; broaden jaw planes without flattening features.
    for vertex in body.data.vertices:
        x, y, z = vertex.co
        if z > 1.49:
            jaw = math.exp(-((z - 1.55) / .045) ** 2)
            vertex.co.x *= 1.035 + .12 * jaw
            if y < -.075 and abs(x) < .045 and 1.64 < z < 1.67:
                vertex.co.y -= .003
    body.data.update()
    source_shirt = original['Ch01_Shirt']
    jacket = copy_surface(source_shirt, 'Open short jacket', leather,
                          lambda p: p.z > 1.015 and abs(p.x) < .355 and not (p.z > 1.475 and abs(p.x) < .13) and not (p.y < -.012 and abs(p.x) < .045 + max(0, p.z - 1.08) * .15), .008,
                          planes=[((0, 0, 1.015), (0, 0, 1)), ((0, 0, 1.475), (0, 0, 1)), ((.13, 0, 0), (1, 0, 0)), ((-.13, 0, 0), (1, 0, 0)), ((.355, 0, 0), (1, 0, 0)), ((-.355, 0, 0), (1, 0, 0)), ((.045, 0, 1.08), (1, 0, -.15)), ((-.045, 0, 1.08), (-1, 0, -.15))])
    solid = jacket.modifiers.new('Jacket edge thickness', 'SOLIDIFY')
    solid.thickness = .004
    shirt = copy_surface(source_shirt, 'Travel shirt', cloth, lambda p: p.z > 1.025 and not (p.z > 1.48 and abs(p.x) < .13),
                         planes=[((0, 0, 1.025), (0, 0, 1)), ((0, 0, 1.48), (0, 0, 1)), ((.13, 0, 0), (1, 0, 0)), ((-.13, 0, 0), (1, 0, 0))])
    collar(source_shirt, leather)
    bpy.data.objects.remove(source_shirt, do_unlink=True)
    for vertex in shirt.data.vertices:
        x = abs(vertex.co.x)
        if x > .25:
            vertex.co.x = math.copysign(.25 + (x - .25) * 2.0, vertex.co.x)
            side = 'L' if vertex.co.x > 0 else 'R'
            lower = max(0, min(1, (abs(vertex.co.x) - .43) / .07))
            for group in list(vertex.groups):
                shirt.vertex_groups[group.group].remove([vertex.index])
            for bone, weight in [(f'Shoulder_{side}', 1 - lower), (f'Elbow_{side}', lower)]:
                if weight > 0:
                    shirt.vertex_groups[bone].add([vertex.index], weight, 'REPLACE')
    shirt.data.update()
    pants = original['Ch01_Pants']
    assign(pants, cloth)
    cloth_hems(rig, cloth)
    for side, suffix in [(1, 'L'), (-1, 'R')]:
        def arm_weights(point, suffix=suffix):
            hand = max(0, min(1, (abs(point.x) - .56) / .13))
            return [(f'Elbow_{suffix}', 1 - hand), (f'Hand_{suffix}', hand)]
        tube('Forearm guard ' + suffix, [(side * .55, .036, 1.417), (side * .61, .034, 1.42), (side * .669, .031, 1.423)], [(.042, .037), (.034, .031), (.029, .027)], 'x', leather, rig, arm_weights)
        tube('Rolled sleeve ' + suffix, [(side * .5, .034, 1.417), (side * .52, .034, 1.417), (side * .54, .034, 1.417)], [(.058, .05), (.061, .053), (.053, .046)], 'x', cloth, rig, bone_weights('Elbow_' + suffix))
    gloves = copy_surface(body, 'Fingerless gloves', leather, lambda p: .68 < abs(p.x) < .78, .002,
                          planes=[((.68, 0, 0), (1, 0, 0)), ((.78, 0, 0), (1, 0, 0)), ((-.68, 0, 0), (1, 0, 0)), ((-.78, 0, 0), (1, 0, 0))])
    gloves.modifiers.new('Glove thickness', 'SOLIDIFY').thickness = .002
    belt = tube('Waist belt', [(0, -.008, 1.002), (0, -.008, 1.041)], [(.174, .147), (.177, .147)], 'z', leather, rig, bone_weights('Hips'), sides=32)
    waist = [vertex.co.copy() for obj in [shirt, jacket] for vertex in obj.data.vertices if abs(vertex.co.z - 1.023) < .025]
    for vertex in belt.data.vertices:
        direction = Vector((vertex.co.x, vertex.co.y + .008, 0)).normalized()
        aligned = [point for point in waist if Vector((point.x, point.y + .008, 0)).normalized().dot(direction) > .98]
        if aligned:
            radius = max(Vector((point.x, point.y + .008, 0)).dot(direction) for point in aligned) + .007
            vertex.co.x = direction.x * radius
            vertex.co.y = -.008 + direction.y * radius
    rounded_box('Belt buckle', (0, -.163, 1.023), (.055, .014, .047), metal, rig, 'Hips', .004)
    rounded_box('Travel pouch', (.162, -.112, .963), (.085, .05, .105), leather, rig, 'Hips')
    boots = copy_surface(pants, 'Boot shafts', leather, lambda p: .12 < p.z < .445, .008,
                         planes=[((0, 0, .12), (0, 0, 1)), ((0, 0, .445), (0, 0, 1))])
    boots.modifiers.new('Boot thickness', 'SOLIDIFY').thickness = .004
    sneakers = original['Ch01_Sneakers']
    for side, suffix in [(1, 'L'), (-1, 'R')]:
        bm = bmesh.new()
        for vertex in sneakers.data.vertices:
            if vertex.co.x * side > 0:
                bm.verts.new(vertex.co)
        bmesh.ops.convex_hull(bm, input=list(bm.verts), use_existing_faces=False)
        data = bpy.data.meshes.new('Boot foot ' + suffix)
        bm.to_mesh(data)
        bm.free()
        obj = bpy.data.objects.new('Boot foot ' + suffix, data)
        bpy.context.collection.objects.link(obj)
        assign(obj, leather)
        bind(obj, rig, bone_weights('Ankle_' + suffix))
        edge = obj.modifiers.new('Rounded boot toe', 'BEVEL')
        edge.width = .007
        edge.segments = 3
        tube('Boot cuff ' + suffix, [(side * .143, .006, .425), (side * .143, .006, .45)], [(.067, .072), (.065, .07)], 'z', leather, rig, bone_weights('LowerLeg_' + suffix))
    bpy.data.objects.remove(sneakers, do_unlink=True)
    hair(rig, hair_surface)
    bpy.context.view_layer.update()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    PRIVATE.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(PRIVATE / 'male-geometry.blend'))
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    for obj in bpy.data.objects:
        if obj.type == 'MESH' and obj.parent == rig:
            obj.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(filepath=str(OUTPUT / 'model.glb'), export_format='GLB', use_selection=True, export_animations=False, export_apply=True)
    return rig


def motions(rig):
    manifest = json.loads((ROOT / 'assets/motion-profiles.json').read_text())
    source_pack = next(pack for pack in json.loads((ROOT / '.local/animation-packs/mixamo/converted-source-catalog.json').read_text())['packs'] if pack['id'] == 'mixamo')
    sources = {clip['id']: clip for clip in source_pack['clips']}
    choices = {'idle': 'shield-idle', 'run': 'shield-forward', 'attack': 'sword-attack', 'dodge': 'roll'}
    records = {}
    target_objects = set(bpy.data.objects)
    for role, key in choices.items():
        recipe = manifest['clips'][key]
        source = sources[recipe['sourceId']]
        try:
            bpy.ops.import_scene.fbx(filepath=str(ROOT / '.local/animation-packs' / source['source']), use_anim=True)
            original = next(obj for obj in bpy.data.objects if obj not in target_objects and obj.type == 'ARMATURE')
            mapping = {name: bone for name, bone in BAKER.bone_map(original).items() if name in rig.data.bones}
            fingers = {f'mixamorig:{side}Hand{finger}{segment}' for side in ['Left', 'Right'] for finger in ['Ring', 'Pinky'] for segment in [1, 2, 3]}
            if fingers - set(mapping):
                raise RuntimeError(f'Missing grip finger mapping for {key}: {sorted(fingers - set(mapping))}')
            action = original.animation_data.action
            fps = bpy.context.scene.render.fps / bpy.context.scene.render.fps_base
            trim = recipe.get('trim')
            sample_range = tuple(action.frame_range[0] + time * fps for time in trim) if trim else None
            meta = BAKER.bake(rig, original, action, role, OUTPUT / f'{role}.glb', mapping=mapping, sample_range=sample_range, output_duration=recipe.get('duration'))
            records[role] = {'url': f'/vendor/characters/protagonist-male-draft/{role}.glb', 'sourceId': recipe['sourceId'], 'sourceName': recipe['name'], **meta}
        finally:
            for obj in list(bpy.data.objects):
                if obj not in target_objects:
                    bpy.data.objects.remove(obj, do_unlink=True)
            rig.animation_data_clear()
            for bone in rig.pose.bones:
                bone.matrix_basis.identity()
    return records


def main():
    parser = argparse.ArgumentParser()
    parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    rig = build()
    records = motions(rig)
    path = ROOT / 'public/vendor/character-gallery/catalog.json'
    catalog = json.loads(path.read_text())
    identity = 'lantern-protagonist-male-draft'
    row = {'id': identity, 'name': 'Male geometry draft', 'family': 'Lantern studies', 'url': '/vendor/characters/protagonist-male-draft/model.glb', 'status': 'ready', 'bones': len(rig.data.bones), 'motions': records, 'motionError': None}
    index = next((index for index, item in enumerate(catalog['characters']) if item['id'] == identity), None)
    if index is None:
        catalog['characters'].append(row)
        catalog['expectedCount'] += 1
    else:
        catalog['characters'][index] = row
    path.write_text(json.dumps(catalog, indent=2) + '\n')
    print('Prepared private male geometry study with independently baked finger-complete motions.', flush=True)


if __name__ == '__main__':
    main()
