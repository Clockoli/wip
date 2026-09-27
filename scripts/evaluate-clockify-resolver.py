#!/usr/bin/env python3
"""Compare deterministic and CatBoost resolver ranking over labelled candidate lists."""
from __future__ import annotations

import argparse
import csv
import json
import math
import re
import sys
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

CORPUS_HEADER = ['schema_version','source_file_sha256','source_record_number','project','description','task','user','tags','start_date','start_time','end_date','end_time','duration_decimal']
LABEL_HEADER = ['schema_version','source_file_sha256','source_record_number','candidate_url','candidate_title','label']
FEATURES = ['issue_id_exact_match', 'repository_exact_match', 'title_token_jaccard', 'title_prefix_similarity', 'title_edit_similarity', 'pattern_type_code', 'repository_validation_frequency', 'user_repository_frequency']
URL = re.compile(r'^https://github\.com/([^/]+)/([^/]+)/(issues|pull)/(\d{1,9})$')
NUMBER = re.compile(r'(?:^|\s)#(\d{1,9})(?=\s|$)', re.I)
TOKEN = re.compile(r'[a-z0-9]{2,}', re.I)


def rows(path: Path, header: list[str]) -> list[dict[str, str]]:
    with path.open(encoding='utf-8', newline='') as source:
        reader = csv.DictReader(source)
        if reader.fieldnames != header:
            raise ValueError(f'{path.name}: unsupported header')
        result = list(reader)
    if any(None in row or any(value is None for value in row.values()) for row in result):
        raise ValueError(f'{path.name}: malformed CSV row')
    return result


def source_text(row: dict[str, str]) -> str:
    return ' '.join(row[field] for field in ('project', 'description', 'task', 'tags'))


def tokens(value: str) -> set[str]:
    return set(TOKEN.findall(value.lower()))


def candidate(label: dict[str, str], owner: str) -> tuple[str, int]:
    match = URL.fullmatch(label['candidate_url'])
    if not match or match[1].lower() != owner.lower():
        raise ValueError('label candidate URL is outside the explicit repository allowlist')
    return match[2].lower(), int(match[4])


def feature_vector(row: dict[str, str], label: dict[str, str], owner: str, project_counts: dict[str, int], user_project_counts: dict[tuple[str, str], int]) -> list[float]:
    repository, number = candidate(label, owner)
    text = source_text(row)
    source_tokens = tokens(text)
    title_tokens = tokens(label['candidate_title'])
    jaccard = len(source_tokens & title_tokens) / len(source_tokens | title_tokens) if source_tokens or title_tokens else 0.0
    compact_text = ' '.join(TOKEN.findall(text.lower()))
    compact_title = ' '.join(TOKEN.findall(label['candidate_title'].lower()))
    prefix = len(__import__('os').path.commonprefix([compact_text, compact_title])) / max(1, len(compact_title))
    edit = SequenceMatcher(None, compact_text, compact_title).ratio()
    issue_exact = float(str(number) in NUMBER.findall(text))
    repository_exact = float(row['project'].strip().lower() == repository)
    project_key = row['project'].strip().lower()
    user_key = row['user'].strip().lower()
    total = max(1, sum(project_counts.values()))
    user_total = max(1, sum(count for (user, _), count in user_project_counts.items() if user == user_key))
    return [issue_exact, repository_exact, jaccard, prefix, edit, 2.0 if issue_exact and repository_exact else 1.0 if issue_exact else 0.0, project_counts.get(project_key, 0) / total, user_project_counts.get((user_key, project_key), 0) / user_total]


