"""Bake original environment surfaces onto locally prepared Synty meshes.
Authored palette regions are sampled before UV replacement; geometry stays intact.
"""
import argparse, hashlib, json, sys
from pathlib import Path
from collections import Counter
import bpy
import numpy as np


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
    surfaces={family:bpy.data.images.load(str(textures/(family+'-v1.png')),check_existing=True) for family in ['stone','bark','timber','foliage','cloth','leather']}
    look=row.get('foliage')
    if look:
        source=surfaces['foliage']
        pixels=image_pixels(source)
        image=bpy.data.images.new('Autumn foliage',source.size[0],source.size[1],alpha=True)
        image.colorspace_settings.name=source.colorspace_settings.name
        reference=float(np.mean(pixels[:,:,:3] @ np.array([.2126,.7152,.0722])))
        pixels[:,:,:3]=autumn_colors(pixels[:,:,:3],look,reference)
        image.pixels.foreach_set(pixels.ravel());image.update()
        surfaces['foliage']=image
    for mesh in meshes:
        bpy.ops.object.select_all(action='DESELECT'); mesh.select_set(True); bpy.context.view_layer.objects.active=mesh
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
        bpy.ops.uv.smart_project(island_margin=.006); bpy.ops.object.mode_set(mode='OBJECT')
        if len(temporary.loops)!=len(mesh.data.loops): raise RuntimeError('UV topology changed corner count: '+mesh.name)
        baked_uv=mesh.data.uv_layers.new(name='EnvironmentBake')
        for index,loop in enumerate(temporary.uv_layers.active.data): baked_uv.data[index].uv=loop.uv
        bpy.data.objects.remove(topology,do_unlink=True); bpy.data.meshes.remove(temporary)
        bpy.ops.object.select_all(action='DESELECT'); mesh.select_set(True); bpy.context.view_layer.objects.active=mesh
        mesh.data.uv_layers.active_index=1; mesh.data.uv_layers[1].active_render=True
        materials=[];colorsockets=[];alpha=[]
        for family in counts:
            mat=bpy.data.materials.new(mesh.name+':'+family);mat.use_nodes=True;nodes=mat.node_tree.nodes;nodes.clear();links=mat.node_tree.links
            attr=nodes.new('ShaderNodeVertexColor');attr.layer_name='EnvironmentTint'
            color=attr.outputs['Color']
            surface=surfaces.get(family)
            if surface:
                coord=nodes.new('ShaderNodeTexCoord');mapping=nodes.new('ShaderNodeVectorMath');mapping.operation='SCALE';mapping.inputs[3].default_value=1.2 if family in ['bark','timber'] else .85
                tex=nodes.new('ShaderNodeTexImage');tex.image=surface;tex.projection='BOX';tex.projection_blend=.25;tex.extension='REPEAT'
                links.new(coord.outputs['Generated'],mapping.inputs[0]);links.new(mapping.outputs['Vector'],tex.inputs['Vector'])
                # Half authored palette, half original surface: recognizable facets without photographic contrast.
                mix=nodes.new('ShaderNodeMixRGB');mix.blend_type='MIX';mix.inputs[0].default_value=row['projection']['colorBlend'] if family!='foliage' else row['projection']['foliageBlend']
                links.new(attr.outputs['Color'],mix.inputs[1]);links.new(tex.outputs['Color'],mix.inputs[2]);color=mix.outputs[0]
            emission=nodes.new('ShaderNodeEmission');out=nodes.new('ShaderNodeOutputMaterial');links.new(color,emission.inputs['Color']);links.new(emission.outputs[0],out.inputs['Surface'])
            materials.append((family,mat,emission));colorsockets.append(color);alpha.append(attr.outputs['Alpha'])
        mesh.data.materials.clear()
        for _,mat,_ in materials:mesh.data.materials.append(mat)
        for face,family in zip(mesh.data.polygons,classes):face.material_index=[f for f,_,_ in materials].index(family)
        baked={}
        bpy.context.scene.render.engine='CYCLES';bpy.context.scene.cycles.samples=1
        for channel in ['color','roughness','metalness','alpha'] if source_alpha else ['color','roughness','metalness']:
            image=bpy.data.images.new(mesh.name+'-'+channel,size,size,alpha=False);image.colorspace_settings.name='sRGB' if channel=='color' else 'Non-Color'
            for index,(family,mat,emission) in enumerate(materials):
                nodes=mat.node_tree.nodes;links=mat.node_tree.links
                for link in list(emission.inputs['Color'].links):links.remove(link)
                if channel=='color':links.new(colorsockets[index],emission.inputs['Color'])
                elif channel=='alpha':links.new(alpha[index],emission.inputs['Color'])
                else:
                    value=ROUGH[family] if channel=='roughness' else .65 if family=='metal' else 0
                    emission.inputs['Color'].default_value=(value,value,value,1)
                target=nodes.new('ShaderNodeTexImage');target.image=image;nodes.active=target
            bpy.ops.object.bake(type='EMIT',margin=4);image.pack();baked[channel]=image
        mat=bpy.data.materials.new(mesh.name+' warm grimdark');mat.use_nodes=True;nodes=mat.node_tree.nodes;links=mat.node_tree.links;bsdf=nodes.get('Principled BSDF')
        for channel,socket in [('color','Base Color'),('roughness','Roughness'),('metalness','Metallic')]:
            tex=nodes.new('ShaderNodeTexImage');tex.image=baked[channel];links.new(tex.outputs['Color'],bsdf.inputs[socket])
        if source_alpha:
            tex=nodes.new('ShaderNodeTexImage');tex.image=baked['alpha'];links.new(tex.outputs['Color'],bsdf.inputs['Alpha']);mat.surface_render_method='DITHERED'
        mat.use_backface_culling=not any(originals[m][2].use_backface_culling is False for m in originals)
        mesh.data.materials.clear();mesh.data.materials.append(mat)
        mesh.data.uv_layers.active_index=1;mesh.data.uv_layers[1].active_render=True
        # Remove sampled colors after baking; keep authored UVs for audit and preserve normals/hierarchy.
        mesh.data.color_attributes.remove(tint)
        report['meshes'].append({'name':mesh.name,'vertices':len(mesh.data.vertices),'faces':len(mesh.data.polygons),'regions':dict(counts),'alphaPreserved':bool(source_alpha)})
    target=output/row['filename'];target.parent.mkdir(parents=True,exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(target),export_format='GLB',export_apply=False,export_animations=False,export_extras=True,export_texcoords=True,export_normals=True,export_materials='EXPORT')
    report['output']=str(target);report['bytes']=target.stat().st_size
    reports=Path.cwd()/'.local/environment-art/reports'; reports.mkdir(parents=True,exist_ok=True)
    (reports/(row['filename']+'.json')).write_text(json.dumps(report,indent=2))
    print('ENVIRONMENT_BAKED',row['id'],report['bytes'])

parser=argparse.ArgumentParser();parser.add_argument('--jobs',type=Path,required=True);parser.add_argument('--textures',type=Path,required=True);parser.add_argument('--output',type=Path,required=True);parser.add_argument('--size',type=int,default=1024)
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:]);args.output.mkdir(parents=True,exist_ok=True)
for row in json.loads(args.jobs.read_text()):bake(row,args.textures,args.output,row.get('bakeSize',args.size))
