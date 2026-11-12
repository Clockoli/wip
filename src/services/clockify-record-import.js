import { buildActiveTimer, buildEntry, normalizeTaskTitle, validateEntry } from '../domain/records.js';
import { localDateInTimezone } from '../domain/records.js';
import { applyTaskIndexChanges, parseTaskIndex, serializeTaskIndex, TASK_INDEX_PATH } from '../domain/task-index.js';
import { parseMonthlyRecords, monthlyRecordsPath, serializeMonthlyRecords } from '../domain/work-records.js';
import { createDeterministicUlid } from '../domain/ulid.js';
import { parseUserBranchMetadata, USER_METADATA_PATH } from './user-storage-branch.js';

const PROVENANCE_FIELD = 'clockoli_import';
const PROVENANCE_KEY = 'provenance_sha256';
const IMPORT_PRODUCER = Object.freeze({ kind: 'importer', name: 'clockoli', version: '1' });
const SUGGESTED_GITHUB_URL = /^https:\/\/github\.com\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/(?:issues|pull)\/[1-9][0-9]{0,8}$/;
const DESTINATION_READ_CONCURRENCY = 6;

function isNotFound(error) { return error?.status === 404 || error?.code === 'not_found'; }
function isConflict(error) { return error?.status === 409 || error?.code === 'conflict'; }

async function mapBounded(items, limit, operation) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await operation(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function preparationFailureReason(error) {
  const message = String(error?.message || '');
  if (/duration|timestamp|interval/i.test(message)) return 'invalid_imported_interval';
  if (/task URL|task title/i.test(message)) return 'invalid_imported_task';
  if (/description/i.test(message)) return 'invalid_imported_description';
  if (/timezone|entry date/i.test(message)) return 'invalid_imported_time_context';
  if (/entry ID/i.test(message)) return 'invalid_imported_record_id';
  return 'invalid_imported_record';
}

function githubWriteFailureReason(error) {
  if (error?.code === 'rate_limit') return 'github_write_rate_limited';
  if (error?.code === 'authentication' || error?.status === 401) return 'github_write_authentication';
  if (error?.code === 'permission' || error?.code === 'org_approval_required' || error?.status === 403) return 'github_write_permission';
  if (error?.code === 'not_found' || error?.status === 404) return 'github_write_target_missing';
  if (error?.code === 'validation' || error?.status === 400 || error?.status === 422) return 'github_write_rejected';
  return 'github_write_failed';
}

function safeFailureDiagnostic(stage, error) {
  if (stage !== 'preparing_records' || preparationFailureReason(error) !== 'invalid_imported_record') return null;
  const message = String(error?.message || '');
  const code = /Unsupported time entry schema/.test(message) ? 'destination_record_schema'
    : /Unsupported active timer schema/.test(message) ? 'destination_active_timer_schema'
    : /Duplicate imported work record ID/.test(message) ? 'destination_duplicate_record_id'
    : /Invalid imported entry|Invalid imported project identity/.test(message) ? 'destination_source_identity'
    : /Imported duration does not match exact timestamps|Invalid imported interval/.test(message) ? 'destination_time_context'
    : /identity|entry ID|record ID/i.test(message) ? 'destination_record_identity'
    : /timestamp|date|timezone|createdAt|updatedAt|endedAt|startedAt|duration/i.test(message) ? 'destination_time_context'
    : /producer/i.test(message) ? 'destination_producer'
    : /actor|user/i.test(message) ? 'destination_actor'
    : /metadata|metrics/i.test(message) ? 'destination_metadata'
    : /description/i.test(message) ? 'destination_description'
    : /task URL|task title/i.test(message) ? 'destination_task'
    : 'destination_record_validation';
  const detail = /^[A-Za-z][A-Za-z0-9 _:-]{0,120}$/.test(message) ? message : null;
  const collision = error?.collision;
  const validCollisionSide = value => value && typeof value === 'object'
    && typeof value.recordId === 'string' && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value.recordId)
    && typeof value.provenanceSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.provenanceSha256)
    && typeof value.startedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.startedAt)
    && typeof value.endedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.endedAt)
    && Number.isSafeInteger(value.durationSeconds) && value.durationSeconds >= 0
    && typeof value.taskFingerprintSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.taskFingerprintSha256);
  const collisionLocation = code === 'destination_duplicate_record_id'
    && validCollisionSide(collision?.incoming) && validCollisionSide(collision?.existing)
    && typeof collision.existing.path === 'string' && /^times\/\d{4}-(?:0[1-9]|1[0-2])\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\.jsonl$/.test(collision.existing.path)
    && Number.isSafeInteger(collision.existing.line) && collision.existing.line >= 1
    && collision.comparison && typeof collision.comparison === 'object'
    && ['sameProvenance', 'sameTimeRange', 'sameTaskFingerprint'].every(key => typeof collision.comparison[key] === 'boolean')
    ? collision
    : null;
  return { stage: 'preparing_destination_record', code, ...(detail ? { detail } : {}), ...(collisionLocation ? { collision: collisionLocation } : {}) };
}
function failureReason(stage, error) {
  if (stage === 'overlapping_intervals' || error?.code === 'overlapping_intervals') return 'overlapping_intervals';
  if (stage === 'verifying_storage') return 'storage_branch_incomplete';
  if (stage === 'reading_existing_records') return 'storage_data_unreadable';
  if (stage === 'preparing_records') return preparationFailureReason(error);
  if (stage === 'writing_records') return githubWriteFailureReason(error);
  return 'record_write_failed';
}

