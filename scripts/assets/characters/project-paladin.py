"""Project original text-prompted surfaces locally; never uploads character assets."""
import argparse
import colorsys
import numpy as np
import json
import sys
from pathlib import Path
import bpy

ROOT = Path(__file__).resolve().parents[3]
VARIANTS = {'silver-gold': (0.045, 0.14, 0.28, 1), 'dark-brass': (0.22, 0.018, 0.028, 1), 'ivory-gold': (0.025, 0.19, 0.17, 1), 'grim-gold': (0.16, 0.015, 0.018, 1), 'grim-crimson': (0.12, 0.008, 0.012, 1), 'iron-gold-crimson': (.35, .016, .032, 1), 'iron-copper-teal': (.015, .24, .22, 1), 'slate-bronze-blue': (.028, .09, .32, 1)}

ACCENTS = {'iron-gold-crimson': (.42, .20, .035, 1), 'iron-copper-teal': (.40, .11, .045, 1), 'slate-bronze-blue': (.28, .16, .06, 1)}

def palette_regions(mesh, image, bounds):
    """Large authored armor parts and whole cloth faces; no new decorative motifs."""
    pixels = np.empty(image.size[0] * image.size[1] * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    width, height = image.size
    def sample(uv):
        x, y = round((uv.x % 1) * (width - 1)), round((uv.y % 1) * (height - 1))
        rgb = pixels[(y * width + x) * 4:(y * width + x) * 4 + 3]
        hue, saturation, value = colorsys.rgb_to_hsv(*rgb)
        return hue, saturation, value
    def fabric(uv):
        hue, saturation, value = sample(uv)
        return .58 < hue < .90 and saturation > .35 and value > .005
    accents = []
    heads = []
    for vertex in mesh.data.vertices:
        weights = {mesh.vertex_groups[g.group].name: g.weight for g in vertex.groups}
        shoulder = max(weights.get('Shoulder_L', 0), weights.get('Shoulder_R', 0), weights.get('mixamorig:LeftShoulder', 0), weights.get('mixamorig:RightShoulder', 0))
        forearm = max(weights.get('Elbow_L', 0), weights.get('Elbow_R', 0)) * .85
        z = ((mesh.matrix_world @ vertex.co).z - bounds[0]) / (bounds[1] - bounds[0])
        crown = weights.get('Head', 0) if z > .89 else 0
        accents.append(max(shoulder, forearm, crown))
        heads.append(weights.get('Head', 0))
    uv = mesh.data.uv_layers.active.data
    attribute = mesh.data.color_attributes.new(name='PaletteRegions', type='FLOAT_COLOR', domain='CORNER')
    for polygon in mesh.data.polygons:
        corners = [uv[i].uv for i in polygon.loop_indices]
        center = sum(corners, corners[0] * 0) / len(corners)
        cloth = fabric(center) or sum(fabric(point) for point in corners) >= len(corners) / 2
        hue, saturation, value = sample(center)
        head = max(heads[mesh.data.loops[i].vertex_index] for i in polygon.loop_indices) > .2
        skin = head and hue < .10 and .18 < saturation < .65 and value > .18
        steel = not cloth and not skin and (saturation < .45 or (.06 < hue < .17 and value > .17))
        for i in polygon.loop_indices:
            attribute.data[i].color = (accents[mesh.data.loops[i].vertex_index], float(cloth), float(steel), float(skin))
    mesh.data.update()
    return attribute


def project(variant, output, size):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.ops.import_scene.gltf(filepath=str(ROOT / 'public/vendor/characters/paladin/authored.glb'))
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.name.startswith('Paladin_J_Nordstrom')]
    for obj in list(bpy.data.objects):
        if obj.type == 'MESH' and obj not in meshes:
            bpy.data.objects.remove(obj, do_unlink=True)
    if len(meshes) != 2 or any(not mesh.data.materials for mesh in meshes):
        raise RuntimeError('Expected the Paladin body and helmet with authored materials')
    grim = variant.startswith('grim-')
    balanced = variant in ACCENTS
    z_values = [(mesh.matrix_world @ vertex.co).z for mesh in meshes for vertex in mesh.data.vertices]
    bounds = (min(z_values), max(z_values))
    surface = bpy.data.images.load(str(ROOT / 'assets/textures/paladin' / f'{variant}.png'))
    review = ROOT / '.local/paladin-review'
    review.mkdir(parents=True, exist_ok=True)
    for mesh in meshes:
        original = mesh.data.materials[0]
        mat = original.copy()
        mesh.data.materials[0] = mat
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        bsdf = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
        base = bsdf.inputs['Base Color'].links[0].from_socket
        regions = palette_regions(mesh, base.node.image, bounds) if balanced else None
        uv = nodes.new('ShaderNodeTexCoord')
        projection = nodes.new('ShaderNodeTexImage')
        projection.image = surface
        projection.projection = 'BOX'
        projection.projection_blend = 0.3
        projection.extension = 'REPEAT'
        # Rest-pose object coordinates: detail follows the skinned UV bake during movement.
        links.new(uv.outputs['Generated'], projection.inputs['Vector'])
        hsv = nodes.new('ShaderNodeSeparateColor'); hsv.mode = 'HSV'
        links.new(base, hsv.inputs['Color'])

        def math(op, a, b=0):
            n = nodes.new('ShaderNodeMath'); n.operation = op
            for slot, value in zip(n.inputs, (a, b)):
                if isinstance(value, (float, int)): slot.default_value = value
                else: links.new(value, slot)
            return n.outputs[0]

        def mix(factor, a, b, mode='MIX'):
            n = nodes.new('ShaderNodeMixRGB'); n.blend_type = mode
            for slot, value in zip(n.inputs, (factor, a, b)):
                if isinstance(value, (tuple, list)): slot.default_value = value
                elif isinstance(value, (float, int)): slot.default_value = value
                else: links.new(value, slot)
            return n.outputs[0]

        # Source albedo saturation separates neutral plate from gold trim and purple cloth.
        armor = math('LESS_THAN', hsv.outputs[1], 0.42 if grim or balanced else 0.29)
        armor = math('MULTIPLY', armor, math('GREATER_THAN', hsv.outputs[2], 0.025))
        coords = nodes.new('ShaderNodeSeparateXYZ'); links.new(uv.outputs['UV'], coords.inputs[0])
        def rect(x0, x1, y0, y1):
            x = math('MULTIPLY', math('GREATER_THAN', coords.outputs['X'], x0), math('LESS_THAN', coords.outputs['X'], x1))
            y = math('MULTIPLY', math('GREATER_THAN', coords.outputs['Y'], y0), math('LESS_THAN', coords.outputs['Y'], y1))
            return math('MULTIPLY', x, y)
        # Preserve face/scalp, eye and mouth UV islands even at low saturation.
        skin = math('MAXIMUM', rect(0, .31, .16, .34), math('MAXIMUM', rect(.50, .57, .64, .72), rect(.58, .66, .55, .65)))
        armor = math('MULTIPLY', armor, math('SUBTRACT', 1, skin))
        # Retain authored plate creases rather than painting over the model's structure.
        if balanced:
            detailed = mix(.88, mix(1, base, (.5, .5, .5, 1), 'MULTIPLY'), mix(1, projection.outputs['Color'], (.9, .9, .9, 1), 'MULTIPLY'))
            for node in nodes:
                if node.type == 'NORMAL_MAP': node.inputs['Strength'].default_value = .55
        elif grim:
            # Keep the new surfaces truly charcoal under the same scene lighting.
            dark_base = mix(1, base, (.2, .2, .2, 1), 'MULTIPLY')
            dark_projection = mix(1, projection.outputs['Color'], (.45, .45, .45, 1), 'MULTIPLY')
            detailed = mix(.95, dark_base, dark_projection)
            for node in nodes:
                if node.type == 'NORMAL_MAP': node.inputs['Strength'].default_value = .35
        else:
            detailed = mix(.62, base, projection.outputs['Color'])
        color = mix(armor, base, detailed)
        cloth = math('MULTIPLY', math('GREATER_THAN', hsv.outputs[1], .5), math('MULTIPLY', math('GREATER_THAN', hsv.outputs[0], .60), math('LESS_THAN', hsv.outputs[0], .85)))
        cloth_color = mix(1, VARIANTS[variant], mix(.45, base, (0.24, .24, .24, 1)), 'MULTIPLY')
        if grim:
            # Cover tabard glyphs locally; no new ornamental patterns in the grim variants.
            cloth = math('MAXIMUM', cloth, math('MAXIMUM', rect(.022, .16, .72, .96), rect(.028, .19, .37, .56)))
            cloth_color = mix(1, VARIANTS[variant], mix(.90, base, (.12, .12, .12, 1)), 'MULTIPLY')
            trim = math('MULTIPLY', math('GREATER_THAN', hsv.outputs[1], .35), math('MULTIPLY', math('GREATER_THAN', hsv.outputs[0], .06), math('LESS_THAN', hsv.outputs[0], .17)))
            trim = math('MULTIPLY', trim, math('SUBTRACT', 1, skin))
            trim_color = (.10, .055, .012, 1) if variant == 'grim-gold' else (.085, .007, .009, 1)
            color = mix(trim, color, mix(.08, detailed, trim_color))
        if balanced:
            palette = nodes.new('ShaderNodeVertexColor'); palette.layer_name = 'PaletteRegions'
            channels = nodes.new('ShaderNodeSeparateColor'); links.new(palette.outputs['Color'], channels.inputs['Color'])
            skin = math('MAXIMUM', skin, palette.outputs['Alpha'])
            trim = math('MULTIPLY', math('GREATER_THAN', hsv.outputs[1], .35), math('MULTIPLY', math('GREATER_THAN', hsv.outputs[0], .06), math('LESS_THAN', hsv.outputs[0], .17)))
            armor = math('MULTIPLY', math('MAXIMUM', math('MAXIMUM', armor, trim), channels.outputs[2]), math('SUBTRACT', 1, skin))
            color = mix(armor, base, detailed)
            accent = math('MULTIPLY', armor, math('GREATER_THAN', channels.outputs[0], .48))
            wear = mix(.80, projection.outputs['Color'], (.8, .8, .8, 1))
            color = mix(accent, color, mix(1, wear, ACCENTS[variant], 'MULTIPLY'))
            cloth = math('MAXIMUM', cloth, channels.outputs[1])
            cloth_color = mix(1, VARIANTS[variant], mix(.90, projection.outputs['Color'], (.65, .65, .65, 1)), 'MULTIPLY')
        color = mix(cloth, color, cloth_color)
        baked = bpy.data.images.new(f'{variant}-{mesh.name}-albedo', size, size, alpha=False)
        target = nodes.new('ShaderNodeTexImage'); target.image = baked; nodes.active = target
        emission = nodes.new('ShaderNodeEmission'); links.new(color, emission.inputs['Color'])
        out = next(n for n in nodes if n.type == 'OUTPUT_MATERIAL'); links.new(emission.outputs[0], out.inputs['Surface'])
        # Original UVs remain in place, preserving the normal map and all skin islands.
        bpy.ops.object.select_all(action='DESELECT'); mesh.select_set(True); bpy.context.view_layer.objects.active = mesh
        bpy.context.scene.render.engine = 'CYCLES'; bpy.context.scene.cycles.samples = 1
        bpy.ops.object.bake(type='EMIT', margin=8)
        baked.filepath_raw = str(review / f'{variant}-{mesh.name}-albedo.png'); baked.file_format = 'PNG'; baked.save(); baked.pack()
        links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
        texture = nodes.new('ShaderNodeTexImage'); texture.image = baked; links.new(texture.outputs['Color'], bsdf.inputs['Base Color'])
        if grim or balanced:
            for link in list(bsdf.inputs['Specular IOR Level'].links): links.remove(link)
            bsdf.inputs['Specular IOR Level'].default_value = .22 if balanced else .16
        # Mild metals; keep nonmetal areas matte, retaining the authored normal map.
        metal = math('MAXIMUM', armor, math('MULTIPLY', math('GREATER_THAN', hsv.outputs[0], .06), math('LESS_THAN', hsv.outputs[0], .17)))
        metal = math('MULTIPLY', metal, math('SUBTRACT', 1, skin))
        if balanced:
            metal = math('MULTIPLY', armor, math('SUBTRACT', 1, cloth))
            metal_value = math('ADD', math('MULTIPLY', metal, .40), math('MULTIPLY', math('MULTIPLY', accent, math('SUBTRACT', 1, cloth)), .25))
        else:
            metal_value = math('MULTIPLY', metal, .22 if grim else .75)
        links.new(metal_value, bsdf.inputs['Metallic'])
        links.new(math('SUBTRACT', .78, math('MULTIPLY', metal, .22 if balanced else .05 if grim else .38)), bsdf.inputs['Roughness'])
        # glTF cannot export procedural PBR masks: bake roughness/metallic to the same UVs.
        for name in ['Metallic', 'Roughness']:
            value = bsdf.inputs[name].links[0].from_socket
            pbr = bpy.data.images.new(f'{variant}-{mesh.name}-{name}', size, size, alpha=False); pbr.colorspace_settings.name = 'Non-Color'
            target.image = pbr; nodes.active = target
            links.new(value, emission.inputs['Color']); links.new(emission.outputs[0], out.inputs['Surface'])
            bpy.ops.object.bake(type='EMIT', margin=8)
            pbr.pack(); tex = nodes.new('ShaderNodeTexImage'); tex.image = pbr; links.new(tex.outputs['Color'], bsdf.inputs[name])
        links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
        if regions: mesh.data.color_attributes.remove(regions)
        print(f'Baked {variant}: {mesh.name}', flush=True)
    bpy.ops.object.select_all(action='SELECT')
    output.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(output / f'{variant}.glb'), export_format='GLB', export_animations=False)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT / 'public/vendor/characters/paladin')
    parser.add_argument('--variant', choices=list(VARIANTS), action='append')
    parser.add_argument('--size', type=int, choices=[1024, 2048], default=2048)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    output = args.output.resolve()
    for variant in args.variant or VARIANTS:
        project(variant, output, args.size)
    (output / 'variants.json').write_text(json.dumps({'version': 1, 'variants': [{'id': 'authored', 'label': 'Original', 'url': '/vendor/characters/paladin/authored.glb'}, *[{'id': id, 'label': id.replace('-', ' ').title(), 'url': f'/vendor/characters/paladin/{id}.glb'} for id in VARIANTS]]}, indent=2) + '\n')


if __name__ == '__main__':
    main()
