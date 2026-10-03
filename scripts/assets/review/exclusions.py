"""Completed asset deletions exclude preparation; private sources remain untouched."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
path = ROOT / 'assets/asset-reviews.json'
records = json.loads(path.read_text()) if path.exists() else {'version': 1, 'deleted': {}}
if records.get('version') != 1 or not isinstance(records.get('deleted'), dict):
    raise ValueError('Invalid asset deletion exclusions')


def excluded(family_id, url, appearance='original'):
    return any(row['url'] == url or identity == family_id + '@' + appearance
               for identity, row in records['deleted'].items())


def excluded_path(path):
    try:
        url = '/' + str(Path(path).relative_to(ROOT / 'public'))
    except ValueError:
        return False
    return excluded('', url)