function validGithubUser(user) {
  return Number.isSafeInteger(user?.id) && user.id > 0
    && typeof user.login === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(user.login);
}

function normalizedIdentity(entry, githubUserId) {
  if (!entry || typeof entry !== 'object') throw new Error('Invalid imported entry');
  const values = [
    entry.provider, entry.entryId, entry.userId, entry.startedAt, entry.endedAt,
    entry.timezone, entry.duration,
  ];
  if (values.some(value => (typeof value !== 'string' && typeof value !== 'number') || value === '')) throw new Error('Invalid imported entry identity');
  if (!Number.isSafeInteger(githubUserId) || githubUserId <= 0) throw new Error('Invalid GitHub user identity');
  // Length-prefixing makes this identity unambiguous without retaining source values.
  return `clockoli-import-v1|${githubUserId}|${values.map(value => `${value.length}:${value}`).join('|')}`;
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function collisionTimeRange(value) {
  return {
    startedAt: value.startedAt,
    endedAt: value.endedAt,
    durationSeconds: value.duration ?? value.durationSeconds,
  };
}

async function taskFingerprint(taskUrl, taskTitle) {
  return sha256(`clockoli-import-task-v1|${taskUrl.length}:${taskUrl}|${taskTitle.length}:${taskTitle}`);
}

async function collisionDiagnostic(candidate, existing, path, line) {
  const incomingTask = importedTaskIdentity(candidate);
  const incoming = {
    recordId: candidate.id,
    provenanceSha256: candidate.provenance,
    ...collisionTimeRange(candidate),
    taskFingerprintSha256: await taskFingerprint(incomingTask.url, incomingTask.title),
  };
  const stored = {
    recordId: existing.id,
    provenanceSha256: provenanceOf(existing),
    ...collisionTimeRange(existing),
    taskFingerprintSha256: await taskFingerprint(existing.taskUrl, existing.taskTitle),
    path,
    line,
  };
  return {
    incoming,
    existing: stored,
    comparison: {
      sameProvenance: incoming.provenanceSha256 === stored.provenanceSha256,
      sameTimeRange: incoming.startedAt === stored.startedAt && incoming.endedAt === stored.endedAt && incoming.durationSeconds === stored.durationSeconds,
      sameTaskFingerprint: incoming.taskFingerprintSha256 === stored.taskFingerprintSha256,
    },
  };
}

function provenanceOf(entry) {
  return entry?.metadata?.[PROVENANCE_FIELD]?.[PROVENANCE_KEY];
}

function validResolvedIssue(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && typeof value.url === 'string' && SUGGESTED_GITHUB_URL.test(value.url)
    && typeof value.title === 'string' && value.title.trim();
}

function clockifyProjectTaskUrl(entry) {
  if (typeof entry?.organization !== 'string' || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(entry.organization)) throw new Error('Invalid imported project identity');
  const project = normalizeTaskTitle(entry.project).replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!project || project.length > 100) throw new Error('Invalid imported project identity');
  const title = normalizeTaskTitle(entry.task || entry.description || entry.project).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!title || title.length > 300) throw new Error('Invalid imported task identity');
  return `${entry.organization}/${project}/${title}`;
}

