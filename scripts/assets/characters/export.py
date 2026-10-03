"""Private character roster and per-rig Mixamo sample bakes. Run through export.mjs."""
import argparse
import hashlib
import importlib.util
import json
import re
import sys
from pathlib import Path
import bpy

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('motion_baker', ROOT / 'scripts/assets/mixamo/baker.py')
baker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(baker)
exclusions_spec = importlib.util.spec_from_file_location('asset_exclusions', ROOT / 'scripts/assets/review/exclusions.py')
exclusions = importlib.util.module_from_spec(exclusions_spec)
exclusions_spec.loader.exec_module(exclusions)
OUTPUT = ROOT / 'public/vendor/character-gallery'
VERSION = 3
BAKER_SIGNATURE = hashlib.sha256((ROOT / 'scripts/assets/mixamo/baker.py').read_bytes()).hexdigest()
BUNDLES = {
    ('generic', 'Generic_Characters'): 'Synty Generic',
    ('goblin-war-camp', 'Characters'): 'Synty Goblin War Camp',
    ('goblin-war-camp', 'CharactersBR'): 'Synty Goblin War Camp',
    ('prototype', 'Characters'): 'Synty Prototype',
    ('viking-realm', 'VikingRealm_Characters'): 'Synty Viking Realm',
    ('shops', 'Characters'): 'Synty Shops',
    ('goblin-locomotion', 'PolygonSyntyCharacter'): 'Synty Locomotion',
    ('goblin-locomotion', 'SidekickSyntyCharacter'): 'Synty Locomotion',
}


def glb_json(path):
    import struct
    with path.open('rb') as f:
        f.read(12)
        size, _ = struct.unpack('<II', f.read(8))
        return json.loads(f.read(size))


def roster():
    result = []
    assets = json.loads((ROOT / 'public/vendor/synty/library/catalog.json').read_text())['assets']
    for asset in assets.values():
        family = BUNDLES.get((asset['pack'], asset['name']))
        if not family or asset['kind'] != 'model':
            continue
        source = ROOT / ('public' + asset['url'])
        for node in glb_json(source)['nodes']:
            name = node.get('name', '')
            if 'mesh' not in node or 'Attach' in name:
                continue
            label = re.sub(r'^(SM_Gen_Chr_|SM_Chr_|SK_|Character_)', '', name).replace('_', ' ')
            row = {'id': f"synty-{asset['pack']}-{name.lower()}", 'name': label, 'family': family, 'source': str(source), 'node': name, 'sourceHash': asset['sourceHash']}
            if asset['pack'] == 'generic':
                # Generic prefab renderers all reference Generic_01_A; the raw library FBX has no material remap.
                palette = ROOT / '.local/synty-library/sources' / Path(asset['source']).parents[1] / 'Textures/Alts/Generic_01_A.png'
                row['palette'] = str(palette)
                row['paletteHash'] = hashlib.sha256(palette.read_bytes()).hexdigest()
            result.append(row)
    for meta in sorted((ROOT / '.local/animation-packs/mixamo/Library/Characters').glob('*/asset.json')):
        asset = json.loads(meta.read_text())
        result.append({'id': 'mixamo-' + asset['productId'], 'name': asset['name'], 'family': 'Mixamo', 'source': str(ROOT / asset['file']), 'sourceHash': asset['sha256']})
    return sorted(result, key=lambda row: (row['family'], row['name'].casefold()))


def write_json(path, value):
    temp = path.with_suffix('.partial')
    temp.write_text(json.dumps(value, indent=2) + '\n')
    temp.replace(path)


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def reset_rig(rig):
    rig.animation_data_clear()
    for bone in rig.pose.bones:
        bone.rotation_mode = 'QUATERNION'
        bone.matrix_basis.identity()
    bpy.context.view_layer.update()


