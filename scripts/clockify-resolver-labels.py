#!/usr/bin/env python3
"""Generate verified Clockify resolver candidate labels using authenticated GitHub CLI reads."""
from __future__ import annotations

import argparse
import csv
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

CORPUS_HEADER = ['schema_version','source_file_sha256','source_record_number','project','description','task','user','tags','start_date','start_time','end_date','end_time','duration_decimal']
LABEL_HEADER = ['schema_version','source_file_sha256','source_record_number','candidate_url','candidate_title','label']
NUMBER = re.compile(r'(?:^|\s)#(\d{1,9})(?:\s|$)')
REPOSITORY = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$')
DEFAULT_PROJECT_ALIASES = Path(__file__).with_name('clockify-resolver-project-aliases-v1.json')


def read_corpus(path: Path) -> list[dict[str, str]]:
    with path.open(encoding='utf-8', newline='') as source:
        reader = csv.DictReader(source)
        if reader.fieldnames != CORPUS_HEADER:
            raise ValueError('corpus header is unsupported')
        rows = list(reader)
    if any(not row['source_file_sha256'] or not row['source_record_number'] for row in rows):
        raise ValueError('corpus row is missing its stable source key')
    return rows


def read_project_aliases(path: Path, default_owner: str) -> dict[str, tuple[str, str]]:
    try:
        payload = json.loads(path.read_text(encoding='utf-8'))
    except json.JSONDecodeError as error:
        raise ValueError('project aliases must contain valid JSON') from error
    if not isinstance(payload, list):
        raise ValueError('project aliases must be a list')
    aliases: dict[str, tuple[str, str]] = {}
    for entry in payload:
        if not isinstance(entry, dict):
            raise ValueError('project alias entry must be an object')
        project = entry.get('clockifyProject')
        owner = entry.get('owner', default_owner)
        repository = entry.get('repository')
        if not isinstance(project, str) or not project.strip() or not isinstance(owner, str) or not REPOSITORY.fullmatch(owner) or not isinstance(repository, str) or not REPOSITORY.fullmatch(repository):
            raise ValueError('project alias entry is invalid')
        project = project.strip()
        owner = owner.lower()
        repository = repository.lower()
        if project in aliases:
            raise ValueError('project aliases must not duplicate a Clockify project')
        aliases[project] = (owner, repository)
    return aliases


def candidate_number(row: dict[str, str], owner: str, project_aliases: dict[str, tuple[str, str]]) -> tuple[str, str, int] | None:
    project = row['project'].strip()
    candidate_owner, repository = project_aliases.get(project, (owner, project))
    candidate_owner = candidate_owner.lower()
    repository = repository.lower()
    numbers = set(NUMBER.findall(' '.join(row[key] for key in ('description', 'task', 'tags'))))
    if not REPOSITORY.fullmatch(candidate_owner) or not REPOSITORY.fullmatch(repository) or len(numbers) != 1:
        return None
    return candidate_owner, repository, int(next(iter(numbers)))


def graph_query(owner: str, candidates: list[tuple[str, int]]) -> str:
    selections = []
    for index, (repository, number) in enumerate(candidates):
        selections.append(
            f'candidate{index}: repository(owner: {json.dumps(owner)}, name: {json.dumps(repository)}) '
            f'{{ issueOrPullRequest(number: {number}) {{ __typename '
            f'... on Issue {{ url title number repository {{ nameWithOwner }} }} '
            f'... on PullRequest {{ url title number repository {{ nameWithOwner }} }} }} }}'
        )
    return 'query { ' + ' '.join(selections) + ' }'


