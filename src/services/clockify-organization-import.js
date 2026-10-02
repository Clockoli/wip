import { resolveClockifyUserMappings } from './clockify-identity-mapping.js';
import { importClockifyCompletedRecords } from './clockify-record-import.js';
import { validateClockifyUserMapping } from '../addons/clockify/user-mapping.js';
import { ensureUserStorageBranch, parseUserBranchMetadata, userStorageBranch, USER_METADATA_PATH } from './user-storage-branch.js';
import { parseTaskIndex, TASK_INDEX_PATH } from '../domain/task-index.js';

const RESOLUTION_FAILURE_MESSAGE = 'Could not resolve all mapped GitHub users.';
const IMPORT_STATUSES = new Set(['imported', 'already_present', 'conflict', 'failed']);
const IMPORT_FAILURE_REASONS = new Set([
  'storage_branch_incomplete', 'storage_data_unreadable',
  'invalid_imported_interval', 'invalid_imported_task', 'invalid_imported_description',
  'invalid_imported_time_context', 'invalid_imported_record_id', 'invalid_imported_record',
  'github_write_rate_limited', 'github_write_authentication', 'github_write_permission',
  'github_write_target_missing', 'github_write_rejected', 'github_write_failed',
  'overlapping_intervals', 'record_write_failed',
  'storage_branch_unavailable', 'github_rate_limited', 'github_authentication', 'github_permission',
  'repository_or_branch_not_found',
]);

function fail(message) { throw new Error(`Invalid Clockify organization import: ${message}`); }

// Build an inert, canonical copy without ever evaluating caller-controlled
// accessors. Source records are later passed to collaborators, so this is also
// the TOCTOU boundary for the complete operation.
function snapshotData(value, label, active = new WeakSet()) {
  if (typeof value === 'function' || typeof value === 'symbol') fail(`${label} must contain only data values`);
  if (value === null || typeof value !== 'object') return value;
  if (active.has(value)) fail(`${label} must not be cyclic`);
  active.add(value);
  let copy;
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) fail(`${label} must be a plain array`);
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    const length = lengthDescriptor?.value;
    const keys = Reflect.ownKeys(value);
    if (!Number.isSafeInteger(length) || length < 0 || keys.length !== length + 1 || !keys.includes('length')) {
      fail(`${label} must be a dense data array`);
    }
    copy = new Array(length);
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail(`${label} must be a dense data array`);
      copy[index] = snapshotData(descriptor.value, `${label}[${index}]`, active);
    }
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype) fail(`${label} must be a plain object`);
    copy = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') fail(`${label} must not contain symbol fields`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail(`${label} fields must be data properties`);
      Object.defineProperty(copy, key, {
        value: snapshotData(descriptor.value, `${label}.${key}`, active), enumerable: true, configurable: true, writable: true,
      });
    }
  }
  active.delete(value);
  return copy;
}

function denseDataArray(value, label) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail(`${label} must be an array`);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !keys.includes('length')) fail(`${label} must be a dense data array`);
  const values = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail(`${label} must be a dense data array`);
    values.push(descriptor.value);
  }
  return values;
}

function entrySourceUserId(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.getPrototypeOf(entry) !== Object.prototype) fail('entries must be plain objects');
  const descriptor = Object.getOwnPropertyDescriptor(entry, 'userId');
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string' || !descriptor.value) fail('entry user ID must be a non-empty data property');
  return descriptor.value;
}

