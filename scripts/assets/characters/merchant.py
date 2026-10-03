"""Prepare only the authored Peasant Man and a neutral Mixamo idle for gameplay."""
import hashlib
import importlib.util
import json
from pathlib import Path
import bpy

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('gallery', Path(__file__).with_name('export.py'))
gallery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gallery)
IDENTITY = '5fb4b535-034a-4011-af3b-2880391547a5'
IDLE = '2b810890b52a'


def main():
    if gallery.exclusions.excluded('', '/vendor/characters/merchant/model.glb'):return
    metadata = ROOT / '.local/animation-packs/mixamo/Library/Characters' / IDENTITY / 'asset.json'
    source = json.loads(metadata.read_text())
    row = {'id': 'mixamo-' + IDENTITY, 'name': source['name'], 'family': 'Mixamo',
           'source': str(ROOT / source['file']), 'sourceHash': source['sha256']}
    if hashlib.sha256(Path(row['source']).read_bytes()).hexdigest() != row['sourceHash']:
        raise RuntimeError('Merchant source changed')
    rig, error = gallery.prepare(row)
    if error:
        raise RuntimeError(error)
    # Legacy Phong reflection is not authored PBR metalness; keep clothing/skin diffuse.
    for material in bpy.data.materials:
        if material.node_tree:
            shader = material.node_tree.nodes.get('Principled BSDF')
            if shader and not shader.inputs['Metallic'].is_linked:
                shader.inputs['Metallic'].default_value = 0
    output = ROOT / 'public/vendor/characters/merchant'
    output.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(output / 'authored.glb'), export_format='GLB', export_animations=False)
    targets = set(bpy.data.objects)
    catalog = json.loads((ROOT / '.local/animation-packs/mixamo/converted-source-catalog.json').read_text())
    clip = next(c for p in catalog['packs'] for c in p['clips'] if c['id'] == IDLE)
    animation = ROOT / '.local/animation-packs' / clip['source']
    if hashlib.sha256(animation.read_bytes()).hexdigest() != clip['sourceHash']:
        raise RuntimeError('Neutral idle source changed')
    bpy.ops.import_scene.fbx(filepath=str(animation), use_anim=True)
    actor = next(o for o in bpy.data.objects if o not in targets and o.type == 'ARMATURE')
    mapping = {name: bone for name, bone in gallery.baker.bone_map(actor).items() if name in rig.data.bones}
    motion = gallery.baker.bake(rig, actor, actor.animation_data.action, 'idle', output / 'idle.glb', mapping=mapping)
    gallery.write_json(output / 'catalog.json', {'version': 1, 'character': '/vendor/characters/merchant/authored.glb',
        'defaults': {'idle': IDLE}, 'packs': [{'id': 'mixamo', 'clips': [
            {**clip, **motion, 'url': '/vendor/characters/merchant/idle.glb'}]}]})
    gallery.write_json(output / 'provenance.json', {'character': row['id'], 'sourceHash': row['sourceHash'],
        'motion': IDLE, 'motionSourceHash': clip['sourceHash'], 'bakeVersion': motion.get('bakeVersion')})


if __name__ == '__main__':
    main()
