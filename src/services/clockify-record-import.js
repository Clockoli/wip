import { buildActiveTimer, buildEntry, normalizeTaskTitle, validateEntry } from '../domain/records.js';
import { localDateInTimezone } from '../domain/records.js';
import { applyTaskIndexChanges, parseTaskIndex, serializeTaskIndex, TASK_INDEX_PATH } from '../domain/task-index.js';
import { parseMonthlyRecords, monthlyRecordsPath, serializeMonthlyRecords } from '../domain/work-records.js';
import { createDeterministicUlid } from '../domain/ulid.js';
import { userStorageBranch, parseUserBranchMetadata, USER_METADATA_PATH } from './user-storage-branch.js';

const PROVENANCE_FIELD = 'clockoli_import';
const PROVENANCE_KEY = 'provenance_sha256';
const IMPORT_PRODUCER = Object.freeze({ kind: 'importer', name: 'clockoli', version: '1' });

function isNotFound(error) { return error?.status === 404 || error?.code === 'not_found'; }
function isConflict(error) { return error?.status === 409 || error?.code === 'conflict'; }

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

function provenanceOf(entry) {
  return entry?.metadata?.[PROVENANCE_FIELD]?.[PROVENANCE_KEY];
}

function taskIdentityPairs(candidate) {
  const pairs = [{ url: clockifyProjectTaskUrl(candidate), title: clockifyTaskTitle(candidate) }];
  if (candidate.resolvedIssue?.url && candidate.resolvedIssue?.title) {
    pairs.unshift({ url: candidate.resolvedIssue.url, title: candidate.resolvedIssue.title });
  }
  return pairs;
}

function replayIdentityMatches(record, candidate, githubUser) {
  return record?.producer?.kind === IMPORT_PRODUCER.kind
    && record?.producer?.name === IMPORT_PRODUCER.name
    && record?.user === githubUser.login
    && record?.actor?.kind === 'human'
    && record?.actor?.id === `github:${githubUser.id}`
    && record?.entryDate === localDateInTimezone(candidate.startedAt, candidate.timezone)
    && record?.durationSeconds === candidate.duration
    && taskIdentityPairs(candidate).some(identity => record?.taskUrl === identity.url && record?.taskTitle === identity.title);
}

function replayTargets(candidates, files, githubUser) {
  const records = [...files.values()].flatMap(file => file.entries.map((record, index) => ({ file, index, record })));
  const targets = new Map();
  for (const candidate of candidates) {
    const provenanceMatches = records.filter(item => provenanceOf(item.record) === candidate.provenance);
    const identityMatches = records.filter(item => replayIdentityMatches(item.record, candidate, githubUser));
    const matches = provenanceMatches.length ? provenanceMatches : identityMatches;
    if (matches.length !== 1) continue;
    const matchingCandidates = candidates.filter(other => replayIdentityMatches(matches[0].record, other, githubUser));
    if (!provenanceMatches.length && matchingCandidates.length !== 1) continue;
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

function intervalsOverlap(left, right) {
  return new Date(left.startedAt).getTime() < new Date(right.endedAt).getTime()
    && new Date(right.startedAt).getTime() < new Date(left.endedAt).getTime();
}

function overlappingIntervalsError() {
  const error = new Error('Imported completed time overlaps an existing record');
  error.code = 'overlapping_intervals';
  return error;
}

// Existing Clockoli intervals remain fixed. Every imported interval that
// collides with either source or existing time moves forward in source order,
// preserving its reported duration and never changing existing Clockoli time.
function normalizeImportedIntervals(candidates, fixedIntervals = []) {
  const candidateProvenance = new Set(candidates.map(candidate => candidate.provenance));
  const fixed = fixedIntervals
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
        const overlap = [...fixed, ...normalized.map(interval => ({
          startedAt: new Date(interval.startedAt).getTime(), endedAt: new Date(interval.endedAt).getTime(),
        }))].find(interval => startedAt < interval.endedAt && interval.startedAt < endedAt);
        if (!overlap) break;
        startedAt = overlap.endedAt;
        endedAt = startedAt + durationMilliseconds;
      }
      normalized.push({ ...candidate, startedAt: new Date(startedAt).toISOString(), endedAt: new Date(endedAt).toISOString() });
  }
  return normalized;
}

// The project identifier gives an imported task a stable URL identity. The
// project and task names remain the human-facing title in Clockoli.
function clockifyProjectTaskUrl(entry) {
  if (typeof entry?.projectId !== 'string' || !entry.projectId) throw new Error('Invalid imported project identity');
  return `https://app.clockify.me/reports/detailed?project=${encodeURIComponent(entry.projectId)}`;
}

function clockifyTaskTitle(entry) {
  const project = normalizeTaskTitle(entry?.project);
  const task = normalizeTaskTitle(entry?.task);
  return normalizeTaskTitle([project, task].filter(Boolean).join(' — '));
}