// This deliberately validates only the association. The exact importer owns
// complete source-record validation and receives the inert record snapshot.
function validateEntryAssociation(sourceUsers, entries) {
  const roster = denseDataArray(sourceUsers, 'source users');
  const sourceIds = new Set();
  const expectedCounts = new Map();
  for (const sourceUser of roster) {
    if (!sourceUser || typeof sourceUser !== 'object' || Array.isArray(sourceUser) || Object.getPrototypeOf(sourceUser) !== Object.prototype) fail('source users must be plain objects');
    const id = Object.getOwnPropertyDescriptor(sourceUser, 'userId');
    const count = Object.getOwnPropertyDescriptor(sourceUser, 'entryCount');
    if (!id || !Object.hasOwn(id, 'value') || typeof id.value !== 'string' || !id.value) fail('source roster user ID is invalid');
    if (!count || !Object.hasOwn(count, 'value') || !Number.isSafeInteger(count.value) || count.value < 1) fail('source roster entry count is invalid');
    if (sourceIds.has(id.value)) fail('duplicate source roster user ID');
    sourceIds.add(id.value);
    expectedCounts.set(id.value, count.value);
  }
  const normalizedEntries = denseDataArray(entries, 'entries');
  const receivedCounts = new Map([...sourceIds].map(id => [id, 0]));
  for (const entry of normalizedEntries) {
    const sourceUserId = entrySourceUserId(entry);
    if (!sourceIds.has(sourceUserId)) fail('entry user is not in the source roster');
    receivedCounts.set(sourceUserId, receivedCounts.get(sourceUserId) + 1);
  }
  for (const [sourceUserId, expected] of expectedCounts) {
    if (receivedCounts.get(sourceUserId) !== expected) fail('entry count does not match source roster');
  }
  return normalizedEntries;
}

function safeRepair(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { kind, path, line, actualMonth, expectedMonth } = value;
  if (kind !== 'monthly_partition_mismatch' || !/^times\/\d{4}-(?:0[1-9]|1[0-2])\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\.jsonl$/.test(path)
    || !Number.isSafeInteger(line) || line < 1 || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(actualMonth) || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(expectedMonth)) return null;
  return { kind, path, line, actualMonth, expectedMonth };
}

function safeDiagnostic(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const allowed = new Set(['destination_record_schema', 'destination_active_timer_schema', 'destination_duplicate_record_id', 'destination_source_identity', 'destination_record_identity', 'destination_time_context', 'destination_producer', 'destination_actor', 'destination_metadata', 'destination_description', 'destination_task', 'destination_record_validation']);
  const detail = typeof value.detail === 'string' && /^[A-Za-z][A-Za-z0-9 _:-]{0,120}$/.test(value.detail) ? value.detail : null;
  const collision = value.collision;
  const validCollisionSide = side => side && typeof side === 'object' && !Array.isArray(side)
    && typeof side.recordId === 'string' && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(side.recordId)
    && typeof side.provenanceSha256 === 'string' && /^[a-f0-9]{64}$/.test(side.provenanceSha256)
    && typeof side.startedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(side.startedAt)
    && typeof side.endedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(side.endedAt)
    && Number.isSafeInteger(side.durationSeconds) && side.durationSeconds >= 0
    && typeof side.taskFingerprintSha256 === 'string' && /^[a-f0-9]{64}$/.test(side.taskFingerprintSha256);
  const safeCollision = value.code === 'destination_duplicate_record_id'
    && collision && typeof collision === 'object' && !Array.isArray(collision)
    && validCollisionSide(collision.incoming) && validCollisionSide(collision.existing)
    && typeof collision.existing.path === 'string' && /^times\/\d{4}-(?:0[1-9]|1[0-2])\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\.jsonl$/.test(collision.existing.path)
    && Number.isSafeInteger(collision.existing.line) && collision.existing.line >= 1
    && collision.comparison && typeof collision.comparison === 'object'
    && ['sameProvenance', 'sameTimeRange', 'sameTaskFingerprint'].every(key => typeof collision.comparison[key] === 'boolean')
    ? {
      incoming: {
        recordId: collision.incoming.recordId, provenanceSha256: collision.incoming.provenanceSha256,
        startedAt: collision.incoming.startedAt, endedAt: collision.incoming.endedAt, durationSeconds: collision.incoming.durationSeconds,
        taskFingerprintSha256: collision.incoming.taskFingerprintSha256,
      },
      existing: {
        recordId: collision.existing.recordId, provenanceSha256: collision.existing.provenanceSha256,
        startedAt: collision.existing.startedAt, endedAt: collision.existing.endedAt, durationSeconds: collision.existing.durationSeconds,
        taskFingerprintSha256: collision.existing.taskFingerprintSha256, path: collision.existing.path, line: collision.existing.line,
      },
      comparison: {
        sameProvenance: collision.comparison.sameProvenance, sameTimeRange: collision.comparison.sameTimeRange,
        sameTaskFingerprint: collision.comparison.sameTaskFingerprint,
      },
    }
    : null;
  return value.stage === 'preparing_destination_record' && allowed.has(value.code)
    ? { stage: value.stage, code: value.code, ...(detail ? { detail } : {}), ...(safeCollision ? { collision: safeCollision } : {}) } : null;
}

