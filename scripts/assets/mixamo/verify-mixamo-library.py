"""Check that the local Mixamo collection covers its reconciled live catalog."""
import argparse
import hashlib
import json
import struct
from pathlib import Path


def fbx_time_mode(path):
    """Read the exported FBX clock without importing Blender or loading geometry."""
    with path.open('rb') as source:
        if source.read(23) != b'Kaydara FBX Binary  \x00\x1a\x00':
            raise ValueError('Expected binary FBX')
        version = struct.unpack('<I', source.read(4))[0]
        header = '<QQQB' if version >= 7500 else '<IIIB'
        header_size = struct.calcsize(header)

        def nodes(end, settings=False):
            while source.tell() < end:
                raw = source.read(header_size)
                if len(raw) != header_size or not any(raw): return None
                stop, count, length, name_length = struct.unpack(header, raw)
                name = source.read(name_length)
                props_start = source.tell()
                if settings and name == b'P':
                    props = []
                    for _ in range(count):
                        kind = source.read(1)
                        if kind in (b'S', b'R'):
                            size = struct.unpack('<I', source.read(4))[0]
                            props.append(source.read(size))
                        else:
                            fmt = {b'Y': '<h', b'C': '<?', b'I': '<i', b'F': '<f', b'D': '<d', b'L': '<q'}[kind]
                            props.append(struct.unpack(fmt, source.read(struct.calcsize(fmt)))[0])
                    if props[0] == b'TimeMode': return props[-1]
                source.seek(props_start + length)
                if settings or name == b'GlobalSettings':
                    mode = nodes(stop, True)
                    if mode is not None: return mode
                source.seek(stop)
            return None

        return nodes(path.stat().st_size)


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--complete', action='store_true', help='Require all source assets and verify SHA-256 hashes')
parser.add_argument('--fps', type=int, choices=[30, 60], help='Require this exported motion clock')
args = parser.parse_args()
repo = Path(__file__).resolve().parents[3]
root = repo / '.local/animation-packs/mixamo/Library'
if not (root / 'download-state.json').is_file(): parser.exit(1, 'Mixamo collection unavailable; run assets:download-mixamo first.\n')
state = json.loads((root / 'download-state.json').read_text())
catalog = state['catalog']
expected = {'Motion:' + str(m['id']) for m in catalog.get('motions', []) + catalog.get('packMotions', [])}
expected.update('Character:' + str(c['id']) for c in catalog.get('characters', []))
completed = state['completed']
missing = sorted(expected - set(completed))
bad = []
for key in expected.intersection(completed):
    record = completed[key]
    path = Path(record['file'])
    if not path.is_absolute(): path = repo / path
    if not path.is_file() or path.stat().st_size != record['bytes']:
        bad.append(key)
    elif args.fps and key.startswith('Motion:') and (record.get('fps') != args.fps or fbx_time_mode(path) != {30: 6, 60: 3}[args.fps]):
        bad.append(key)
    elif args.complete and hashlib.sha256(path.read_bytes()).hexdigest() != record['sha256']:
        bad.append(key)
report = {
    'individualMotions': len(catalog.get('motions', [])),
    'motionPacks': len(catalog.get('packs', [])),
    'packMembers': len(catalog.get('packMotions', [])),
    'characters': len(catalog.get('characters', [])),
    'expectedAssets': len(expected),
    'savedAssets': len(expected.intersection(completed)),
    'missingCount': len(missing),
    'invalidCount': len(bad),
    'requiredMotionFps': args.fps,
    'errors': state['errors'],
}
print(json.dumps(report, indent=2))
if args.complete:
    if missing: print('Missing IDs:', ', '.join(missing[:12]))
    if bad: print('Invalid IDs:', ', '.join(bad[:12]))
    if not expected or missing or bad or state['errors']: raise SystemExit(1)
elif args.fps and bad:
    raise SystemExit(1)