function legacyClockifyProjectTaskUrl(entry) {
  if (typeof entry?.projectId !== 'string' || !entry.projectId) throw new Error('Invalid imported project identity');
  return `https://app.clockify.me/reports/detailed?project=${encodeURIComponent(entry.projectId)}`;
}

function clockifyTaskTitle(entry) {
  const project = normalizeTaskTitle(entry?.project);
  const task = normalizeTaskTitle(entry?.task);
  return normalizeTaskTitle([project, task].filter(Boolean).join(' — '));
}

function importedTaskIdentity(entry) {
  return validResolvedIssue(entry?.resolvedIssue)
    ? entry.resolvedIssue
    : { url: clockifyProjectTaskUrl(entry), title: clockifyTaskTitle(entry) };
}

function replayIdentityKey(entryDate, duration, taskUrl, taskTitle) {
  return [entryDate, duration, taskUrl, taskTitle].join('|');
}

function candidateReplayIdentityKeys(entry) {
  const entryDate = localDateInTimezone(entry.startedAt, entry.timezone);
  return [
    replayIdentityKey(entryDate, entry.duration, importedTaskIdentity(entry).url, importedTaskIdentity(entry).title),
    replayIdentityKey(entryDate, entry.duration, legacyClockifyProjectTaskUrl(entry), clockifyTaskTitle(entry)),
  ];
}

function recordReplayIdentityKey(record) {
  return replayIdentityKey(record.entryDate, record.durationSeconds, record.taskUrl, record.taskTitle);
}

function isImportedRecordForMappedUser(record, githubUser) {
  return record?.producer?.kind === IMPORT_PRODUCER.kind
    && record?.producer?.name === IMPORT_PRODUCER.name
    && record?.user === githubUser.login
    && record?.actor?.kind === 'human'
    && record?.actor?.id === `github:${githubUser.id}`;
}

function isLegacyDeterministicIdTarget(candidate, item, githubUser) {
  if (!isImportedRecordForMappedUser(item.record, githubUser) || item.record.id !== candidate.id) return false;
  const task = importedTaskIdentity(candidate);
  return item.record.durationSeconds === candidate.duration
    && item.record.taskUrl === task.url
    && item.record.taskTitle === task.title;
}

function addToIndex(index, key, value) {
  const values = index.get(key);
  if (values) values.push(value);
  else index.set(key, [value]);
}

function replayTargets(candidates, files, githubUser) {
  const records = [...files.values()].flatMap(file => file.entries.map((record, index) => ({ file, index, record })));
  const recordsByProvenance = new Map();
  const recordsByIdentity = new Map();
  const recordsById = new Map();
  for (const item of records) {
    const provenance = provenanceOf(item.record);
    if (typeof provenance === 'string') addToIndex(recordsByProvenance, provenance, item);
    addToIndex(recordsById, item.record.id, item);
    if (isImportedRecordForMappedUser(item.record, githubUser)) {
      addToIndex(recordsByIdentity, recordReplayIdentityKey(item.record), item);
    }
  }
  const candidateIdentityKeys = new Map();
  const candidateCountsByIdentity = new Map();
  const candidateCountsById = new Map();
  for (const candidate of candidates) {
    const keys = candidateReplayIdentityKeys(candidate);
    candidateIdentityKeys.set(candidate, keys);
    for (const key of keys) candidateCountsByIdentity.set(key, (candidateCountsByIdentity.get(key) ?? 0) + 1);
    candidateCountsById.set(candidate.id, (candidateCountsById.get(candidate.id) ?? 0) + 1);
  }
  const targets = new Map();
  for (const candidate of candidates) {
    const provenanceMatches = recordsByProvenance.get(candidate.provenance) ?? [];
    const identityKeys = candidateIdentityKeys.get(candidate);
    const identityMatches = [...new Set(identityKeys.flatMap(key => recordsByIdentity.get(key) ?? []))];
    const legacyIdMatches = candidateCountsById.get(candidate.id) === 1
      ? (recordsById.get(candidate.id) ?? []).filter(item => isLegacyDeterministicIdTarget(candidate, item, githubUser))
      : [];
    const matches = provenanceMatches.length ? provenanceMatches : identityMatches.length ? identityMatches : legacyIdMatches;
    if (matches.length !== 1) continue;
    const usedLegacyIdMatch = !provenanceMatches.length && !identityMatches.length && legacyIdMatches.length === 1;
    if (!provenanceMatches.length && !usedLegacyIdMatch && candidateCountsByIdentity.get(recordReplayIdentityKey(matches[0].record)) !== 1) continue;
    targets.set(candidate.provenance, matches[0]);
  }
  return targets;
}