function safeOutcome(mapping, outcome) {
  const base = { sourceUserId: mapping.sourceUserId, githubUser: { ...mapping.githubUser } };
  const status = outcome?.status;
  if (!IMPORT_STATUSES.has(status)) return { ...base, status: 'failed', failureReason: 'record_write_failed' };
  if (status === 'imported' || status === 'already_present') {
    const added = outcome.added;
    const alreadyPresent = outcome.alreadyPresent;
    if (!Number.isSafeInteger(added) || added < 0 || !Number.isSafeInteger(alreadyPresent) || alreadyPresent < 0) return { ...base, status: 'failed', failureReason: 'record_write_failed' };
    return { ...base, status, added, alreadyPresent };
  }
  if (status === 'failed') {
    const reason = outcome.failureReason;
    const repair = safeRepair(outcome.repair);
    const diagnostic = safeDiagnostic(outcome.diagnostic);
    return { ...base, status, failureReason: IMPORT_FAILURE_REASONS.has(reason) ? reason : 'record_write_failed', ...(repair ? { repair } : {}), ...(diagnostic ? { diagnostic } : {}) };
  }
  return { ...base, status };
}

function emitProgress(onProgress, stage, completed, total, elapsedMs = null) {
  if (typeof onProgress !== 'function') return;
  try { onProgress({ stage, completed, total, ...(Number.isSafeInteger(elapsedMs) && elapsedMs >= 0 ? { elapsedMs } : {}) }); } catch { /* progress observers cannot interrupt writes */ }
}

function configuredGithubUser(value) {
  return Number.isSafeInteger(value?.id) && value.id > 0
    && typeof value.login === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(value.login);
}

function sameGithubUser(left, right) {
  return left.id === right.id && left.login.toLowerCase() === right.login.toLowerCase();
}

function branchFailure(error) {
  if (error?.code === 'github_rate_limited' || error?.code === 'rate_limit' || error?.status === 429) return 'github_rate_limited';
  if (error?.status === 401) return 'github_authentication';
  if (error?.status === 403) return 'github_permission';
  if (error?.status === 404) return 'repository_or_branch_not_found';
  return 'storage_branch_incomplete';
}

async function verifiedBranch(github, user) {
  const branch = userStorageBranch(user.id);
  const target = github.forBranch(branch, 'custom');
  // A branch-scoped client must retain the exact configured repository identity.
  // Do not trust a collaborator's returned branch or silently fall back to the
  // configured writer branch when another user's branch cannot be read.
  if (target?.branch !== branch || target.owner !== github.owner || target.repo !== github.repo
      || target.expectedRepositoryId !== github.expectedRepositoryId
      || typeof target.assertDestinationReachable !== 'function' || typeof target.getText !== 'function') {
    throw new Error('Clockoli storage branch client does not match its repository and user');
  }
  await target.assertDestinationReachable();
  const metadata = parseUserBranchMetadata((await target.getText(USER_METADATA_PATH)).text);
  if (!sameGithubUser(metadata, user)) throw new Error('Clockoli storage branch belongs to another user');
  parseTaskIndex((await target.getText(TASK_INDEX_PATH)).text, { user: metadata.login });
  return target;
}

/**
 * Import each explicitly mapped person into their verified personal branch.
 * Missing personal branches are initialized in the configured repository; a
 * branch with invalid ownership metadata is never claimed or overwritten.
 */
