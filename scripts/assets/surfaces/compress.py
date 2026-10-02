"""Explicit high-quality scenery compression. Preserve private original GLBs and all mesh/material data."""
import argparse, json, struct, subprocess, tempfile, hashlib
from pathlib import Path

def pack(path, encoder, archive):
    raw = path.read_bytes()
    length = struct.unpack_from('<I', raw, 12)[0]
    document = json.loads(raw[20:20 + length]); binary = raw[28 + length:]
    if 'KHR_texture_basisu' in document.get('extensionsRequired', []):
        print('ALREADY_COMPRESSED', path.name, flush=True); return
    original = archive / 'originals' / (hashlib.sha256(raw).hexdigest() + '.glb')
    original.parent.mkdir(parents=True, exist_ok=True)
    if not original.exists(): original.write_bytes(raw)
    color_images = {document['textures'][material['pbrMetallicRoughness']['baseColorTexture']['index']]['source']
                    for material in document.get('materials', []) if 'baseColorTexture' in material.get('pbrMetallicRoughness', {})}
    replacement = {}
    with tempfile.TemporaryDirectory(dir=archive) as directory:
        for index, image in enumerate(document.get('images', [])):
            if 'bufferView' not in image: raise ValueError('Expected embedded prepared images')
            view = document['bufferViews'][image['bufferView']]
            source = Path(directory) / f'{index}.png'; target = Path(directory) / f'{index}.ktx2'
            source.write_bytes(binary[view.get('byteOffset', 0):view.get('byteOffset', 0) + view['byteLength']])
            subprocess.run([str(encoder), '--t2', '--genmipmap', '--encode', 'uastc', '--uastc_quality', '3', '--zcmp', '9', '--threads', '2',
                            '--assign_oetf', 'srgb' if index in color_images else 'linear', str(target), str(source)], check=True)
            replacement[image['bufferView']] = target.read_bytes(); image['mimeType'] = 'image/ktx2'
            print('COMPRESSED', path.name, index + 1, '/', len(document['images']), flush=True)
    chunks = bytearray()
    for index, view in enumerate(document['bufferViews']):
        data = replacement.get(index, binary[view.get('byteOffset', 0):view.get('byteOffset', 0) + view['byteLength']])
        chunks.extend(b'\0' * (-len(chunks) % 4)); view['byteOffset'] = len(chunks); view['byteLength'] = len(data); chunks.extend(data)
    document['buffers'][0]['byteLength'] = len(chunks)
    for texture in document['textures']:
        texture.setdefault('extensions', {})['KHR_texture_basisu'] = {'source': texture.pop('source')}
    for key in ['extensionsUsed', 'extensionsRequired']:
        document.setdefault(key, []).append('KHR_texture_basisu')
    encoded = json.dumps(document, separators=(',', ':')).encode(); encoded += b' ' * (-len(encoded) % 4); chunks.extend(b'\0' * (-len(chunks) % 4))
    result = struct.pack('<III', 0x46546c67, 2, 28 + len(encoded) + len(chunks)) + struct.pack('<II', len(encoded), 0x4e4f534a) + encoded + struct.pack('<II', len(chunks), 0x004e4942) + chunks
    temporary = path.with_suffix('.compressed.tmp'); temporary.write_bytes(result); temporary.replace(path)
    print('PREPARED', path.name, len(raw), '->', len(result), flush=True)

parser = argparse.ArgumentParser(); parser.add_argument('--encoder', type=Path, required=True); parser.add_argument('--jobs', type=Path, required=True); parser.add_argument('--archive', type=Path, required=True)
args = parser.parse_args()
for model in json.loads(args.jobs.read_text()): pack(Path(model), args.encoder, args.archive)
