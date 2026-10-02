"""Bake original environment surfaces onto locally prepared Synty meshes.
Authored palette regions are sampled before UV replacement. Default geometry stays
intact; opt-in showcase recipes may reshape canopy while preserving trunk/bounds.
"""
import argparse, hashlib, json, sys, math
from pathlib import Path
from collections import Counter
import bpy
import numpy as np
sys.path.insert(0,str(Path(__file__).parent))
from material_fields import author_fields, pixels as field_pixels, DEPTH


def linear(c): return c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4

def region(kind, rgb, normal, name):
    r,g,b=rgb; warm=r-max(g,b); spread=max(rgb)-min(rgb)
    if kind=='rock': return 'stone'
    if kind in ['pine','fern','bush']:
        if g>r*1.035 and g>b*1.12: return 'foliage'
        return 'cutwood' if r>130 and r>g*1.12 else 'bark'
    if kind=='log': return 'cutwood' if r>145 or abs(normal.z)>.85 else 'bark'
    if kind=='campfire': return 'timber' if warm>12 else 'stone'
    if kind in ['crate','barrel','chest']:
        if kind=='chest' and 'lock' in name.lower(): return 'metal'
        if spread<18 or b>=r: return 'metal'
        if kind=='barrel' and r>g*1.5 and r>b*1.8: return 'cloth'
        return 'timber'
    if kind=='tent':
        if 'rope' in name.lower(): return 'rope'
        return 'cloth' if r>120 and r-g<35 else 'timber'
    if kind=='bedroll': return 'leather' if r>g*1.5 else 'cloth'
    if kind=='backpack': return 'metal' if spread<16 and r>115 else 'cloth' if b>r or spread<16 else 'leather'
    if kind=='lantern': return 'metal' if spread<20 else 'glass' if r>170 and g>110 else 'timber'
    raise ValueError('Unmapped asset kind '+kind)

ROUGH={'stone':.94,'bark':.97,'timber':.9,'foliage':.95,'cloth':.98,'leather':.84,'metal':.64,'cutwood':.94,'rope':.98,'glass':.3}

def autumn_colors(rgb, look, reference):
    """Retain broad authored light/dark facets during the foliage recolor."""
    rgb=np.asarray(rgb,dtype=np.float32)
    luminance=rgb @ np.array([.2126,.7152,.0722])
    value=np.clip(luminance/max(reference,.001),.55,1.4)
    target=np.array([int(look['color'][i:i+2],16)/255 for i in [1,3,5]])
    shadow=np.array([int(look['shadow'][i:i+2],16)/255 for i in [1,3,5]])
    # Dark clusters carry configured olive or burgundy without per-triangle randomness.
    retained=np.clip((.95-value)/.3,0,1)*look['shadowRetention']
    tint=target*(1-retained[...,None])+shadow*retained[...,None]
    return np.clip(tint*value[...,None]*look['valueScale'],0,1)


def image_pixels(image):
    pixels=np.empty(len(image.pixels),dtype=np.float32); image.pixels.foreach_get(pixels)
    return pixels.reshape((image.size[1],image.size[0],4))


def prepare_showcase(mesh, classes, row):
    """Local form edits and mapping; preserve trunk, hierarchy and original bounds."""
    up=row.get('upAxis',2); horizontal=[axis for axis in range(3) if axis!=up]
    lo=[min(v.co[i] for v in mesh.data.vertices) for i in range(3)]
    hi=[max(v.co[i] for v in mesh.data.vertices) for i in range(3)]
    span=[max(hi[i]-lo[i],.001) for i in range(3)]
    amount=row.get('shape',{}).get('canopyIrregularity',0)
    if amount:
        foliage={v for face,family in zip(mesh.data.polygons,classes) if family=='foliage' for v in face.vertices}
        solid={v for face,family in zip(mesh.data.polygons,classes) if family!='foliage' for v in face.vertices}
        for index in foliage-solid:
            co=mesh.data.vertices[index].co; h=(co[up]-lo[up])/span[up]
            a,c=horizontal; angle=math.atan2(co[c],co[a])
            # Zero at every original extremum keeps height normalization and trunk alignment stable.
            ta=(co[a]-lo[a])/span[a];tc=(co[c]-lo[c])/span[c]
            envelope=math.sin(math.pi*h)**2*(4*ta*(1-ta))*(4*tc*(1-tc))
            shrink=1-amount*(.5+.5*math.sin(angle*3+h*22))*envelope
            co[a]*=shrink;co[c]*=shrink
        mesh.data.update()
        mesh.data.normals_split_custom_set([tuple(face.normal) for face in mesh.data.polygons for _ in face.loop_indices])
    uv=mesh.data.uv_layers.new(name='SurfaceGrain')
    for face,family in zip(mesh.data.polygons,classes):
        rule=row.get('mapping',{}).get(family,{})
        if rule.get('mode')!='cylinder':continue
        a,c=horizontal; values=[]
        for loop in face.loop_indices:
            co=mesh.data.vertices[mesh.data.loops[loop].vertex_index].co
            values.append((math.atan2(co[c],co[a])/(2*math.pi)+.5,(co[up]-lo[up])/span[up]))
        seam=max(u for u,v in values)-min(u for u,v in values)>.5
        repeat=rule.get('repeat',[1,1])
        for loop,(u,v) in zip(face.loop_indices,values):uv.data[loop].uv=((u+1 if seam and u<.5 else u)*repeat[0],v*repeat[1])

