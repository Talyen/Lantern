"""Triplanar-project ImageGen albedo and bake it to a private rock GLB."""

import argparse
import sys
from pathlib import Path

import bpy


def arguments():
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--albedo", type=Path, required=True)
    parser.add_argument("--preview", type=Path, required=True)
    return parser.parse_args(args)


def main():
    args = arguments()
    source = args.source_root / "Models/SM_Env_Rock_Cliff_01.fbx"
    if not source.is_file() or not args.albedo.is_file():
        raise FileNotFoundError(f"Missing rock FBX or generated albedo: {source}, {args.albedo}")
    args.output.mkdir(parents=True, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str(source), use_anim=False)
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if len(meshes) != 1:
        raise RuntimeError(f"Expected one rock mesh; found {len(meshes)}")
    rock = meshes[0]
    bpy.ops.object.select_all(action="DESELECT")
    rock.select_set(True)
    bpy.context.view_layer.objects.active = rock

    # Vendor palette UVs occupy tiny shared color swatches. The experiment
    # needs a full-coverage UV atlas to preserve projected surface detail.
    while rock.data.uv_layers:
        rock.data.uv_layers.remove(rock.data.uv_layers[0])
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(island_margin=0.025)
    bpy.ops.object.mode_set(mode="OBJECT")

    image = bpy.data.images.load(str(args.albedo), check_existing=True)
    projection = bpy.data.materials.new("ImageGen rock triplanar projection")
    projection.use_nodes = True
    nodes = projection.node_tree.nodes
    nodes.clear()
    coords = nodes.new("ShaderNodeTexCoord")
    source_image = nodes.new("ShaderNodeTexImage")
    source_image.image = image
    source_image.projection = "BOX"
    source_image.projection_blend = 0.28
    source_image.extension = "REPEAT"
    color_grade = nodes.new("ShaderNodeHueSaturation")
    color_grade.inputs["Saturation"].default_value = 0.75
    color_grade.inputs["Value"].default_value = 0.78
    emission = nodes.new("ShaderNodeEmission")
    output_node = nodes.new("ShaderNodeOutputMaterial")
    bake_image = bpy.data.images.new("ImageGen rock UV bake", width=1024, height=1024, alpha=False)
    target = nodes.new("ShaderNodeTexImage")
    target.image = bake_image
    nodes.active = target
    projection.node_tree.links.new(coords.outputs["Generated"], source_image.inputs["Vector"])
    projection.node_tree.links.new(source_image.outputs["Color"], color_grade.inputs["Color"])
    projection.node_tree.links.new(color_grade.outputs["Color"], emission.inputs["Color"])
    projection.node_tree.links.new(emission.outputs["Emission"], output_node.inputs["Surface"])
    rock.data.materials.clear()
    rock.data.materials.append(projection)

    bpy.context.scene.render.engine = "CYCLES"
    bpy.context.scene.cycles.samples = 1
    bpy.ops.object.bake(type="EMIT", margin=12)
    args.preview.parent.mkdir(parents=True, exist_ok=True)
    bake_image.filepath_raw = str(args.preview)
    bake_image.file_format = "PNG"
    bake_image.save()

    baked_material = bpy.data.materials.new("ImageGen rock baked albedo")
    baked_material.use_nodes = True
    baked_nodes = baked_material.node_tree.nodes
    baked_nodes.clear()
    baked_texture = baked_nodes.new("ShaderNodeTexImage")
    baked_texture.image = bake_image
    shader = baked_nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Roughness"].default_value = 0.9
    material_output = baked_nodes.new("ShaderNodeOutputMaterial")
    baked_material.node_tree.links.new(baked_texture.outputs["Color"], shader.inputs["Base Color"])
    baked_material.node_tree.links.new(shader.outputs["BSDF"], material_output.inputs["Surface"])
    rock.data.materials.clear()
    rock.data.materials.append(baked_material)
    bake_image.pack()
    target_path = args.output / "rock-painted.glb"
    bpy.ops.export_scene.gltf(filepath=str(target_path), export_format="GLB", export_apply=True)
    print(f"Baked rock: {target_path} ({target_path.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
