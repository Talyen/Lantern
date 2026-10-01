"""Verify coverage, catalog closure and every GLB's geometry / external image references."""
import json
import struct
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[4]
BASE=ROOT/'public/vendor/synty/library'
if not (BASE/'catalog.json').is_file():
    sys.exit('Synty library unavailable; run assets:import-library first.')
catalog=json.loads((BASE/'catalog.json').read_text())
errors=[];warnings=0
for ident,asset in catalog['assets'].items():
    if asset['status']=='unsupported':continue
    if asset['status']!='converted':errors.append(ident+': '+asset['status']);continue
    warnings+=len(asset.get('warnings',[]))
    for dependency in asset['dependencies']:
        if dependency not in catalog['assets'] or catalog['assets'][dependency]['status']!='converted':errors.append(ident+': unresolved dependency '+dependency)
    path=BASE/asset['url'].removeprefix('/vendor/synty/library/')
    if not path.is_file():errors.append(ident+': missing output');continue
    if path.suffix=='.glb':
        content=path.read_bytes()
        if len(content)<20 or struct.unpack_from('<III',content)!= (0x46546c67,2,len(content)):errors.append(ident+': malformed GLB');continue
        size,kind=struct.unpack_from('<II',content,12)
        data=json.loads(content[20:20+size])
        if kind!=0x4e4f534a:errors.append(ident+': no JSON chunk')
        for image in data.get('images',[]):
            if image.get('uri') and not (path.parent/image['uri']).is_file():errors.append(ident+': missing texture '+image['uri'])
        for mesh in data.get('meshes',[]):
            for primitive in mesh['primitives']:
                if 'POSITION' not in primitive['attributes']:errors.append(ident+': no vertex positions')
coverage=json.loads((ROOT/'.local/synty-library/coverage.json').read_text())
if not coverage['complete'] or not catalog['complete']:errors.append('Coverage is incomplete')
print(f'{len(catalog["assets"])} catalog assets; {warnings} reported material/component approximations; {len(errors)} verification failures')
for error in errors[:30]:print(error)
sys.exit(bool(errors))
