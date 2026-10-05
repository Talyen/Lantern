"""Prepare the supplied B1 outfit without changing its authored surfaces or skin."""
import bpy
from mathutils import Matrix, Quaternion, Vector

# Blender bone-frame calibration, including glTF's preserved joint-axis offset,
# compared with the previously reviewed Erika wrist-to-palm frames. Keep this
# on the rig rather than changing shared item definitions.
EQUIPMENT_FRAMES = {
    'L': (-0.357635946, -0.571664939, -0.635457147, 0.376151733),
    'R': (-0.347442439, 0.569743431, 0.635744051, 0.387951259),
}


def prepare(rig):
    if len(rig.data.bones) != 52:
        raise RuntimeError('B1 requires its supplied 52-bone skeleton')
    for side, (x, y, z, w) in EQUIPMENT_FRAMES.items():
        bone = f'Hand_{side}'
        socket = bpy.data.objects.new(f'equipment-socket-{bone}', None)
        bpy.context.collection.objects.link(socket)
        socket.parent = rig
        socket.parent_type = 'BONE'
        socket.parent_bone = bone
        bpy.context.view_layer.update()
        socket.matrix_world = rig.matrix_world @ rig.data.bones[bone].matrix_local @ Quaternion((w, x, y, z)).to_matrix().to_4x4()
    bpy.context.view_layer.update()
    # The outfit already carries a lantern. Keep all three skinned pieces together
    # so the shared personal-light preference can hide them without a second cage.
    lantern = bpy.data.objects.new('character-lantern', None)
    bpy.context.collection.objects.link(lantern)
    lantern.parent = rig
    for name in ['B1_Travel_Lantern_Candle', 'B1_Travel_Lantern_Frame', 'B1_Travel_Lantern_Panes']:
        obj = bpy.data.objects.get(name)
        if obj is None or not any(mod.type == 'ARMATURE' for mod in obj.modifiers):
            raise RuntimeError(f'B1 authored lantern skin is unavailable: {name}')
        world = obj.matrix_world.copy()
        obj.parent = lantern
        obj.matrix_world = world
    hanger = bpy.data.objects.get('B1_Lantern_Belt_Hanger')
    if hanger is None:
        raise RuntimeError('B1 lantern belt hanger is unavailable')
    points = [hanger.matrix_world @ vertex.co for vertex in hanger.data.vertices]
    # Use the authored hanger frame; no generic offset or second connector hook.
    position = Vector(((min(p.x for p in points) + max(p.x for p in points)) / 2,
                       (min(p.y for p in points) + max(p.y for p in points)) / 2,
                       max(p.z for p in points)))
    socket = bpy.data.objects.new('lantern-socket', None)
    bpy.context.collection.objects.link(socket)
    socket.parent = rig
    socket.parent_type = 'BONE'
    socket.parent_bone = 'Hips'
    bpy.context.view_layer.update()
    socket.matrix_world = Matrix.Translation(position)
    bpy.context.view_layer.update()
    print(f'B1: 52 mapped bones, authored lantern retained at {list(position)}', flush=True)
