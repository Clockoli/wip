import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url);
const shaA = 'a'.repeat(64);
const shaB = 'b'.repeat(64);
const corpusHeader = 'schema_version,source_file_sha256,source_record_number,project,description,task,user,tags,start_date,start_time,end_date,end_time,duration_decimal';
const labelHeader = 'schema_version,source_file_sha256,source_record_number,candidate_url,candidate_title,label';

function run(...args) {
  return spawnSync(process.env.CLOCKOLI_TRAINER_PYTHON || 'python3', ['scripts/evaluate-clockify-resolver.py', ...args], { cwd: ROOT, encoding: 'utf8' });
}

test('offline evaluator compares deterministic and CatBoost rankers on held-out candidate groups', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'clockoli-evaluate-'));
  try {
    const corpus = join(directory, 'corpus.csv');
    const labels = join(directory, 'labels.csv');
    const model = join(directory, 'model.json');
    const output = join(directory, 'metrics.json');
    await writeFile(corpus, [
      corpusHeader,
      `1,${shaA},1,repo-a,#11 implement caching,#11 implement caching,Alice,,01/02/2026,09:00:00,01/02/2026,10:00:00,1`,
      `1,${shaB},1,customer work,fix report export,fix report export,Bob,,01/03/2026,09:00:00,01/03/2026,10:00:00,1`,
    ].join('\n') + '\n');
    await writeFile(labels, [
      labelHeader,
      `1,${shaA},1,https://github.com/acme/repo-a/issues/11,implement caching,positive`,
      `1,${shaA},1,https://github.com/acme/repo-a/issues/12,unrelated task,negative`,
      `1,${shaB},1,https://github.com/acme/repo-b/issues/21,fix report export,positive`,
      `1,${shaB},1,https://github.com/acme/repo-b/issues/22,redesign dashboard,negative`,
    ].join('\n') + '\n');
    await writeFile(model, JSON.stringify({
      version: 3, modelType: 'catboost-oblivious-trees', featureSchemaVersion: 3,
      features: ['issue_id_exact_match', 'repository_exact_match', 'title_token_jaccard', 'title_prefix_similarity', 'title_edit_similarity', 'pattern_type_code', 'repository_validation_frequency', 'user_repository_frequency'],
      bias: 0, trees: [{ splits: [{ featureIndex: 2, threshold: 0.4 }], leafValues: [-1, 1] }],
      training: { catBoostVersion: '1.2.8', datasetVersion: `sha256:${'c'.repeat(64)}` },
      evaluation: { trainingSamples: 4, positiveSamples: 2, heldOutPrecision: 0, heldOutRecall: 0, groups: 'source_file_sha256+user' },
    }));

    const result = run('--corpus', corpus, '--labels', labels, '--model', model, '--owner', 'acme', '--output', output);
    assert.equal(result.status, 0, result.stderr);
    const metrics = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(metrics.version, 1);
    assert.equal(metrics.cohorts.all.entries, 2);
    assert.equal(metrics.cohorts.deterministic.entries, 1);
    assert.equal(metrics.cohorts.fuzzy.entries, 1);
    assert.equal(metrics.cohorts.all.catboost.top1Accuracy, 1);
    assert.equal(metrics.cohorts.all.deterministic.top1Accuracy, 0.5);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