function sameImportedRecord(record, replacement) {
  return record.startedAt === replacement.startedAt
    && record.endedAt === replacement.endedAt
    && record.taskUrl === replacement.taskUrl
    && record.taskTitle === replacement.taskTitle
    && record.description === replacement.description
    && provenanceOf(record) === provenanceOf(replacement);
}

function collapseRecordsById(records) {
  const byId = new Map();
  for (const record of records) byId.set(record.id, record);
  return [...byId.values()];
}

function overlappingIntervalsError() {
  const error = new Error('Imported completed time overlaps an existing record');
  error.code = 'overlapping_intervals';
  return error;
}

function firstIntervalAtOrAfter(intervals, startedAt) {
  let lower = 0;
  let upper = intervals.length;
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    if (intervals[middle].startedAt < startedAt) lower = middle + 1;
    else upper = middle;
  }
  return lower;
}

function firstOverlap(intervals, startedAt, endedAt) {
  const index = firstIntervalAtOrAfter(intervals, startedAt);
  const previous = intervals[index - 1];
  if (previous && startedAt < previous.endedAt) return previous;
  const next = intervals[index];
  return next && next.startedAt < endedAt ? next : null;
}

function insertInterval(intervals, interval) {
  intervals.splice(firstIntervalAtOrAfter(intervals, interval.startedAt), 0, interval);
}

function verifyNonOverlappingAdditions(additions) {
  let previousEnd = -Infinity;
  for (const { record } of [...additions].sort((left, right) => left.record.startedAt.localeCompare(right.record.startedAt)
    || left.record.endedAt.localeCompare(right.record.endedAt))) {
    const startedAt = new Date(record.startedAt).getTime();
    const endedAt = new Date(record.endedAt).getTime();
    if (startedAt < previousEnd) throw overlappingIntervalsError();
    previousEnd = Math.max(previousEnd, endedAt);
  }
}

// Existing Clockoli intervals remain fixed. Every imported interval that
// collides with either source or existing time moves forward in source order,
// preserving its reported duration and never changing existing Clockoli time.
function normalizeImportedIntervals(candidates, fixedIntervals = []) {
  const candidateProvenance = new Set(candidates.map(candidate => candidate.provenance));
  const occupied = fixedIntervals
    .filter(record => !candidateProvenance.has(provenanceOf(record)))
    .map(record => ({ startedAt: new Date(record.startedAt).getTime(), endedAt: new Date(record.endedAt).getTime() }))
    .filter(interval => Number.isFinite(interval.startedAt) && Number.isFinite(interval.endedAt) && interval.startedAt < interval.endedAt)
    .sort((left, right) => left.startedAt - right.startedAt);
  const normalized = [];
  for (const candidate of [...candidates]
    .sort((left, right) => new Date(left.startedAt).getTime() - new Date(right.startedAt).getTime()
      || left.provenance.localeCompare(right.provenance))) {
      const sourceStart = new Date(candidate.startedAt).getTime();
      const sourceEnd = new Date(candidate.endedAt).getTime();
      const durationMilliseconds = candidate.duration * 1000;
      if (!Number.isFinite(sourceStart) || !Number.isFinite(sourceEnd)
        || !Number.isSafeInteger(candidate.duration) || candidate.duration <= 0
        || Math.round((sourceEnd - sourceStart) / 1000) !== candidate.duration) {
        throw new Error('Invalid imported interval');
      }
      let startedAt = sourceStart;
      let endedAt = startedAt + durationMilliseconds;
      for (;;) {
        const overlap = firstOverlap(occupied, startedAt, endedAt);
        if (!overlap) break;
        startedAt = overlap.endedAt;
        endedAt = startedAt + durationMilliseconds;
      }
      const interval = { startedAt, endedAt };
      insertInterval(occupied, interval);
      normalized.push({ ...candidate, startedAt: new Date(interval.startedAt).toISOString(), endedAt: new Date(interval.endedAt).toISOString() });
  }
  return normalized;
}