def prepare(row, max_texture_size=1024):
    clear()
    source = Path(row['source'])
    if source.suffix == '.glb':
        bpy.ops.import_scene.gltf(filepath=str(source))
        keep = {row['node']}
        if row['family'] == 'Synty Viking Realm':
            keep.add('SM_Chr_Attach_Hair_02')
        for obj in list(bpy.data.objects):
            if obj.type == 'MESH' and obj.name not in keep:
                bpy.data.objects.remove(obj, do_unlink=True)
    else:
        bpy.ops.import_scene.fbx(filepath=str(source), use_anim=False)
        # These legacy Mixamo FBXs use Phong reflection, not PBR metalness.
        # Blender maps ReflectionFactor directly to Metallic (both body materials
        # import as 0.5), making skin/cloth conductive and suppressing diffuse light.
        # Preserve the authored specular/normal/color inputs. GLB PBR surfaces and
        # the locally authored metallic masks never pass through this correction.
        for material in bpy.data.materials if row['id'] in {
            'mixamo-eface83a-acc0-4036-a15e-3c650df1510d',
            'mixamo-130a335c-bbdb-492f-971f-8faab0616b6e',
            'mixamo-d0496a75-08b9-4f4e-9f1d-f65820323cc2',
        } else []:
            if material.node_tree:
                shader = material.node_tree.nodes.get('Principled BSDF')
                if shader and not shader.inputs['Metallic'].is_linked:
                    shader.inputs['Metallic'].default_value = 0
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    if row.get('palette'):
        material = bpy.data.materials.new('Generic_01_A'); material.use_nodes = True
        shader = material.node_tree.nodes.get('Principled BSDF'); shader.inputs['Roughness'].default_value = 0.8
        texture = material.node_tree.nodes.new('ShaderNodeTexImage'); texture.image = bpy.data.images.load(row['palette'])
        material.node_tree.links.new(texture.outputs['Color'], shader.inputs['Base Color'])
        for mesh in meshes:
            mesh.data.materials.clear(); mesh.data.materials.append(material)
    if not meshes:
        raise RuntimeError('No character meshes')
    rigs = [o for o in bpy.data.objects if o.type == 'ARMATURE']
    if len(rigs) != 1:
        raise RuntimeError(f'Expected one skeleton, found {len(rigs)}')
    rig = rigs[0]
    for bone in rig.data.bones:
        bone.name = re.sub(r'^mixamorig\d*:', 'mixamorig:', bone.name)
    # Canonical names allow the existing world-space baker to target other humanoid rigs.
    canonical = {'Hips', 'Head', 'Shoulder_L', 'Shoulder_R', 'Elbow_L', 'Elbow_R', 'Hand_L', 'Hand_R', 'UpperLeg_L', 'UpperLeg_R', 'LowerLeg_L', 'LowerLeg_R', 'Ankle_L', 'Ankle_R'}
    try:
        mapping = {name: name for name in rig.data.bones.keys()} if canonical.issubset(rig.data.bones.keys()) else baker.bone_map(rig)
        for name, original in mapping.items():
            rig.data.bones[original].name = name
        motion_error = None
    except RuntimeError as error:
        motion_error = str(error)
    reset_rig(rig)
    # Keep embedded texture colors/UVs, but bound gallery texture memory.
    for image in bpy.data.images:
        if max_texture_size and (image.size[0] > max_texture_size or image.size[1] > max_texture_size):
            factor = max_texture_size / max(image.size)
            image.scale(max(1, round(image.size[0] * factor)), max(1, round(image.size[1] * factor)))
        if image.source == 'FILE' and image.has_data:
            image.pack()
    return rig, motion_error


