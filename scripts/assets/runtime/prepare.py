"""Explicit source-preserving UASTC runtime derivatives; original GLBs never change."""
import argparse
import copy
import hashlib
import json
import os
import struct
import subprocess
import tempfile
from pathlib import Path

RECIPE = 'uastc-q4-zstd9-v1'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def dimensions(data):
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        return None
    width, height = struct.unpack('>II', data[16:24])
    return width, height, data[24]


def atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_bytes(data)
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--jobs', type=Path, required=True)
    parser.add_argument('--encoder', type=Path, required=True)
    args = parser.parse_args()
    version = subprocess.check_output([str(args.encoder), '--version'], text=True, stderr=subprocess.STDOUT).strip()
    if version != 'toktx v4.4.2':
        raise ValueError('Runtime art requires toktx v4.4.2')
    public = args.root / 'public'
    output = public / 'vendor/runtime-art'
    archive = args.root / '.local/runtime-art'
    archive.mkdir(parents=True, exist_ok=True)
    assets = {}
    count = 0

    def url(path):
        return '/' + path.relative_to(public if path.is_relative_to(public) else args.root).as_posix()

    def encode(data, srgb, mip, flip=False):
        nonlocal count
        size = dimensions(data)
        if not size or size[2] != 8 or max(size[:2]) < 512 or size[0] % 4 or size[1] % 4:
            return None
        key = digest(data + f'{RECIPE}:{srgb}:{mip}{":flip" if flip else ""}'.encode())
        target = output / 'textures' / (key + '.ktx2')
        if not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.TemporaryDirectory(dir=archive) as directory:
                source = Path(directory) / 'source.png'
                result = Path(directory) / 'result.ktx2'
                source.write_bytes(data)
                command = [str(args.encoder), '--t2', '--encode', 'uastc', '--uastc_quality', '4', '--zcmp', '9', '--threads', '2', '--assign_oetf', 'srgb' if srgb else 'linear', '--assign_primaries', 'bt709' if srgb else 'none']
                if mip:
                    command.append('--genmipmap')
                if flip:
                    command.append('--lower_left_maps_to_s0t0')
                subprocess.run(command + [str(result), str(source)], check=True)
                encoded = result.read_bytes()
                if encoded[:12] != b'\xabKTX 20\xbb\r\n\x1a\n' or struct.unpack_from('<II', encoded, 20) != size[:2]:
                    raise ValueError('KTX dimensions changed')
                atomic(target, encoded)
            count += 1
            print('ENCODED', count, size[:2], 'srgb' if srgb else 'linear', target.name, flush=True)
        # Correct the legacy trial's DFD tag without altering its already encoded
        # blocks: linear data must have unspecified primaries for glTF BasisU.
        encoded = bytearray(target.read_bytes())
        dfd = struct.unpack_from('<I', encoded, 48)[0]
        if not srgb and encoded[dfd + 14] == 1 and encoded[dfd + 13] != 0:
            encoded[dfd + 13] = 0
            atomic(target, encoded)
        validator = args.encoder.with_name('ktx')
        if not validator.is_file():
            raise ValueError('KTX-Software 4.4.2 ktx validator must accompany toktx')
        validation = subprocess.run([str(validator), 'validate'] + ([] if flip else ['--gltf-basisu']) + [str(target)], capture_output=True, text=True)
        if validation.returncode:
            raise ValueError(validation.stdout + validation.stderr)
        return target, {'contentHash': digest(target.read_bytes()), 'sourceHash': digest(data), 'width': size[0], 'height': size[1], 'mips': mip, 'recipe': RECIPE}

    def reference(source, prepared, color, flip=False):
        target, metadata = prepared
        entry = assets.setdefault(source, {'url': url(target), **metadata})
        entry[('color' if color else 'data') + ('Flip' if flip else '') + 'URL'] = url(target)

    def model(path):
        raw = path.read_bytes()
        length = struct.unpack_from('<I', raw, 12)[0]
        doc = json.loads(raw[20:20 + length])
        if not doc.get('images'):
            return
        binary = raw[28 + length:] if len(raw) > 20 + length else b''
        original = copy.deepcopy(doc)
        views = doc.get('bufferViews', [])
        image_views = {image['bufferView'] for image in doc['images'] if 'bufferView' in image}
        # Preserve indices and every non-image byte; vacated image views remain valid padding.
        chunks = bytearray()
        for index, view in enumerate(views):
            offset = view.get('byteOffset', 0)
            data = binary[offset:offset + view['byteLength']]
            if index in image_views:
                data = b'\0' * 4
            chunks.extend(b'\0' * (-len(chunks) % 4))
            view['byteOffset'] = len(chunks)
            view['byteLength'] = len(data)
            chunks.extend(data)
        new_images = []
        image_keys = {}
        texture_keys = {}
        new_textures = []
        target = output / 'models' / (digest(raw + RECIPE.encode()) + '.glb')

        def texture(old_index, srgb):
            key = (old_index, srgb)
            if key in texture_keys:
                return texture_keys[key]
            spec = copy.deepcopy(original['textures'][old_index])
            source_index = spec.get('source', spec.get('extensions', {}).get('KHR_texture_basisu', {}).get('source'))
            image = original['images'][source_index]
            if 'bufferView' in image:
                view = original['bufferViews'][image['bufferView']]
                data = binary[view.get('byteOffset', 0):view.get('byteOffset', 0) + view['byteLength']]
                source_url = None
            else:
                source = (path.parent / image['uri']).resolve()
                if not source.is_relative_to(public):
                    raise ValueError('Image outside public input')
                data = source.read_bytes()
                source_url = url(source)
            sampler = original.get('samplers', [])[spec['sampler']] if 'sampler' in spec else {}
            mip = sampler.get('minFilter', 9987) not in (9728, 9729)
            image_key = (digest(data), srgb, mip)
            if image_key not in image_keys:
                prepared = encode(data, srgb, mip)
                new_image = copy.deepcopy(image)
                new_image.pop('bufferView', None)
                info = dimensions(data)
                if info:
                    new_image.setdefault('extras', {})['lanternRuntime'] = {
                        'contentHash': image_key[0], 'width': info[0], 'height': info[1],
                        'bitDepth': info[2], 'lossless': not bool(prepared), 'mips': mip,
                    }
                if prepared:
                    encoded, metadata = prepared
                    new_image['uri'] = os.path.relpath(encoded, target.parent).replace(os.sep, '/')
                    new_image['mimeType'] = 'image/ktx2'
                    new_image.setdefault('extras', {})['lanternRuntime'] = metadata
                    if source_url:
                        reference(source_url, prepared, srgb)
                elif source_url:
                    new_image['uri'] = os.path.relpath(public / source_url.lstrip('/'), target.parent).replace(os.sep, '/')
                else:
                    new_image.pop('uri', None)
                    new_image['bufferView'] = len(views)
                    chunks.extend(b'\0' * (-len(chunks) % 4))
                    views.append({'buffer': 0, 'byteOffset': len(chunks), 'byteLength': len(data)})
                    chunks.extend(data)
                image_keys[image_key] = len(new_images)
                new_images.append(new_image)
            new_index = image_keys[image_key]
            if new_images[new_index].get('mimeType') == 'image/ktx2':
                spec.pop('source', None)
                spec.setdefault('extensions', {})['KHR_texture_basisu'] = {'source': new_index}
            else:
                spec['source'] = new_index
            texture_keys[key] = len(new_textures)
            new_textures.append(spec)
            return texture_keys[key]

        def visit(value):
            if not isinstance(value, dict):
                return
            for name, child in value.items():
                if isinstance(child, dict) and name.endswith('Texture') and 'index' in child:
                    child['index'] = texture(child['index'], name in ('baseColorTexture', 'emissiveTexture', 'sheenColorTexture', 'specularColorTexture'))
                elif isinstance(child, dict):
                    visit(child)
        for material in doc.get('materials', []):
            visit(material)
        doc['images'] = new_images
        doc['textures'] = new_textures
        if any(image.get('mimeType') == 'image/ktx2' for image in new_images):
            for name in ('extensionsUsed', 'extensionsRequired'):
                doc[name] = list(dict.fromkeys(doc.get(name, []) + ['KHR_texture_basisu']))
        doc['buffers'][0]['byteLength'] = len(chunks)
        doc.setdefault('extras', {})['lanternRuntime'] = {'sourceHash': digest(raw), 'recipe': RECIPE}
        encoded_json = json.dumps(doc, separators=(',', ':')).encode()
        encoded_json += b' ' * (-len(encoded_json) % 4)
        chunks.extend(b'\0' * (-len(chunks) % 4))
        result = struct.pack('<III', 0x46546c67, 2, 28 + len(encoded_json) + len(chunks)) + struct.pack('<II', len(encoded_json), 0x4e4f534a) + encoded_json + struct.pack('<II', len(chunks), 0x004e4942) + chunks
        # Compare the mesh/accessor/animation declarations and non-image buffer payloads.
        for name in ('meshes', 'accessors', 'skins', 'nodes', 'animations'):
            if doc.get(name) != original.get(name):
                raise ValueError(f'Authored {name} changed')
        for index, before in enumerate(original.get('bufferViews', [])):
            if index in image_views:
                continue
            after = views[index]
            if binary[before.get('byteOffset', 0):before.get('byteOffset', 0) + before['byteLength']] != chunks[after['byteOffset']:after['byteOffset'] + after['byteLength']]:
                raise ValueError('Authored binary geometry/animation changed')
        atomic(target, result)
        assets[url(path)] = {'url': url(target), 'sourceHash': digest(raw), 'contentHash': digest(result), 'recipe': RECIPE}
        print('MODEL', url(path), len(raw), '->', len(result), flush=True)

    jobs = json.loads(args.jobs.read_text())
    for entry in jobs:
        path = Path(entry['path'] if isinstance(entry, dict) else entry)
        if path.suffix.lower() == '.glb':
            model(path)
    for entry in jobs:
        if not isinstance(entry, dict):
            continue
        path = Path(entry['path'])
        if path.suffix.lower() != '.png' or entry.get('lossless'):
            continue
        if entry.get('inferred') and url(path) in assets:
            continue  # GLTF-only dependencies already have their declared sampling role.
        for role in ('color', 'data'):
            if not entry.get(role):
                continue
            prepared = encode(path.read_bytes(), role == 'color', True, entry.get('flipY', False))
            if prepared:
                reference(url(path), prepared, role == 'color', entry.get('flipY', False))
    index = {'version': 1, 'encoder': version, 'recipe': RECIPE, 'assets': assets}
    atomic(output / 'index.json', (json.dumps(index, indent=2) + '\n').encode())
    print('READY', len(assets), 'runtime derivatives', flush=True)


if __name__ == '__main__':
    main()
