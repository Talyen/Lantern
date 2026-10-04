"""Prepare the private male geometry study; keep licensed source and editable output private."""
import argparse
import importlib.util
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[3]
IDENTITY = 'mixamo-a58c06c4-3307-40e6-a02d-bfcd658bdbff'
OUTPUT = ROOT / 'public/vendor/characters/protagonist-male-draft'
PRIVATE = ROOT / '.local/animation-packs/Protagonists/male-draft'
SPEC = importlib.util.spec_from_file_location('motion_baker', ROOT / 'scripts/assets/mixamo/baker.py')
BAKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BAKER)


def material(name, shade):
    value = bpy.data.materials.new(name)
    value.use_nodes = True
    shader = value.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*shade, 1)
    shader.inputs['Roughness'].default_value = .8
    return value


def assign(obj, surface):
    obj.data.materials.clear()
    obj.data.materials.append(surface)
    for face in obj.data.polygons:
        face.material_index = 0
        face.use_smooth = True


def copy_surface(source, name, surface, keep, offset=0, planes=()):
    obj = source.copy()
    obj.data = source.data.copy()
    obj.name = name
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.00001)
    for point, normal in planes:
        bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces), dist=.000001, plane_co=point, plane_no=normal)
    remove = [face for face in bm.faces if not keep(face.calc_center_median())]
    bmesh.ops.delete(bm, geom=remove, context='FACES')
    bm.normal_update()
    for vertex in bm.verts:
        vertex.co += vertex.normal * offset
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    assign(obj, surface)
    return obj


def bind(obj, rig, weights):
    obj.parent = rig
    obj.matrix_parent_inverse = rig.matrix_world.inverted()
    obj.matrix_basis = Matrix.Identity(4)
    modifier = obj.modifiers.new('Character skin', 'ARMATURE')
    modifier.object = rig
    for index, vertex in enumerate(obj.data.vertices):
        for name, weight in weights(vertex.co):
            if weight > 0:
                group = obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name)
                group.add([index], weight, 'REPLACE')
    return obj


