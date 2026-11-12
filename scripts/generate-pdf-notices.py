#!/usr/bin/env python3
"""Generate complete pinned npm production dependency notices for html2pdf.js.

Input is the Corresponding Source ZIP from scripts/package-source.py; never
guess notices from Webpack module names or incomplete minifier comments.
"""
import argparse
import json
from pathlib import Path, PurePosixPath
import re
import sys
import zipfile

PREFIX = "third_party/html2pdf.js-v0.14.0/"
DEFAULT_OUT = Path(__file__).resolve().parent.parent / "LICENSES/PDF-npm-dependencies.txt"
NOTICE_NAMES = re.compile(r"^(?:licen[sc]e(?:[.\-_].*)?|copying(?:[.\-_].*)?|notice(?:[.\-_].*)?|copyright(?:[.\-_].*)?|feel-free\.md)$", re.I)


def generated_notices(archive):
    names = set(archive.namelist())
    lock = json.loads(archive.read(PREFIX + 'package-lock.json'))
    items = sorted(
        ((name, data) for name, data in lock['packages'].items()
         if name.startswith('node_modules/') and not data.get('dev')),
        key=lambda item: item[0].lower())
    out = [
        'Complete npm production dependency notices for html2pdf.js 0.14.0',
        'Pinned upstream: eKoopmans/html2pdf.js @ 29a31027d105782f10918bbf7fcada67488199dc',
        'Licenses are reproduced from the exact npm ci --omit=dev package source archive.',
        'This deliberately covers all installed production packages, including optional',
        'and type packages that may not be present in the minified browser bundle.',
        'The original html2pdf Webpack license report is retained separately.',
        '',
    ]
    included = []
    for package_path, record in items:
        folder = PREFIX + package_path + '/'
        metadata_file = folder + 'package.json'
        if metadata_file not in names:
            if record.get('optional'):
                continue
            raise ValueError('Missing non-optional installed package: ' + package_path)
        metadata = json.loads(archive.read(metadata_file))
        version = record.get('version') or metadata.get('version')
        declared_license = record.get('license') or metadata.get('license')
        if not version or not declared_license:
            raise ValueError('Missing license/version metadata for ' + package_path)
        notice_files = sorted((name for name in names
          if name.startswith(folder) and '/' not in name[len(folder):]
          and NOTICE_NAMES.fullmatch(PurePosixPath(name).name)), key=str.lower)
        if not notice_files:
            raise ValueError('No LICENSE/NOTICE file shipped by ' + package_path)
        included.append((package_path, version))
        out.append('=' * 76)
        out.append(f'Package: {package_path.removeprefix("node_modules/")}@{version}')
        out.append(f'Declared license: {declared_license}')
        out.append('=' * 76)
        for file in notice_files:
            data = archive.read(file)
            try:
                txt = data.decode('utf-8-sig').replace('\r\n', '\n').replace('\r', '\n')
            except UnicodeDecodeError as exc:
                raise ValueError('Non-UTF8 license file: ' + file) from exc
            out.append('File: ' + file.removeprefix(PREFIX))
            out.append('')
            out.append(txt.rstrip())
            out.append('')
    out.insert(7, f'Installed production dependencies with notices: {len(included)}')
    return '\n'.join(out).rstrip() + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source_zip', type=Path, help='ZIP produced by package-source.py')
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--check', action='store_true', help='Fail if repository notice file is stale')
    group.add_argument('--emit-logs', action='store_true', help='Print JSON-escaped content for initial checkout generation')
    args = parser.parse_args()
    with zipfile.ZipFile(args.source_zip) as archive:
        result = generated_notices(archive)
    if args.emit_logs:
        chunks = [result[i:i + 2500] for i in range(0, len(result), 2500)]
        print('LICENSE_DATA_BEGIN:' + str(len(chunks)))
        for index, part in enumerate(chunks):
            print('LICENSE_DATA_PART:' + str(index) + ':' + json.dumps(part))
        print('LICENSE_DATA_END')
        return
    expected = DEFAULT_OUT.read_text(encoding='utf-8')
    if expected != result:
        raise SystemExit('PDF dependency license notice file differs from pinned npm packages')
    print('Verified exact PDF dependency license notices:', len(result.encode('utf-8')), 'bytes')


if __name__ == '__main__':
    main()
