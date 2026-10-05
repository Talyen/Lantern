"""Collect Safari's Mixamo export receipts and save every source asset locally.

Adobe authentication stays in Safari. Only asset export URLs and public catalog
metadata enter these receipts. Downloaded FBXs, ZIPs and progress stay ignored.
"""
import argparse
import concurrent.futures
import hashlib
import json
import re
import shutil
import threading
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
ROOT = REPO / '.local/animation-packs/mixamo/Library'
STATE = {'completed': {}, 'errors': {}, 'catalog': {}}
LOCK = threading.Lock()


def save():
    path = ROOT / 'download-state.json'
    partial = path.with_suffix('.partial')
    partial.write_text(json.dumps(STATE, indent=2) + '\n')
    partial.replace(path)


def process(receipt):
    data = json.loads(receipt.read_text())
    if data.get('session') != 'lantern-mixamo-full-library-v3-60fps': return
    path, body = data['path'], data['body']
    if path == '/catalog':
        with LOCK: STATE['catalog'] = body; save()
        print(f"CATALOG: {len(body.get('motions', []))} motions; {len(body.get('characters', []))} characters", flush=True)
    elif path == '/error':
        with LOCK: STATE['errors'][str(body['key'])] = str(body['error'])[:500]; save()
        print(f"EXPORT ERROR {body['key']}: {str(body['error'])[:120]}", flush=True)
    elif path in ['/asset', '/batch']:
        key = str(body['key'])
        if not re.fullmatch(r'(Motion|Character|MotionPack):[\w-]+', key): raise ValueError('Invalid asset ID')
        with LOCK:
            if key in STATE['completed'] and (key.startswith('Character:') or STATE['completed'][key].get('fps') == body.get('fps')):
                receipt.unlink()
                return
        kind, identity = key.split(':', 1)
        url = urllib.parse.urlparse(body['url'])
        host = url.hostname or ''
        if url.scheme != 'https' or not (host.endswith('.amazonaws.com') or host.endswith('.cloudfront.net') or host.endswith('.adobe.io')):
            raise ValueError('Expected an Adobe asset download host')
        destination = ROOT / ({'Motion':'Animations','Character':'Characters','MotionPack':'Archives'}[kind]) / identity
        destination.mkdir(parents=True, exist_ok=True)
        partial = destination / 'download.partial'
        archive_file = destination / 'source.zip'
        binary_file = destination / 'source.fbx'
        cached = json.loads((destination / 'asset.json').read_text()) if (destination / 'asset.json').exists() else {}
        reusable = kind == 'Character' or cached.get('fps') == body.get('fps')
        if reusable and archive_file.exists() and zipfile.is_zipfile(archive_file):
            file = archive_file
            archive = True
        elif reusable and binary_file.exists():
            file = binary_file
            archive = False
        else:
            with urllib.request.urlopen(body['url'], timeout=180) as response, partial.open('wb') as out:
                shutil.copyfileobj(response, out, 1024 * 1024)
            archive = zipfile.is_zipfile(partial)
            with partial.open('rb') as f: signature = f.read(64)
            if not archive and not signature.startswith(b'Kaydara FBX Binary'):
                raise ValueError('Expected FBX or ZIP data')
            file = archive_file if archive else binary_file
            partial.replace(file)
        if archive:
            with zipfile.ZipFile(file) as source:
                for entry in source.infolist():
                    dest = destination / 'extracted' / entry.filename
                    if destination.resolve() not in dest.resolve().parents: raise ValueError('Unsafe ZIP path')
                    if (entry.external_attr >> 16) & 0o170000 == 0o120000: raise ValueError('ZIP symlink not allowed')
                source.extractall(destination / 'extracted')
        metadata = {k: v for k, v in body.items() if k != 'url'}
        metadata.update({'file': str(file.relative_to(REPO)), 'bytes': file.stat().st_size, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest()})
        (destination / 'asset.json').write_text(json.dumps(metadata, indent=2) + '\n')
        records = {key: metadata}
        if path == '/batch':
            fbx_files = list((destination / 'extracted').rglob('*.fbx'))
            for motion in body['motions']:
                mid = str(motion['id'])
                matches = [f for f in fbx_files if f.stem == mid]
                alias_of = None
                if not matches and motion.get('gms_hash'):
                    # Mixamo collapses identical configs across bundled packs.
                    # Reuse only an exactly equal source configuration, never
                    # a similarly named motion or an arbitrary archive file.
                    for candidate in body['motions']:
                        if candidate.get('gms_hash') == motion['gms_hash']:
                            alternate = [f for f in fbx_files if f.stem == str(candidate['id'])]
                            if len(alternate) == 1:
                                matches = alternate; alias_of = candidate['id']; break
                if len(matches) != 1: raise ValueError(f'Cannot identify batch motion {mid}; archive names: {[f.name for f in fbx_files][:6]}')
                target = ROOT / 'Animations' / mid
                target.mkdir(parents=True, exist_ok=True)
                previous = json.loads((target / 'asset.json').read_text()) if (target / 'asset.json').exists() else {}
                shutil.copy2(matches[0], target / 'source.fbx')
                record = {'key': 'Motion:'+mid, 'type':'Motion', 'productId':mid, 'name':motion['name'], 'description':motion.get('description',''), 'sourcePackName':motion.get('sourcePackName'), 'sourcePackId':motion.get('sourcePackId'), 'batch':key, 'fps':body['fps'], 'aliasOf':alias_of, 'file':str((target/'source.fbx').relative_to(REPO)), 'bytes':(target/'source.fbx').stat().st_size, 'sha256':hashlib.sha256((target/'source.fbx').read_bytes()).hexdigest()}
                if previous.get('aliases'): record['aliases'] = previous['aliases']
                (target/'asset.json').write_text(json.dumps(record,indent=2)+'\n')
                records['Motion:'+mid] = record
        with LOCK:
            STATE['completed'].update(records)
            for record_key in records: STATE['errors'].pop(record_key, None)
            save()
            completed = len(STATE['completed'])
        print(f'DOWNLOADED {completed}: {kind}: {body.get("name", identity)} ({file.stat().st_size:,} bytes)', flush=True)
    receipt.unlink()


