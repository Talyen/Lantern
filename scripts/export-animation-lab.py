"""Bake locally acquired humanoid animations onto one privately owned Synty rig.

Sources and exports remain ignored. Nothing is downloaded or written to Topaz.
Motion is sampled at 30 fps, with horizontal root travel removed for comparison.
"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Quaternion, Vector


def arguments():
    parser = argparse.ArgumentParser()
    parser.add_argument('--topaz', type=Path, default=Path('../Topaz'))
    parser.add_argument('--sources', type=Path, default=Path('.local/animation-packs'))
    parser.add_argument('--output', type=Path, default=Path('public/vendor/animations'))
    parser.add_argument('--pack', choices=['mixamo'])
    parser.add_argument('--limit', type=int)
    parser.add_argument('--shards', type=int, default=1)
    parser.add_argument('--shard', type=int, default=0)
    return parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])


def import_file(path):
    if path.suffix == '.glb':
        bpy.ops.import_scene.gltf(filepath=str(path))
    else:
        bpy.ops.import_scene.fbx(filepath=str(path), use_anim=True)


def bone_map(rig):
    names = set(rig.data.bones.keys())
    mapping = {}
    candidates = {
        'Hips': ['pelvis', 'hips', 'B-hips', 'mixamorig:Hips'],
        'Spine_01': ['spine_01', 'spine', 'B-spine', 'mixamorig:Spine'],
        'Spine_02': ['spine_02', 'chest', 'B-chest', 'mixamorig:Spine1'],
        'Spine_03': ['spine_03', 'mixamorig:Spine2'],
        'Neck': ['neck_01', 'B-neck', 'mixamorig:Neck'],
        'Head': ['Head', 'head', 'B-head', 'mixamorig:Head'],
    }
    for side, mix in [('L', 'Left'), ('R', 'Right')]:
        lower = side.lower()
        candidates.update({
            f'Clavicle_{side}': [f'clavicle_{lower}', f'B-shoulder.{side}', f'mixamorig:{mix}Shoulder'],
            f'Shoulder_{side}': [f'upperarm_{lower}', f'upperarm.{lower}', f'B-upperArm.{side}', f'mixamorig:{mix}Arm'],
            f'Elbow_{side}': [f'lowerarm_{lower}', f'lowerarm.{lower}', f'B-forearm.{side}', f'mixamorig:{mix}ForeArm'],
            f'Hand_{side}': [f'hand_{lower}', f'wrist.{lower}', f'B-hand.{side}', f'mixamorig:{mix}Hand'],
            f'UpperLeg_{side}': [f'thigh_{lower}', f'upperleg.{lower}', f'B-thigh.{side}', f'mixamorig:{mix}UpLeg'],
            f'LowerLeg_{side}': [f'calf_{lower}', f'lowerleg.{lower}', f'B-shin.{side}', f'mixamorig:{mix}Leg'],
            f'Ankle_{side}': [f'foot_{lower}', f'foot.{lower}', f'B-foot.{side}', f'mixamorig:{mix}Foot'],
            f'Ball_{side}': [f'ball_{lower}', f'toes.{lower}', f'B-toe.{side}', f'mixamorig:{mix}ToeBase'],
        })
        for index in (1, 2, 3):
            candidates[f'Thumb_0{index}_{side}'] = [f'thumb_0{index}_{lower}', f'B-thumb0{index}.{side}', f'mixamorig:{mix}HandThumb{index}']
        for segment in (1, 2, 3):
            candidates[f'IndexFinger_0{segment}_{side}'] = [f'index_0{segment}_{lower}', f'B-indexFinger0{segment}.{side}', f'mixamorig:{mix}HandIndex{segment}']
            candidates[f'Finger_0{segment}_{side}'] = [f'middle_0{segment}_{lower}', f'B-middleFinger0{segment}.{side}', f'mixamorig:{mix}HandMiddle{segment}']
    for target, options in candidates.items():
        match = next((n for n in options if n in names), None)
        if match:
            mapping[target] = match
    required = ['Hips', 'Head', 'Shoulder_L', 'Shoulder_R', 'Elbow_L', 'Elbow_R', 'Hand_L', 'Hand_R', 'UpperLeg_L', 'UpperLeg_R', 'LowerLeg_L', 'LowerLeg_R', 'Ankle_L', 'Ankle_R']
    missing = [n for n in required if n not in mapping]
    if missing:
        raise RuntimeError(f'Incomplete rig mapping for {rig.name}: {missing}; bones: {sorted(names)}')
    return mapping


def category(name):
    n = name.lower()
    if any(s in n for s in ['death', 'dying', 'defeat']): return 'death'
    if any(s in n for s in ['hit', 'impact', 'damage', 'knockback', 'react']): return 'hit'
    if any(s in n for s in ['attack', 'slash', 'punch', 'hook', 'kick', 'shoot', 'firing', 'cast', 'throw']): return 'attack'
    if any(s in n for s in ['run', 'jog', 'sprint']): return 'run'
    if 'walk' in n: return 'walk'
    if any(s in n for s in ['roll', 'dodge', 'dash']): return 'dodge'
    if 'idle' in n: return 'idle'
    if 'block' in n: return 'block'
    if any(s in n for s in ['jump', 'climb', 'slide', 'fall', 'crouch', 'swim']): return 'movement'
    return 'other'


def character(topaz, output, export_model=True):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    candidates = [topaz / 'Assets/Synty/PolygonVikingRealm']
    private_sources = Path(__file__).resolve().parents[1] / '.local/synty-library/sources'
    candidates.extend(sorted(private_sources.glob('*/Assets/Synty/PolygonVikingRealm')))
    root = next((path for path in candidates if (path / 'Models/VikingRealm_Characters.fbx').is_file() and (path / 'Textures/Alts/PolygonVikingRealm_01_A.png').is_file()), None)
    if root is None: raise FileNotFoundError('Synty Viking character source missing from Topaz and the private Synty library.')
    bpy.ops.import_scene.fbx(filepath=str(root / 'Models/VikingRealm_Characters.fbx'), use_anim=False)
    rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    rig.name = 'SyntyRig'
    keep = {'SM_Chr_Warrior_Male_01', 'SM_Chr_Attach_Hair_02'}
    for obj in list(bpy.data.objects):
        if obj.type == 'MESH' and obj.name not in keep:
            bpy.data.objects.remove(obj, do_unlink=True)
    if not any(o.name == 'SM_Chr_Warrior_Male_01' for o in bpy.data.objects):
        raise RuntimeError('Synty warrior mesh missing')
    image = bpy.data.images.load(str(root / 'Textures/Alts/PolygonVikingRealm_01_A.png'))
    image.scale(1024, 1024)
    image.pack()
    mat = bpy.data.materials.new('Viking Realm palette')
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Roughness'].default_value = 0.9
    tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
    tex.image = image
    mat.node_tree.links.new(tex.outputs['Color'], shader.inputs['Base Color'])
    for obj in bpy.data.objects:
        if obj.type == 'MESH':
            obj.data.materials.clear()
            obj.data.materials.append(mat)
    rig.animation_data_clear()
    for pb in rig.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.matrix_basis.identity()
    bpy.context.view_layer.update()
    if export_model:
        bpy.ops.export_scene.gltf(filepath=str(output / 'synty-warrior.glb'), export_format='GLB', export_animations=False)
    return rig


def bake(target, source, original, name, output):
    mapping = bone_map(source)
    missing_targets = set(mapping) - set(target.data.bones.keys())
    if missing_targets: raise RuntimeError(f'Target bones missing: {missing_targets}')
    source.animation_data_create()
    source.animation_data.action = original
    if original.slots:
        source.animation_data.action_slot = original.slots[0]
    for track in list(source.animation_data.nla_tracks): source.animation_data.nla_tracks.remove(track)
    fps = bpy.context.scene.render.fps / bpy.context.scene.render.fps_base
    start, end = original.frame_range
    duration = (end - start) / fps
    samples = max(1, math.ceil(duration * 30))
    target.animation_data_create()
    action = bpy.data.actions.new(name)
    target.animation_data.action = action
    for track in list(target.animation_data.nla_tracks): target.animation_data.nla_tracks.remove(track)
    tw = target.matrix_world.copy()
    tq = tw.to_quaternion()
    # Object-space deltas are transformed through world space to handle FBX axis conventions.
    source_rest = {t: (source.matrix_world @ source.data.bones[s].matrix_local).to_quaternion() for t, s in mapping.items()}
    target_rest = {b.name: b.matrix_local.to_quaternion() for b in target.data.bones}
    source_hip_rest = source.matrix_world @ source.data.bones[mapping['Hips']].head_local
    target_hip_rest = tw @ target.data.bones['Hips'].head_local
    ratio = target_hip_rest.z / source_hip_rest.z if abs(source_hip_rest.z) > 0.01 else 1
    previous = {}
    for frame in range(samples + 1):
        source_frame = min(end, start + frame / 30 * fps)
        bpy.context.scene.frame_set(math.floor(source_frame), subframe=source_frame % 1)
        desired = {}
        for bone in target.data.bones:
            rest = target_rest[bone.name]
            parent = bone.parent
            parent_pose = desired[parent.name] if parent else Quaternion()
            parent_rest = target_rest[parent.name] if parent else Quaternion()
            if bone.name in mapping:
                pose_world = (source.matrix_world @ source.pose.bones[mapping[bone.name]].matrix).to_quaternion()
                delta_world = pose_world @ source_rest[bone.name].inverted()
                goal = tq.inverted() @ delta_world @ tq @ rest
            else:
                goal = parent_pose @ parent_rest.inverted() @ rest
            desired[bone.name] = goal
            local = rest.inverted() @ parent_rest @ parent_pose.inverted() @ goal
            if bone.name in previous and previous[bone.name].dot(local) < 0:
                local.negate()
            previous[bone.name] = local.copy()
            pb = target.pose.bones[bone.name]
            pb.rotation_quaternion = local
            pb.location = (0, 0, 0)
            pb.scale = (1, 1, 1)
            pb.keyframe_insert('rotation_quaternion', frame=frame, group=bone.name)
        hip_world = source.matrix_world @ source.pose.bones[mapping['Hips']].head
        vertical = (hip_world.z - source_hip_rest.z) * ratio
        # Z is Blender world up. Horizontal displacement is intentionally not baked.
        delta = tw.inverted().to_3x3() @ Vector((0, 0, vertical))
        hp = target.pose.bones['Hips']
        hp.location = target.data.bones['Hips'].matrix_local.to_3x3().inverted() @ delta
        hp.keyframe_insert('location', frame=frame, group='Hips')
    bpy.context.scene.render.fps = 30
    bpy.context.scene.render.fps_base = 1
    bpy.context.scene.frame_start = 0
    bpy.context.scene.frame_end = samples
    bpy.context.scene.frame_set(0)
    bpy.ops.object.select_all(action='DESELECT')
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.export_scene.gltf(filepath=str(output), export_format='GLB', use_selection=True,
        export_animations=True, export_animation_mode='ACTIVE_ACTIONS', export_force_sampling=True,
        export_frame_range=True, export_anim_slide_to_zero=True)
    target.animation_data.action = None
    bpy.data.actions.remove(action)
    bpy.context.scene.render.fps = round(fps)
    return {'duration': round(samples / 30, 4), 'mappedBones': len(mapping), 'bakeVersion': 2}


PACKS = {
    'mixamo': ('Mixamo · Complete Library', 'Adobe Mixamo terms', 'https://www.mixamo.com/'),
}


def write_json(path, value):
    partial = path.with_suffix('.partial')
    partial.write_text(json.dumps(value, indent=2) + '\n')
    partial.replace(path)


def main():
    args = arguments()
    if args.shards < 1 or not 0 <= args.shard < args.shards: raise ValueError('Invalid export shard')
    args.output.mkdir(parents=True, exist_ok=True)
    target = character(args.topaz.resolve(), args.output.resolve(), export_model=args.shards == 1)
    target_objects = set(bpy.data.objects)
    for key, (label, license_name, url) in PACKS.items():
        if args.pack and key != args.pack: continue
        pack_root = args.sources / key
        download_state_path = pack_root / 'Library/download-state.json'
        completed_sources = set()
        if download_state_path.exists():
            download_state = json.loads(download_state_path.read_text())
            completed_sources = {Path(record['file']).resolve() for key, record in download_state['completed'].items() if key.startswith('Motion:')}
        files = sorted(p for p in pack_root.rglob('*.fbx') if not {'Characters', 'Archives'}.intersection(p.relative_to(pack_root).parts) and ('Library' not in p.relative_to(pack_root).parts or p.resolve() in completed_sources))
        if not files: raise RuntimeError(f'No downloaded source files for {key}')
        files = files[args.shard::args.shards]
        pack_dir = args.output / key
        pack_dir.mkdir(exist_ok=True)
        manifest_path = pack_dir / ('pack.json' if args.shards == 1 else f'pack.shard-{args.shard}.json')
        cache_path = manifest_path if manifest_path.exists() else pack_dir / 'pack.json'
        existing = json.loads(cache_path.read_text()) if cache_path.exists() else {'id': key, 'label': label, 'license': license_name, 'url': url, 'clips': []}
        existing['label'] = label
        clips_by_id = {c['id']: c for c in existing['clips']}
        by_source = {}
        for clip in clips_by_id.values(): by_source.setdefault(clip.get('source'), []).append(clip)
        count = 0
        seen = set()
        for file in files:
            source_hash = hashlib.sha256(file.read_bytes()).hexdigest()
            cached = by_source.get(str(file.relative_to(args.sources)), [])
            if cached and all(c.get('sourceHash') == source_hash and c.get('bakeVersion') == 2 and (pack_dir / (c['id'] + '.glb')).exists() for c in cached):
                seen.update(c['id'] for c in cached)
                count += len(cached)
                if args.limit and count >= args.limit: break
                continue
            before_actions = set(bpy.data.actions)
            import_file(file.resolve())
            source = next((o for o in bpy.data.objects if o.type == 'ARMATURE' and o not in target_objects), None)
            if source is None:
                print(f'SKIP non-rigged source: {file}', flush=True)
                for obj in list(bpy.data.objects):
                    if obj not in target_objects: bpy.data.objects.remove(obj, do_unlink=True)
                for action in list(bpy.data.actions):
                    if action not in before_actions: bpy.data.actions.remove(action)
                continue
            actions = sorted(set(bpy.data.actions) - before_actions, key=lambda a: a.name)
            for original in actions:
                metadata_path = file.parent / 'asset.json'
                source_metadata = json.loads(metadata_path.read_text()) if metadata_path.exists() else {}
                name = source_metadata.get('name', file.stem)
                if name.lower() in ['x bot', 'y bot']: continue
                identity = hashlib.sha256((str(file.relative_to(pack_root)) + ':' + name).encode()).hexdigest()[:12]
                seen.add(identity)
                destination = pack_dir / (identity + '.glb')
                if identity not in clips_by_id or not destination.exists() or clips_by_id[identity].get('bakeVersion') != 2 or clips_by_id[identity].get('sourceHash') != source_hash:
                    meta = bake(target, source, original, name, destination.resolve())
                    clips_by_id[identity] = {'id': identity, 'name': name, 'category': category(name), 'url': f'/vendor/animations/{key}/{identity}.glb', 'source': str(file.relative_to(args.sources)), 'description': source_metadata.get('description', ''), 'sourceHash': source_hash, **meta}
                    existing['clips'] = list(clips_by_id.values())
                    write_json(manifest_path, existing)
                    print(f'BAKED {key}: {name}', flush=True)
                count += 1
                if args.limit and count >= args.limit: break
            for obj in list(bpy.data.objects):
                if obj not in target_objects: bpy.data.objects.remove(obj, do_unlink=True)
            for action in list(bpy.data.actions):
                if action not in before_actions: bpy.data.actions.remove(action)
            if args.limit and count >= args.limit: break
        if not args.limit:
            existing['clips'] = [clip for identity, clip in clips_by_id.items() if identity in seen]
            write_json(manifest_path, existing)
        print(f"PACK {key}: {len(existing['clips'])} clips", flush=True)
    if args.shards > 1: return
    packs = [json.loads(p.read_text()) for p in sorted(args.output.glob('*/pack.json')) if p.parent.name in PACKS]
    write_json(args.output / 'catalog.json', {'version': 1, 'character': '/vendor/animations/synty-warrior.glb', 'characterLabel': 'Synty Viking Realm · Warrior Male 01', 'motion': 'In place · 30 fps · retargeted to the same Synty rig', 'packs': packs})


if __name__ == '__main__': main()
