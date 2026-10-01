"""Private APFS clones and process-lifetime resource leases. No third-party modules."""
import argparse
import ctypes
import fcntl
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time


def identity(pid):
    try:
        return subprocess.check_output(['ps', '-p', str(pid), '-o', 'lstart='], text=True).strip()
    except subprocess.CalledProcessError:
        return ''


def clone(source, target, exclusions=(), source_root=None, small_copy=False):
    source, target = Path(source), Path(target)
    source_root = source_root or source.resolve()
    if str(source.resolve()) in exclusions:
        return
    if source.is_symlink():
        # Dependency links must remain inside the private copy, not point to its original.
        link = os.readlink(source)
        if os.path.isabs(link) or not (source.parent / link).resolve().is_relative_to(source_root):
            raise RuntimeError(f'Absolute symlink cannot be privately cloned: {source}')
        target.parent.mkdir(parents=True, exist_ok=True)
        target.symlink_to(link)
    elif source.is_dir():
        target.mkdir(parents=True, exist_ok=True)
        for child in source.iterdir():
            clone(child, target / child.name, exclusions, source_root, small_copy)
        shutil.copystat(source, target)
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        if sys.platform == 'darwin':
            libc = ctypes.CDLL('/usr/lib/libSystem.B.dylib', use_errno=True)
            libc.clonefile.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_int]
            if libc.clonefile(os.fsencode(source), os.fsencode(target), 0):
                raise OSError(ctypes.get_errno(), f'APFS clone failed: {source} -> {target}')
        elif small_copy:
            # Explicitly bounded fixture/asset-free CI copies, never a catalog fallback.
            shutil.copy2(source, target)
        else:
            subprocess.run(['cp', '--reflink=always', '--', str(source), str(target)], check=True)
        shutil.copystat(source, target)


def lease(args):
    directory = Path(args.directory)
    directory.mkdir(parents=True, exist_ok=True)
    parent = os.getppid()
    parent_started = identity(parent)
    handle = None
    waited = False
    while handle is None:
        if identity(parent) != parent_started:
            return
        for slot in range(args.slots):
            candidate = (directory / f'{args.resource}-{slot}.lock').open('a+')
            try:
                fcntl.flock(candidate, fcntl.LOCK_EX | fcntl.LOCK_NB)
                handle = candidate
                break
            except BlockingIOError:
                candidate.close()
        if handle is None:
            if not waited:
                print(json.dumps({'waiting': args.resource}), flush=True)
                waited = True
            time.sleep(.15)
    record_path = directory / f'{args.resource}-{slot}.json'
    record = {'pid': os.getpid(), 'started': identity(os.getpid()), 'parent': os.getppid(),
              'resource': args.resource, 'slot': slot, 'token': args.token, 'task': args.task}
    temporary = record_path.with_suffix(f'.{os.getpid()}.tmp')
    temporary.write_text(json.dumps(record))
    temporary.replace(record_path)
    children = {}
    cleanups = []
    def stop(*_):
        raise SystemExit(1)
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        print(json.dumps({'acquired': record}), flush=True)
        for line in sys.stdin:
            message = json.loads(line)
            if 'cleanup' in message:
                cleanups.append(message['cleanup'])
            elif 'child' in message:
                children[message['child']] = message['started']
            elif 'done' in message:
                children.pop(message['done'], None)
    finally:
        # Only registered, independently owned process groups with matching start identities.
        for pid, started in children.items():
            if started and identity(pid) == started:
                try:
                    os.killpg(pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
        for command in cleanups:
            try:
                subprocess.run(command, timeout=10, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except (OSError, subprocess.TimeoutExpired):
                pass
        record_path.unlink(missing_ok=True)
        handle.close()


parser = argparse.ArgumentParser()
sub = parser.add_subparsers(dest='operation', required=True)
copy = sub.add_parser('clone')
copy.add_argument('source')
copy.add_argument('target')
copy.add_argument('--exclude', action='append', default=[])
lock = sub.add_parser('lease')
lock.add_argument('directory')
lock.add_argument('resource')
lock.add_argument('--slots', type=int, default=1)
lock.add_argument('--token', required=True)
lock.add_argument('--task', default='main')
args = parser.parse_args()
if args.operation == 'clone':
    source = Path(args.source)
    size = 0 if sys.platform == 'darwin' else (sum(p.stat().st_size for p in source.rglob('*') if p.is_file() and not p.is_symlink()) if source.is_dir() else source.stat().st_size)
    clone(args.source, args.target, set(args.exclude), small_copy=sys.platform != 'darwin' and size <= 1024 * 1024)
else:
    lease(args)
