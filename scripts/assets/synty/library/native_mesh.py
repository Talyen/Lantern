"""Pack Unity-resolved mesh geometry into glTF, including skin attributes and bind poses."""
import json
import struct
from pathlib import Path


def export(source,target):
    raw=json.loads(Path(source).read_text());binary=bytearray();views=[];accessors=[]
    def add(values,typ,component=5126):
        width={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[typ]
        fmt={5126:'f',5125:'I',5123:'H'}[component]
        binary.extend(b'\0'*((-len(binary))%4));offset=len(binary)
        binary.extend(struct.pack('<'+fmt*len(values),*values))
        views.append({'buffer':0,'byteOffset':offset,'byteLength':len(binary)-offset})
        acc={'bufferView':len(views)-1,'componentType':component,'count':len(values)//width,'type':typ}
        if typ=='VEC3':acc.update(min=[min(values[i::3]) for i in range(3)],max=[max(values[i::3]) for i in range(3)])
        accessors.append(acc);return len(accessors)-1
    def mirror(values):return [(-v if i%3==2 else v) for i,v in enumerate(values)]
    attrs={'POSITION':add(mirror(raw['positions']),'VEC3')}
    for field,name,typ in [('normals','NORMAL','VEC3'),('uv','TEXCOORD_0','VEC2'),('colors','COLOR_0','VEC4')]:
        if raw.get(field):attrs[name]=add(mirror(raw[field]) if field=='normals' else [1-v if i%2 else v for i,v in enumerate(raw[field])] if field=='uv' else raw[field],typ)
    if raw.get('joints') and raw.get('bindposes'):
        attrs['JOINTS_0']=add(raw['joints'],'VEC4',5123);attrs['WEIGHTS_0']=add(raw['weights'],'VEC4')
    primitives=[]
    for submesh in raw['triangles']:
        triangles=submesh['indices']
        if not triangles:continue
        indices=[]
        for i in range(0,len(triangles),3):indices.extend([triangles[i],triangles[i+2],triangles[i+1]])
        primitives.append({'attributes':attrs,'indices':add(indices,'SCALAR',5125)})
    data={'asset':{'version':'2.0','generator':'Lantern native geometry'},'buffers':[{'byteLength':len(binary)}],'bufferViews':views,'accessors':accessors,'meshes':[{'primitives':primitives}],'nodes':[{'mesh':0}],'scenes':[{'nodes':[0]}],'scene':0}
    # Bind matrices are returned as neutral assembly metadata. Skinning is bound to prefab bones at load time.
    bindposes=raw.get('bindposes',[])
    if bindposes:data['meshes'][0]['extras']={'bindposes':[v*(-1 if (i%16//4==2)!=(i%4==2) else 1) for i,v in enumerate(bindposes)]}
    encoded=json.dumps(data,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4);binary+=b'\0'*((-len(binary))%4)
    target=Path(target);target.parent.mkdir(parents=True,exist_ok=True)
    target.write_bytes(struct.pack('<III',0x46546c67,2,28+len(encoded)+len(binary))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(binary),0x004e4942)+binary)
    return {'bounds':[accessors[0]['min'],accessors[0]['max']],'bytes':target.stat().st_size}