async function readRequired(github, path, label) {
  try { return await github.getText(path); }
  catch (error) {
    if (isNotFound(error)) throw new Error(`Required Clockoli ${label} is missing`);
    throw error;
  }
}

function completedRecord({ entry, githubUser, id, now }) {
  const startedAt = entry.startedAt;
  const entryDate = localDateInTimezone(startedAt, entry.timezone);
  const taskIdentity = importedTaskIdentity(entry);
  const active = buildActiveTimer({
    user: githubUser.login,
    id,
    actor: { kind: 'human', id: `github:${githubUser.id}`, name: githubUser.login },
    producer: IMPORT_PRODUCER,
    taskUrl: taskIdentity.url,
    importedStoredIdentity: true,
    taskTitle: taskIdentity.title,
    startedAt,
    entryDate,
    timezone: entry.timezone,
    description: String(entry.description ?? ''),
    metadata: { [PROVENANCE_FIELD]: { [PROVENANCE_KEY]: entry.provenance } },
    metrics: {},
  });
  const result = buildEntry({ active, endedAt: entry.endedAt, now: (typeof now === 'function' ? now() : now) ?? entry.endedAt });
  if (result.durationSeconds !== entry.duration) throw new Error('Imported duration does not match exact timestamps');
  return validateEntry(result);
}

/**
 * Imports one mapped Clockify user into Clockoli's configured writer branch.
 * The normalized source entry is never copied into storage; only its opaque digest is.
 */
