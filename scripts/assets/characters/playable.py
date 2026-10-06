"""Prepare gameplay character assets using the canonical Mixamo baker; sources stay private."""
import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path
import bpy

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('gallery', Path(__file__).with_name('export.py'))
gallery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gallery)
MANIFEST = json.loads((ROOT / 'assets/motion-profiles.json').read_text())
CHARACTERS = json.loads((ROOT / 'assets/playable-characters.json').read_text())


def export(name, character, config, motions_only=False):
    identity = character['sourceId']
    defaults = config["defaults"]
    output = ROOT / 'public/vendor/characters' / name
    output.mkdir(parents=True, exist_ok=True)
    if character.get('source'):
        source = ROOT / character['source']
        row = {'id': identity, 'name': character['name'], 'family': 'Owner supplied', 'source': str(source), 'sourceHash': hashlib.sha256(source.read_bytes()).hexdigest()}
    elif identity.startswith('synty-'):
        row = next(row for row in gallery.roster() if row['id'] == identity)
    else:
        metadata = ROOT / '.local/animation-packs/mixamo/Library/Characters' / identity.removeprefix('mixamo-') / 'asset.json'
        source = json.loads(metadata.read_text())
        row = {'id': identity, 'name': source['name'], 'family': 'Mixamo', 'source': str(ROOT / source['file']), 'sourceHash': source['sha256']}
    rig, error = gallery.prepare(row, max_texture_size=None)
    if error:
        raise RuntimeError(error)
    if identity == 'mixamo-d0496a75-08b9-4f4e-9f1d-f65820323cc2':
        quiver_spec = importlib.util.spec_from_file_location('erika', Path(__file__).with_name('erika.py'))
        erika = importlib.util.module_from_spec(quiver_spec)
        quiver_spec.loader.exec_module(erika)
        erika.separate_quiver(rig)
    model = output / 'authored.glb'
    if not motions_only:
        bpy.ops.export_scene.gltf(filepath=str(model), export_format='GLB', export_animations=False)
    target_objects = set(bpy.data.objects)
    source_index = ROOT / '.local/animation-packs/mixamo/converted-source-catalog.json'
    if not source_index.exists():
        # Fresh preparation indexes original FBX files; it never needs retired Viking GLBs.
        source_root = ROOT / '.local/animation-packs'
        clips = []
        for path in sorted((source_root / 'mixamo').rglob('*.fbx')):
            relative = path.relative_to(source_root / 'mixamo')
            if {'Characters', 'Archives'}.intersection(relative.parts):
                continue
            metadata = path.parent / 'asset.json'
            record = json.loads(metadata.read_text()) if metadata.exists() else {}
            title = record.get('name', path.stem)
            clip_identity = hashlib.sha256((str(relative) + ':' + title).encode()).hexdigest()[:12]
            clip = {'id': clip_identity, 'name': title, 'category': gallery.baker.category(title), 'source': str(path.relative_to(source_root)), 'description': record.get('description', ''), 'sourceHash': hashlib.sha256(path.read_bytes()).hexdigest()}
            clips.append(clip)
            # Acquisition preserves older pack IDs beside the canonical source.
            for alias in record.get('aliases', []):
                clips.append({**clip, **{key: alias[key] for key in ('id', 'name', 'category', 'description')}})
        gallery.write_json(source_index, {'version': 1, 'packs': [{'id': 'mixamo', 'label': 'Mixamo', 'license': 'Mixamo terms', 'url': 'https://www.mixamo.com/', 'clips': clips}]})
    source_catalog = json.loads(source_index.read_text())
    source_pack = next(p for p in source_catalog['packs'] if p['id'] == 'mixamo')
    wanted = list(dict.fromkeys(role for profile in config['profiles'].values() for role in profile.values())) + config.get('audit', []) + config.get('comparison', [])
    results = []
    by_id = {clip['id']: clip for clip in source_pack['clips']}
    preparation_hash = hashlib.sha256(Path(__file__).read_bytes() + Path(__file__).with_name('export.py').read_bytes()).hexdigest()
    baker_hash = hashlib.sha256((ROOT / 'scripts/assets/mixamo/baker.py').read_bytes()).hexdigest()
    for index, key in enumerate(wanted):
        recipe = MANIFEST['clips'][key]
        clip = by_id[recipe['sourceId']]
        source_path = ROOT / '.local/animation-packs' / clip['source']
        if hashlib.sha256(source_path.read_bytes()).hexdigest() != clip['sourceHash']:
            raise RuntimeError(f"Source changed: {recipe['sourceId']}")
        destination = output / 'motions' / f"{key}.glb"
        record = destination.with_suffix('.json')
        trim = recipe.get('trim')
        signature = hashlib.sha256(json.dumps([row['sourceHash'], preparation_hash, clip['sourceHash'], baker_hash, recipe], sort_keys=True).encode()).hexdigest()
        cached = json.loads(record.read_text()) if record.exists() else {}
        if not destination.exists() or cached.get('signature') != signature:
            destination.parent.mkdir(exist_ok=True)
            try:
                bpy.ops.import_scene.fbx(filepath=str(ROOT / '.local/animation-packs' / clip['source']), use_anim=True)
                source = next(o for o in bpy.data.objects if o not in target_objects and o.type == 'ARMATURE')
                action = source.animation_data.action
                if action is None:
                    raise RuntimeError(f"No animation in {clip['source']}")
                mapping = {name: bone for name, bone in gallery.baker.bone_map(source).items() if name in rig.data.bones}
                fps = bpy.context.scene.render.fps / bpy.context.scene.render.fps_base
                sample_range = tuple(action.frame_range[0] + time * fps for time in trim) if trim else None
                if sample_range and (sample_range[0] < action.frame_range[0] or sample_range[1] > action.frame_range[1]):
                    raise RuntimeError(f'Invalid trim for {key}: {trim}')
                meta = gallery.baker.bake(rig, source, action, clip['name'], destination, mapping=mapping, sample_range=sample_range, output_duration=recipe.get('duration'))
                gallery.write_json(record, {'signature': signature, **meta})
            finally:
                for obj in list(bpy.data.objects):
                    if obj not in target_objects:
                        bpy.data.objects.remove(obj, do_unlink=True)
                gallery.reset_rig(rig)
        baked = json.loads(record.read_text())
        results.append({**clip, **baked, 'id': key, 'sourceId': recipe['sourceId'], 'name': recipe['name'], 'category': recipe['category'], 'contact': recipe.get('contact'), 'contacts': recipe.get('contacts'), 'speed': (sum(v*v for v in baked.get('rootVelocity',[0,0])) ** .5 or recipe.get('speed')) if recipe.get('speed') else None, 'audit': recipe.get('audit',False), 'url': f'/vendor/characters/{name}/motions/{key}.glb'})
        print(f"{name.upper()} {index + 1}/{len(wanted)}: {key}", flush=True)
    expected = {clip['id'] for clip in results}
    for cached in (output / 'motions').iterdir():
        if cached.suffix in ['.glb', '.json'] and cached.stem not in expected:
            cached.unlink()
    gallery.write_json(output / 'study.json', {'version': 1, 'clips': [clip for clip in results if clip['category'] == 'study']})
    results = [clip for clip in results if clip['category'] != 'study']
    gallery.write_json(output / 'catalog.json', {'version': 1, 'character': f'/vendor/characters/{name}/authored.glb', 'characterLabel': row['name'], 'motion': 'In place · Mixamo motions baked to this character', 'defaults': defaults, 'profiles': config['profiles'], 'packs': [{**source_pack, 'label': 'Mixamo', 'clips': results}]})


def main():
    parser = argparse.ArgumentParser()
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument('--skeleton-only', action='store_true')
    selection.add_argument('--player-only', action='store_true')
    parser.add_argument('--motions-only', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    for role, character in CHARACTERS.items():
        if args.player_only and role != 'player': continue
        if args.skeleton_only and role != 'skeleton': continue
        if gallery.exclusions.excluded('character:' + character['sourceId'], character['model'], 'gameplay'):continue
        export(Path(character['model']).parent.name, character, MANIFEST[role], args.motions_only)


if __name__ == '__main__':
    main()