def collect(receipt):
    try: process(receipt)
    except Exception as error:
        print(f'COLLECTOR ERROR {receipt.name}: {type(error).__name__}: {error}', flush=True)
        try:
            body = json.loads(receipt.read_text()).get('body', {})
            if body.get('key'):
                with LOCK: STATE['errors'][str(body['key'])] = str(error)[:500]; save()
        finally:
            # Preserve the failed receipt privately; rerun the browser helper to
            # request a fresh URL once expired download links are encountered.
            failed = ROOT / 'failed-receipts'; failed.mkdir(exist_ok=True)
            receipt.replace(failed / receipt.name)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--downloads', type=Path, default=Path.home() / 'Downloads')
    parser.add_argument('--motions-only', action='store_true', help='Acquire animations without downloading character models')
    parser.add_argument('--prepare-only', action='store_true')
    args = parser.parse_args()
    import os
    ROOT.mkdir(parents=True, exist_ok=True)
    if not args.prepare_only: (REPO / '.local/mixamo-collector.pid').write_text(str(os.getpid()))
    state = ROOT / 'download-state.json'
    if state.exists(): STATE = json.loads(state.read_text())
    helper = (REPO / 'scripts/assets/mixamo/mixamo-browser-download.js').read_text().replace('__COMPLETED__', json.dumps([key for key, record in STATE['completed'].items() if (key.startswith('Character:') and not args.motions_only) or record.get('fps') == 60]))
    helper = helper.replace('__DOWNLOAD_CHARACTERS__', json.dumps(not args.motions_only))
    (REPO / '.local/mixamo-download-console.js').write_text(helper)
    print('Console helper prepared at .local/mixamo-download-console.js', flush=True)
    if args.prepare_only: raise SystemExit(0)
    print(f'Watching {args.downloads} for this task\'s export receipts', flush=True)
    pending = set()
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        while True:
            for file in args.downloads.glob('lantern-mixamo-receipt-*.json'):
                if file not in pending:
                    pending.add(file)
                    pool.submit(collect, file)
            time.sleep(0.3)