export async function importClockifyCompletedRecords({ github, githubUser, entries, idFactory, now, onProfile } = {}) {
  let stage = 'validating_request';
  const startedAt = performance.now();
  const profile = name => {
    if (typeof onProfile === 'function') onProfile({ stage: name, elapsedMs: Math.round(performance.now() - startedAt) });
  };
  try {
    if (!github || !validGithubUser(githubUser) || !Array.isArray(entries)) {
      throw new Error('Invalid Clockify import request');
    }
    // Fail closed: migration uses the already-configured Clockoli writer branch
    // and never creates or switches to another branch.
    const storageGithub = github;
    stage = 'verifying_storage';
    profile(stage);
    const metadataFile = await readRequired(storageGithub, USER_METADATA_PATH, 'user branch metadata');
    const metadata = parseUserBranchMetadata(metadataFile.text);
    if (metadata.id !== githubUser.id || metadata.login.toLowerCase() !== githubUser.login.toLowerCase()) {
      throw new Error('Clockoli user branch identity does not match mapped user');
    }
    const indexFile = await readRequired(storageGithub, TASK_INDEX_PATH, 'task index');
    const taskIndex = parseTaskIndex(indexFile.text, { user: githubUser.login });

    stage = 'preparing_records';
    profile(stage);
    const seenProvenance = new Set();
    const candidates = [];
    for (const rawEntry of entries) {
      const provenance = await sha256(normalizedIdentity(rawEntry, githubUser.id));
      if (seenProvenance.has(provenance)) continue;
      seenProvenance.add(provenance);
      const deterministicId = idFactory
        ? await idFactory(rawEntry.startedAt, provenance)
        : await createDeterministicUlid(new Date(rawEntry.startedAt).getTime(), provenance);
      candidates.push({
        ...rawEntry, organization: github.owner, provenance, id: deterministicId,
      });
    }

    const byPath = new Map();
    for (const candidate of candidates) {
      const entryDate = localDateInTimezone(candidate.startedAt, candidate.timezone);
      const path = monthlyRecordsPath(githubUser.login, entryDate);
      if (!byPath.has(path)) byPath.set(path, []);
      byPath.get(path).push(candidate);
    }

    const files = new Map();
    stage = 'reading_existing_records';
    profile(stage);
    // A missing month is normal for a first import. One branch-tree read avoids
    // a separate GitHub Contents 404 for every empty monthly partition.
    let branchPaths = null;
    if (byPath.size && typeof storageGithub.listRepositoryEntries === 'function') {
      try {
        const branchEntries = await storageGithub.listRepositoryEntries();
        if (Array.isArray(branchEntries) && branchEntries.every(item => typeof item?.path === 'string' && typeof item?.type === 'string')) {
          branchPaths = new Map(branchEntries.map(item => [item.path, item.type]));
        }
      } catch (error) {
        if (error?.code === 'rate_limit' || error?.code === 'migration_paused') throw error;
        // A rejected or truncated tree cannot prove that a month is absent.
        // Contents reads still validate any existing monthly records.
      }
    }
    const loadedFiles = await mapBounded([...byPath.keys()], DESTINATION_READ_CONCURRENCY, async path => {
      if (branchPaths && !branchPaths.has(path)) return { path, sha: null, entries: [] };
      if (branchPaths && branchPaths.get(path) !== 'blob') throw new Error('Clockoli monthly storage path is not a file');
      try {
        const file = await storageGithub.getText(path);
        return { path, sha: file.sha, entries: parseMonthlyRecords(file.text, { user: githubUser.login, path, sha: file.sha }) };
      } catch (error) {
        if (isNotFound(error)) return { path, sha: null, entries: [] };
        if (error?.repair?.kind === 'monthly_partition_mismatch') {
          const wrapped = new Error('Clockoli monthly storage partition is invalid');
          wrapped.repair = { ...error.repair, path };
          throw wrapped;
        }
        throw error;
      }
    });
    for (const file of loadedFiles) files.set(file.path, file);

    profile('matching_replay_targets');
    const uniqueCandidatesByProvenance = new Map();
    for (const candidate of candidates) {
      const prior = uniqueCandidatesByProvenance.get(candidate.provenance);
      if (!prior) { uniqueCandidatesByProvenance.set(candidate.provenance, candidate); continue; }
      if (prior.startedAt !== candidate.startedAt || prior.endedAt !== candidate.endedAt || prior.id !== candidate.id) {
        throw new Error('Duplicate imported provenance has conflicting records');
      }
    }
    const uniqueCandidates = [...uniqueCandidatesByProvenance.values()];
    const recordsById = new Map();
    for (const file of files.values()) for (let index = 0; index < file.entries.length; index += 1) recordsById.set(file.entries[index].id, { file, index, record: file.entries[index] });
    const targets = replayTargets(uniqueCandidates, files, githubUser);
    profile('normalizing_intervals');
    const replacedRecords = new Set([...targets.values()].map(target => target.record));
    const normalizedCandidates = normalizeImportedIntervals(uniqueCandidates,
      [...files.values()].flatMap(file => file.entries).filter(record => !replacedRecords.has(record)));
    for (const candidate of normalizedCandidates) {
      const path = monthlyRecordsPath(githubUser.login, localDateInTimezone(candidate.startedAt, candidate.timezone));
      if (!files.has(path)) files.set(path, { path, sha: null, entries: [] });
    }

    let alreadyPresent = 0;
    let updated = 0;
    const additions = [];
    const replacements = [];
    stage = 'preparing_records';
    profile('building_records');
    for (const candidate of normalizedCandidates) {
      const path = monthlyRecordsPath(githubUser.login, localDateInTimezone(candidate.startedAt, candidate.timezone));
      const file = files.get(path);
      const target = targets.get(candidate.provenance);
      if (target) {
        const replacement = completedRecord({ entry: candidate, githubUser, id: target.record.id, now });
        if (sameImportedRecord(target.record, replacement)) {
          alreadyPresent += 1;
          continue;
        }
        if (provenanceOf(target.record) === candidate.provenance) alreadyPresent += 1;
        const replacementPath = monthlyRecordsPath(githubUser.login, replacement.entryDate);
        if (replacementPath === target.file.path) {
          target.file.entries[target.index] = replacement;
        } else {
          target.file.entries.splice(target.index, 1);
          const destination = files.get(replacementPath);
          if (!destination) throw new Error('Generated replacement record has no monthly partition');
          destination.entries.push(replacement);
        }
        replacements.push({ previous: target.record, record: replacement });
        updated += 1;
        continue;
      }
      const existingIndex = file.entries.findIndex(existing => provenanceOf(existing) === candidate.provenance);
      if (existingIndex !== -1) {
        alreadyPresent += 1;
        const existing = file.entries[existingIndex];
        const replacement = completedRecord({ entry: candidate, githubUser, id: existing.id, now });
        if (!sameImportedRecord(existing, replacement)) {
          file.entries[existingIndex] = replacement;
          replacements.push({ previous: existing, record: replacement });
          updated += 1;
        }
        continue;
      }
      const record = completedRecord({ entry: candidate, githubUser, id: candidate.id, now });
      const idTarget = recordsById.get(record.id);
      if (idTarget) {
        const error = new Error('Duplicate imported work record ID');
        error.collision = await collisionDiagnostic(candidate, idTarget.record, idTarget.file.path, idTarget.index + 1);
        throw error;
      } else {
        additions.push({ path, record });
      }
    }

    if (!additions.length && !updated) return { status: 'already_present', added: 0, alreadyPresent };

    profile('validating_output');
    verifyNonOverlappingAdditions(additions);

    const additionsById = new Map();
    for (const addition of additions) additionsById.set(addition.record.id, addition);
    const uniqueAdditions = [...additionsById.values()];
    const usedIds = new Set([...files.values()].flatMap(file => file.entries.map(entry => entry.id)));
    for (const { record } of uniqueAdditions) {
      if (usedIds.has(record.id)) throw new Error('Duplicate imported work record ID');
      usedIds.add(record.id);
    }
    for (const { record } of uniqueAdditions) {
      const path = monthlyRecordsPath(githubUser.login, record.entryDate);
      const file = files.get(path);
      if (!file) throw new Error('Generated destination record has no monthly partition');
      file.entries.push(record);
    }
    for (const file of files.values()) file.entries = collapseRecordsById(file.entries);
    for (const file of files.values()) serializeMonthlyRecords(file.entries); // validate complete output before writing

    const removalRecords = collapseRecordsById(replacements.map(item => item.previous));
    const knownIndexIds = new Set(Object.values(taskIndex.tasks).flatMap(summary => summary.recordIds));
    const removalIds = new Set(removalRecords.map(record => record.id));
    const indexedRecords = collapseRecordsById([...replacements.map(item => item.record), ...uniqueAdditions.map(item => item.record)])
      .filter(record => !knownIndexIds.has(record.id) || removalIds.has(record.id));
    const nextIndex = applyTaskIndexChanges(taskIndex, {
      remove: removalRecords,
      add: indexedRecords,
    });
    const changes = [...files.values()].map(file => {
      const text = serializeMonthlyRecords(file.entries);
      parseMonthlyRecords(text, { user: githubUser.login, path: file.path, sha: file.sha });
      return { path: file.path, sha: file.sha, text };
    });
    if (additions.length || replacements.length) changes.push({ path: TASK_INDEX_PATH, sha: indexFile.sha, text: serializeTaskIndex(nextIndex) });
    stage = 'writing_records';
    profile(stage);
    await storageGithub.updateTextsAtomic(changes, `Import completed work records (${uniqueAdditions.length})`, {
      guards: [{ path: USER_METADATA_PATH, sha: metadataFile.sha }],
    });
    profile('records_written');
    return { status: 'imported', added: additions.length, alreadyPresent };
  } catch (error) {
    if (error?.code === 'rate_limit' || error?.code === 'migration_paused') throw error;
    // Import failures are intentionally reduced to a stable UI reason. Keep a
    // source-data-free diagnostic for the privileged runtime console.
    console.warn('Clockify import failed', { stage, error: String(error?.message || error) });
    profile(`failed:${stage}`);
    const repair = error?.repair?.kind === 'monthly_partition_mismatch' ? error.repair : null;
    const diagnostic = safeFailureDiagnostic(stage, error);
    return isConflict(error) ? { status: 'conflict' } : {
      status: 'failed', failureReason: failureReason(stage, error), ...(repair ? { repair } : {}), ...(diagnostic ? { diagnostic } : {}),
    };
  }
}

export { PROVENANCE_FIELD, PROVENANCE_KEY };
