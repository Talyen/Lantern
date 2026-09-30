"""Planar-project an original ImageGen surface and bake it to a local ground GLB."""

import argparse
import sys
from pathlib import Path

import bpy


def arguments():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--albedo', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--preview', type=Path, required=True)
    return parser.parse_args(args)


def main():
    args = arguments()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.mesh.primitive_circle_add(vertices=96, radius=8.1, fill_type='TRIFAN')
    ground = bpy.context.object
    ground.name = 'Painted ground'
    uv = ground.data.uv_layers.new(name='GroundUV')
    for poly in ground.data.polygons:
        for loop_id in poly.loop_indices:
            vertex = ground.data.vertices[ground.data.loops[loop_id].vertex_index]
            uv.data[loop_id].uv = (vertex.co.x / 16.2 + 0.5, vertex.co.y / 16.2 + 0.5)

    source = bpy.data.images.load(str(args.albedo), check_existing=True)
    projection = bpy.data.materials.new('Forest floor planar projection')
    projection.use_nodes = True
    nodes = projection.node_tree.nodes
    nodes.clear()
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = source
    uv_node = nodes.new('ShaderNodeUVMap')
    uv_node.uv_map = 'GroundUV'
    emission = nodes.new('ShaderNodeEmission')
    output = nodes.new('ShaderNodeOutputMaterial')
    baked = bpy.data.images.new('Forest floor baked color', 1024, 1024, alpha=False)
    target = nodes.new('ShaderNodeTexImage')
    target.image = baked
    nodes.active = target
    projection.node_tree.links.new(uv_node.outputs['UV'], tex.inputs['Vector'])
    projection.node_tree.links.new(tex.outputs['Color'], emission.inputs['Color'])
    projection.node_tree.links.new(emission.outputs['Emission'], output.inputs['Surface'])
    ground.data.materials.append(projection)
    bpy.context.scene.render.engine = 'CYCLES'
    bpy.context.scene.cycles.samples = 1
    bpy.ops.object.bake(type='EMIT', margin=8)
    args.preview.parent.mkdir(parents=True, exist_ok=True)
    baked.filepath_raw = str(args.preview)
    baked.file_format = 'PNG'
    baked.save()

    final = bpy.data.materials.new('Forest floor baked albedo')
    final.use_nodes = True
    nodes = final.node_tree.nodes
    nodes.clear()
    image = nodes.new('ShaderNodeTexImage')
    image.image = baked
    shader = nodes.new('ShaderNodeBsdfPrincipled')
    shader.inputs['Roughness'].default_value = 1
    out = nodes.new('ShaderNodeOutputMaterial')
    final.node_tree.links.new(image.outputs['Color'], shader.inputs['Base Color'])
    final.node_tree.links.new(shader.outputs['BSDF'], out.inputs['Surface'])
    ground.data.materials.clear()
    ground.data.materials.append(final)
    baked.pack()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(args.output), export_format='GLB', export_apply=True)
    print(f'Baked ground: {args.output}')


if __name__ == '__main__':
    main()
