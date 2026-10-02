"""Losslessly fold relief fields into unused prepared material channels; preserve all source files."""
import argparse, hashlib, io, json, struct
from pathlib import Path
from PIL import Image

def archive_bytes(directory, data, suffix):
    target = directory / (hashlib.sha256(data).hexdigest() + suffix)
    if not target.exists(): target.write_bytes(data)

def pack(path, public, archive):
    raw = path.read_bytes(); length = struct.unpack_from('<I', raw, 12)[0]
    document = json.loads(raw[20:20+length]); binary = raw[28+length:]; replacement = {}; packed = 0
    if 'KHR_texture_basisu' in document.get('extensionsUsed', []): raise ValueError('Pack the original PNG GLB before any compression trial.')
    for material in document.get('materials', []):
        descriptor = material.get('extras', {}).get('lanternSurface', {})
        if descriptor.get('version') != 2: continue
        if material.get('occlusionTexture'): raise ValueError('Prepared metallic/roughness red channel is already used by occlusion.')
        normal = material['normalTexture']; rough = material['pbrMetallicRoughness']['metallicRoughnessTexture']; base = material['pbrMetallicRoughness']['baseColorTexture']
        if len({normal.get('texCoord',0),rough.get('texCoord',0),base.get('texCoord',0)}) != 1: raise ValueError('Relief packing requires matched material UV channels.')
        url = descriptor['url']
        if not url.startswith('/vendor/synty/environment/') or '..' in url: raise ValueError('Invalid relief field URL')
        field_bytes = (public / url.lstrip('/')).read_bytes(); fields = Image.open(io.BytesIO(field_bytes)).convert('RGBA')
        for texture, fields_to_copy in [(normal, {3:1}), (rough, {0:0, 3:2})]:
            image = document['images'][document['textures'][texture['index']]['source']]; index = image['bufferView']; view = document['bufferViews'][index]
            if index in replacement: raise ValueError('Shared prepared image requires an explicit packing recipe.')
            pixels = Image.open(io.BytesIO(binary[view.get('byteOffset',0):view.get('byteOffset',0)+view['byteLength']])).convert('RGBA')
            if pixels.size != fields.size: raise ValueError('Relief and material dimensions differ.')
            channels = list(pixels.split()); source = fields.split()
            for target, origin in fields_to_copy.items(): channels[target] = source[origin]
            result = Image.merge('RGBA', channels); output = io.BytesIO(); result.save(output, format='PNG')
            # PNG is lossless; verify every copied and retained byte after encoding.
            decoded = Image.open(io.BytesIO(output.getvalue())).convert('RGBA')
            if decoded.tobytes() != result.tobytes(): raise ValueError('Packed PNG changed pixel values.')
            replacement[index] = output.getvalue()
        archive_bytes(archive, field_bytes, '.png'); descriptor.pop('url'); descriptor['version'] = 3; packed += 1
    if not packed: print('UNCHANGED',path.name,flush=True); return
    archive_bytes(archive, raw, '.glb'); chunks = bytearray()
    for index, view in enumerate(document['bufferViews']):
        data = replacement.get(index,binary[view.get('byteOffset',0):view.get('byteOffset',0)+view['byteLength']]); chunks.extend(b'\0'*(-len(chunks)%4)); view['byteOffset']=len(chunks); view['byteLength']=len(data); chunks.extend(data)
    document['buffers'][0]['byteLength']=len(chunks); encoded=json.dumps(document,separators=(',',':')).encode(); encoded+=b' '*(-len(encoded)%4); chunks.extend(b'\0'*(-len(chunks)%4))
    output=struct.pack('<III',0x46546c67,2,28+len(encoded)+len(chunks))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(chunks),0x004e4942)+chunks
    temporary=path.with_suffix('.packed.tmp');temporary.write_bytes(output);temporary.replace(path);print('PACKED',path.name,packed,'materials',len(raw),'->',len(output),flush=True)

parser=argparse.ArgumentParser();parser.add_argument('--jobs',type=Path,required=True);parser.add_argument('--archive',type=Path,required=True);parser.add_argument('--public',type=Path,required=True);args=parser.parse_args()
for model in json.loads(args.jobs.read_text()): pack(Path(model),args.public,args.archive)