export async function importClockifyOrganization({ sourceUsers, entries, mappings, github, destinationUser,
  sourceBranch, resolveMappings = resolveClockifyUserMappings, importRecords = importClockifyCompletedRecords, onProgress,
  now = () => performance.now() } = {}) {
  const startedAt = now();
  const elapsed = () => Math.max(0, Math.round(now() - startedAt));
  const snapshot = { sourceUsers: snapshotData(sourceUsers, 'source users'), entries: snapshotData(entries, 'entries') };
  const normalizedEntries = validateEntryAssociation(snapshot.sourceUsers, snapshot.entries);
  const sourceUserTotal = snapshot.sourceUsers.length;
  if (!configuredGithubUser(destinationUser)) throw new Error('The configured Clockoli user is unavailable. Reconnect GitHub and try again.');

  let verifiedMappings;
  emitProgress(onProgress, 'resolving_identities', 0, sourceUserTotal, elapsed());
  try {
    const resolved = await resolveMappings({ sourceUsers: snapshot.sourceUsers, mappings, github });
    verifiedMappings = validateClockifyUserMapping(snapshot.sourceUsers, resolved);
  } catch {
    throw new Error(RESOLUTION_FAILURE_MESSAGE);
  }
  emitProgress(onProgress, 'resolving_identities', sourceUserTotal, sourceUserTotal, elapsed());

  const selectedMappings = verifiedMappings.filter(mapping => !mapping.skipped);
  const total = selectedMappings.length;
  if (!total) {
    emitProgress(onProgress, 'preparing_storage', 1, 1, elapsed());
    emitProgress(onProgress, 'writing_records', 0, 0, elapsed());
    emitProgress(onProgress, 'completed', 0, 0, elapsed());
    return [];
  }
  if (!Number.isSafeInteger(github?.expectedRepositoryId) || github.expectedRepositoryId <= 0
      || typeof github.owner !== 'string' || !github.owner || typeof github.repo !== 'string' || !github.repo
      || github.branch !== userStorageBranch(destinationUser.id) || typeof github.forBranch !== 'function') {
    throw new Error('The configured Clockoli repository and personal branch must be verified before importing.');
  }
  const outcomes = [];
  emitProgress(onProgress, 'preparing_storage', 0, total, elapsed());
  emitProgress(onProgress, 'writing_records', 0, total, elapsed());
  for (const mapping of selectedMappings) {
    let imported;
    try {
      let target;
      try { target = await verifiedBranch(github, mapping.githubUser); }
      catch (error) {
        if (error?.status !== 404 || sameGithubUser(mapping.githubUser, destinationUser)
            || typeof github.ensureBranchWithTexts !== 'function') throw error;
        await ensureUserStorageBranch(github, mapping.githubUser, sourceBranch);
        target = await verifiedBranch(github, mapping.githubUser);
      }
      emitProgress(onProgress, 'preparing_storage', outcomes.length + 1, total, elapsed());
      const selectedEntries = normalizedEntries.filter(entry => entry.userId === mapping.sourceUserId);
      const request = { github: target, githubUser: { ...mapping.githubUser }, entries: selectedEntries };
      if (importRecords === importClockifyCompletedRecords) {
        request.onProfile = profile => emitProgress(onProgress,
          profile.stage === 'records_written' ? 'writing_records' : profile.stage,
          outcomes.length, total, profile.elapsedMs);
      }
      try { imported = await importRecords(request); }
      catch { imported = { status: 'failed', failureReason: 'record_write_failed' }; }
    } catch (error) {
      imported = { status: 'failed', failureReason: branchFailure(error) };
      emitProgress(onProgress, 'preparing_storage', outcomes.length + 1, total, elapsed());
    }
    outcomes.push(safeOutcome(mapping, imported));
    emitProgress(onProgress, 'writing_records', outcomes.length, total, elapsed());
  }
  emitProgress(onProgress, 'completed', total, total, elapsed());
  return outcomes;
}
