import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url);
const corpusHeader = 'schema_version,source_file_sha256,source_record_number,project,description,task,user,tags,start_date,start_time,end_date,end_time,duration_decimal';
const labelHeader = 'schema_version,source_file_sha256,source_record_number,candidate_url,candidate_title,label';
const shaA = 'a'.repeat(64);
const shaB = 'b'.repeat(64);

function train(...args) {
  return spawnSync(process.env.CLOCKOLI_TRAINER_PYTHON || 'python3', ['scripts/train-clockify-resolver.py', ...args], { cwd: ROOT, encoding: 'utf8' });
}

function label(...args) {
  return spawnSync('python3', ['scripts/clockify-resolver-labels.py', ...args], { cwd: ROOT, encoding: 'utf8' });
}

test('offline trainer accepts only allowlisted labelled candidates and produces a portable CatBoost artifact', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'clockoli-train-'));
  try {
    const corpus = join(directory, 'corpus.csv');
    const labels = join(directory, 'labels.csv');
    const model = join(directory, 'model.json');
    await writeFile(corpus, [
      corpusHeader,
      `1,${shaA},1,clockoli,#13 Add CSV resolver,#13 Add CSV resolver,Alice,backend,01/02/2026,09:00:00,01/02/2026,10:30:00,1.5`,
      `1,${shaB},1,clockoli,#14 Other work,#14 Other work,Bob,backend,01/03/2026,09:00:00,01/03/2026,10:00:00,1`,
    ].join('\n') + '\n');
    await writeFile(labels, [
      labelHeader,
      `1,${shaA},1,https://github.com/clockoli/clockoli/issues/13,Add CSV resolver,positive`,
      `1,${shaA},1,https://github.com/clockoli/clockoli/issues/99,Wrong candidate,negative`,
      `1,${shaB},1,https://github.com/clockoli/clockoli/issues/14,Other work,positive`,
      `1,${shaB},1,https://github.com/clockoli/clockoli/issues/98,Wrong candidate,negative`,
    ].join('\n') + '\n');

    const result = train('--corpus', corpus, '--labels', labels, '--repository', 'clockoli/clockoli', '--output', model);
    assert.equal(result.status, 0, result.stderr);
    const artifact = JSON.parse(await readFile(model, 'utf8'));
    assert.equal(artifact.version, 3);
    assert.equal(artifact.modelType, 'catboost-oblivious-trees');
    assert.equal(artifact.featureSchemaVersion, 3);
    assert.deepEqual(artifact.features, [
      'issue_id_exact_match', 'repository_exact_match', 'title_token_jaccard', 'title_prefix_similarity',
      'title_edit_similarity', 'pattern_type_code', 'repository_validation_frequency', 'user_repository_frequency',
    ]);
    assert.ok(artifact.trees.length > 0);
    assert.match(artifact.training.catBoostVersion, /^1\.2\.8$/);
    assert.equal(artifact.evaluation.trainingSamples, 4);
    assert.equal(artifact.evaluation.positiveSamples, 2);
    assert.match(artifact.training.datasetVersion, /^sha256:[a-f0-9]{64}$/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('offline trainer rejects labels outside the explicit repository allowlist', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'clockoli-train-'));
  try {
    const corpus = join(directory, 'corpus.csv');
    const labels = join(directory, 'labels.csv');
    const model = join(directory, 'model.json');
    await writeFile(corpus, `${corpusHeader}\n1,${shaA},1,clockoli,#13 work,#13 work,Alice,,01/02/2026,09:00:00,01/02/2026,10:30:00,1.5\n`);
    await writeFile(labels, `${labelHeader}\n1,${shaA},1,https://github.com/other/private/issues/13,work,positive\n`);
    const result = train('--corpus', corpus, '--labels', labels, '--repository', 'clockoli/clockoli', '--output', model);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /allowlist/i);
    await assert.rejects(readFile(model, 'utf8'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('authenticated label generator validates private-repository entities and adds only guaranteed counterfactual negatives', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'clockoli-labels-'));
  try {
    const corpus = join(directory, 'corpus.csv');
    const labels = join(directory, 'labels.csv');
    const bin = join(directory, 'bin');
    const github = join(bin, 'gh');
    await mkdir(bin);
    await writeFile(corpus, [
      corpusHeader,
      `1,${shaA},1,private-repo,Issue 13 work,#13 work,Alice,,01/02/2026,09:00:00,01/02/2026,10:30:00,1.5`,
      `1,${shaB},1,private-repo,Issue 14 work,#14 work,Bob,,01/03/2026,09:00:00,01/03/2026,10:00:00,1`,
    ].join('\n') + '\n');
    await writeFile(github, `#!/bin/sh\nprintf '%s\\n' '{"data":{"candidate0":{"issueOrPullRequest":{"__typename":"Issue","url":"https://github.com/manticoresoftware/private-repo/issues/13","title":"Actual 13","number":13,"repository":{"nameWithOwner":"manticoresoftware/private-repo"}}},"candidate1":{"issueOrPullRequest":{"__typename":"Issue","url":"https://github.com/manticoresoftware/private-repo/issues/14","title":"Actual 14","number":14,"repository":{"nameWithOwner":"manticoresoftware/private-repo"}}}}}'\nexit 1\n`);
    await chmod(github, 0o755);

    const result = label('--corpus', corpus, '--owner', 'manticoresoftware', '--output', labels, '--github-command', github);
    assert.equal(result.status, 0, result.stderr);
    const output = (await readFile(labels, 'utf8')).trim().split('\n').map((line) => line.split(','));
    assert.equal(output.length, 5);
    assert.equal(output.filter((row) => row[5] === 'positive').length, 2);
    assert.equal(output.filter((row) => row[5] === 'negative').length, 2);
    assert.ok(output.slice(1).every((row) => row[3].startsWith('https://github.com/manticoresoftware/private-repo/issues/')));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
