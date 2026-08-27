import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeRecordPath, monthlyRecordsPath, parseActiveRecord, parseMonthlyRecords,
  parseMonthlyRecordsPath, serializeActiveRecord, serializeMonthlyRecords, timestampWithTimezone,
} from '../src/domain/work-records.js';
import { applyEntryEdits, buildActiveTimer, buildEntry } from '../src/domain/records.js';

const ID = '01K2ABCDEF0123456789ABCDEF';
const actor = { kind: 'human', id: 'github:123', name: 'alice' };
const producer = { kind: 'browser_extension', name: 'clockoli-chrome', version: '0.1.29' };
const active = buildActiveTimer({
  user: 'alice', id: ID, actor, producer,
  taskUrl: 'https://github.com/acme/frontend/issues/123', taskTitle: 'Ranking regression',
  startedAt: '2026-08-18T15:00:00.000Z', entryDate: '2026-08-18', timezone: 'America/Los_Angeles',
  description: 'Investigating',
});
const entry = buildEntry({ active, endedAt: '2026-08-18T16:15:30.000Z', now: '2026-08-18T16:15:31.000Z' });

function context(path = 'times/2026-08/alice.jsonl', sha = 'monthly-sha') {
  return { user: 'alice', month: '2026-08', path, sha };
}

test('v1 storage paths use one active JSON object and monthly JSONL records', () => {
  assert.equal(monthlyRecordsPath('alice', '2026-08-18'), 'times/2026-08/alice.jsonl');
  assert.deepEqual(parseMonthlyRecordsPath('times/2026-08/alice.jsonl'), {
    path: 'times/2026-08/alice.jsonl', month: '2026-08', user: 'alice',
  });
  assert.equal(activeRecordPath('alice'), 'active/alice.json');
  assert.throws(() => monthlyRecordsPath('../alice', '2026-08-18'), /user/i);
  assert.throws(() => parseMonthlyRecordsPath('times/2026-08/alice.txt'), /monthly/i);
});

test('active JSON stores the canonical nested v1 envelope and record ID', () => {
  const text = serializeActiveRecord(active);
  const stored = JSON.parse(text);
  assert.equal(stored.schema_version, 1);
  assert.equal(stored.id, ID);
  assert.equal(stored.record_type, 'work');
  assert.deepEqual(stored.actor, actor);
  assert.deepEqual(stored.work_item, {
    kind: 'github_issue', id: 'url:https://github.com/acme/frontend/issues/123',
    url: 'https://github.com/acme/frontend/issues/123', title: 'Ranking regression',
  });
  assert.deepEqual(stored.activity, {
    state: 'running', started_at: '2026-08-18T15:00:00.000Z', ended_at: null,
    local_date: '2026-08-18', timezone: 'America/Los_Angeles',
  });
  assert.deepEqual(stored.producer, producer);
  assert.equal(stored.created_at, '2026-08-18T15:00:00.000Z');
  assert.equal(stored.updated_at, '2026-08-18T15:00:00.000Z');
  assert.equal(text.endsWith('\n'), true);

  const parsed = parseActiveRecord(text, { user: 'alice', path: 'active/alice.json', sha: 'active-sha' });
  assert.equal(parsed.id, ID);
  assert.equal(parsed.entryDate, '2026-08-18');
  assert.equal(parsed.timezone, 'America/Los_Angeles');
  assert.equal(parsed.taskTitle, 'Ranking regression');
  assert.equal(parsed._sha, 'active-sha');
});

test('monthly JSONL round-trips completed records and derives duration', () => {
  const secondActive = buildActiveTimer({
    user: 'alice', id: '01K2ABCDEF0123456789ABCDEG', actor, producer,
    taskUrl: 'https://example.com/work?q=42', startedAt: '2026-08-19T10:00:00.000Z',
    entryDate: '2026-08-19', timezone: 'UTC',
  });
  const second = buildEntry({ active: secondActive, endedAt: '2026-08-19T10:30:00.000Z' });
  const text = serializeMonthlyRecords([entry, second]);
  assert.equal(text.trim().split('\n').length, 2);
  const parsed = parseMonthlyRecords(text, context());
  assert.deepEqual(parsed.map(record => record.entryDate), ['2026-08-18', '2026-08-19']);
  assert.equal(parsed[0].id, ID);
  assert.equal(parsed[0]._index, 0);
  assert.equal(parsed[0]._sha, 'monthly-sha');
  assert.equal(parsed[0].durationSeconds, 4530);
  assert.equal(parsed[1].taskUrl, 'https://example.com/work?q=42');
});

