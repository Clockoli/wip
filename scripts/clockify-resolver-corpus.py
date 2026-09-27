#!/usr/bin/env python3
"""Build a minimized, versioned offline resolver corpus from Clockify CSV exports.

The source exports remain outside Git. This tool intentionally excludes personal
email/client/group and billing columns before writing any derived corpus.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile

SOURCE_HEADER = [
    'Project', 'Client', 'Description', 'Task', 'User', 'Group', 'Email', 'Tags',
    'Billable', 'Start Date', 'Start Time', 'End Date', 'End Time', 'Duration (h)',
    'Duration (decimal)', 'Billable Rate (0)', 'Billable Amount (0)', 'Date of creation',
]
CORPUS_HEADER = [
    'schema_version', 'source_file_sha256', 'source_record_number', 'project',
    'description', 'task', 'user', 'tags', 'start_date', 'start_time', 'end_date',
    'end_time', 'duration_decimal',
]
FIELD_MAP = {
    'project': 'Project',
    'description': 'Description',
    'task': 'Task',
    'user': 'User',
    'tags': 'Tags',
    'start_date': 'Start Date',
    'start_time': 'Start Time',
    'end_date': 'End Date',
    'end_time': 'End Time',
    'duration_decimal': 'Duration (decimal)',
}
SCHEMA_VERSION = 1


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def atomic_write(path: Path, contents: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f'.{path.name}.', dir=path.parent, text=True)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8', newline='') as destination:
            destination.write(contents)
        os.replace(temporary, path)
    except BaseException:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def read_rows(path: Path) -> tuple[list[list[str]], dict]:
    source_hash = sha256_file(path)
    rows: list[list[str]] = []
    with path.open('r', encoding='utf-8-sig', newline='') as source:
        reader = csv.DictReader(source)
        if reader.fieldnames != SOURCE_HEADER:
            raise ValueError(f'{path.name}: Clockify CSV header is unsupported')
        for record_number, row in enumerate(reader, start=1):
            if None in row:
                raise ValueError(f'{path.name}: CSV record {record_number} has too many columns')
            if any(value is None for value in row.values()):
                raise ValueError(f'{path.name}: CSV record {record_number} is malformed')
            rows.append([
                str(SCHEMA_VERSION), source_hash, str(record_number),
                *(row[FIELD_MAP[column]] for column in CORPUS_HEADER[3:]),
            ])
    return rows, {'name': path.name, 'sha256': source_hash, 'records': len(rows)}


def extract(inputs: list[Path], output: Path, manifest: Path) -> None:
    corpus_rows: list[list[str]] = []
    source_files = []
    for path in inputs:
        rows, source_file = read_rows(path)
        corpus_rows.extend(rows)
        source_files.append(source_file)

    csv_output: list[str] = []
    class Buffer:
        def write(self, value: str) -> int:
            csv_output.append(value)
            return len(value)
    writer = csv.writer(Buffer(), lineterminator='\n')
    writer.writerow(CORPUS_HEADER)
    writer.writerows(corpus_rows)

    atomic_write(output, ''.join(csv_output))
    atomic_write(manifest, json.dumps({
        'version': SCHEMA_VERSION,
        'sourceFiles': source_files,
    }, separators=(',', ':'), sort_keys=True) + '\n')
    print(f'Wrote {len(corpus_rows)} training rows from {len(source_files)} Clockify CSV file(s).')


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    subcommands = parser.add_subparsers(dest='command', required=True)
    extract_command = subcommands.add_parser('extract', help='Create a minimized versioned corpus and manifest.')
    extract_command.add_argument('--input', action='append', required=True, type=Path, help='Clockify Detailed Report CSV. Repeat for each file.')
    extract_command.add_argument('--output', required=True, type=Path, help='Destination minimized corpus CSV.')
    extract_command.add_argument('--manifest', required=True, type=Path, help='Destination corpus manifest JSON.')
    return parser.parse_args()


def main() -> int:
    arguments = parse_arguments()
    try:
        if arguments.command == 'extract':
            extract(arguments.input, arguments.output, arguments.manifest)
        return 0
    except (OSError, UnicodeError, ValueError, csv.Error) as error:
        print(f'clockify resolver corpus: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