def bake(row, textures, output, size):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(row['source']))
    meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
    report={'id':row['id'],'source':str(row['source']),'sourceHash':hashlib.sha256(Path(row['source']).read_bytes()).hexdigest(),'foliage':row.get('foliage'),'meshes':[]}
    originals={}; arrays={}
    for mesh in meshes:
        for mat in mesh.data.materials:
            bsdf=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
            def find_texture(node):
                if node.type=='TEX_IMAGE': return node
                for input in node.inputs:
                    for link in input.links:
                        result=find_texture(link.from_node)
                        if result: return result
                return None
            socket=bsdf.inputs['Base Color']
            tex=find_texture(socket.links[0].from_node) if socket.is_linked else None
            factor=(1,1,1,1) if socket.is_linked else tuple(socket.default_value)
            originals[mat.name]=(tex.image if tex else None,factor,mat)
            if tex and tex.image.name not in arrays: arrays[tex.image.name]=image_pixels(tex.image)
    surfaces={family:bpy.data.images.load(str(textures/row.get('surfaces',{}).get(family,family+'-v1.png')),check_existing=True) for family in ['stone','bark','timber','foliage','cloth','leather']}
    look=row.get('foliage')
    if look and not look.get('retainSourcePalette'):
        source=surfaces['foliage']
        pixels=image_pixels(source)
        image=bpy.data.images.new('Autumn foliage',source.size[0],source.size[1],alpha=True)
        image.colorspace_settings.name=source.colorspace_settings.name
        reference=float(np.mean(pixels[:,:,:3] @ np.array([.2126,.7152,.0722])))
        pixels[:,:,:3]=autumn_colors(pixels[:,:,:3],look,reference)
        image.pixels.foreach_set(pixels.ravel());image.update()
        surfaces['foliage']=image
    fields={family:author_fields(surface,family,row.get('materialFields',{}).get(family)) for family,surface in surfaces.items()}
    for mesh in meshes:
        bpy.ops.object.select_all(action='DESELECT'); mesh.select_set(True); bpy.context.view_layer.objects.active=mesh
        if row.get('bevel') and row['kind']=='rock':
            original_lo=[min(v.co[i] for v in mesh.data.vertices) for i in range(3)]
            original_hi=[max(v.co[i] for v in mesh.data.vertices) for i in range(3)]
            spans=[original_hi[i]-original_lo[i] for i in range(3)]
            modifier=mesh.modifiers.new('Weathered edges','BEVEL');modifier.width=min(spans)*row['bevel'];modifier.segments=1;modifier.limit_method='ANGLE';modifier.angle_limit=.65
            bpy.ops.object.modifier_apply(modifier=modifier.name)
            # Retain the original normalization envelope and conservative collision footprint.
            new_lo=[min(v.co[i] for v in mesh.data.vertices) for i in range(3)]
            new_hi=[max(v.co[i] for v in mesh.data.vertices) for i in range(3)]
            for vertex in mesh.data.vertices:
                for axis in range(3):vertex.co[axis]=original_lo[axis]+(vertex.co[axis]-new_lo[axis])/max(new_hi[axis]-new_lo[axis],.001)*spans[axis]
            mesh.data.update()
            mesh.data.normals_split_custom_set([tuple(face.normal) for face in mesh.data.polygons for _ in face.loop_indices])
        original_uv=mesh.data.uv_layers.active
        if original_uv is None: raise RuntimeError('No authored UVs: '+mesh.name)
        original_uv.name='Authored'
        tint=mesh.data.color_attributes.new(name='EnvironmentTint',type='FLOAT_COLOR',domain='CORNER')
        classes=[]; counts=Counter(); source_alpha=False; samples=[]
        for face in mesh.data.polygons:
            image,factor,original=originals[mesh.data.materials[face.material_index].name]
            # Palette swatches can end exactly on a black gutter at a corner.
            # Sample the face interior, as the original filtered shader does.
            coordinates=[original_uv.data[index].uv for index in face.loop_indices]
            u=sum(uv.x for uv in coordinates)/len(coordinates); v=sum(uv.y for uv in coordinates)/len(coordinates)
            pixel=arrays[image.name][int((v%1)*image.size[1])%image.size[1],int((u%1)*image.size[0])%image.size[0]] if image else np.array(factor)
            rgb=[float(pixel[k])*factor[k] for k in range(3)]
            source_alpha=source_alpha or pixel[3]*factor[3]<.99
            family=region(row['kind'],[c*255 for c in rgb],face.normal,mesh.name)
            classes.append(family);counts[family]+=1;samples.append((rgb,float(pixel[3])*factor[3]))
        foliage=[rgb for (rgb,_),family in zip(samples,classes) if family=='foliage']
        reference=float(np.mean(np.array(foliage) @ np.array([.2126,.7152,.0722]))) if foliage else 1
        for face,(rgb,alpha),family in zip(mesh.data.polygons,samples,classes):
            if look and family=='foliage': rgb=autumn_colors(rgb,look,reference)
            for loop_index in face.loop_indices: tint.data[loop_index].color=(*[linear(float(c)) for c in rgb],alpha)
        if row.get('mapping'): prepare_showcase(mesh,classes,row)
        # Exported flat normals duplicate vertices at every triangle. Unwrap a
        # welded topology copy, then transfer corner UVs without changing the
        # real mesh, its normals, vertex colors, hierarchy or source UVs.
        vertices=[]; lookup={}; faces=[]
        for face in mesh.data.polygons:
            indices=[]
            for vertex in face.vertices:
                coordinate=tuple(mesh.data.vertices[vertex].co)
                if coordinate not in lookup: lookup[coordinate]=len(vertices); vertices.append(coordinate)
                indices.append(lookup[coordinate])
            faces.append(indices)
        temporary=bpy.data.meshes.new('Environment UV topology'); temporary.from_pydata(vertices,[],faces)
        topology=bpy.data.objects.new('Environment UV topology',temporary); bpy.context.collection.objects.link(topology)
        bpy.ops.object.select_all(action='DESELECT'); topology.select_set(True); bpy.context.view_layer.objects.active=topology
        temporary.uv_layers.new(name='Projection'); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(island_margin=.009); bpy.ops.object.mode_set(mode='OBJECT')
        if len(temporary.loops)!=len(mesh.data.loops): raise RuntimeError('UV topology changed corner count: '+mesh.name)
        baked_uv=mesh.data.uv_layers.new(name='EnvironmentBake')
        for index,loop in enumerate(temporary.uv_layers.active.data): baked_uv.data[index].uv=loop.uv
        bpy.data.objects.remove(topology,do_unlink=True); bpy.data.meshes.remove(temporary)
        bpy.ops.object.select_all(action='DESELECT'); mesh.select_set(True); bpy.context.view_layer.objects.active=mesh
        mesh.data.uv_layers.active=baked_uv; baked_uv.active_render=True
        materials=[];colorsockets=[];alpha=[];fieldnodes=[];outputs=[];bumps=[]
        for family in counts:
            mat=bpy.data.materials.new(mesh.name+':'+family);mat.use_nodes=True;nodes=mat.node_tree.nodes;nodes.clear();links=mat.node_tree.links
            attr=nodes.new('ShaderNodeVertexColor');attr.layer_name='EnvironmentTint'
            color=attr.outputs['Color']
            surface=surfaces.get(family);field=None;bump=None
            if surface:
                rule=row.get('mapping',{}).get(family,{})
                coord=nodes.new('ShaderNodeTexCoord');mapping=nodes.new('ShaderNodeMapping')
                scale=1.2 if family in ['bark','timber'] else .85
                mapping.inputs['Scale'].default_value=rule.get('scale',[scale]*3)
                mapping.inputs['Rotation'].default_value=rule.get('rotation',[0,0,0])
                tex=nodes.new('ShaderNodeTexImage');tex.image=surface;tex.projection='BOX';tex.projection_blend=.25;tex.extension='REPEAT'
                if rule.get('mode')=='cylinder':
                    grain=nodes.new('ShaderNodeUVMap');grain.uv_map='SurfaceGrain';tex.projection='FLAT';links.new(grain.outputs['UV'],tex.inputs['Vector'])
                else:
                    links.new(coord.outputs['Generated'],mapping.inputs['Vector']);links.new(mapping.outputs['Vector'],tex.inputs['Vector'])
                fieldtex=nodes.new('ShaderNodeTexImage');fieldtex.image=fields[family];fieldtex.projection=tex.projection;fieldtex.projection_blend=.25;fieldtex.extension='REPEAT'
                links.new(tex.inputs['Vector'].links[0].from_socket,fieldtex.inputs['Vector'])
                channels=nodes.new('ShaderNodeSeparateColor');channels.mode='RGB';links.new(fieldtex.outputs['Color'],channels.inputs[0])
                field={key:channels.outputs[channel] for key,channel in [('height','Red'),('roughness','Green'),('cavity','Blue')]}
                bump=nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.55;bump.inputs['Distance'].default_value=DEPTH[family]*1.8
                links.new(channels.outputs['Red'],bump.inputs['Height'])
                # Retain the authored palette; individual recipes choose how
                # strongly painted marks carry the form at gameplay distance.
                mix=nodes.new('ShaderNodeMixRGB');mix.blend_type='MIX';mix.inputs[0].default_value=rule.get('blend',row['projection']['colorBlend'] if family!='foliage' else row['projection']['foliageBlend'])
                painted=tex.outputs['Color']
                if rule.get('contrast'):
                    contrast=nodes.new('ShaderNodeBrightContrast');contrast.inputs['Contrast'].default_value=rule['contrast']
                    links.new(painted,contrast.inputs['Color']);painted=contrast.outputs['Color']
                links.new(attr.outputs['Color'],mix.inputs[1]);links.new(painted,mix.inputs[2]);color=mix.outputs[0]
                if family=='foliage' and 'interior' in rule:
                    # Broad radial material variation: darker inner needles, restrained outer tips.
                    separate=nodes.new('ShaderNodeSeparateXYZ');links.new(coord.outputs['Generated'],separate.inputs[0])
                    horizontal=[axis for axis in range(3) if axis!=row.get('upAxis',2)]
                    radial=[]
                    for axis in horizontal:
                        subtract=nodes.new('ShaderNodeMath');subtract.operation='SUBTRACT';subtract.inputs[1].default_value=.5;links.new(separate.outputs[axis],subtract.inputs[0])
                        absolute=nodes.new('ShaderNodeMath');absolute.operation='ABSOLUTE';links.new(subtract.outputs[0],absolute.inputs[0]);radial.append(absolute.outputs[0])
                    radius=nodes.new('ShaderNodeMath');radius.operation='MAXIMUM';links.new(radial[0],radius.inputs[0]);links.new(radial[1],radius.inputs[1])
                    value=nodes.new('ShaderNodeMapRange');value.inputs['From Min'].default_value=.05;value.inputs['From Max'].default_value=.4;value.inputs['To Min'].default_value=rule['interior'];value.inputs['To Max'].default_value=rule['tips'];links.new(radius.outputs[0],value.inputs['Value'])
                    finish=nodes.new('ShaderNodeMixRGB');finish.blend_type='MULTIPLY';finish.inputs[0].default_value=1;links.new(color,finish.inputs[1]);links.new(value.outputs['Result'],finish.inputs[2]);color=finish.outputs[0]
                if 'valueScale' in rule:
                    finish=nodes.new('ShaderNodeMixRGB');finish.blend_type='MULTIPLY';finish.inputs[0].default_value=1;finish.inputs[2].default_value=(rule['valueScale'],)*3+(1,);links.new(color,finish.inputs[1]);color=finish.outputs[0]
                if rule.get('footWear'):
                    # Object-space lower-edge dirt follows each form, independently
                    # of projected texture brightness and the direction of light.
                    separate=nodes.new('ShaderNodeSeparateXYZ');links.new(coord.outputs['Generated'],separate.inputs[0])
                    wear=nodes.new('ShaderNodeMapRange');wear.clamp=True
                    wear.inputs['From Min'].default_value=0;wear.inputs['From Max'].default_value=.22
                    wear.inputs['To Min'].default_value=1-rule['footWear'];wear.inputs['To Max'].default_value=1
                    links.new(separate.outputs[row.get('upAxis',2)],wear.inputs['Value'])
                    finish=nodes.new('ShaderNodeMixRGB');finish.blend_type='MULTIPLY';finish.inputs[0].default_value=1
                    links.new(color,finish.inputs[1]);links.new(wear.outputs['Result'],finish.inputs[2]);color=finish.outputs[0]
                    dirt=nodes.new('ShaderNodeMath');dirt.operation='SUBTRACT';dirt.inputs[0].default_value=1;links.new(wear.outputs['Result'],dirt.inputs[1])
                    rough=nodes.new('ShaderNodeMath');rough.operation='MULTIPLY_ADD';rough.use_clamp=True;rough.inputs[1].default_value=.3
                    links.new(dirt.outputs[0],rough.inputs[0]);links.new(field['roughness'],rough.inputs[2]);field['roughness']=rough.outputs[0]
            emission=nodes.new('ShaderNodeEmission');out=nodes.new('ShaderNodeOutputMaterial');links.new(color,emission.inputs['Color']);links.new(emission.outputs[0],out.inputs['Surface'])
            materials.append((family,mat,emission));colorsockets.append(color);alpha.append(attr.outputs['Alpha']);fieldnodes.append(field);outputs.append(out);bumps.append(bump)
        mesh.data.materials.clear()
        for _,mat,_ in materials:mesh.data.materials.append(mat)
        for face,family in zip(mesh.data.polygons,classes):face.material_index=[f for f,_,_ in materials].index(family)
        baked={}
        bpy.context.scene.render.engine='CYCLES';bpy.context.scene.cycles.samples=1
        for channel in ['color','roughness','metalness','height','cavity','eligibility','coverage']+(['alpha'] if source_alpha else []):
            image=bpy.data.images.new(mesh.name+'-'+channel,size,size,alpha=False);image.colorspace_settings.name='sRGB' if channel=='color' else 'Non-Color'
            for index,(family,mat,emission) in enumerate(materials):
                nodes=mat.node_tree.nodes;links=mat.node_tree.links
                for link in list(emission.inputs['Color'].links):links.remove(link)
                if channel=='color':links.new(colorsockets[index],emission.inputs['Color'])
                elif channel=='alpha':links.new(alpha[index],emission.inputs['Color'])
                elif channel in ['height','roughness','cavity'] and fieldnodes[index]:
                    links.new(fieldnodes[index][channel],emission.inputs['Color'])
                else:
                    value=row.get('roughness',{}).get(family,ROUGH[family]) if channel=='roughness' else .65 if channel=='metalness' and family=='metal' else .5 if channel=='height' else 1 if channel in ['cavity','coverage'] else 1 if channel=='eligibility' and family in ['stone','bark','timber'] else 0
                    emission.inputs['Color'].default_value=(value,value,value,1)
                target=nodes.new('ShaderNodeTexImage');target.image=image;nodes.active=target
            bpy.ops.object.bake(type='EMIT',margin=0 if channel=='coverage' else 8);image.pack();baked[channel]=image
        # Bake tangent normals from the same projected height fields into the final atlas UVs.
        normal=bpy.data.images.new(mesh.name+'-normal',size,size,alpha=False);normal.colorspace_settings.name='Non-Color'
        for index,(family,mat,emission) in enumerate(materials):
            nodes=mat.node_tree.nodes;links=mat.node_tree.links;principled=nodes.new('ShaderNodeBsdfPrincipled')
            if bumps[index]:links.new(bumps[index].outputs['Normal'],principled.inputs['Normal'])
            links.new(principled.outputs['BSDF'],outputs[index].inputs['Surface'])
            target=nodes.new('ShaderNodeTexImage');target.image=normal;nodes.active=target
        bpy.ops.object.bake(type='NORMAL',normal_space='TANGENT',margin=8);normal.pack();baked['normal']=normal
        # Fade POM over atlas borders: smaller islands remain normal-mapped without unsafe UV shifts.
        coverage=field_pixels(baked['coverage'])[:,:,0];edge=coverage.copy();distance=np.zeros_like(edge)
        for step in range(1,17):
            edge=np.minimum.reduce([edge,np.roll(edge,1,0),np.roll(edge,-1,0),np.roll(edge,1,1),np.roll(edge,-1,1)])
            edge[0,:]=edge[-1,:]=0;edge[:,0]=edge[:,-1]=0;distance+=edge/16
        packed=np.stack([field_pixels(baked['height'])[:,:,0],field_pixels(baked['cavity'])[:,:,0],field_pixels(baked['eligibility'])[:,:,0]*distance,np.ones_like(distance)],axis=-1)
        from material_fields import field_image
        basename=Path(row['filename']).stem+'-'+str(meshes.index(mesh))+'-surface.png'
        field_image(mesh.name+' surface data',packed,output/basename)
        mat=bpy.data.materials.new(mesh.name+' warm grimdark');mat.use_nodes=True;nodes=mat.node_tree.nodes;links=mat.node_tree.links;bsdf=nodes.get('Principled BSDF')
        for channel,socket in [('color','Base Color'),('roughness','Roughness'),('metalness','Metallic')]:
            tex=nodes.new('ShaderNodeTexImage');tex.image=baked[channel];links.new(tex.outputs['Color'],bsdf.inputs[socket])
        tex=nodes.new('ShaderNodeTexImage');tex.image=baked['normal'];normal_node=nodes.new('ShaderNodeNormalMap');links.new(tex.outputs['Color'],normal_node.inputs['Color']);links.new(normal_node.outputs['Normal'],bsdf.inputs['Normal'])
        mat['lanternSurface']={'url':str(Path(row['url']).parent/ basename),'depth':max([DEPTH[f] for f in counts if f in ['stone','bark','timber']],default=0),'version':2}
        if source_alpha:
            tex=nodes.new('ShaderNodeTexImage');tex.image=baked['alpha'];links.new(tex.outputs['Color'],bsdf.inputs['Alpha']);mat.surface_render_method='DITHERED'
        mat.use_backface_culling=not any(originals[m][2].use_backface_culling is False for m in originals)
        mesh.data.materials.clear();mesh.data.materials.append(mat)
        mesh.data.uv_layers.active=baked_uv;baked_uv.active_render=True
        # Remove sampled colors after baking; keep authored UVs for audit and preserve normals/hierarchy.
        mesh.data.color_attributes.remove(tint)
        report['meshes'].append({'name':mesh.name,'vertices':len(mesh.data.vertices),'faces':len(mesh.data.polygons),'regions':dict(counts),'alphaPreserved':bool(source_alpha),'mapping':row.get('mapping'),'shape':row.get('shape'),'bakeSize':size,'bevel':row.get('bevel'),'atlasPadding':8,'surfaceData':basename})
    target=output/row['filename'];target.parent.mkdir(parents=True,exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(target),export_format='GLB',export_apply=False,export_animations=False,export_extras=True,export_texcoords=True,export_normals=True,export_materials='EXPORT')
    report['output']=str(target);report['bytes']=target.stat().st_size
    reports=Path.cwd()/'.local/environment-art/reports'; reports.mkdir(parents=True,exist_ok=True)
    (reports/(row['filename']+'.json')).write_text(json.dumps(report,indent=2))
    print('ENVIRONMENT_BAKED',row['id'],report['bytes'])

parser=argparse.ArgumentParser();parser.add_argument('--jobs',type=Path,required=True);parser.add_argument('--textures',type=Path,required=True);parser.add_argument('--output',type=Path,required=True);parser.add_argument('--size',type=int,default=1024)
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:]);args.output.mkdir(parents=True,exist_ok=True)
for row in json.loads(args.jobs.read_text()):bake(row,args.textures,args.output,row.get('bakeSize',args.size))
