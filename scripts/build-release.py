#!/usr/bin/env python3
import argparse
import hashlib
import json
import pathlib
import subprocess
import tempfile
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent


def inventory(target):
    result = subprocess.run(
        ['node', 'scripts/validate-release-inventory.js', '--target', target, '--json'], cwd=ROOT,
        check=True, stdout=subprocess.PIPE, text=True,
    )
    return json.loads(result.stdout)


def build(output, contents):
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for relative, data in contents.items():
            info = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            info.create_system = 3
            archive.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    with zipfile.ZipFile(output, 'r') as archive:
        if archive.namelist() != list(contents):
            raise SystemExit('ZIP inventory mismatch')
        for name, data in contents.items():
            if archive.read(name) != data:
                raise SystemExit(f'ZIP content mismatch: {name}')
    return {'path': str(output), 'files': len(contents), 'bytes': output.stat().st_size,
            'sha256': hashlib.sha256(output.read_bytes()).hexdigest()}


def main():
    parser = argparse.ArgumentParser(description='Build a deterministic Clockoli extension package.')
    parser.add_argument('--target', choices=['chrome', 'firefox', 'safari'], default='chrome')
    parser.add_argument('--unpacked', action='store_true', help='Write a new unpacked directory instead of an archive')
    parser.add_argument('output', nargs='?', default='/tmp/clockoli-release.zip')
    args = parser.parse_args()
    output = pathlib.Path(args.output).resolve()
    if output == ROOT or ROOT in output.parents:
        parser.error('Build output must be outside the repository')
    subprocess.run(['node', 'scripts/validate-extension.js', '--target', args.target],
                   cwd=ROOT, check=True, stdout=subprocess.PIPE)
    manifest = subprocess.run(['node', 'scripts/target-manifest.js', args.target],
                              cwd=ROOT, check=True, stdout=subprocess.PIPE).stdout
    contents = {name: manifest if name == 'manifest.json' else (ROOT / name).read_bytes()
                for name in inventory(args.target)}
    if args.unpacked:
        output.mkdir(parents=True, exist_ok=False)
        for name, data in contents.items():
            file = output / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(data)
        actual = sorted(str(file.relative_to(output)) for file in output.rglob('*') if file.is_file())
        if actual != list(contents) or any((output / name).read_bytes() != data for name, data in contents.items()):
            raise SystemExit('Unpacked inventory/content mismatch')
        summary = {'path': str(output), 'files': len(contents), 'bytes': sum(map(len, contents.values()))}
    else:
        # Only publish a completely verified archive, even if validation or writing fails.
        output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=output.parent) as temporary:
            archive = pathlib.Path(temporary) / output.name
            summary = build(archive, contents)
            archive.replace(output)
        summary['path'] = str(output)
    print(json.dumps(summary, sort_keys=True))


if __name__ == '__main__':
    main()