def export(row, motions, signature):
    directory = OUTPUT / row['id']
    directory.mkdir(parents=True, exist_ok=True)
    record_path = directory / 'record.json'
    if record_path.exists():
        cached = json.loads(record_path.read_text())
        if cached.get('status') == 'ready' and not cached.get('motionError') and cached.get('signature') == signature and (directory / 'model.glb').exists() and all((ROOT / ('public' + m['url'])).exists() for m in cached.get('motions', {}).values()):
            if (OUTPUT / 'thumbnails' / f"{row['id']}.png").exists():
                cached['thumbnail'] = f"/vendor/character-gallery/thumbnails/{row['id']}.png"
            return cached
    record = {key: row[key] for key in ('id', 'name', 'family', 'sourceHash')}
    record.update(signature=signature, url=f"/vendor/character-gallery/{row['id']}/model.glb", motions={}, status='ready')
    try:
        rig, motion_error = prepare(row)
        bpy.ops.export_scene.gltf(filepath=str(directory / 'model.glb'), export_format='GLB', export_animations=False)
        record['bones'] = len(rig.data.bones)
        record['motionError'] = motion_error
        if not motion_error:
            for role, motion in motions.items():
                before = set(bpy.data.objects)
                try:
                    bpy.ops.import_scene.fbx(filepath=str(ROOT / '.local/animation-packs' / motion['source']), use_anim=True)
                    source = next(o for o in bpy.data.objects if o not in before and o.type == 'ARMATURE')
                    action = source.animation_data.action
                    if action is None:
                        raise RuntimeError('Motion source has no action')
                    mapping = {name: bone for name, bone in baker.bone_map(source).items() if name in rig.data.bones}
                    meta = baker.bake(rig, source, action, role, directory / f'{role}.glb', mapping=mapping)
                    record['motions'][role] = {'url': f"/vendor/character-gallery/{row['id']}/{role}.glb", 'sourceName': motion['name'], **meta}
                except Exception as error:
                    record['motionError'] = str(error)
                finally:
                    for obj in list(bpy.data.objects):
                        if obj not in before:
                            bpy.data.objects.remove(obj, do_unlink=True)
                    reset_rig(rig)
    except Exception as error:
        record['status'] = 'unavailable'
        record['error'] = str(error)
    write_json(record_path, record)
    return record


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit', type=int)
    parser.add_argument('--family')
    parser.add_argument('--character', help='Comma-separated stable IDs; retain other gallery entries')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    if args.character and (args.family or args.limit):
        parser.error('Do not combine --character with family or limit filters')
    OUTPUT.mkdir(parents=True, exist_ok=True)
    catalog = json.loads((ROOT / '.local/animation-packs/mixamo/converted-source-catalog.json').read_text())
    clips = next(pack['clips'] for pack in catalog['packs'] if pack['id'] == 'mixamo')
    choices = {'idle': 'sword and shield idle', 'run': 'sword and shield run', 'attack': 'sword and shield slash'}
    motions = {role: next(clip for clip in clips if clip['name'] == name) for role, name in choices.items()}
    rows = [row for row in roster() if not exclusions.excluded('character:' + row['id'], f"/vendor/character-gallery/{row['id']}/model.glb", 'gallery')]
    selected = set(args.character.split(',')) if args.character else None
    if selected and selected - {row['id'] for row in rows}:
        parser.error(f'Unknown character IDs: {sorted(selected - {row["id"] for row in rows})}')
    previous = json.loads((OUTPUT / 'catalog.json').read_text()) if selected and (OUTPUT / 'catalog.json').exists() else {}
    retained = {row['id']: row for row in previous.get('characters', []) if not exclusions.excluded('character:' + row['id'], row['url'], 'gallery')}
    records = []
    for index, row in enumerate(rows):
        if selected and row['id'] not in selected:
            continue
        if args.family and args.family not in row['family']:
            continue
        if args.limit and len(records) >= args.limit:
            break
        signature = hashlib.sha256(json.dumps([VERSION, BAKER_SIGNATURE, row, {role: m['sourceHash'] for role, m in motions.items()}], sort_keys=True).encode()).hexdigest()
        record = export(row, motions, signature)
        records.append(record)
        print(f"CHARACTER {index + 1}/{len(rows)}: {row['family']} / {row['name']} — {record['status']}, {len(record['motions'])} motions", flush=True)
        # Interrupted exports preserve the last complete entries and can resume.
        retained[row['id']] = record
        if selected:
            order = list(dict.fromkeys([item['id'] for item in previous.get('characters', []) if item['id'] in retained] + [item['id'] for item in records]))
            published = [retained[identity] for identity in order]
        else:
            published = records
        expected = len(rows)
        write_json(OUTPUT / 'catalog.json', {'version': 1, 'expectedCount': expected, 'complete': len(published) == expected, 'characters': published})
    failed = [r for r in records if r['status'] != 'ready']
    print(f'Prepared {len(records)}/{len(rows)} characters; {len(failed)} unavailable.', flush=True)
    if failed:
        raise RuntimeError('Character conversion failures; inspect private catalog errors')


if __name__ == '__main__':
    main()
