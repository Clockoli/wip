#!/usr/bin/env python3
"""Train and export the portable CatBoost Clockify resolver ranker offline."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
from difflib import SequenceMatcher
from os.path import commonprefix
from pathlib import Path
import re
import sys
import tempfile
from typing import Any

try:
    import catboost
    from catboost import CatBoostClassifier
except ImportError as error:
    raise SystemExit('clockify resolver trainer requires catboost==1.2.8; install scripts/requirements-clockify-resolver.txt') from error

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


def tokens(value: str) -> set[str]:
    return set(TOKEN.findall(value.lower()))


def source_text(row: dict[str, str]) -> str:
    return ' '.join(row[field] for field in ('project', 'description', 'task', 'tags'))


def candidate(label: dict[str, str], repository_scope: str) -> tuple[str, int]:
    match = URL.fullmatch(label['candidate_url'])
    actual = f'{match[1]}/{match[2]}'.lower() if match else ''
    allowed = actual == repository_scope.lower() if '/' in repository_scope else bool(match and match[1].lower() == repository_scope.lower())
    if not match or not allowed:
        raise ValueError('label candidate URL is outside the explicit repository allowlist')
    return match[2].lower(), int(match[4])


def feature_vector(row: dict[str, str], label: dict[str, str], repository_scope: str, project_counts: dict[str, int], user_project_counts: dict[tuple[str, str], int]) -> list[float]:
    candidate_repository, number = candidate(label, repository_scope)
    text = source_text(row)
    source_tokens = tokens(text)
    title_tokens = tokens(label['candidate_title'])
    jaccard = len(source_tokens & title_tokens) / len(source_tokens | title_tokens) if source_tokens or title_tokens else 0.0
    compact_text = ' '.join(TOKEN.findall(text.lower()))
    compact_title = ' '.join(TOKEN.findall(label['candidate_title'].lower()))
    prefix = len(commonprefix([compact_text, compact_title])) / max(1, len(compact_title))
    edit = SequenceMatcher(None, compact_text, compact_title).ratio()
    issue_exact = float(str(number) in NUMBER.findall(text))
    repository_exact = float(row['project'].strip().lower() == candidate_repository)
    pattern = 2.0 if issue_exact and repository_exact else 1.0 if issue_exact else 0.0
    project_key = row['project'].strip().lower()
    user_key = row['user'].strip().lower()
    total = max(1, sum(project_counts.values()))
    user_total = max(1, sum(count for (user, _), count in user_project_counts.items() if user == user_key))
    return [issue_exact, repository_exact, jaccard, prefix, edit, pattern, project_counts.get(project_key, 0) / total, user_project_counts.get((user_key, project_key), 0) / user_total]


def grouped_split(samples: list[tuple[list[float], int, str]]) -> tuple[list[int], list[int]]:
    groups = sorted({group for _, _, group in samples})
    if len(groups) < 2:
        raise ValueError('training requires at least two source-file/user groups')
    held_out = {groups[index] for index in range(0, len(groups), 5)}
    if len(held_out) == len(groups): held_out = {groups[-1]}
    train = [index for index, (_, _, group) in enumerate(samples) if group not in held_out]
    test = [index for index, (_, _, group) in enumerate(samples) if group in held_out]
    if not train or not test or len({samples[index][1] for index in train}) != 2:
        held_out = {groups[-1]}
        train = [index for index, (_, _, group) in enumerate(samples) if group not in held_out]
        test = [index for index, (_, _, group) in enumerate(samples) if group in held_out]
    if not train or not test or len({samples[index][1] for index in train}) != 2:
        raise ValueError('group split must retain positive and negative training samples')
    return train, test


def export_model(model: CatBoostClassifier, dataset_version: str, evaluation: dict[str, Any]) -> dict[str, Any]:
    with tempfile.NamedTemporaryFile(suffix='.json') as temporary:
        model.save_model(temporary.name, format='json')
        raw = json.loads(Path(temporary.name).read_text(encoding='utf-8'))
    scale, biases = raw['scale_and_bias']
    if scale != 1 or not isinstance(biases, list) or len(biases) != 1 or not math.isfinite(biases[0]):
        raise ValueError('CatBoost export has unsupported scale or bias')
    trees = []
    for raw_tree in raw['oblivious_trees']:
        splits = raw_tree['splits']
        if any(split.get('split_type') != 'FloatFeature' for split in splits):
            raise ValueError('portable CatBoost export requires numeric-only splits')
        trees.append({
            'splits': [{'featureIndex': split['float_feature_index'], 'threshold': split['border']} for split in splits],
            'leafValues': raw_tree['leaf_values'],
        })
    return {
        'version': 3, 'modelType': 'catboost-oblivious-trees', 'featureSchemaVersion': 3,
        'features': FEATURES, 'bias': biases[0], 'trees': trees,
        'training': {'catBoostVersion': catboost.__version__, 'datasetVersion': f'sha256:{dataset_version}'},
        'evaluation': evaluation,
    }


def train(corpus_path: Path, labels_path: Path, repository_scope: str, output: Path) -> None:
    corpus = rows(corpus_path, CORPUS_HEADER)
    labels = rows(labels_path, LABEL_HEADER)
    corpus_by_key = {(row['schema_version'], row['source_file_sha256'], row['source_record_number']): row for row in corpus}
    if len(corpus_by_key) != len(corpus): raise ValueError('corpus source keys must be unique')
    project_counts: dict[str, int] = {}
    user_project_counts: dict[tuple[str, str], int] = {}
    for row in corpus:
        project = row['project'].strip().lower(); user = row['user'].strip().lower()
        project_counts[project] = project_counts.get(project, 0) + 1
        user_project_counts[(user, project)] = user_project_counts.get((user, project), 0) + 1
    samples = []
    seen = set()
    for label in labels:
        if label['label'] not in ('positive', 'negative'): continue
        key = (label['schema_version'], label['source_file_sha256'], label['source_record_number'])
        if key not in corpus_by_key: raise ValueError('label has no corpus source row')
        identity = key + (label['candidate_url'],)
        if identity in seen: raise ValueError('duplicate labelled candidate')
        seen.add(identity)
        candidate(label, repository_scope)
        samples.append((feature_vector(corpus_by_key[key], label, repository_scope, project_counts, user_project_counts), 1 if label['label'] == 'positive' else 0, f'{key[1]}:{corpus_by_key[key]["user"].strip().lower()}'))
    if not samples or len({label for _, label, _ in samples}) != 2: raise ValueError('training requires verified positive and negative labels')
    train_indexes, test_indexes = grouped_split(samples)
    x_train = [samples[index][0] for index in train_indexes]; y_train = [samples[index][1] for index in train_indexes]
    model = CatBoostClassifier(iterations=32, depth=3, learning_rate=0.15, loss_function='Logloss', random_seed=0, verbose=False, allow_writing_files=False, thread_count=1)
    model.fit(x_train, y_train)
    x_test = [samples[index][0] for index in test_indexes]; y_test = [samples[index][1] for index in test_indexes]
    logits = model.predict(x_test, prediction_type='RawFormulaVal')
    predicted = [int(value >= 0) for value in logits]
    true_positive = sum(actual == predicted == 1 for actual, predicted in zip(y_test, predicted))
    predicted_positive = sum(predicted); actual_positive = sum(y_test)
    digest = hashlib.sha256((corpus_path.read_bytes() + b'\0' + labels_path.read_bytes())).hexdigest()
    artifact = export_model(model, digest, {
        'trainingSamples': len(samples), 'positiveSamples': sum(label for _, label, _ in samples),
        'heldOutPrecision': true_positive / predicted_positive if predicted_positive else 0.0,
        'heldOutRecall': true_positive / actual_positive if actual_positive else 0.0,
        'groups': 'source_file_sha256+user',
    })
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(f'.{output.name}.tmp')
    temporary.write_text(json.dumps(artifact, sort_keys=True, separators=(',', ':')) + '\n', encoding='utf-8')
    temporary.replace(output)
    print(f'Wrote CatBoost resolver model with {len(samples)} verified training samples.')


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--corpus', required=True, type=Path); parser.add_argument('--labels', required=True, type=Path)
    scope = parser.add_mutually_exclusive_group(required=True)
    scope.add_argument('--repository'); scope.add_argument('--owner')
    parser.add_argument('--output', required=True, type=Path)
    arguments = parser.parse_args()
    try:
        train(arguments.corpus, arguments.labels, arguments.repository or arguments.owner, arguments.output)
    except (OSError, UnicodeError, ValueError, csv.Error, json.JSONDecodeError) as error:
        print(f'clockify resolver trainer: {error}', file=sys.stderr); return 1
    return 0

if __name__ == '__main__': raise SystemExit(main())
