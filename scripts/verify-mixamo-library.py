"""Check that the local Mixamo collection covers its reconciled live catalog."""
import argparse
import hashlib
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--complete', action='store_true', help='Require all source assets and verify SHA-256 hashes')
args = parser.parse_args()
repo = Path(__file__).resolve().parents[1]
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
    'errors': state['errors'],
}
print(json.dumps(report, indent=2))
if args.complete:
    if missing: print('Missing IDs:', ', '.join(missing[:12]))
    if bad: print('Invalid IDs:', ', '.join(bad[:12]))
    if not expected or missing or bad or state['errors']: raise SystemExit(1)
