"""Read private Synty meshes and bake original surface studies locally."""
import argparse
import sys
from pathlib import Path
import bpy

parser = argparse.ArgumentParser()
parser.add_argument('--source-root', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--textures', type=Path, required=True)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
root = args.source_root
models = {
    'wall': ('SM_Bld_Stone_Wall_01.fbx', 'stone'),
    'pillar': ('SM_Bld_Stone_Pillar_01.fbx', 'stone'),
    'door': ('SM_Bld_Door_01.fbx', 'wood'),
    'floor': ('SM_Bld_Dock_Floor_01.fbx', 'wood'),
    'brazier': ('SM_Prop_Brazier_01.fbx', None),
    'torch': ('SM_Prop_Torch_01.fbx', None),
    'rock': ('SM_Env_Rock_Cliff_01.fbx', 'stone'),
}
args.output.mkdir(parents=True, exist_ok=True)
for name, (filename, surface) in models.items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str(root / 'Models' / filename), use_anim=False)
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    palette = bpy.data.images.load(str(root / 'Textures/Alts/PolygonVikingRealm_01_A.png'))
    palette.scale(1024, 1024)
    palette.pack()
    mat = bpy.data.materials.new('Original Synty palette')
    mat.use_nodes = True
    tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
    tex.image = palette
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Roughness'].default_value = 0.9
    mat.node_tree.links.new(tex.outputs['Color'], shader.inputs['Base Color'])
    for mesh in meshes:
        mesh.data.materials.clear()
        mesh.data.materials.append(mat)
    bpy.ops.export_scene.gltf(filepath=str(args.output / f'{name}.glb'), export_format='GLB', export_apply=True)
    if not surface:
        continue
    albedo = args.textures / f'{surface}-painterly.png'
    if not albedo.is_file():
        raise FileNotFoundError(albedo)
    image = bpy.data.images.load(str(albedo))
    for index, mesh in enumerate(meshes):
        bpy.ops.object.select_all(action='DESELECT')
        mesh.select_set(True)
        bpy.context.view_layer.objects.active = mesh
        while mesh.data.uv_layers:
            mesh.data.uv_layers.remove(mesh.data.uv_layers[0])
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(island_margin=0.025)
        bpy.ops.object.mode_set(mode='OBJECT')
        projection = bpy.data.materials.new(f'{surface} projection')
        projection.use_nodes = True
        nodes = projection.node_tree.nodes
        nodes.clear()
        coord = nodes.new('ShaderNodeTexCoord')
        source = nodes.new('ShaderNodeTexImage')
        source.image = image
        source.projection = 'BOX'
        source.projection_blend = 0.28
        emission = nodes.new('ShaderNodeEmission')
        output = nodes.new('ShaderNodeOutputMaterial')
        baked = bpy.data.images.new(f'{name}-{index} albedo', 1024, 1024, alpha=False)
        target = nodes.new('ShaderNodeTexImage')
        target.image = baked
        nodes.active = target
        projection.node_tree.links.new(coord.outputs['Generated'], source.inputs['Vector'])
        projection.node_tree.links.new(source.outputs['Color'], emission.inputs['Color'])
        projection.node_tree.links.new(emission.outputs['Emission'], output.inputs['Surface'])
        mesh.data.materials.clear()
        mesh.data.materials.append(projection)
        bpy.context.scene.render.engine = 'CYCLES'
        bpy.context.scene.cycles.samples = 1
        bpy.ops.object.bake(type='EMIT', margin=12)
        preview = args.output.parents[3] / '.local' / 'art-lab' / f'{name}-{index}-albedo.png'
        preview.parent.mkdir(parents=True, exist_ok=True)
        baked.filepath_raw = str(preview)
        baked.file_format = 'PNG'
        baked.save()
        baked.pack()
        final = bpy.data.materials.new(f'Painterly {surface}')
        final.use_nodes = True
        texture = final.node_tree.nodes.new('ShaderNodeTexImage')
        texture.image = baked
        bsdf = final.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Roughness'].default_value = 0.95
        final.node_tree.links.new(texture.outputs['Color'], bsdf.inputs['Base Color'])
        mesh.data.materials.clear()
        mesh.data.materials.append(final)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=str(args.output / f'{name}-painterly.glb'), export_format='GLB', export_apply=True)
    print(f'Exported original and painterly {name}')