test('v1 parser rejects old text blocks, malformed JSONL, duplicates, and wrong state or partition', () => {
  const completed = JSON.parse(serializeMonthlyRecords([entry]));
  assert.throws(() => parseMonthlyRecords('URL: https://example.com\nStart: 2026-08-18T08:00:00Z\n', context()), /JSON/i);
  assert.throws(() => parseMonthlyRecords(`${JSON.stringify(completed)}\n\n`, context()), /blank/i);
  assert.throws(() => parseMonthlyRecords(`${JSON.stringify(completed)}\n${JSON.stringify(completed)}\n`, context()), /duplicate/i);
  assert.throws(() => parseMonthlyRecords(`${JSON.stringify({ ...completed, activity: { ...completed.activity, state: 'running', ended_at: null } })}\n`, context()), /completed/i);
  assert.throws(() => parseMonthlyRecords(`${JSON.stringify({ ...completed, activity: { ...completed.activity, local_date: '2026-09-01' } })}\n`, context()), /month|partition/i);
  assert.throws(() => parseMonthlyRecords(`${JSON.stringify({ ...completed, schema_version: 2 })}\n`, context()), /schema/i);
  assert.throws(() => parseMonthlyRecords(`${JSON.stringify({ ...completed, id: `8${completed.id.slice(1)}` })}\n`, context()), /entry ID/i);
  assert.throws(() => parseMonthlyRecords(`${JSON.stringify({ ...completed, activity: { ...completed.activity, timezone: '' } })}\n`, context()), /timezone/i);
  assert.throws(() => parseMonthlyRecords(`${JSON.stringify({ ...completed, actor: { ...completed.actor, name: 'bob' } })}\n`, context()), /actor|storage/i);
  assert.throws(() => parseMonthlyRecords(JSON.stringify(completed), context()), /newline|terminator|JSONL/i);
  const runningText = serializeActiveRecord(active);
  assert.throws(() => parseActiveRecord(runningText.slice(0, -1), { user: 'alice' }), /newline|terminator/i);
  assert.throws(() => parseActiveRecord(`${runningText}\n`, { user: 'alice' }), /newline|terminator/i);
  assert.throws(() => parseActiveRecord(`${runningText.slice(0, -1)}\r\n`, { user: 'alice' }), /newline|terminator/i);
  assert.throws(() => parseActiveRecord(`${runningText.slice(0, -1)}  \n`, { user: 'alice' }), /newline|terminator/i);
  assert.throws(() => parseActiveRecord(`${runningText} \n`, { user: 'alice' }), /newline|terminator/i);
  const running = JSON.parse(runningText);
  assert.throws(() => parseActiveRecord(`${JSON.stringify({ ...running, actor: { ...running.actor, name: 'bob' } })}\n`, { user: 'alice' }), /actor|storage/i);
  assert.throws(() => parseActiveRecord(`${JSON.stringify({ ...running, actor: { ...running.actor, name: 'bob' } })}\n`, { path: 'active/alice.json' }), /actor|storage/i);
  assert.throws(() => parseMonthlyRecords(`${JSON.stringify({ ...completed, actor: { ...completed.actor, name: 'bob' } })}\n`, { month: '2026-08', path: 'times/2026-08/alice.jsonl' }), /actor|storage/i);
  assert.throws(() => parseActiveRecord(`${JSON.stringify(completed)}\n`, { user: 'alice' }), /running/i);
  assert.throws(() => timestampWithTimezone('2026-02-31T08:00:00.000Z'), /timestamp/i);
});

test('record ID survives Start, Stop, parse, edit, and rewrite', () => {
  assert.equal(active.id, ID);
  assert.equal(entry.id, ID);
  const parsed = parseMonthlyRecords(serializeMonthlyRecords([entry]), context())[0];
  const edited = applyEntryEdits(parsed, { endedAt: '2026-08-18T16:30:00.000Z', description: 'Done' }, '2026-08-18T17:00:00.000Z');
  const saved = parseMonthlyRecords(serializeMonthlyRecords([edited]), context())[0];
  assert.equal(saved.id, ID);
  assert.equal(saved.durationSeconds, 5400);
});

test('unknown root and nested fields survive supported edits and rewrites', () => {
  const stored = JSON.parse(serializeMonthlyRecords([entry]));
  stored.future_root = { enabled: true };
  stored.actor.provider_data = { team: 'search' };
  stored.work_item.provider_node_id = 'I_kwDOExample';
  stored.activity.future_clock = 'monotonic';
  stored.producer.build = { channel: 'dev' };
  stored.metadata.category = 'development';
  stored.metrics['llm.input_tokens'] = {
    value: 12, unit: 'token', aggregation: 'sum', source: 'provider', future_metric_field: 'kept',
  };
  stored.execution = { id: 'run:1', session_id: 'session:1', parent_id: null, attempt: 1, future_execution: true };

  const parsed = parseMonthlyRecords(`${JSON.stringify(stored)}\n`, context())[0];
  const edited = applyEntryEdits(parsed, { description: 'Updated' }, '2026-08-18T17:00:00.000Z');
  const rewritten = JSON.parse(serializeMonthlyRecords([edited]));

  assert.deepEqual(rewritten.future_root, { enabled: true });
  assert.deepEqual(rewritten.actor.provider_data, { team: 'search' });
  assert.equal(rewritten.work_item.provider_node_id, 'I_kwDOExample');
  assert.equal(rewritten.activity.future_clock, 'monotonic');
  assert.deepEqual(rewritten.producer.build, { channel: 'dev' });
  assert.equal(rewritten.metadata.category, 'development');
  assert.equal(rewritten.metrics['llm.input_tokens'].future_metric_field, 'kept');
  assert.equal(rewritten.execution.future_execution, true);
  assert.equal(rewritten.description, 'Updated');
});

test('changing a task URL updates URL-derived identity but preserves unrelated extension fields', () => {
  const stored = JSON.parse(serializeMonthlyRecords([entry]));
  stored.work_item.provider_hint = 'keep';
  stored.metadata = { custom: { keep: true }, github: { item: { number: 123 } } };
  const parsed = parseMonthlyRecords(`${JSON.stringify(stored)}\n`, context())[0];
  const edited = applyEntryEdits(parsed, { taskUrl: 'https://example.com/new', taskTitle: 'New task' });
  const rewritten = JSON.parse(serializeMonthlyRecords([edited]));
  assert.equal(rewritten.work_item.id, 'url:https://example.com/new');
  assert.equal(rewritten.work_item.url, 'https://example.com/new');
  assert.equal(rewritten.work_item.title, 'New task');
  assert.equal(rewritten.work_item.provider_hint, 'keep');
  assert.deepEqual(rewritten.metadata, { custom: { keep: true } });
});