def mesh(name, points, faces, surface, rig, weights):
    data = bpy.data.meshes.new(name)
    data.from_pydata(points, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    assign(obj, surface)
    return bind(obj, rig, weights)


def bone_weights(name):
    return lambda point: [(name, 1)]


def tube(name, centers, radii, axis, surface, rig, weights, sides=16):
    points, faces = [], []
    for center, (a, b) in zip(centers, radii):
        for side in range(sides):
            angle = side / sides * math.tau
            delta = (0, a * math.cos(angle), b * math.sin(angle)) if axis == 'x' else (a * math.cos(angle), b * math.sin(angle), 0)
            points.append(tuple(Vector(center) + Vector(delta)))
    for ring in range(len(centers) - 1):
        for side in range(sides):
            nxt = (side + 1) % sides
            faces.append((ring * sides + side, ring * sides + nxt, (ring + 1) * sides + nxt, (ring + 1) * sides + side))
    obj = mesh(name, points, faces, surface, rig, weights)
    obj.modifiers.new('Bounded shell thickness', 'SOLIDIFY').thickness = .003
    return obj


def patch(name, points, faces, surface, rig, weights):
    obj = mesh(name, points, faces, surface, rig, weights)
    solid = obj.modifiers.new('Garment thickness', 'SOLIDIFY')
    solid.thickness = .006
    bevel = obj.modifiers.new('Soft garment edge', 'BEVEL')
    bevel.width = .002
    bevel.segments = 2
    return obj


def rounded_box(name, center, size, surface, rig, bone, bevel=.008):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    # Bake location into coordinates so skinning shares the source's object space.
    for vertex in obj.data.vertices:
        vertex.co += obj.location
    obj.location = (0, 0, 0)
    assign(obj, surface)
    edge = obj.modifiers.new('Rounded edges', 'BEVEL')
    edge.width = bevel
    edge.segments = 3
    bind(obj, rig, bone_weights(bone))
    return obj


def collar(source, surface):
    obj = copy_surface(source, 'Fitted broad collar', surface,
                       lambda p: p.z > 1.465 and abs(p.x) < .14, .004,
                       planes=[((0, 0, 1.465), (0, 0, 1)), ((.14, 0, 0), (1, 0, 0)), ((-.14, 0, 0), (1, 0, 0))])
    for vertex in obj.data.vertices:
        vertex.co.x *= 1.04
        vertex.co.y = .008 + (vertex.co.y - .008) * 1.045
        if abs(vertex.co.x) > .055:
            vertex.co.x *= 1.03
    obj.modifiers.new('Collar thickness', 'SOLIDIFY').thickness = .003
    edge = obj.modifiers.new('Soft collar edge', 'BEVEL')
    edge.width = .0015
    edge.segments = 2
    return obj


def cloth_hems(rig, surface):
    for side in [-1, 1]:
        for front in [True, False]:
            points, faces = [], []
            columns, rows = 8, 6
            for row in range(rows + 1):
                v = row / rows
                z = 1.032 - .148 * v
                radius_x = .193 + .027 * v
                radius_y = (.149 + .005 * v) if front else (.083 + .009 * v)
                for column in range(columns + 1):
                    u = column / columns
                    x = .024 + .006 * v + (.143 + .003 * v) * u
                    y = radius_y * math.sqrt(max(.05, 1 - (x / radius_x) ** 2))
                    points.append((side * x, -y if front else y, z))
            for row in range(rows):
                for column in range(columns):
                    a = row * (columns + 1) + column
                    faces.append((a, a + 1, a + columns + 2, a + columns + 1))
            patch('Curved split cloth panel', points, faces, surface, rig, bone_weights('Hips'))


def hair(rig, surface):
    points, faces = [], []
    sides, rings = 72, 24
    for ring in range(rings + 1):
        for side in range(sides):
            azimuth = math.tau * side / sides
            forward = max(0, -math.sin(azimuth))
            rim = 1.65 - .45 * forward
            latitude = .025 + (rim - .025) * ring / rings
            points.append((.09 * math.sin(latitude) * math.cos(azimuth), .007 + .108 * math.sin(latitude) * math.sin(azimuth), 1.663 + .12 * math.cos(latitude)))
    for ring in range(rings):
        for side in range(sides):
            nxt = (side + 1) % sides
            faces.append((ring * sides + side, ring * sides + nxt, (ring + 1) * sides + nxt, (ring + 1) * sides + side))
    cap = mesh('Sculpted hair foundation', points, faces, surface, rig, bone_weights('Head'))
    cap.modifiers.new('Hair edge thickness', 'SOLIDIFY').thickness = .004
    # Broad, contained sweeps enrich the silhouette without thin strands or physics.
    for lock in range(7):
        x = (lock - 3) * .018
        points, faces = [], []
        steps, section = 12, 8
        for step in range(steps + 1):
            t = step / steps
            y = -.065 + .153 * t
            cx = x + .018 * math.sin(math.pi * t)
            z = 1.663 + .12 * math.sqrt(max(.03, 1 - (cx / .09) ** 2 - ((y - .007) / .108) ** 2))
            width = .002 + .013 * math.sin(math.pi * t) ** .5
            height = .001 + .004 * math.sin(math.pi * t)
            for corner in range(section):
                angle = math.tau * corner / section
                points.append((cx + width * math.cos(angle), y, z + height * math.sin(angle)))
        for step in range(steps):
            for corner in range(section):
                nxt = (corner + 1) % section
                faces.append((step * section + corner, step * section + nxt, (step + 1) * section + nxt, (step + 1) * section + corner))
        faces.extend([tuple(range(section - 1, -1, -1)), tuple(steps * section + i for i in range(section))])
        mesh(f'Hair sweep {lock + 1}', points, faces, surface, rig, bone_weights('Head'))


def source_weights(source):
    """Interpolate the existing garment's weights in the normalized authoring space."""
    from mathutils.kdtree import KDTree
    tree = KDTree(len(source.data.vertices))
    groups = {group.index: group.name for group in source.vertex_groups}
    for vertex in source.data.vertices:
        tree.insert(vertex.co, vertex.index)
    tree.balance()

    def sample(point):
        result = {}
        for _, index, distance in tree.find_n(point, 4):
            factor = 1 / max(.00001, distance ** 2)
            for item in source.data.vertices[index].groups:
                name = groups[item.group]
                result[name] = result.get(name, 0) + factor * item.weight
        total = sum(result.values())
        if total <= 0:
            raise RuntimeError('No source skin weights near new garment')
        return [(name, weight / total) for name, weight in result.items() if weight > total * .00001]

    return sample


def garment_torso(name, profile, surface, rig, weights, opening):
    points, faces = [], []
    sides = 64
    for z, radius_x, front, back in profile:
        delta = opening(z, radius_x)
        for side in range(sides + 1):
            theta = delta + (math.tau - 2 * delta) * side / sides
            x = radius_x * math.sin(theta)
            cosine = math.cos(theta)
            y = -(front if cosine >= 0 else back) * cosine
            height = z
            if z > 1.47:
                height += .014 * max(0, -cosine)
            points.append((x, y, height))
    for row in range(len(profile) - 1):
        for side in range(sides):
            a = row * (sides + 1) + side
            faces.append((a, a + 1, a + sides + 2, a + sides + 1))
    obj = mesh(name, points, faces, surface, rig, weights)
    solid = obj.modifiers.new('Tailored garment thickness', 'SOLIDIFY')
    solid.thickness = .004
    solid.offset = 0
    return obj


def fitted_collar(rig, surface, weights):
    points, faces = [], []
    columns, rows = 40, 6
    for row in range(rows + 1):
        u = row / rows
        for column in range(columns + 1):
            angle = math.radians(-135 - 270 * column / columns)
            inner = Vector((.089 * math.cos(angle), .012 + .102 * math.sin(angle), 1.491))
            outer = Vector((.146 * math.cos(angle), .012 + .126 * math.sin(angle), 1.446))
            outer.z += .015 * max(0, math.sin(angle))
            point = inner.lerp(outer, u)
            point.z += .009 * math.sin(math.pi * u)
            points.append(tuple(point))
    for row in range(rows):
        for column in range(columns):
            a = row * (columns + 1) + column
            faces.append((a, a + 1, a + columns + 2, a + columns + 1))
    patch('Turned leather collar', points, faces, surface, rig, weights)
    for sign in [-1, 1]:
        corners = [Vector((sign * .062, -.061, 1.491)), Vector((sign * .103, -.077, 1.446)), Vector((sign * .105, -.154, 1.356)), Vector((sign * .045, -.146, 1.413))]
        points, faces = [], []
        steps = 8
        for row in range(steps + 1):
            v = row / steps
            a, b = corners[0].lerp(corners[3], v), corners[1].lerp(corners[2], v)
            for column in range(steps + 1):
                u = column / steps
                point = a.lerp(b, u)
                point.y -= .005 * math.sin(math.pi * u)
                points.append(tuple(point))
        for row in range(steps):
            for column in range(steps):
                a = row * (steps + 1) + column
                faces.append((a, a + 1, a + steps + 2, a + steps + 1))
        patch('Folded lapel', points, faces, surface, rig, weights)


def tailored_outfit(source, rig, cloth, leather, trim, metal):
    weights = source_weights(source)
    jacket_profile = [(1.025,.183,.166,.107),(1.085,.175,.165,.105),(1.16,.178,.162,.111),(1.25,.197,.157,.124),(1.34,.216,.149,.129),(1.405,.234,.13,.121),(1.452,.229,.108,.113),(1.484,.091,.104,.101)]
    opening = lambda z, radius: math.asin(min(.82, (.038 + max(0,z-1.08)*.17)/radius))
    jacket = garment_torso('Tailored short jacket', jacket_profile, leather, rig, weights, opening)
    shirt_profile = [(1.025,.171,.152,.095),(1.10,.164,.149,.089),(1.20,.169,.144,.100),(1.30,.194,.139,.119),(1.40,.221,.113,.105),(1.453,.218,.098,.096),(1.482,.078,.088,.087)]
    shirt_opening = lambda z, radius: 0 if z < 1.41 else math.asin(min(.7,(z-1.41)*.52/radius))
    shirt = garment_torso('Blue-green travel shirt', shirt_profile, cloth, rig, weights, shirt_opening)
    fitted_collar(rig, leather, weights)
    for sign, suffix in [(1,'L'),(-1,'R')]:
        def arm(point, suffix=suffix):
            lower = max(0,min(1,(abs(point.x)-.425)/.085))
            return [(f'Shoulder_{suffix}',1-lower),(f'Elbow_{suffix}',lower)]
        tube('Leather upper sleeve '+suffix,[(sign*.235,.03,1.431),(sign*.30,.034,1.427),(sign*.363,.038,1.421)],[(.065,.062),(.059,.057),(.052,.05)],'x',leather,rig,arm,sides=24)
        tube('Cloth sleeve '+suffix,[(sign*.29,.034,1.429),(sign*.39,.038,1.423),(sign*.465,.04,1.415),(sign*.523,.036,1.417)],[(.053,.049),(.048,.044),(.041,.037),(.037,.033)],'x',cloth,rig,arm,sides=24)
        tube('Rolled cloth cuff '+suffix,[(sign*.502,.037,1.417),(sign*.512,.037,1.417),(sign*.528,.037,1.417)],[(.039,.035),(.043,.039),(.038,.034)],'x',cloth,rig,arm,sides=24)
        tube('Leather sleeve binding '+suffix,[(sign*.354,.038,1.421),(sign*.366,.038,1.421)],[(.054,.052),(.053,.051)],'x',trim,rig,arm,sides=24)
        rounded_box('Small shoulder fitting '+suffix,(sign*.218,-.005,1.475),(.046,.075,.008),metal,rig,'Shoulder_'+suffix,.005)
    # Edge binding follows the same curved opening, rather than floating above it.
    for sign in [-1,1]:
        points, faces = [], []
        for row,(z,rx,front,back) in enumerate(jacket_profile):
            theta = opening(z,rx)
            for edge in [0,1]:
                angle = theta + edge*.035
                points.append((sign*rx*math.sin(angle),-front*math.cos(angle)-.002,z))
            if row:
                a=(row-1)*2
                faces.append((a,a+1,a+3,a+2))
        patch('Bound jacket opening',points,faces,trim,rig,weights)
    # A narrow hem and construction seam give the jacket a deliberate squared edge.
    tube('Jacket hem binding',[(0,0,1.025),(0,0,1.039)],[(.183,.166),(.183,.166)],'z',trim,rig,weights,sides=64)
    return jacket, shirt


def polished_boots(rig, leather, trim, sole, metal):
    for sign,suffix in [(1,'L'),(-1,'R')]:
        def foot_weights(point,suffix=suffix):
            toe=max(0,min(.55,(-point.y-.09)/.18))
            return [('Ankle_'+suffix,1-toe),('Ball_'+suffix,toe)]
        points,faces=[],[]
        sections=[(-.215,.015,.026,.038),(-.204,.041,.025,.065),(-.177,.061,.023,.083),(-.12,.067,.023,.101),(-.055,.058,.025,.132),(.015,.049,.026,.146),(.075,.046,.027,.128),(.105,.028,.028,.079)]
        sides=24
        for y,width,bottom,top in sections:
            for side in range(sides):
                angle=math.tau*side/sides
                points.append((sign*.155+width*math.cos(angle),y,(top+bottom)/2+(top-bottom)/2*math.sin(angle)))
        for row in range(len(sections)-1):
            for side in range(sides):
                nxt=(side+1)%sides;a=row*sides+side
                faces.append((a,row*sides+nxt,(row+1)*sides+nxt,a+sides))
        faces.extend([tuple(range(sides-1,-1,-1)),tuple((len(sections)-1)*sides+i for i in range(sides))])
        mesh('Rounded boot vamp '+suffix,points,faces,leather,rig,foot_weights)
        # The sole is a shallow, closed outline of the same last.
        outline=[(sign*.155+.063*math.cos(a),-.047+.16*math.sin(a),.021) for a in [math.tau*i/48 for i in range(48)]]
        vertices=[(x,y,z+d) for d in [0,.017] for x,y,z in outline]
        faces=[tuple(range(47,-1,-1)),tuple(range(48,96))]+[(i,(i+1)%48,(i+1)%48+48,i+48) for i in range(48)]
        mesh('Leather boot sole '+suffix,vertices,faces,sole,rig,foot_weights)
        def leg(point,suffix=suffix):
            calf=max(0,min(1,(point.z-.10)/.20))
            return [('Ankle_'+suffix,1-calf),('LowerLeg_'+suffix,calf)]
        centers=[(sign*.148,.03,.105),(sign*.145,.025,.18),(sign*.141,.02,.27),(sign*.14,.009,.365),(sign*.143,.006,.445)]
        radii=[(.047,.048),(.045,.049),(.049,.053),(.06,.062),(.066,.066)]
        tube('Fitted boot shaft '+suffix,centers,radii,'z',leather,rig,leg,sides=32)
        tube('Turned boot cuff '+suffix,[(sign*.143,.006,.412),(sign*.143,.006,.43),(sign*.143,.006,.445)],[(.07,.07),(.071,.071),(.068,.068)],'z',trim,rig,leg,sides=32)
        tube('Boot ankle strap '+suffix,[(sign*.145,.025,.163),(sign*.145,.025,.177)],[(.049,.054),(.049,.054)],'z',trim,rig,leg,sides=32)
        rounded_box('Boot strap buckle '+suffix,(sign*.199,-.016,.17),(.008,.035,.021),metal,rig,'Ankle_'+suffix,.003)


def linear_color(hex_value):
    rgb = [int(hex_value[i:i+2],16)/255 for i in [0,2,4]]
    return tuple(value/12.92 if value <= .04045 else ((value+.055)/1.055)**2.4 for value in rgb)


def finish_vertex_surfaces(objects):
    """Broad painted variation remains vertex-native and exports through glTF COLOR_0."""
    for obj in objects:
        if obj.type != 'MESH' or not obj.data.materials:
            continue
        surface = obj.data.materials[0]
        if not surface.get('authored_surface'):
            continue
        shader = surface.node_tree.nodes.get('Principled BSDF')
        color = tuple(shader.inputs['Base Color'].default_value[:3])
        attribute = obj.data.color_attributes.new(name='Authored color',type='FLOAT_COLOR',domain='POINT')
        for vertex in obj.data.vertices:
            x,y,z=vertex.co
            variation = .94 + .04*math.sin(x*17+z*12)+.025*math.sin(y*25-z*9)
            # Quiet lightening along cuffs and garment hems; no all-over scratch pattern.
            edge = .025*math.exp(-((z-1.03)/.025)**2) if 'jacket' in obj.name.lower() else 0
            attribute.data[vertex.index].color=(*(min(1,c*(variation+edge)) for c in color),1)
        node = surface.node_tree.nodes.get('Authored vertex color')
        if not node:
            node=surface.node_tree.nodes.new('ShaderNodeVertexColor')
            node.name='Authored vertex color';node.layer_name='Authored color'
            surface.node_tree.links.new(node.outputs['Color'],shader.inputs['Base Color'])


def finish_skin(body):
    """Bake subtle outdoor skin tone and stubble locally, preserving authored UVs and normals."""
    skin=body.data.materials[0].copy();skin.name='Protagonist skin'
    body.data.materials.clear();body.data.materials.append(skin)
    shader=skin.node_tree.nodes.get('Principled BSDF')
    for name,value in [('Metallic',0),('Roughness',.66)]:
        for link in list(shader.inputs[name].links):skin.node_tree.links.remove(link)
        shader.inputs[name].default_value=value
    attribute=body.data.color_attributes.new(name='Local skin shade',type='FLOAT_COLOR',domain='POINT')
    for vertex in body.data.vertices:
        x,y,z=vertex.co
        front=max(0,min(1,(-y-.027)/.055))
        lower=math.exp(-((z-1.545)/.044)**4)
        sideburn=math.exp(-((z-1.606)/.037)**4)*max(0,min(1,(abs(x)-.042)/.02))
        lips=math.exp(-((z-1.586)/.011)**4)*math.exp(-(x/.036)**6)
        beard=max(0,min(.72,(lower*.64+sideburn*.45)*front*(1-lips))) if 1.49<z<1.66 else 0
        attribute.data[vertex.index].color=(1-beard*.57,1-beard*.62,1-beard*.65,1)
    color_input=shader.inputs['Base Color'];source=color_input.links[0].from_socket if color_input.is_linked else None
    tint=skin.node_tree.nodes.new('ShaderNodeVertexColor');tint.layer_name='Local skin shade'
    mix=skin.node_tree.nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1
    if source:skin.node_tree.links.new(source,mix.inputs[1])
    else:mix.inputs[1].default_value=color_input.default_value
    skin.node_tree.links.new(tint.outputs['Color'],mix.inputs[2]);skin.node_tree.links.new(mix.outputs['Color'],color_input)
    image=bpy.data.images.new('Protagonist skin color',width=2048,height=2048,alpha=True)
    image.colorspace_settings.name='sRGB'
    target=skin.node_tree.nodes.new('ShaderNodeTexImage');target.image=image;skin.node_tree.nodes.active=target
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=8
    scene.render.bake.use_pass_direct=False;scene.render.bake.use_pass_indirect=False;scene.render.bake.use_pass_color=True;scene.render.bake.margin=12
    bpy.ops.object.select_all(action='DESELECT');body.select_set(True);bpy.context.view_layer.objects.active=body
    bpy.ops.object.bake(type='DIFFUSE')
    image.filepath_raw=str(PRIVATE/'skin-color.png');image.file_format='PNG';image.save();image.pack()
    skin.node_tree.links.new(target.outputs['Color'],color_input)
    skin.node_tree.nodes.remove(tint);skin.node_tree.nodes.remove(mix)
    body.data.color_attributes.remove(attribute)



def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    source = ROOT / 'public/vendor/character-gallery' / IDENTITY / 'model.glb'
    bpy.ops.import_scene.gltf(filepath=str(source))
    rig = next(obj for obj in bpy.data.objects if obj.type == 'ARMATURE')
    rig.name = 'Protagonist male rig'
    original = {obj.name: obj for obj in bpy.data.objects if obj.type == 'MESH' and obj.name.startswith('Ch01_')}
    # Imported FBX-derived meshes retain centimetre/Y-up coordinates beneath
    # the armature's transform. Author in world metres without altering the rig.
    for obj in original.values():
        obj.data.transform(obj.matrix_world)
        obj.matrix_parent_inverse = rig.matrix_world.inverted()
        obj.matrix_basis = Matrix.Identity(4)
    cloth = material('Blue-green linen', linear_color('627980'))
    leather = material('Warm weathered leather', linear_color('634532'))
    trim = material('Softened leather edges', linear_color('896546'))
    pants_surface = material('Charcoal travel cloth', linear_color('454345'))
    sole = material('Dark boot sole', linear_color('342b24'))
    metal = material('Tarnished brass', linear_color('a48853'))
    metal.node_tree.nodes['Principled BSDF'].inputs['Metallic'].default_value=.72
    metal.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.48
    hair_surface = material('Dark brown sculpted hair', linear_color('38291f'))
    for surface in [cloth,leather,trim,pants_surface,sole,metal,hair_surface]:
        surface['authored_surface']=True
    PRIVATE.mkdir(parents=True,exist_ok=True)
    body = original['Ch01_Body']
    # Preserve weighted anatomy and UVs; broaden jaw planes without flattening features.
    for vertex in body.data.vertices:
        x, y, z = vertex.co
        if z > 1.49:
            jaw = math.exp(-((z - 1.55) / .045) ** 2)
            vertex.co.x *= 1.035 + .12 * jaw
            if y < -.075 and abs(x) < .045 and 1.64 < z < 1.67:
                vertex.co.y -= .003
    body.data.update()
    source_shirt = original['Ch01_Shirt']
    jacket, shirt = tailored_outfit(source_shirt, rig, cloth, leather, trim, metal)
    bpy.data.objects.remove(source_shirt,do_unlink=True)
    pants=original['Ch01_Pants'];assign(pants,pants_surface)
    cloth_hems(rig,cloth)
    for sign,suffix in [(1,'L'),(-1,'R')]:
        def arm_weights(point,suffix=suffix):
            hand=max(0,min(1,(abs(point.x)-.56)/.13))
            return [('Elbow_'+suffix,1-hand),('Hand_'+suffix,hand)]
        tube('Fitted bracer '+suffix,[(sign*.552,.036,1.417),(sign*.612,.034,1.42),(sign*.674,.031,1.423)],[(.035,.032),(.029,.028),(.025,.024)],'x',leather,rig,arm_weights,sides=24)
        tube('Bracer binding '+suffix,[(sign*.552,.036,1.417),(sign*.563,.036,1.417)],[(.037,.034),(.035,.032)],'x',trim,rig,arm_weights,sides=24)
    gloves = copy_surface(body, 'Fingerless gloves', leather, lambda p: .68 < abs(p.x) < .78, .002,
                          planes=[((.68, 0, 0), (1, 0, 0)), ((.78, 0, 0), (1, 0, 0)), ((-.68, 0, 0), (1, 0, 0)), ((-.78, 0, 0), (1, 0, 0))])
    gloves.modifiers.new('Glove thickness', 'SOLIDIFY').thickness = .002
    belt = tube('Waist belt', [(0, -.008, 1.002), (0, -.008, 1.041)], [(.174, .147), (.177, .147)], 'z', leather, rig, bone_weights('Hips'), sides=32)
    waist = [vertex.co.copy() for obj in [shirt, jacket] for vertex in obj.data.vertices if abs(vertex.co.z - 1.023) < .025]
    for vertex in belt.data.vertices:
        direction = Vector((vertex.co.x, vertex.co.y + .008, 0)).normalized()
        aligned = [point for point in waist if Vector((point.x, point.y + .008, 0)).normalized().dot(direction) > .98]
        if aligned:
            radius = max(Vector((point.x, point.y + .008, 0)).dot(direction) for point in aligned) + .007
            vertex.co.x = direction.x * radius
            vertex.co.y = -.008 + direction.y * radius
    rounded_box('Belt buckle', (0, -.163, 1.023), (.055, .014, .047), metal, rig, 'Hips', .004)
    rounded_box('Travel pouch', (.162, -.112, .963), (.085, .05, .105), leather, rig, 'Hips')
    bpy.data.objects.remove(original['Ch01_Sneakers'],do_unlink=True)
    polished_boots(rig,leather,trim,sole,metal)
    hair(rig, hair_surface)
    finish_skin(body)
    finish_vertex_surfaces([obj for obj in bpy.data.objects if obj.type=='MESH' and obj.parent==rig])
    bpy.context.view_layer.update()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    PRIVATE.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(PRIVATE / 'male-geometry.blend'))
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    for obj in bpy.data.objects:
        if obj.type == 'MESH' and obj.parent == rig:
            obj.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(filepath=str(OUTPUT / 'model.glb'), export_format='GLB', use_selection=True, export_animations=False, export_apply=True)
    return rig