async function resolveClockifyIssue(github, entry) {
  if (typeof github?.resolveRepositoryIssue !== 'function') return null;
  const project = normalizeTaskTitle(entry?.project);
  const match = normalizeTaskTitle(entry?.task).match(/^#([1-9]\d*)\s+(.+)$/);
  if (!project || !match) return null;
  try {
    return await github.resolveRepositoryIssue({ repository: project, number: Number(match[1]), title: match[2] });
  } catch { return null; }
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
  const active = buildActiveTimer({
    user: githubUser.login,
    id,
    actor: { kind: 'human', id: `github:${githubUser.id}`, name: githubUser.login },
    producer: IMPORT_PRODUCER,
    taskUrl: entry.resolvedIssue?.url ?? clockifyProjectTaskUrl(entry),
    taskTitle: entry.resolvedIssue?.title ?? clockifyTaskTitle(entry),
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
 * Imports one already-mapped Clockify user into that user's pre-provisioned branch.
 * The normalized source entry is never copied into storage; only its opaque digest is.
 */
export async function importClockifyCompletedRecords({ github, githubUser, entries, idFactory, now } = {}) {
  let stage = 'validating_request';
  try {
    if (!github || typeof github.forBranch !== 'function' || !validGithubUser(githubUser) || !Array.isArray(entries)) {
      throw new Error('Invalid Clockify import request');
    }
    const branch = userStorageBranch(githubUser.id);
    const personalGithub = github.forBranch(branch, 'custom');
    if (!personalGithub || typeof personalGithub.getText !== 'function' || typeof personalGithub.updateTextsAtomic !== 'function') {
      throw new Error('Invalid personal GitHub client');
    }

    // Fail closed: importing never creates or repairs personal storage branches.
    stage = 'verifying_storage';
    const metadataFile = await readRequired(personalGithub, USER_METADATA_PATH, 'user branch metadata');
    const metadata = parseUserBranchMetadata(metadataFile.text);
    if (metadata.id !== githubUser.id || metadata.login.toLowerCase() !== githubUser.login.toLowerCase()) {
      throw new Error('Clockoli user branch identity does not match mapped user');
    }
    const indexFile = await readRequired(personalGithub, TASK_INDEX_PATH, 'task index');
    const taskIndex = parseTaskIndex(indexFile.text, { user: githubUser.login });

    stage = 'preparing_records';
    const seenProvenance = new Set();
    const candidates = [];
    for (const rawEntry of entries) {
      const provenance = await sha256(normalizedIdentity(rawEntry, githubUser.id));
      if (seenProvenance.has(provenance)) continue;
      seenProvenance.add(provenance);
      const deterministicId = idFactory
        ? await idFactory(rawEntry.startedAt, provenance)
        : await createDeterministicUlid(new Date(rawEntry.startedAt).getTime(), provenance);
      candidates.push({ ...rawEntry, provenance, id: deterministicId, resolvedIssue: await resolveClockifyIssue(github, rawEntry) });
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
    for (const path of byPath.keys()) {
      try {
        const file = await personalGithub.getText(path);
        files.set(path, { path, sha: file.sha, entries: parseMonthlyRecords(file.text, { user: githubUser.login, path, sha: file.sha }) });
      } catch (error) {
        if (!isNotFound(error)) throw error;
        files.set(path, { path, sha: null, entries: [] });
      }
    }

    const targets = replayTargets(candidates, files, githubUser);
    const replacedRecords = new Set([...targets.values()].map(target => target.record));
    const normalizedCandidates = normalizeImportedIntervals(candidates,
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
        target.file.entries[target.index] = replacement;
        replacements.push({ previous: target.record, record: replacement });
        updated += 1;
        continue;
      }
      const existingIndex = file.entries.findIndex(existing => provenanceOf(existing) === candidate.provenance);
      if (existingIndex !== -1) {
        alreadyPresent += 1;
        const existing = file.entries[existingIndex];
        const taskTitle = candidate.resolvedIssue?.title ?? clockifyTaskTitle(candidate);
        const description = String(candidate.description ?? '');
        if ((taskTitle && existing.taskTitle !== taskTitle) || (description && existing.description !== description)) {
          file.entries[existingIndex] = validateEntry({
            ...existing,
            taskTitle: taskTitle || existing.taskTitle,
            issueTitle: taskTitle || existing.issueTitle,
            description: description || existing.description,
          });
          updated += 1;
        }
        continue;
      }
      const record = completedRecord({ entry: candidate, githubUser, id: candidate.id, now });
      additions.push({ path, record });
    }

    if (!additions.length && !updated) return { status: 'already_present', added: 0, alreadyPresent };

    for (let index = 0; index < additions.length; index += 1) {
      const record = additions[index].record;
      if (additions.slice(0, index).some(previous => intervalsOverlap(previous.record, record))) {
        throw overlappingIntervalsError();
      }
    }

    const usedIds = new Set([...files.values()].flatMap(file => file.entries.map(entry => entry.id)));
    for (const { record } of additions) {
      if (usedIds.has(record.id)) throw new Error('Duplicate imported work record ID');
      usedIds.add(record.id);
    }
    for (const { path, record } of additions) files.get(path).entries.push(record);
    for (const file of files.values()) serializeMonthlyRecords(file.entries); // validate complete output before writing

    const nextIndex = applyTaskIndexChanges(taskIndex, {
      remove: replacements.map(item => item.previous),
      add: [...replacements.map(item => item.record), ...additions.map(item => item.record)],
    });
    const changes = [...files.values()].map(file => ({ path: file.path, sha: file.sha, text: serializeMonthlyRecords(file.entries) }));
    if (additions.length || replacements.length) changes.push({ path: TASK_INDEX_PATH, sha: indexFile.sha, text: serializeTaskIndex(nextIndex) });
    stage = 'writing_records';
    await personalGithub.updateTextsAtomic(changes, `Import completed work records (${additions.length})`, {
      guards: [{ path: USER_METADATA_PATH, sha: metadataFile.sha }],
    });
    return { status: 'imported', added: additions.length, alreadyPresent };
  } catch (error) {
    // Import failures are intentionally reduced to a stable UI reason. Keep a
    // source-data-free diagnostic for the privileged runtime console.
    console.warn('Clockify import failed', { stage, error: String(error?.message || error) });
    return isConflict(error) ? { status: 'conflict' } : { status: 'failed', failureReason: failureReason(stage, error) };
  }
}

export { PROVENANCE_FIELD, PROVENANCE_KEY };
