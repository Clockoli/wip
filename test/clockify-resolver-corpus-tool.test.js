import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url);
const HEADER = 'Project,Client,Description,Task,User,Group,Email,Tags,Billable,Start Date,Start Time,End Date,End Time,Duration (h),Duration (decimal),Billable Rate (0),Billable Amount (0),Date of creation';
const ROW = 'clockoli,private,"#13 Add CSV resolver",#13 Add CSV resolver,Alice,dev,alice@example.test,backend,Yes,01/02/2026,09:00:00,01/02/2026,10:30:00,01:30,1.5,100,150,01/02/2026';

function tool(...args) {
  return spawnSync('python3', ['scripts/clockify-resolver-corpus.py', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

test('offline corpus tool emits a minimized versioned CSV and manifest without personal or billing columns', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'clockoli-corpus-'));
  try {
    const source = join(directory, 'Clockify_Time_Report_Detailed_2026.csv');
    const output = join(directory, 'corpus.csv');
    const manifest = join(directory, 'manifest.json');
    await writeFile(source, `${HEADER}\n${ROW}\n`, 'utf8');

    const result = tool('extract', '--input', source, '--output', output, '--manifest', manifest);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /1 training rows/);

    const corpus = await readFile(output, 'utf8');
    const [header, row] = corpus.trimEnd().split('\n');
    assert.equal(header, 'schema_version,source_file_sha256,source_record_number,project,description,task,user,tags,start_date,start_time,end_date,end_time,duration_decimal');
    assert.match(row, /^1,[a-f0-9]{64},1,clockoli,#13 Add CSV resolver,#13 Add CSV resolver,Alice,backend,01\/02\/2026,09:00:00,01\/02\/2026,10:30:00,1\.5$/);
    assert.doesNotMatch(corpus, /alice@example\.test|private|100|150/);

    const parsedManifest = JSON.parse(await readFile(manifest, 'utf8'));
    assert.deepEqual(parsedManifest, {
      version: 1,
      sourceFiles: [{ name: 'Clockify_Time_Report_Detailed_2026.csv', sha256: parsedManifest.sourceFiles[0].sha256, records: 1 }],
    });
    assert.match(parsedManifest.sourceFiles[0].sha256, /^[a-f0-9]{64}$/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('offline corpus tool rejects a changed Clockify CSV schema before producing output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'clockoli-corpus-'));
  try {
    const source = join(directory, 'report.csv');
    const output = join(directory, 'corpus.csv');
    const manifest = join(directory, 'manifest.json');
    await writeFile(source, 'Project,Description\nclockoli,unsafe\n', 'utf8');

    const result = tool('extract', '--input', source, '--output', output, '--manifest', manifest);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /header/i);
    await assert.rejects(readFile(output, 'utf8'));
    await assert.rejects(readFile(manifest, 'utf8'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
