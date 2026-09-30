"""Isolated Blender geometry conversion; shared textures are linked without re-encoding pixels."""
import json
import os
from pathlib import Path
import struct
import sys
import traceback
import bpy


def convert(job):
    target=Path(job['target']);target.parent.mkdir(parents=True,exist_ok=True)
    result={'status':'failed','fingerprint':job['fingerprint']}
    try:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.fbx(filepath=job['source'],use_anim=False,use_image_search=False) if Path(job['source']).suffix.lower()=='.fbx' else bpy.ops.wm.obj_import(filepath=job['source'])
        meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
        if not meshes:raise RuntimeError('Source contains no meshes')
        warnings=[];used=set();primitive_names=[];specs={}
        for mesh in meshes:
            if not mesh.data.uv_layers:warnings.append('No UVs: '+mesh.name)
            slots=job.get('materialBindings',{}).get(mesh.name) or job.get('materialBindings',{}).get(mesh.data.name) or job.get('materialBindings',{}).get(mesh.name.rsplit('.',1)[0])
            for index,original in enumerate(mesh.data.materials):
                if not original:continue
                name=original.name
                spec=slots[index] if slots and index<len(slots) else job['materials'].get(name) or job['materials'].get(name.rsplit('.',1)[0])
                material=original.copy();material.name=f'{mesh.name}:slot{index}';material.use_nodes=True;mesh.data.materials[index]=material
                # FBX image searches and pixel re-encoding are unnecessary: the catalog already owns the shared PNGs.
                for node in list(material.node_tree.nodes):
                    if node.type=='TEX_IMAGE':material.node_tree.nodes.remove(node)
                shader=material.node_tree.nodes.get('Principled BSDF')
                if not spec:warnings.append('No verified material mapping: '+name);continue
                specs[material.name]=spec
                shader.inputs['Base Color'].default_value=spec.get('color',[1,1,1,1])
                shader.inputs['Roughness'].default_value=spec.get('roughness',0.9)
                shader.inputs['Metallic'].default_value=spec.get('metalness',0)
                shader.inputs['Emission Color'].default_value=spec.get('emissive',[1,1,1])+[1]
                shader.inputs['Emission Strength'].default_value=1 if 'emissive' in spec.get('textures',{}) else 0
                material.use_backface_culling=not (spec.get('doubleSided',False) or spec.get('effectRole')=='foliage')
                warnings.extend(spec.get('warnings',[]))
            primitive_names.append({'object':mesh.name,'mesh':mesh.data.name,'materialSlots':len(mesh.data.materials),'vertices':len(mesh.data.vertices)})
        temp=target.with_suffix('.gltf')
        bpy.ops.export_scene.gltf(filepath=str(temp),export_format='GLTF_SEPARATE',export_apply=False,export_animations=False,export_extras=True,export_image_format='NONE')
        data=json.loads(temp.read_text());data['images']=[];data['textures']=[]
        data['samplers']=[{'magFilter':9729,'minFilter':9987,'wrapS':10497,'wrapT':10497}]
        texture_indices={}
        for material in data.get('materials',[]):
            spec=specs.get(material.get('name'))
            if not spec:continue
            material['alphaMode']='MASK' if spec.get('effectRole')=='foliage' else spec.get('alphaMode','OPAQUE')
            if material['alphaMode']=='MASK':material['alphaCutoff']=spec.get('alphaCutoff',0.5)
            material['doubleSided']=spec.get('doubleSided',False) or spec.get('effectRole')=='foliage'
            for channel,mapping in spec.get('textures',{}).items():
                ident=mapping['id'];path=job['textures'][ident]
                if not Path(path).exists():raise RuntimeError('Texture dependency not ready: '+path)
                used.add(ident)
                if ident not in texture_indices:
                    data['images'].append({'uri':os.path.relpath(path,target.parent).replace(os.sep,'/')})
                    data['textures'].append({'source':len(data['images'])-1,'sampler':0});texture_indices[ident]=len(data['textures'])-1
                scale=mapping.get('scale',[1,1]);offset=mapping.get('offset',[0,0])
                info={'index':texture_indices[ident],'extensions':{'KHR_texture_transform':{'scale':scale,'offset':[offset[0],1-scale[1]-offset[1]]}}}
                if channel=='baseColor':material.setdefault('pbrMetallicRoughness',{})['baseColorTexture']=info
                elif channel=='normal':material['normalTexture']=info
                elif channel=='emissive':material['emissiveTexture']=info;material['emissiveFactor']=spec.get('emissive',[1,1,1])
                data['extensionsUsed']=sorted(set(data.get('extensionsUsed',[])+['KHR_texture_transform']))
        binary=bytearray()
        original_buffers=data.get('buffers',[])
        if len(original_buffers)!=1:raise RuntimeError('Unexpected geometry buffer count')
        binary.extend((temp.parent/original_buffers[0]['uri']).read_bytes());data['buffers']=[{'byteLength':len(binary)}]
        encoded=json.dumps(data,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4);binary+=b'\0'*((-len(binary))%4)
        content=struct.pack('<III',0x46546c67,2,28+len(encoded)+len(binary))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(binary),0x004e4942)+binary
        temporary=target.with_suffix('.tmp');temporary.write_bytes(content);temporary.replace(target)
        (temp.parent/original_buffers[0]['uri']).unlink(missing_ok=True);temp.unlink()
        coords=[obj.matrix_world@v.co for obj in meshes for v in obj.data.vertices]
        low=[min(v[i] for v in coords) for i in range(3)];high=[max(v[i] for v in coords) for i in range(3)]
        bounds=[[low[0],low[2],-high[1]],[high[0],high[2],-low[1]]]
        result.update(status='converted',bytes=target.stat().st_size,dependencies=sorted(used),warnings=sorted(set(warnings)),bounds=bounds,meshes=primitive_names,rig={'bones':[b.name for o in bpy.context.scene.objects if o.type=='ARMATURE' for b in o.data.bones]})
    except Exception as error:result['reason']=str(error);traceback.print_exc()
    finally:
        output=Path(job['result']);output.parent.mkdir(parents=True,exist_ok=True)
        temporary=output.with_suffix('.tmp');temporary.write_text(json.dumps(result,indent=2));temporary.replace(output)

jobs=json.loads(Path(sys.argv[sys.argv.index('--')+1]).read_text())
for job in jobs if isinstance(jobs,list) else [jobs]:convert(job)