def motions(rig):
    manifest = json.loads((ROOT / 'assets/motion-profiles.json').read_text())
    source_pack = next(pack for pack in json.loads((ROOT / '.local/animation-packs/mixamo/converted-source-catalog.json').read_text())['packs'] if pack['id'] == 'mixamo')
    sources = {clip['id']: clip for clip in source_pack['clips']}
    choices = {'idle': 'shield-idle', 'run': 'shield-forward', 'attack': 'sword-attack', 'dodge': 'roll'}
    records = {}
    target_objects = set(bpy.data.objects)
    for role, key in choices.items():
        recipe = manifest['clips'][key]
        source = sources[recipe['sourceId']]
        try:
            bpy.ops.import_scene.fbx(filepath=str(ROOT / '.local/animation-packs' / source['source']), use_anim=True)
            original = next(obj for obj in bpy.data.objects if obj not in target_objects and obj.type == 'ARMATURE')
            mapping = {name: bone for name, bone in BAKER.bone_map(original).items() if name in rig.data.bones}
            fingers = {f'mixamorig:{side}Hand{finger}{segment}' for side in ['Left', 'Right'] for finger in ['Ring', 'Pinky'] for segment in [1, 2, 3]}
            if fingers - set(mapping):
                raise RuntimeError(f'Missing grip finger mapping for {key}: {sorted(fingers - set(mapping))}')
            action = original.animation_data.action
            fps = bpy.context.scene.render.fps / bpy.context.scene.render.fps_base
            trim = recipe.get('trim')
            sample_range = tuple(action.frame_range[0] + time * fps for time in trim) if trim else None
            meta = BAKER.bake(rig, original, action, role, OUTPUT / f'{role}.glb', mapping=mapping, sample_range=sample_range, output_duration=recipe.get('duration'))
            records[role] = {'url': f'/vendor/characters/protagonist-male-draft/{role}.glb', 'sourceId': recipe['sourceId'], 'sourceName': recipe['name'], **meta}
        finally:
            for obj in list(bpy.data.objects):
                if obj not in target_objects:
                    bpy.data.objects.remove(obj, do_unlink=True)
            rig.animation_data_clear()
            for bone in rig.pose.bones:
                bone.matrix_basis.identity()
    return records


def main():
    parser = argparse.ArgumentParser()
    parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    rig = build()
    records = motions(rig)
    path = ROOT / 'public/vendor/character-gallery/catalog.json'
    catalog = json.loads(path.read_text())
    identity = 'lantern-protagonist-male-draft'
    row = {'id': identity, 'name': 'Male geometry draft', 'family': 'Lantern studies', 'url': '/vendor/characters/protagonist-male-draft/model.glb', 'status': 'ready', 'bones': len(rig.data.bones), 'motions': records, 'motionError': None}
    index = next((index for index, item in enumerate(catalog['characters']) if item['id'] == identity), None)
    if index is None:
        catalog['characters'].append(row)
        catalog['expectedCount'] += 1
    else:
        catalog['characters'][index] = row
    path.write_text(json.dumps(catalog, indent=2) + '\n')
    print('Prepared private male geometry study with independently baked finger-complete motions.', flush=True)


if __name__ == '__main__':
    main()
