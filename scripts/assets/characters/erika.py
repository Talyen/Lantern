"""Separate Erika's authored quiver and arrow islands without reshaping her outfit."""
from pathlib import Path
import bpy
from mathutils import Matrix, Vector

QUIVER_NODE = 'character-quiver'


def separate_quiver(rig):
    separated = []
    for obj in list(bpy.data.objects):
        if obj.type != 'MESH' or not obj.name.startswith('Erika_Archer_'):
            continue
        parents = list(range(len(obj.data.vertices)))

        def find(index):
            while parents[index] != index:
                parents[index] = parents[parents[index]]
                index = parents[index]
            return index

        def union(a, b):
            parents[find(a)] = find(b)

        # Discover connected islands across authored UV/normal seams. Do not weld
        # or rewrite the original geometry when separating those islands.
        positions = {}
        for vertex in obj.data.vertices:
            position = obj.matrix_world @ vertex.co
            key = tuple(round(value, 5) for value in position)
            if key in positions:
                union(vertex.index, positions[key])
            else:
                positions[key] = vertex.index
        for face in obj.data.polygons:
            for index in face.vertices[1:]:
                union(face.vertices[0], index)
        islands = {}
        for face in obj.data.polygons:
            islands.setdefault(find(face.vertices[0]), []).append(face.index)
        selected = []
        for indices in islands.values():
            vertices = {index for face in indices for index in obj.data.polygons[face].vertices}
            points = [obj.matrix_world @ obj.data.vertices[index].co for index in vertices]
            # Verified source islands: the bag and five arrows lie wholly behind
            # the torso. Hair, jacket, skirt, harness and body cross this plane.
            if min(point.y for point in points) > .15 and min(point.z for point in points) > 1.15:
                selected.extend(indices)
        if not selected:
            continue
        before = set(bpy.data.objects)
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.context.tool_settings.mesh_select_mode = (False, False, True)
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='DESELECT')
        bpy.ops.object.mode_set(mode='OBJECT')
        for index in selected:
            obj.data.polygons[index].select = True
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.separate(type='SELECTED')
        bpy.ops.object.mode_set(mode='OBJECT')
        separated.extend(item for item in bpy.data.objects if item not in before and item.type == 'MESH')
    if len(separated) != 1:
        raise RuntimeError(f'Expected one authored quiver mesh, found {len(separated)}')
    quiver = separated[0]
    quiver.name = QUIVER_NODE
    if not any(modifier.type == 'ARMATURE' for modifier in quiver.modifiers):
        raise RuntimeError('Separated quiver lost its skin binding')
    # Use an actual belt vertex and its dominant skin bone, rather than the old
    # model-independent hip offset. The cage hangs beneath this exported socket.
    body = bpy.data.objects.get('Erika_Archer_Body_Mesh')
    if body is None:
        raise RuntimeError('Erika clothing mesh is unavailable for the lantern mount')
    hint = Vector((.155, -.14, 1.145))
    candidates = [(vertex, body.matrix_world @ vertex.co) for vertex in body.data.vertices]
    candidates = [(vertex, point) for vertex, point in candidates if point.x > .1 and point.y < -.08 and 1.1 < point.z < 1.18]
    if not candidates:
        raise RuntimeError('Erika belt attachment region is unavailable')
    vertex, position = min(candidates, key=lambda pair: (pair[1] - hint).length_squared)
    groups = [group for group in vertex.groups if body.vertex_groups[group.group].name in rig.data.bones]
    if not groups:
        raise RuntimeError('Erika belt attachment has no skin bone')
    bone = body.vertex_groups[max(groups, key=lambda group: group.weight).group].name
    socket = bpy.data.objects.new('lantern-socket', None)
    bpy.context.collection.objects.link(socket)
    socket.parent = rig; socket.parent_type = 'BONE'; socket.parent_bone = bone
    bpy.context.view_layer.update()
    socket.matrix_world = Matrix.Translation(position + Vector((.016, -.017, -.012)))
    bpy.context.view_layer.update()
    print(f'Lantern belt socket: {bone}; {list(socket.matrix_world.translation)}', flush=True)
    private = Path(__file__).resolve().parents[3] / '.local/animation-packs/Protagonists/erika'
    private.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(private / 'authored-separated.blend'))
    print(f'Separated authored quiver: {len(quiver.data.polygons)} faces; original source untouched.', flush=True)
