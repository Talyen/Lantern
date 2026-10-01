"""Shared local humanoid world-space baker used by playable and gallery exports.

Sources stay private. Motion is sampled at 30 fps, retaining vertical hip motion.
"""
import json
import math
import bpy
from mathutils import Quaternion, Vector


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
    # Keep the imported Mixamo names for these fingers so retained model joints remain compatible.
    for mix in ['Left', 'Right']:
        for finger in ['Ring', 'Pinky']:
            for segment in [1, 2, 3]:
                name = f'mixamorig:{mix}Hand{finger}{segment}'
                candidates[name] = [name]
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


def bake(target, source, original, name, output, mapping=None, sample_range=None, output_duration=None):
    # Gallery consumers may omit optional fingers absent from their target rig.
    mapping = bone_map(source) if mapping is None else mapping
    missing_targets = set(mapping) - set(target.data.bones.keys())
    if missing_targets: raise RuntimeError(f'Target bones missing: {missing_targets}')
    source.animation_data_create()
    source.animation_data.action = original
    if original.slots:
        source.animation_data.action_slot = original.slots[0]
    for track in list(source.animation_data.nla_tracks): source.animation_data.nla_tracks.remove(track)
    fps = bpy.context.scene.render.fps / bpy.context.scene.render.fps_base
    start, end = sample_range or original.frame_range
    source_duration = (end - start) / fps
    duration = output_duration or source_duration
    samples = max(1, round(duration * 30))
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
    left_heights = []
    hip_start = None
    hip_end = None
    for frame in range(samples + 1):
        source_frame = min(end, start + frame / samples * (end - start))
        bpy.context.scene.frame_set(math.floor(source_frame), subframe=source_frame % 1)
        left_heights.append((source.matrix_world @ source.pose.bones[mapping['Ankle_L']].head).z)
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
        if hip_start is None: hip_start = hip_world.copy()
        hip_end = hip_world.copy()
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
    travel = (hip_end - hip_start) * ratio
    return {'duration': round(samples / 30, 4), 'sourceDuration': round(source_duration, 4), 'rootVelocity': [round(travel.x / duration, 4), round(-travel.y / duration, 4)], 'phaseOffset': round(left_heights.index(min(left_heights)) / samples, 4), 'mappedBones': len(mapping), 'bakeVersion': 5}
