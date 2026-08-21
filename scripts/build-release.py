#!/usr/bin/env python3
import hashlib
import json
import pathlib
import subprocess
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUTPUT = pathlib.Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else pathlib.Path('/tmp/repoclock-release.zip')

def inventory():
    result = subprocess.run(
        ['node', 'scripts/validate-release-inventory.js', '--json'], cwd=ROOT,
        check=True, capture_output=True, text=True,
    )
    return json.loads(result.stdout)

def build(files):
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    if OUTPUT.exists(): OUTPUT.unlink()
    with zipfile.ZipFile(OUTPUT, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for relative in files:
            data = (ROOT / relative).read_bytes()
            info = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            info.create_system = 3
            archive.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)

def verify(files):
    with zipfile.ZipFile(OUTPUT, 'r') as archive:
        names = archive.namelist()
        if names != files:
            raise SystemExit(f'ZIP inventory mismatch: expected {files!r}, got {names!r}')
        for name in names:
            if archive.read(name) != (ROOT / name).read_bytes():
                raise SystemExit(f'ZIP content mismatch: {name}')
    digest = hashlib.sha256(OUTPUT.read_bytes()).hexdigest()
    print(json.dumps({'path': str(OUTPUT), 'files': len(files), 'bytes': OUTPUT.stat().st_size, 'sha256': digest}, sort_keys=True))

files = inventory()
build(files)
verify(files)
