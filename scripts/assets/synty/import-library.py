"""Private, resumable Synty inventory / Unity metadata / Blender conversion pipeline."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import Counter
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tarfile
import sys

ROOT = Path(__file__).resolve().parents[3]
PRIVATE = ROOT / '.local/synty-library'
OUTPUT = ROOT / 'public/vendor/synty/library'
PORTABLE = {'.fbx', '.obj', '.png', '.tga', '.jpg', '.jpeg'}
METADATA = {'.mat', '.prefab', '.asset', '.txt', '.meta', '.shader', '.shadergraph', '.shadersubgraph', '.terrainlayer'}
PIPELINE_VERSION = 1

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''): h.update(chunk)
    return h.hexdigest()

def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2))
    temporary.replace(path)

def pack_name(name, sample=''):
    s = (name + '/' + sample).lower().replace('_', '').replace(' ', '')
    for needle, pack in [('goblinlocomotion','goblin-locomotion'), ('goblinwarcamp','goblin-war-camp'), ('alpinemountain','alpine-mountain'), ('vikingrealm','viking-realm'), ('particlefx','particle-fx'), ('polygonshops','shops'), ('polygonprototype','prototype'), ('polygongeneric','generic')]:
        if needle in s: return pack
    return 'unidentified'

def is_animation(path):
    p = Path(path)
    return '/animations/' in ('/' + str(p).lower()) or p.name.startswith('A_') or p.suffix.lower() in {'.anim', '.controller', '.playable', '.mask'}

def inventory(downloads, stage, packs):
    entries = []
    for folder in sorted(downloads.iterdir()):
        if folder.name.startswith('.'): continue
        if folder.is_file() and folder.suffix != '.unitypackage': continue
        if folder.is_dir():
            files = sorted(p for p in folder.rglob('*') if p.is_file() and not p.name.startswith('.'))
            hint = ' '.join(str(p.relative_to(folder)) for p in files if p.name.startswith('MaterialList'))
            if folder.name == 'SourceFiles': hint += ' GoblinLocomotion'  # Confirmed Animations/Polygon goblin paths.
            pack = pack_name(folder.name, hint)
            if pack == 'unidentified' or pack not in packs: continue
            origin = 'source' if 'source' in folder.name.lower() else 'godot' if (folder / 'project.godot').exists() else 'unreal'
            for path in files:
                rel = str(path.relative_to(folder))
                entries.append(record(path, folder.name, rel, pack, origin, stage))
        elif folder.suffix == '.unitypackage':
            pack = pack_name(folder.name)
            if pack not in packs:continue
            scratch = PRIVATE / 'archive-members' / folder.stem
            groups = {}
            # Streaming extraction avoids repeated gzip seeks. Never extract arbitrary archive paths.
            with tarfile.open(folder, 'r|gz') as archive:
                for member in archive:
                    parts = PurePosixPath(member.name).parts
                    if not member.isfile() or len(parts) != 2 or parts[1] not in {'pathname', 'asset', 'asset.meta'}: continue
                    guid, kind = parts
                    if len(guid) != 32 or any(c not in '0123456789abcdef' for c in guid): continue
                    data = archive.extractfile(member)
                    group = groups.setdefault(guid, {})
                    if kind == 'pathname': group['path'] = data.read().decode('utf-8', errors='replace')
                    elif stage:
                        target = scratch / guid / kind
                        target.parent.mkdir(parents=True, exist_ok=True)
                        with target.open('wb') as dest: shutil.copyfileobj(data, dest)
                        group[kind] = target
            for guid, group in groups.items():
                rel = group.get('path', '')
                pp = PurePosixPath(rel)
                if not rel or pp.is_absolute() or '..' in pp.parts: continue
                source = group.get('asset')
                # Directory records have no asset payload.
                if not source and stage: continue
                entry = record(source, folder.stem, rel, pack, 'unity', stage, guid)
                entries.append(entry)
                if stage and entry.get('localPath') and group.get('asset.meta'):
                    shutil.copy2(group['asset.meta'], Path(entry['localPath'] + '.meta'))
            if stage: shutil.rmtree(scratch)
    return entries

def record(path, bundle, rel, pack, origin, stage, guid=None):
    ext = Path(rel).suffix.lower()
    excluded = is_animation(rel)
    usable = ext in PORTABLE
    metadata = ext in METADATA
    status = 'excluded' if excluded else 'pending' if usable else 'converted' if metadata else 'unsupported'
    reason = 'Mixamo-only motion policy' if excluded else 'metadata' if metadata else 'engine resource / non-runtime document' if not usable else None
    entry = dict(source=f'{bundle}/{rel}', pack=pack, origin=origin, relativePath=rel, extension=ext, status=status, reason=reason)
    if guid: entry['guid'] = guid
    if path and stage:
        entry['sourceHash'] = digest(path)
        entry['bytes'] = path.stat().st_size
        if usable or metadata or excluded:
            dest = PRIVATE / 'sources' / bundle / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            if not dest.exists() or digest(dest) != entry['sourceHash']: shutil.copy2(path, dest)
            entry['localPath'] = str(dest)
    return entry

def unity_metadata(entries, args):
    bundles = sorted({e['source'].split('/')[0] for e in entries if e['origin'] == 'unity' and e['pack'] in args.packs})
    results = []
    for bundle in bundles:
        fingerprint = hashlib.sha256((digest(ROOT/'scripts/assets/synty/library/ExportMetadata.cs') + ''.join(sorted(e.get('sourceHash','') for e in entries if e['source'].startswith(bundle+'/')))).encode()).hexdigest()
        out = PRIVATE / 'metadata' / (bundle + '.json')
        stamp = out.with_suffix('.stamp')
        if out.exists() and stamp.exists() and stamp.read_text() == fingerprint:
            results.append({**json.loads(out.read_text()),'bundle':bundle}); continue
        project = PRIVATE / 'unity-project'
        assets = project / 'Assets'
        if assets.exists(): shutil.rmtree(assets)
        assets.mkdir(parents=True)
        (project/'ProjectSettings').mkdir(exist_ok=True)
        (project/'ProjectSettings/ProjectVersion.txt').write_text('m_EditorVersion: '+args.unity_version+'\n')
        (project/'Packages').mkdir(exist_ok=True)
        save(project/'Packages/manifest.json', {'dependencies':{'com.unity.modules.animation':'1.0.0','com.unity.modules.physics':'1.0.0','com.unity.modules.particlesystem':'1.0.0','com.unity.modules.imageconversion':'1.0.0','com.unity.modules.terrain':'1.0.0','com.unity.modules.terrainphysics':'1.0.0'}})
        # Only data assets enter the project. Downloaded code and shader graphs stay archived privately.
        allowed = {'.fbx','.obj','.png','.tga','.jpg','.jpeg','.mat','.prefab','.asset'}
        for e in entries:
            if not e['source'].startswith(bundle+'/') or e['extension'] not in allowed or e['status'] == 'excluded': continue
            local = Path(e['localPath'])
            rel = PurePosixPath(e['relativePath'])
            if rel.parts[0] != 'Assets': continue
            target = project / str(rel)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(local,target)
            if target.suffix=='.asset':
                data=target.read_bytes()
                if data.startswith(b'%YAML'):target.write_bytes(data.replace(b'm_IsReadable: 0',b'm_IsReadable: 1'))
            meta = Path(str(local)+'.meta')
            if meta.exists():
                text=meta.read_text()
                if target.suffix.lower() in {'.fbx','.obj'}: text=text.replace('isReadable: 0','isReadable: 1')
                Path(str(target)+'.meta').write_text(text)
        editor = assets/'Editor'; editor.mkdir()
        shutil.copy2(ROOT/'scripts/assets/synty/library/ExportMetadata.cs',editor/'ExportMetadata.cs')
        out.parent.mkdir(parents=True,exist_ok=True)
        env = {**os.environ, 'LANTERN_METADATA_OUTPUT':str(out)}
        log = PRIVATE/'logs'/(bundle+'-unity.log'); log.parent.mkdir(exist_ok=True)
        print('Unity metadata:',bundle,flush=True)
        result = subprocess.run([args.unity_cli,'run',str(project),'--editor-version',args.unity_version,'--timeout','900','--','-nographics','-executeMethod','LanternMetadata.Export','-logFile',str(log)],env=env)
        if result.returncode or not out.exists(): raise RuntimeError(f'Unity metadata failed: {bundle}; inspect {log}')
        stamp.write_text(fingerprint)
        results.append({**json.loads(out.read_text()),'bundle':bundle})
    return results

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--downloads',type=Path,default=Path.home()/'Downloads')
    parser.add_argument('--blender',default='/Applications/Blender.app/Contents/MacOS/Blender')
    parser.add_argument('--unity-cli',default='unity')
    parser.add_argument('--unity-version',default='6000.6.2f1')
    parser.add_argument('--pack',action='append',default=[])
    parser.add_argument('--jobs',type=int,default=2)
    parser.add_argument('--dry-run',action='store_true')
    parser.add_argument('--inventory-only',action='store_true')
    parser.add_argument('--reuse-inventory',action='store_true',help='Reuse the last staged snapshot without rescanning Downloads')
    parser.add_argument('--limit',type=int,help='Representative conversion only; report remains incomplete')
    args = parser.parse_args()
    if not 1 <= args.jobs <= 4: parser.error('--jobs must be between 1 and 4')
    if args.limit is not None and args.limit < 1: parser.error('--limit must be positive')
    args.packs = set(args.pack) or {'generic','goblin-war-camp','alpine-mountain','viking-realm','particle-fx','shops','prototype','goblin-locomotion'}
    if args.reuse_inventory and (not (PRIVATE / 'inventory.json').is_file() or not (PRIVATE / 'sources').is_dir()):
        raise SystemExit('Working Synty sources unavailable; run npm run agent:sources -- --sources synty-library before --reuse-inventory.')
    print('Inventorying',args.downloads,flush=True)
    entries = json.loads((PRIVATE/'inventory.json').read_text()) if args.reuse_inventory else inventory(args.downloads,not args.dry_run,args.packs)
    entries = [e for e in entries if e['pack'] in args.packs]
    print('Inventory:',dict(Counter(e['pack'] for e in entries)),flush=True)
    if args.dry_run:
        print('Statuses:',dict(Counter(e['status'] for e in entries))); return
    if not args.reuse_inventory: save(PRIVATE/'inventory.json',entries)
    if args.inventory_only: return
    metadata = unity_metadata(entries,args)
    save(PRIVATE/'metadata.json',metadata)
    from importlib.machinery import SourceFileLoader
    prepare = SourceFileLoader('prepare',str(ROOT/'scripts/assets/synty/library/prepare.py')).load_module()
    jobs, catalog = prepare.prepare(entries,metadata,OUTPUT,PRIVATE,PIPELINE_VERSION)
    if args.limit: jobs=[j for j in jobs if j['kind']=='texture'] + [j for j in jobs if j['kind']=='model'][:args.limit]
    print(f'Converting {len(jobs)} assets with {args.jobs} workers',flush=True)
    def run_batch(batch):
        log = PRIVATE/'logs'/('batch-'+hashlib.sha256(batch[0]['id'].encode()).hexdigest()[:20]+'.log')
        request = PRIVATE/'requests'/(log.stem+'.json'); save(request,batch)
        with log.open('w') as stream:
            for backend in ['three','blender']:
                partition=[j for j in batch if j.get('backend','blender')==backend]
                if not partition:continue
                save(request,partition)
                command=['node',str(ROOT/'scripts/assets/synty/library/convert-ascii.mjs'),str(request)] if backend=='three' else [args.blender,'-b','--factory-startup','--python',str(ROOT/'scripts/assets/synty/library/convert.py'),'--',str(request)]
                subprocess.run(command,stdout=stream,stderr=subprocess.STDOUT)
        results=[]
        for job in batch:
            path=Path(job['result'])
            result=json.loads(path.read_text()) if path.exists() else dict(status='failed',reason=f'Blender worker failed; {log}')
            if result.get('fingerprint') != job['fingerprint']: result=dict(status='failed',reason=f'Worker did not produce current result; {log}')
            results.append((job['id'],result))
        return results
    for kind in ['texture','model']:
        selected=[job for job in jobs if job['kind']==kind]
        batches=[selected[i:i+32] for i in range(0,len(selected),32)]
        done=0
        with ThreadPoolExecutor(max_workers=args.jobs) as pool:
            futures=[pool.submit(run_batch,batch) for batch in batches]
            for future in as_completed(futures):
                for ident,result in future.result():
                    catalog['assets'][ident].update(result)
                    if result['status']=='failed': print(f'{ident}: {result.get("reason")}',flush=True)
                    done+=1
                print(f'{kind} {done}/{len(selected)}',flush=True)
    prepare.finish(entries,catalog,OUTPUT,PRIVATE)
    failures=[a for a in catalog['assets'].values() if a['status']=='failed']
    pending=[a for a in catalog['assets'].values() if a['status']=='pending']
    print(f'Library: {len(catalog["assets"])} entries; {len(failures)} failed; {len(pending)} pending',flush=True)
    if failures or pending: raise SystemExit(1)

if __name__ == '__main__':
    if '--dry-run' in sys.argv: main()
    else:
        import fcntl
        PRIVATE.mkdir(parents=True,exist_ok=True)
        with (PRIVATE/'import.lock').open('w') as lock:
            try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            except BlockingIOError: raise SystemExit('Another Synty import owns this workspace; wait for it to finish.')
            main()