def validate_model(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get('version') != 3 or value.get('modelType') != 'catboost-oblivious-trees' or value.get('featureSchemaVersion') != 3:
        raise ValueError('unsupported model artifact')
    if value.get('features') != FEATURES or not isinstance(value.get('bias'), (int, float)) or not math.isfinite(value['bias']) or not isinstance(value.get('trees'), list) or not value['trees']:
        raise ValueError('invalid model artifact')
    for tree in value['trees']:
        splits = tree.get('splits') if isinstance(tree, dict) else None
        leaves = tree.get('leafValues') if isinstance(tree, dict) else None
        if not isinstance(splits, list) or not splits or len(splits) > 16 or not isinstance(leaves, list) or len(leaves) != 2 ** len(splits):
            raise ValueError('invalid model tree')
        for split in splits:
            if not isinstance(split, dict) or not isinstance(split.get('featureIndex'), int) or not 0 <= split['featureIndex'] < len(FEATURES) or not isinstance(split.get('threshold'), (int, float)) or not math.isfinite(split['threshold']):
                raise ValueError('invalid model split')
        if any(not isinstance(leaf, (int, float)) or not math.isfinite(leaf) for leaf in leaves):
            raise ValueError('invalid model leaves')
    return value


def score(model: dict[str, Any], values: list[float]) -> float:
    result = model['bias']
    for tree in model['trees']:
        index = 0
        for depth, split in enumerate(tree['splits']):
            if values[split['featureIndex']] > split['threshold']:
                index |= 1 << depth
        result += tree['leafValues'][index]
    return result


def metrics(entries: list[tuple[bool, bool, bool]]) -> dict[str, Any]:
    count = len(entries)
    return {
        'entries': count,
        'deterministic': {'top1Accuracy': sum(item[0] for item in entries) / count if count else 0},
        'catboost': {'top1Accuracy': sum(item[1] for item in entries) / count if count else 0},
        'deterministicCoverage': sum(item[2] for item in entries) / count if count else 0,
    }


def evaluate(corpus_path: Path, labels_path: Path, model_path: Path, owner: str) -> dict[str, Any]:
    corpus = rows(corpus_path, CORPUS_HEADER)
    labels = rows(labels_path, LABEL_HEADER)
    model = validate_model(json.loads(model_path.read_text(encoding='utf-8')))
    corpus_by_key = {(row['schema_version'], row['source_file_sha256'], row['source_record_number']): row for row in corpus}
    project_counts: dict[str, int] = {}
    user_project_counts: dict[tuple[str, str], int] = {}
    for row in corpus:
        project = row['project'].strip().lower(); user = row['user'].strip().lower()
        project_counts[project] = project_counts.get(project, 0) + 1
        user_project_counts[(user, project)] = user_project_counts.get((user, project), 0) + 1
    grouped: dict[tuple[str, str, str], list[dict[str, str]]] = {}
    for label in labels:
        if label['label'] not in ('positive', 'negative'):
            continue
        key = (label['schema_version'], label['source_file_sha256'], label['source_record_number'])
        if key not in corpus_by_key:
            raise ValueError('label has no corpus source row')
        candidate(label, owner)
        grouped.setdefault(key, []).append(label)
    result = {'all': [], 'deterministic': [], 'fuzzy': []}
    for key, candidates in grouped.items():
        positives = [label for label in candidates if label['label'] == 'positive']
        if len(positives) != 1:
            continue
        row = corpus_by_key[key]
        source = source_text(row)
        numbers = set(NUMBER.findall(source))
        project = row['project'].strip().lower()
        exact = [label for label in candidates if str(candidate(label, owner)[1]) in numbers and candidate(label, owner)[0] == project]
        deterministic_choice = exact[0] if len(exact) == 1 else None
        scores = [(score(model, feature_vector(row, label, owner, project_counts, user_project_counts)), label) for label in candidates]
        best_score = max(item[0] for item in scores)
        model_choice = [label for value, label in scores if value == best_score]
        catboost_choice = model_choice[0] if len(model_choice) == 1 else None
        outcome = (deterministic_choice is positives[0], catboost_choice is positives[0], deterministic_choice is not None)
        result['all'].append(outcome)
        result['deterministic' if deterministic_choice else 'fuzzy'].append(outcome)
    return {'version': 1, 'cohorts': {name: metrics(values) for name, values in result.items()}}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--corpus', required=True, type=Path)
    parser.add_argument('--labels', required=True, type=Path)
    parser.add_argument('--model', required=True, type=Path)
    parser.add_argument('--owner', required=True)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    try:
        output = evaluate(args.corpus, args.labels, args.model, args.owner)
        args.output.write_text(json.dumps(output, sort_keys=True, separators=(',', ':')) + '\n', encoding='utf-8')
    except (OSError, UnicodeError, ValueError, csv.Error, json.JSONDecodeError) as error:
        print(f'clockify resolver evaluator: {error}', file=sys.stderr)
        return 1
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