def read_github(github_command: str, owner: str, candidates: list[tuple[str, int]]) -> dict[tuple[str, int], tuple[str, str]]:
    verified: dict[tuple[str, int], tuple[str, str]] = {}
    for offset in range(0, len(candidates), 50):
        batch = candidates[offset:offset + 50]
        response = subprocess.run(
            [github_command, 'api', 'graphql', '-f', f'query={graph_query(owner, batch)}'],
            check=False, capture_output=True, text=True,
        )
        try:
            payload = json.loads(response.stdout)
        except json.JSONDecodeError as error:
            raise ValueError('GitHub validation returned invalid JSON') from error
        data = payload.get('data') if isinstance(payload, dict) else None
        if response.returncode and not isinstance(data, dict):
            raise ValueError(f'GitHub validation failed for candidate batch {offset // 50 + 1}')
        if not isinstance(data, dict):
            raise ValueError('GitHub validation returned no data')
        for index, (repository, number) in enumerate(batch):
            response_node = data.get(f'candidate{index}')
            entity = response_node.get('issueOrPullRequest') if isinstance(response_node, dict) else None
            if not isinstance(entity, dict):
                continue
            kind = entity.get('__typename')
            suffix = 'issues' if kind == 'Issue' else 'pull' if kind == 'PullRequest' else None
            expected_url = f'https://github.com/{owner}/{repository}/{suffix}/{number}' if suffix else None
            repository_name = entity.get('repository', {}).get('nameWithOwner') if isinstance(entity.get('repository'), dict) else None
            if (
                entity.get('url') == expected_url
                and entity.get('number') == number
                and isinstance(entity.get('title'), str)
                and entity['title']
                and isinstance(repository_name, str)
                and repository_name.lower() == f'{owner}/{repository}'.lower()
            ):
                verified[(repository, number)] = (entity['url'], entity['title'])
    return verified


def atomic_write(path: Path, rows: list[list[str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f'.{path.name}.', dir=path.parent, text=True)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8', newline='') as destination:
            writer = csv.writer(destination, lineterminator='\n')
            writer.writerow(LABEL_HEADER)
            writer.writerows(rows)
        os.replace(temporary, path)
    except BaseException:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def generate(corpus: list[dict[str, str]], owner: str, github_command: str, project_aliases: dict[str, tuple[str, str]]) -> list[list[str]]:
    extracted = {candidate_number(row, owner, project_aliases) for row in corpus}
    candidates_by_owner: dict[str, list[tuple[str, int]]] = {}
    for candidate_owner, repository, number in sorted(candidate for candidate in extracted if candidate is not None):
        candidates_by_owner.setdefault(candidate_owner, []).append((repository, number))
    verified: dict[tuple[str, str, int], tuple[str, str]] = {}
    for candidate_owner, candidates in candidates_by_owner.items():
        for (repository, number), entity in read_github(github_command, candidate_owner, candidates).items():
            verified[(candidate_owner, repository, number)] = entity
    alternatives: dict[tuple[str, str], list[tuple[int, tuple[str, str]]]] = {}
    for (candidate_owner, repository, number), entity in verified.items():
        alternatives.setdefault((candidate_owner, repository), []).append((number, entity))
    for values in alternatives.values():
        values.sort(key=lambda item: item[0])

    labels: list[list[str]] = []
    for row in corpus:
        source_key = [row['schema_version'], row['source_file_sha256'], row['source_record_number']]
        candidate = candidate_number(row, owner, project_aliases)
        entity = verified.get(candidate) if candidate else None
        if not candidate or not entity:
            labels.append(source_key + ['', '', 'unresolved'])
            continue
        labels.append(source_key + [entity[0], entity[1], 'positive'])
        for alternative_number, alternative in alternatives[(candidate[0], candidate[1])]:
            if alternative_number != candidate[2]:
                labels.append(source_key + [alternative[0], alternative[1], 'negative'])
                break
    return labels


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--corpus', required=True, type=Path)
    parser.add_argument('--owner', required=True)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--github-command', default='gh')
    parser.add_argument('--project-aliases', type=Path, default=DEFAULT_PROJECT_ALIASES)
    return parser.parse_args()


def main() -> int:
    arguments = parse_arguments()
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9-]{0,38}', arguments.owner):
        raise ValueError('GitHub owner is invalid')
    corpus = read_corpus(arguments.corpus)
    project_aliases = read_project_aliases(arguments.project_aliases, arguments.owner)
    labels = generate(corpus, arguments.owner, arguments.github_command, project_aliases)
    atomic_write(arguments.output, labels)
    positives = sum(label[-1] == 'positive' for label in labels)
    negatives = sum(label[-1] == 'negative' for label in labels)
    print(f'Wrote {len(labels)} labels: {positives} positive, {negatives} negative.')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, UnicodeError, ValueError, csv.Error) as error:
        print(f'clockify resolver labels: {error}', file=sys.stderr)
        raise SystemExit(1)
