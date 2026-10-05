"""Export five private Synty particle recipes for the development animation lab.

Requires PyYAML. Preserves vendor art privately; never executes vendor scripts.
"""
import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[3]
NAMES = ['SwordSlash', 'Slash_Large', 'Sparks', 'Impact_Small', 'Impact_Large']
MODULES = ['InitialModule', 'ShapeModule', 'EmissionModule', 'ColorModule', 'SizeModule', 'RotationModule', 'UVModule']


def unity(path):
    text = re.sub(r'^%.*\n', '', path.read_text(), flags=re.M)
    text = re.sub(r'--- !u!\d+ &(-?\d+)', r'---\n__id: \1', text)
    return list(yaml.safe_load_all(text))


def main():
    argparse.ArgumentParser(description=__doc__).parse_args()
    inventory_path = ROOT / '.local/synty-library/inventory.json'
    if not inventory_path.is_file() or not (ROOT / '.local/synty-library/sources').is_dir():
        raise SystemExit('Working Synty sources unavailable; run npm run agent:sources -- --sources synty-library in the owned task.')
    inventory = json.loads(inventory_path.read_text())
    by_guid = {x['guid']: x for x in inventory if x.get('guid')}
    catalog = json.loads((ROOT / 'public/vendor/synty/library/catalog.json').read_text())['assets']
    output = ROOT / 'public/vendor/synty/particle-study'
    output.mkdir(parents=True, exist_ok=True)
    dependencies = {}

    def source(row):
        return ROOT / '.local/synty-library/sources' / row['source']

    def copy(path):
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        name = digest[:20] + path.suffix
        shutil.copyfile(path, output / name)
        dependencies[name] = digest
        return '/vendor/synty/particle-study/' + name

    def material(guid):
        row = by_guid[guid]
        mat = unity(source(row))[0]['Material']['m_SavedProperties']
        floats = {k: v for item in mat['m_Floats'] for k, v in item.items()}
        colors = {k: v for item in mat['m_Colors'] for k, v in item.items()}
        tex = next((item['_MainTex'] for item in mat['m_TexEnvs'] if '_MainTex' in item), None)
        return {'color': colors.get('_Color', colors.get('_TintColor')), 'emissive': colors.get('_EmissionColor'),
                'alphaTest': floats.get('_Cutoff', 0) if floats.get('_Mode') == 1 else 0,
                'additive': floats.get('_DstBlend') == 1, 'lit': floats.get('_LightingEnabled', 1) == 1,
                'texture': copy(source(by_guid[tex['m_Texture']['guid']])) if tex and tex['m_Texture'].get('guid') else None}

    recipes = []
    for name in NAMES:
        row = next(x for x in inventory if x.get('pack') == 'particle-fx' and x['relativePath'].endswith('/FX_' + name + '_01.prefab'))
        docs = unity(source(row))
        gos = {d['__id']: d['GameObject'] for d in docs if 'GameObject' in d}
        transforms = {d['__id']: d['Transform'] for d in docs if 'Transform' in d}
        renderers = {d['ParticleSystemRenderer']['m_GameObject']['fileID']: d['ParticleSystemRenderer'] for d in docs if 'ParticleSystemRenderer' in d}
        emitters = []
        warnings = {'Cross-engine shader/lighting and random sequence differ; this is a source-derived study, not Unity pixel parity.'}
        for doc in docs:
            if 'ParticleSystem' not in doc:
                continue
            ps = doc['ParticleSystem']
            go = ps['m_GameObject']['fileID']
            renderer = renderers[go]
            if not gos[go]['m_IsActive'] or not renderer['m_Enabled']:
                continue
            t = next(t for t in transforms.values() if t['m_GameObject']['fileID'] == go)
            chain = []
            while t:
                chain.insert(0, {'position': t['m_LocalPosition'], 'rotation': t['m_LocalRotation'], 'scale': t['m_LocalScale']})
                t = transforms.get(t['m_Father']['fileID'])
            mesh = renderer.get('m_Mesh', {})
            mesh_url = None
            if mesh.get('guid'):
                entry = next(v for k, v in catalog.items() if v['kind'] == 'mesh' and mesh['guid'] in k and v['status'] == 'converted')
                mesh_url = copy(ROOT / 'public' / entry['url'].lstrip('/'))
            active = [k for k, v in ps.items() if isinstance(v, dict) and v.get('enabled') and k.endswith('Module') and k not in MODULES]
            for mod in active:
                warnings.add('Not reproduced: ' + mod + '.')
            if renderer['m_RenderMode'] == 1:
                warnings.add('Stretched billboards use source length/velocity proportions with camera-facing orientation.')
            if ps['EmissionModule']['rateOverTime']['scalar']:
                warnings.add('Continuous emission is bounded to one source-duration burst for replay.')
            emitters.append({'name': gos[go]['m_Name'], 'transforms': chain, 'delay': ps['startDelay'],
                             'duration': ps['lengthInSec'], 'modules': {k: ps[k] for k in MODULES},
                             'renderMode': renderer['m_RenderMode'], 'alignment': renderer['m_RenderAlignment'],
                             'lengthScale': renderer['m_LengthScale'], 'velocityScale': renderer['m_VelocityScale'],
                             'mesh': mesh_url, 'material': material(next(m['guid'] for m in renderer['m_Materials'] if m.get('guid')))})
        recipes.append({'id': name, 'name': 'Synty ' + name.replace('_', ' '), 'sourceHash': row['sourceHash'], 'emitters': emitters, 'warnings': sorted(warnings)})
        print(f"Prepared {name}: {len(emitters)} emitters", flush=True)
    (output / 'recipes.json').write_text(json.dumps({'version': 1, 'recipes': recipes, 'dependencies': dependencies}, indent=2) + '\n')
    # Production rain references only the adopted dust and spark art, not the study catalog.
    rain = []
    for recipe in recipes:
        selected = [e for e in recipe['emitters'] if recipe['id'] == 'Impact_Small' and 'Dust' in e['name'] or recipe['id'] == 'SwordSlash' and e['mesh']]
        if selected:
            rain.append({'id': recipe['id'], 'sourceHash': recipe['sourceHash'], 'emitters': [{'name': e['name'], 'mesh': e['mesh'], 'material': {'texture': e['material']['texture']}} for e in selected[:1]]})
    production = ROOT / 'public/vendor/synty/ability-effects'
    production.mkdir(parents=True, exist_ok=True)
    (production / 'arrow-rain.json').write_text(json.dumps({'version': 1, 'recipes': rain}, indent=2) + '\n')



if __name__ == '__main__':
    main()
