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

_clonefile = None
if sys.platform == 'darwin':
    _libc = ctypes.CDLL('/usr/lib/libSystem.B.dylib', use_errno=True)
    _clonefile = _libc.clonefile
    _clonefile.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_int]
    _clonefile.restype = ctypes.c_int


def identity(pid):
    try:
        return subprocess.check_output(['ps', '-p', str(pid), '-o', 'lstart='], text=True).strip()
    except subprocess.CalledProcessError:
        return ''


def clone(source, target, exclusions=(), small_copy=False):
    source, target = os.path.abspath(source), os.path.abspath(target)
    source_root = Path(source).resolve()
    # Realpath checks matter for excluded paths, but avoid resolving every ordinary file.
    excluded = {os.path.realpath(path) for path in exclusions}
    os.makedirs(os.path.dirname(target), exist_ok=True)

    def copy_entry(source, target, entry=None):
        if excluded and os.path.realpath(source) in excluded:
            return
        is_link = entry.is_symlink() if entry else os.path.islink(source)
        if is_link:
            # Relative links must stay inside the private tree when copied unchanged.
            link = os.readlink(source)
            if os.path.isabs(link) or not (Path(source).parent / link).resolve().is_relative_to(source_root):
                raise RuntimeError(f'Symlink escapes its private clone: {source}')
            os.symlink(link, target)
        elif (entry.is_dir(follow_symlinks=False) if entry else os.path.isdir(source)):
            os.makedirs(target, exist_ok=True)
            with os.scandir(source) as children:
                for child in children:
                    copy_entry(child.path, os.path.join(target, child.name), child)
            shutil.copystat(source, target)
        elif _clonefile:
            # clonefile copies attributes too. Directory cloning is intentionally avoided.
            if _clonefile(os.fsencode(source), os.fsencode(target), 0):
                raise OSError(ctypes.get_errno(), f'APFS clone failed: {source} -> {target}')
        elif small_copy:
            # Explicitly bounded fixture/asset-free CI copies, never a catalog fallback.
            shutil.copy2(source, target)
        else:
            subprocess.run(['cp', '--reflink=always', '--', source, target], check=True)

    copy_entry(source, target)


def lease(args):
    directory = Path(args.directory)
    directory.mkdir(parents=True, exist_ok=True)
    parent = os.getppid()
    parent_started = identity(parent)
    handle = None
    waited = False
    drained = []
    queue_path = directory / f'{args.resource}.queue.json'
    queue_lock = (directory / f'{args.resource}.queue.lock').open('a+')
    waiter = {'pid': os.getpid(), 'started': identity(os.getpid()), 'token': args.token}

    def read_queue():
        queue = json.loads(queue_path.read_text()) if queue_path.exists() else []
        return [entry for entry in queue if identity(entry['pid']) == entry['started']]

    def write_queue(queue):
        temporary = queue_path.with_suffix(f'.{os.getpid()}.tmp')
        temporary.write_text(json.dumps(queue))
        temporary.replace(queue_path)

    def stop_waiting(*_):
        raise SystemExit(1)

    signal.signal(signal.SIGTERM, stop_waiting)
    signal.signal(signal.SIGINT, stop_waiting)
    try:
        while handle is None:
            if identity(parent) != parent_started:
                return
            fcntl.flock(queue_lock, fcntl.LOCK_EX)
            try:
                queue = read_queue()
                if not args.try_only and not any(entry['token'] == args.token for entry in queue):
                    queue.append(waiter)
                # Keep admission and slot acquisition in the same critical section:
                # a later poll or try-only request cannot overtake the first waiter.
                turn = not queue or queue[0]['token'] == args.token
                blocked = not turn
                for retired in (range(args.slots, args.drain_slots) if turn else []):
                    candidate = (directory / f'{args.resource}-{retired}.lock').open('a+')
                    try:
                        fcntl.flock(candidate, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        drained.append(candidate)
                    except BlockingIOError:
                        candidate.close()
                        blocked = True
                        break
                for slot in ([] if blocked else ([args.slot] if args.slot is not None else range(args.slots))):
                    candidate = (directory / f'{args.resource}-{slot}.lock').open('a+')
                    try:
                        fcntl.flock(candidate, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        handle = candidate
                        break
                    except BlockingIOError:
                        candidate.close()
                if handle is not None:
                    queue = [entry for entry in queue if entry['token'] != args.token]
                write_queue(queue)
            finally:
                fcntl.flock(queue_lock, fcntl.LOCK_UN)
            if handle is None:
                for retired in drained:
                    retired.close()
                drained.clear()
                if args.try_only:
                    print(json.dumps({'deferred': args.resource}), flush=True)
                    return
                if not waited:
                    print(json.dumps({'waiting': args.resource}), flush=True)
                    waited = True
                time.sleep(.15)
    finally:
        fcntl.flock(queue_lock, fcntl.LOCK_EX)
        try:
            write_queue([entry for entry in read_queue() if entry['token'] != args.token])
        finally:
            queue_lock.close()
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
        for retired in drained:
            retired.close()


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
lock.add_argument('--drain-slots', type=int, default=1)
lock.add_argument('--slot', type=int)
lock.add_argument('--try-only', action='store_true')
lock.add_argument('--token', required=True)
lock.add_argument('--task', default='main')
args = parser.parse_args()
if args.operation == 'clone':
    source = Path(args.source)
    size = 0 if sys.platform == 'darwin' else (sum(p.stat().st_size for p in source.rglob('*') if p.is_file() and not p.is_symlink()) if source.is_dir() else source.stat().st_size)
    clone(args.source, args.target, set(args.exclude), small_copy=sys.platform != 'darwin' and size <= 1024 * 1024)
else:
    if args.slots < 1 or args.slot is not None and not 0 <= args.slot < args.slots:
        parser.error('Invalid resource slot')
    lease(args)
