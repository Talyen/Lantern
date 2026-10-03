"""Resolve source identity, materials and native assembly references before conversion."""
from pathlib import Path
from collections import Counter
import hashlib
import json
import re
import shutil
import struct
from importlib.machinery import SourceFileLoader

exclusions = SourceFileLoader('asset_exclusions', str(Path(__file__).resolve().parents[2] / 'review/exclusions.py')).load_module()


def key(text): return re.sub(r'[^a-z0-9]+','-',text.lower()).strip('-')
def hash_value(value): return hashlib.sha256(json.dumps(value,sort_keys=True).encode()).hexdigest()
def write(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_suffix(path.suffix+'.tmp');temp.write_text(json.dumps(value,indent=2));temp.replace(path)
def model_id(e):
    path=e['relativePath']
    for prefix in ['/Models/','/FBX/']:
        if prefix in '/'+path: path=('/'+path).split(prefix,1)[1];break
    return e['pack']+':model:'+key(str(Path(path).with_suffix('')))
def map_material(raw, texture_ids):
    textures={t['property']:t for t in raw['textures'] if t.get('path')}
    numbers={n['name']:n['value'] for n in raw['numbers']}
    colors={c['name']:c['value'] for c in raw['colors']}
    result={'name':raw['name'],'color':colors.get('_BaseColor',colors.get('_Color',[1,1,1,1])),'roughness':1-numbers.get('_Smoothness',0.1),'metalness':numbers.get('_Metallic',0), 'doubleSided':numbers.get('_Cull',numbers.get('_CullMode',2))==0,'alphaCutoff':numbers.get('_Alpha_Clip_Threshold',numbers.get('_Cutoff',0.5)),'alphaMode':'MASK' if numbers.get('_AlphaClip',numbers.get('_Alpha_Clip',0)) or '_ALPHATEST_ON' in raw.get('keywords',[]) else 'BLEND' if numbers.get('_Surface',0)==1 else 'OPAQUE','textures':{},'emissive':colors.get('_EmissionColor',[1,1,1,1])[:3],'warnings':[]}
    channels={'baseColor':['_Albedo_Map','_Base_Map','_Base_Texture','_BaseMap','_MainTex','_Base_Albedo','_Leaf_Texture','_Trunk_Texture','_Triplanar_Texture_Side','_Spherical_Map'],'normal':['_Normal_Map','_BumpMap','_Leaf_Normal','_Normal_Texture','_Base_Normal','_Trunk_Normal','_Triplanar_Normal_Texture_Side'],'emissive':['_Emission_Map','_Emission_Texture','_EmissionMap']}
    for channel,properties in channels.items():
        for prop in properties:
            if prop in textures:
                t=textures[prop];ident=texture_ids.get(t['path'])
                if ident: result['textures'][channel]={'id':ident,'scale':t['scale'],'offset':t['offset']}
                else: result['warnings'].append('Unresolved texture '+t['path'])
                break
    role=raw['name'].lower()
    result['effectRole']='water' if 'water' in role else 'foliage' if any(s in role for s in ['leaf','leaves','grass','pine','bush','fern']) else 'particle' if any(s in role for s in ['particle','flame','smoke','spark']) else None
    if '_Leaf_Texture' in textures and '_Trunk_Texture' in textures: result['warnings'].append('Combined trunk/leaf shader approximated with the leaf base layer; original masks archived')
    if any('Triplanar' in name for name in textures): result['warnings'].append('Triplanar shader approximated with its side layer and source UVs')
    result['warnings'].append('Custom shader translated to standard PBR; engine-specific shader behavior is not embedded')
    return result

def source_materials(entries, textures):
    lookup={};bindings={}
    for e in entries:
        if not Path(e['relativePath']).name.startswith('MaterialList') or not e.get('localPath'):continue
        slot=None;mesh=None
        for line in Path(e['localPath']).read_text(errors='replace').splitlines():
            text=line.strip()
            if text.startswith('Mesh Name:'):
                mesh=text.split(':',1)[1].strip();bindings.setdefault((e['pack'],mesh),[])
            elif text.startswith('Slot:'):
                label=text[5:].strip();slot=label.split(' (')[0]
                if mesh and slot not in bindings[(e['pack'],mesh)]: bindings[(e['pack'],mesh)].append(slot)
                mat=lookup.setdefault((e['pack'],slot),{'name':slot,'textures':{},'warnings':[],'alphaMode':'OPAQUE','roughness':0.9,'metalness':0,'color':[1,1,1,1],'emissive':[1,1,1]})
                match=re.search(r'\(([^()]*)\)',label)
                if match and not any(w in match[1].lower() for w in ['shader','no albedo']):
                    candidates=textures.get((e['pack'],match[1]+'.png'),[])
                    if len(candidates)==1:mat['textures']['baseColor']={'id':candidates[0],'scale':[1,1],'offset':[0,0]}
            elif slot and ':' in text:
                channel,file=text.split(':',1);filename=file.strip().split(' (')[0]
                channel={'Albedo':'baseColor','Normal':'normal','Emission':'emissive','_Leaf_Texture':'baseColor','_Leaf_Normal':'normal'}.get(channel)
                if channel:
                    candidates=textures.get((e['pack'],filename),[])
                    if len(candidates)==1:mat['textures'][channel]={'id':candidates[0],'scale':[1,1],'offset':[0,0]}
    return lookup,bindings

def prepare(entries, metadata, output, private, version):
    output.mkdir(parents=True,exist_ok=True)
    previous=json.loads((output/'catalog.json').read_text()) if (output/'catalog.json').exists() else {'assets':{}}
    selected_packs={e['pack'] for e in entries}
    retained={ident:asset for ident,asset in previous['assets'].items() if asset['pack'] not in selected_packs and not exclusions.excluded(ident, asset['url'])}
    catalog={'version':version,'assets':retained,'complete':False}
    assets=catalog['assets']; jobs=[]; textures={}; hash_ids={}; file_ids={}; by_source={}; unity_models={}; materials_by_bundle={}
    entries_by_source={e['source']:e for e in entries}
    model_names={(e['pack'],Path(e['relativePath']).stem) for e in entries if e['extension']=='.fbx' and e['status']!='excluded'}
    ordered=sorted(entries,key=lambda e:({'source':0,'unity':1,'godot':2,'unreal':3}[e['origin']],e['source']))
    code_hash=hashlib.sha256(Path(__file__).with_name('convert.py').read_bytes()).hexdigest()
    def add(e,kind,ident,suffix):
        if ident in assets: ident+='-'+e['sourceHash'][:10]
        target=output/({'assembly':'assemblies'}.get(kind,kind+'s'))/(key(e['pack']))/(hash_value(ident)[:20]+suffix)
        asset={'id':ident,'pack':e['pack'],'name':Path(e['relativePath']).stem,'kind':kind,'source':e['source'],'sourceHash':e['sourceHash'],'url':'/vendor/synty/library/'+str(target.relative_to(output)),'dependencies':[],'status':'pending','warnings':[]}
        assets[ident]=asset; e['assetId']=ident;by_source[e['source']]=ident
        return asset,target
    for e in ordered:
        if e['status']!='pending' or e['extension'] not in {'.png','.jpg','.jpeg','.tga'}:continue
        h=e['sourceHash']
        if h in hash_ids:
            ident=hash_ids[h];e['assetId']=ident;e['status']='duplicate';assets[ident].setdefault('aliases',[]).append(e['source'])
        else:
            ident=e['pack']+':texture:'+key(str(Path(e['relativePath']).with_suffix('')))
            a,target=add(e,'texture',ident,'.png' if e['extension']=='.tga' else e['extension']);ident=a['id'];hash_ids[h]=ident
            if exclusions.excluded(ident, a['url']):
                e.update(status='excluded', reason='Completed asset deletion');continue
            if e['extension']!='.tga':
                if not target.exists() or hashlib.sha256(target.read_bytes()).hexdigest()!=h:target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(e['localPath'],target)
                a.update(status='converted',bytes=target.stat().st_size)
            else:
                from PIL import Image
                target.parent.mkdir(parents=True,exist_ok=True)
                with Image.open(e['localPath']) as image:image.save(target,'PNG')
                a.update(status='converted',bytes=target.stat().st_size)
        textures.setdefault((e['pack'],Path(e['relativePath']).name),[])
        if ident not in textures[(e['pack'],Path(e['relativePath']).name)]:textures[(e['pack'],Path(e['relativePath']).name)].append(ident)
        file_ids[e['source']]=ident
    fallback,source_bindings=source_materials(entries,textures)
    for data in metadata:
        # Export paths identify the package namespace; GUIDs are scoped per package to retain versions.
        bundle=data['bundle']
        if not bundle:continue
        texture_ids={e['relativePath']:e['assetId'] for e in entries if e['source'].startswith(bundle+'/') and e.get('assetId')}
        mapped={m['guid']:map_material(m,texture_ids) for m in data['materials']}
        pack=next(e['pack'] for e in entries if e['source'].startswith(bundle+'/'))
        default_id=pack+':material:unity-default'
        default={'name':'Unity default material','color':[0.5,0.5,0.5,1],'roughness':0.5,'metalness':0,'textures':{},'alphaMode':'OPAQUE','warnings':['Unity built-in default material translated to neutral PBR'],'id':default_id}
        default_target=output/'materials'/pack/'unity-default.json'
        if not exclusions.excluded(default_id, '/vendor/synty/library/' + str(default_target.relative_to(output))):write(default_target,default)
        assets[default_id]={'id':default_id,'kind':'material','pack':pack,'name':default['name'],'status':'converted','url':'/vendor/synty/library/'+str(default_target.relative_to(output)),'sourceHash':hash_value(default),'dependencies':[],'warnings':default['warnings']}
        mapped['0000000000000000f000000000000000']=default

        materials_by_bundle[bundle]=mapped
        for m in data['models']:unity_models[bundle+'/'+m['path']]=m
        for m in data['materials']:
            e=entries_by_source.get(bundle+'/'+m['path'])
            if not e:continue
            ident=e['pack']+':material:'+key(str(Path(m['path']).with_suffix('')))
            a,target=add(e,'material',ident,'.json');material=mapped[m['guid']]
            a.update(status='converted',dependencies=list({t['id'] for t in material['textures'].values()}),warnings=material['warnings'])
            target=target.with_name(hash_value([a['id'],material])+'.json')
            a['url']='/vendor/synty/library/'+str(target.relative_to(output))
            if exclusions.excluded(a['id'], a['url']):
                e.update(status='excluded', reason='Completed asset deletion');continue
            write(target,material);mapped[m['guid']]['id']=a['id']
    material_lookup={}; native_bindings={}; model_mesh_names={}
    for bundle,mapped in materials_by_bundle.items():
        pack=next(e['pack'] for e in entries if e['source'].startswith(bundle+'/'))
        for mat in mapped.values(): material_lookup.setdefault((pack,mat['name']),mat)
        data=next(data for data in metadata if data['bundle']==bundle)
        for raw in data['materials']:
            if '/PolygonGeneric/' in raw['path']: material_lookup.setdefault(('generic',mapped[raw['guid']]['name']),mapped[raw['guid']])
    def normalize(name):return re.sub(r'_(mat|texture)_','_',name.lower())
    merged_materials={**fallback,**material_lookup}
    normalized={(pack,normalize(name)):mat for (pack,name),mat in merged_materials.items()}
    for data in metadata:
        bundle=data['bundle'];pack=next(e['pack'] for e in entries if e['source'].startswith(bundle+'/'));mapped=materials_by_bundle[bundle]
        for assembly in data['assemblies']:
            for node in assembly['nodes']:
                ref=node.get('mesh')
                if ref and ref.get('guid'):
                    slots=[mapped.get(guid) for guid in node['materials']]
                    if all(slots):native_bindings.setdefault((pack,ref['name']),slots)
        for model in data['models']:model_mesh_names[(pack,Path(model['path']).stem)]=[m['name'] for m in model['meshes']]
    hash_ids={}
    for e in ordered:
        if e['status']!='pending' or e['extension'] not in {'.fbx','.obj'}:continue
        if e['extension']=='.obj' and (e['pack'],Path(e['relativePath']).stem) in model_names:
            e.update(status='duplicate',reason='FBX preferred over equivalent OBJ');continue
        h=e['sourceHash']
        if h in hash_ids:
            ident=hash_ids[h];e.update(assetId=ident,status='duplicate');assets[ident].setdefault('aliases',[]).append(e['source']);continue
        a,target=add(e,'model',model_id(e),'.glb');ident=a['id'];hash_ids[h]=ident
        if exclusions.excluded(ident, a['url']):
            e.update(status='excluded', reason='Completed asset deletion');continue
        # Preserve distinct geometry versions, even when names coincide.
        mats={name:mat for (pack,name),mat in merged_materials.items() if pack in {e['pack'],'generic'}}
        basename=Path(e['relativePath']).stem
        names=set(model_mesh_names.get((e['pack'],basename),[]))|{basename}
        names.update(name for (pack,name) in source_bindings if pack==e['pack'] and (name.startswith(basename+'_') or name==basename))
        bindings={}
        for name in names:
            source_slots=source_bindings.get((e['pack'],name),[])
            resolved=[normalized.get((e['pack'],normalize(slot))) or normalized.get(('generic',normalize(slot))) for slot in source_slots]
            if source_slots and all(resolved):bindings[name]=resolved
            elif (e['pack'],name) in native_bindings:bindings[name]=native_bindings[(e['pack'],name)]

        dependencies=sorted({t['id'] for mat in mats.values() for t in mat.get('textures',{}).values()})
        request={'id':ident,'kind':'model','source':e['localPath'],'target':str(target),'result':str(private/'results'/(hash_value(ident)+'.json')),'materials':mats,'materialBindings':bindings,'textures':{i:str(output/assets[i]['url'].split('/vendor/synty/library/')[1]) for i in dependencies},'fingerprint':hash_value([h,code_hash,mats,bindings]),'native':unity_models.get(e['source'])}
        with Path(e['localPath']).open('rb') as stream:
            if e['extension']=='.fbx' and not stream.read(20).startswith(b'Kaydara FBX Binary'):
                request['backend']='three'
                request['fingerprint']=hash_value([h,hashlib.sha256(Path(__file__).with_name('convert-ascii.mjs').read_bytes()).hexdigest(),mats,bindings])
        a['rig']={'bones':request['native'].get('bones',[])} if request['native'] else None
        jobs.append(request)
    from importlib.machinery import SourceFileLoader
    native_export=SourceFileLoader('native_mesh',str(Path(__file__).with_name('native_mesh.py'))).load_module().export
    native_ids={}
    for model_source,model in unity_models.items():
        bundle=model_source.split('/')[0]
        original=entries_by_source.get(model_source)
        if not original: continue
        for mesh in model['meshes']:
            if not mesh.get('geometry') or not Path(mesh['geometry']).exists():continue
            native_hash=hashlib.sha256(Path(mesh['geometry']).read_bytes()+Path(__file__).with_name('native_mesh.py').read_bytes()).hexdigest()
            ident=original['pack']+':mesh:'+mesh['guid']+'-'+str(mesh['fileId'])+'-'+native_hash[:10]
            target=output/'meshes'/(native_hash+'.glb')
            if exclusions.excluded(ident, '/vendor/synty/library/meshes/' + target.name):continue
            if not target.exists():bounds=native_export(mesh['geometry'],target)
            else:
                with target.open('rb') as stream:
                    header=stream.read(20);data=json.loads(stream.read(struct.unpack_from('<I',header,12)[0]))
                bounds={'bounds':[data['accessors'][0]['min'],data['accessors'][0]['max']],'bytes':target.stat().st_size}
            assets[ident]={'id':ident,'kind':'mesh','pack':original['pack'],'name':mesh['name'],'url':'/vendor/synty/library/meshes/'+target.name,'source':original['source'],'sourceHash':original['sourceHash'],'conversionHash':native_hash,'status':'converted','dependencies':[],'warnings':model.get('warnings') or [],**bounds}
            native_ids[(bundle,mesh['guid'],mesh['fileId'])]=ident
            if original['extension']=='.asset':
                original.setdefault('assetIds',[]).append(ident);original['reason']='Native mesh / terrain geometry converted'

    for data in metadata:
        bundle=data['bundle']
        if not bundle:continue
        mapped=materials_by_bundle.get(bundle,{})
        for assembly in data['assemblies']:
            e=entries_by_source.get(bundle+'/'+assembly['path'])
            if not e:continue
            a,target=add(e,'assembly',e['pack']+':assembly:'+key(str(Path(assembly['path']).with_suffix(''))),'.json')
            deps=set();warnings=list(assembly['warnings']);failed=False
            for node in assembly['nodes']:
                mesh=node.get('mesh')
                if 'CanvasRenderer' in node['unsupported']: mesh=None
                if mesh and mesh.get('guid'):
                    mesh['assetId']=native_ids.get((bundle,mesh['guid'],mesh['fileId']))
                    mesh.pop('geometry',None)
                    if mesh['assetId']:deps.add(mesh['assetId'])
                    else:warnings.append('Unresolved model '+mesh['path']);failed=True
                else: node['mesh']=None
                original_materials=list(node['materials'])
                node['materials']=[mapped.get(guid,{}).get('id') for guid in node['materials']]
                if node.get('mesh') and any(guid and not material for guid,material in zip(original_materials,node['materials'])): warnings.append('Unresolved material: '+node['name']);failed=True
                deps.update(i for i in node['materials'] if i)
                for collider in node['colliders']:
                    ref=collider.get('mesh')
                    if ref and ref.get('guid'):
                        ref['assetId']=native_ids.get((bundle,ref['guid'],ref['fileId']))
                        ref.pop('geometry',None)
                        if ref['assetId']: deps.add(ref['assetId'])
                        else: warnings.append('Unresolved collision mesh: '+node['name'])
                if node['unsupported']:warnings.append(node['name']+': omitted '+', '.join(node['unsupported']))
            target=target.with_name(hash_value([a['id'],assembly])+'.json')
            a['url']='/vendor/synty/library/'+str(target.relative_to(output))
            if exclusions.excluded(a['id'], a['url']):
                e.update(status='excluded', reason='Completed asset deletion');continue
            write(target,assembly)
            renderable=any(n.get('mesh') for n in assembly['nodes'])
            a.update(status='failed' if failed else 'converted' if renderable else 'unsupported',dependencies=sorted(deps),warnings=warnings,reason=None if renderable else 'Engine-only prefab; no reusable static or skinned geometry')
    # Completed conversions are reusable only when their complete dependency fingerprint matches.
    assets_to_remove=[ident for ident, asset in assets.items() if exclusions.excluded(ident, asset['url'])]
    for ident in assets_to_remove:del assets[ident]
    queued=[]
    for job in jobs:
        result=Path(job['result']);target=Path(job['target'])
        cached=json.loads(result.read_text()) if result.exists() else {}
        if cached.get('fingerprint')==job['fingerprint'] and cached.get('status')=='converted' and target.exists():assets[job['id']].update(cached)
        else:queued.append(job)
    return queued,catalog

def finish(entries,catalog,output,private):
    for e in entries:
        if e.get('assetId') and e['status'] not in {'duplicate', 'excluded'}:
            a=catalog['assets'][e['assetId']];e['status']=a['status'];e['reason']=a.get('reason')
    catalog['complete']=not any(a['status'] in {'failed','pending'} for a in catalog['assets'].values())
    write(output/'catalog.json',catalog)
    old=json.loads((private/'coverage.json').read_text()).get('entries',[]) if (private/'coverage.json').exists() else []
    selected={e['pack'] for e in entries}
    entries=[e for e in old if e['pack'] not in selected]+entries
    report={'complete':catalog['complete'],'sourceCounts':dict(Counter(e['status'] for e in entries)),'assetCounts':dict(Counter(a['status'] for a in catalog['assets'].values())),'entries':entries}
    write(private/'coverage.json',report)
    print('Source coverage:',report['sourceCounts'],flush=True)
