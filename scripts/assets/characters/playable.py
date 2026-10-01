"""Prepare Paladin and Goblin gameplay assets using the canonical Mixamo baker; sources stay private."""
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
CHARACTERS = {
    'paladin': ('mixamo-eface83a-acc0-4036-a15e-3c650df1510d', {
        'idle': 'sword and shield idle', 'run': 'sword and shield run', 'attack': 'sword and shield slash', 'hit': 'sword and shield impact', 'death': 'sword and shield death', 'dodge': 'Dive Roll',
    }, ['sword and shield block idle', 'sword and shield attack', 'sword and shield slash (2)', 'sword and shield run (2)']),
    'goblin': ('mixamo-130a335c-bbdb-492f-971f-8faab0616b6e', {
        'idle': 'Orc Idle', 'run': 'Running', 'attack': 'standing melee attack horizontal', 'hit': 'Hit Reaction', 'death': 'Dying',
    }, ['Standing Melee Attack Horizontal', 'Run']),
}


def export(name, identity, defaults, alternatives, motions_only=False):
    output = ROOT / 'public/vendor/characters' / name
    output.mkdir(parents=True, exist_ok=True)
    metadata = ROOT / '.local/animation-packs/mixamo/Library/Characters' / identity.removeprefix('mixamo-') / 'asset.json'
    source = json.loads(metadata.read_text())
    row = {'id': identity, 'name': source['name'], 'family': 'Mixamo', 'source': str(ROOT / source['file']), 'sourceHash': source['sha256']}
    rig, error = gallery.prepare(row)
    if error:
        raise RuntimeError(error)
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
            identity = hashlib.sha256((str(relative) + ':' + title).encode()).hexdigest()[:12]
            clips.append({'id': identity, 'name': title, 'category': gallery.baker.category(title), 'source': str(path.relative_to(source_root)), 'description': record.get('description', ''), 'sourceHash': hashlib.sha256(path.read_bytes()).hexdigest()})
        gallery.write_json(source_index, {'version': 1, 'packs': [{'id': 'mixamo', 'label': 'Mixamo', 'license': 'Mixamo terms', 'url': 'https://www.mixamo.com/', 'clips': clips}]})
    source_catalog = json.loads(source_index.read_text())
    source_pack = next(p for p in source_catalog['packs'] if p['id'] == 'mixamo')
    wanted = list(dict.fromkeys([*defaults.values(), *alternatives]))
    clips = [next(c for c in source_pack['clips'] if c['name'] == title) for title in wanted]
    results = []
    for index, clip in enumerate(clips):
        destination = output / 'motions' / f"{clip['id']}.glb"
        record = destination.with_suffix('.json')
        # Dodge trims the observed idle lead-in and tail (source is 3.933 seconds).
        trim = [0.65, 3.65] if name == 'paladin' and clip['name'] == defaults.get('dodge') else None
        signature_parts = [row['sourceHash'], clip['sourceHash'], 2]
        if trim: signature_parts.append(trim)
        signature = hashlib.sha256(json.dumps(signature_parts, sort_keys=True).encode()).hexdigest()
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
                meta = gallery.baker.bake(rig, source, action, clip['name'], destination, mapping=mapping, sample_range=sample_range)
                gallery.write_json(record, {'signature': signature, **meta})
            finally:
                for obj in list(bpy.data.objects):
                    if obj not in target_objects:
                        bpy.data.objects.remove(obj, do_unlink=True)
                gallery.reset_rig(rig)
        baked = json.loads(record.read_text())
        results.append({**clip, **{key: baked[key] for key in ['duration', 'mappedBones', 'bakeVersion']}, 'url': f"/vendor/characters/{name}/motions/{clip['id']}.glb"})
        print(f"{name.upper()} {index + 1}/{len(clips)}: {clip['name']}", flush=True)
    expected = {clip['id'] for clip in results}
    for cached in (output / 'motions').iterdir():
        if cached.suffix in ['.glb', '.json'] and cached.stem not in expected:
            cached.unlink()
    gallery.write_json(output / 'catalog.json', {'version': 1, 'character': f'/vendor/characters/{name}/authored.glb', 'characterLabel': row['name'], 'motion': 'In place · Mixamo motions baked to this character', 'defaults': defaults, 'packs': [{**source_pack, 'label': 'Mixamo', 'clips': results}]})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--player-only', action='store_true')
    parser.add_argument('--motions-only', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    for name, (identity, defaults, alternatives) in CHARACTERS.items():
        if args.player_only and name != 'paladin': continue
        export(name, identity, defaults, alternatives, args.motions_only)


if __name__ == '__main__':
    main()
