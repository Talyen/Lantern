"""Convert three privately owned Synty FBXs into local, ignored browser GLBs."""

import argparse
import sys
from pathlib import Path

import bpy


def arguments():
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args(args)


def main():
    args = arguments()
    root = args.source_root
    palette = root / "Textures/Alts/PolygonVikingRealm_01_A.png"
    models = {
        "pine": root / "Models/SM_Env_Tree_Pine_01.fbx",
        "rock": root / "Models/SM_Env_Rock_Cliff_01.fbx",
        "chest": root / "Models/SM_Prop_Chest_01.fbx",
    }
    missing = [str(path) for path in [palette, *models.values()] if not path.is_file()]
    if missing:
        raise FileNotFoundError("Missing source files: " + ", ".join(missing))
    args.output.mkdir(parents=True, exist_ok=True)

    for name, source in models.items():
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.fbx(filepath=str(source), use_anim=False)
        image = bpy.data.images.load(str(palette), check_existing=True)
        # The source atlas is 4096px. A 1024px copy is sufficient for this
        # small preview and keeps each browser model reasonably sized.
        image.scale(1024, 1024)
        image.pack()
        mapped = bpy.data.materials.new(f"Synty Viking palette {name}")
        mapped.use_nodes = True
        nodes = mapped.node_tree.nodes
        nodes.clear()
        texture = nodes.new("ShaderNodeTexImage")
        texture.image = image
        shader = nodes.new("ShaderNodeBsdfPrincipled")
        shader.inputs["Roughness"].default_value = 0.9
        output_node = nodes.new("ShaderNodeOutputMaterial")
        mapped.node_tree.links.new(texture.outputs["Color"], shader.inputs["Base Color"])
        mapped.node_tree.links.new(shader.outputs["BSDF"], output_node.inputs["Surface"])
        meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
        if not meshes:
            raise RuntimeError(f"No meshes in {source}")
        for mesh in meshes:
            if not mesh.data.uv_layers:
                raise RuntimeError(f"Missing UVs in {source}: {mesh.name}")
            mesh.data.materials.clear()
            mesh.data.materials.append(mapped)
        target = args.output / f"{name}.glb"
        bpy.ops.export_scene.gltf(filepath=str(target), export_format="GLB", export_apply=True)
        print(f"Converted {source.name} -> {target} ({target.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
