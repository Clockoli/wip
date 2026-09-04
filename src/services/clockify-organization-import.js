import { resolveClockifyUserMappings } from './clockify-identity-mapping.js';
import { provisionClockifyUserBranches } from './clockify-user-branch-provisioning.js';
import { importClockifyCompletedRecords } from './clockify-record-import.js';
import { validateClockifyUserMapping } from '../addons/clockify/user-mapping.js';
import { userStorageBranch } from './user-storage-branch.js';

const RESOLUTION_FAILURE_MESSAGE = 'Could not resolve all mapped GitHub users.';
const PROVISION_FAILURE_MESSAGE = "Could not prepare this user's Clockoli storage branch.";
const IMPORT_STATUSES = new Set(['imported', 'already_present', 'conflict', 'failed']);
const PROVISION_FAILURE_REASONS = new Set([
  'github_rate_limited', 'github_authentication', 'github_permission', 'repository_or_branch_not_found',
  'github_conflict', 'github_validation', 'storage_branch_unavailable',
]);
const IMPORT_FAILURE_REASONS = new Set([
  'storage_branch_incomplete', 'storage_data_unreadable',
  'invalid_imported_interval', 'invalid_imported_task', 'invalid_imported_description',
  'invalid_imported_time_context', 'invalid_imported_record_id', 'invalid_imported_record',
  'github_write_rate_limited', 'github_write_authentication', 'github_write_permission',
  'github_write_target_missing', 'github_write_rejected', 'github_write_failed',
  'overlapping_intervals', 'record_write_failed',
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
    return { ...base, status, failureReason: IMPORT_FAILURE_REASONS.has(reason) ? reason : 'record_write_failed' };
  }
  return { ...base, status };
}

function emitProgress(onProgress, stage, completed, total) {
  if (typeof onProgress !== 'function') return;
  try { onProgress({ stage, completed, total }); } catch { /* progress observers cannot interrupt writes */ }
}

function canonicalProvisionOutcome(outcome) {
  if (!outcome || typeof outcome !== 'object' || Array.isArray(outcome) || Object.getPrototypeOf(outcome) !== Object.prototype) return false;
  for (const key of ['sourceUserId', 'githubUser', 'status']) {
    const descriptor = Object.getOwnPropertyDescriptor(outcome, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return false;
  }
  const sourceUserId = Object.getOwnPropertyDescriptor(outcome, 'sourceUserId').value;
  const status = Object.getOwnPropertyDescriptor(outcome, 'status').value;
  if (typeof sourceUserId !== 'string' || !sourceUserId || (status !== 'provisioned' && status !== 'failed')) return false;
  const githubUser = Object.getOwnPropertyDescriptor(outcome, 'githubUser').value;
  if (!githubUser || typeof githubUser !== 'object' || Array.isArray(githubUser) || Object.getPrototypeOf(githubUser) !== Object.prototype) return false;
  const id = Object.getOwnPropertyDescriptor(githubUser, 'id');
  const login = Object.getOwnPropertyDescriptor(githubUser, 'login');
  if (!id || !Object.hasOwn(id, 'value') || !login || !Object.hasOwn(login, 'value')) return false;
  if (status === 'provisioned') {
    const branch = Object.getOwnPropertyDescriptor(outcome, 'branch');
    if (!branch || !Object.hasOwn(branch, 'value')) return false;
    return { sourceUserId, githubUser: { id: id.value, login: login.value }, status, branch: branch.value };
  }
  const error = Object.getOwnPropertyDescriptor(outcome, 'error')?.value;
  const reason = error && typeof error === 'object' && !Array.isArray(error)
    ? Object.getOwnPropertyDescriptor(error, 'reason')?.value : null;
  return {
    sourceUserId, githubUser: { id: id.value, login: login.value }, status,
    failureReason: PROVISION_FAILURE_REASONS.has(reason) ? reason : 'storage_branch_unavailable',
  };
}

function canonicalProvisionOutcomes(provisioned) {
  if (!Array.isArray(provisioned) || Object.getPrototypeOf(provisioned) !== Array.prototype) return [];
  const length = Object.getOwnPropertyDescriptor(provisioned, 'length')?.value;
  const keys = Reflect.ownKeys(provisioned);
  if (!Number.isSafeInteger(length) || keys.length !== length + 1 || !keys.includes('length')) return [];
  const outcomes = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(provisioned, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return [];
    const outcome = canonicalProvisionOutcome(descriptor.value);
    if (outcome) outcomes.push(outcome);
  }
  return outcomes;
}

function isVerifiedProvision(outcome, mapping) {
  return outcome.sourceUserId === mapping.sourceUserId
    && outcome.status === 'provisioned'
    && outcome.branch === userStorageBranch(mapping.githubUser.id)
    && outcome.githubUser.id === mapping.githubUser.id && outcome.githubUser.login === mapping.githubUser.login;
}

/** Resolve mappings, prepare isolated branches, and import exact private subsets. */
export async function importClockifyOrganization({ sourceUsers, entries, mappings, github, sourceBranch,
  resolveMappings = resolveClockifyUserMappings, provisionBranches = provisionClockifyUserBranches,
  importRecords = importClockifyCompletedRecords, onProgress } = {}) {
  // This happens before the first await or remote collaborator invocation.
  const snapshot = { sourceUsers: snapshotData(sourceUsers, 'source users'), entries: snapshotData(entries, 'entries') };
  const normalizedEntries = validateEntryAssociation(snapshot.sourceUsers, snapshot.entries);
  const sourceUserTotal = snapshot.sourceUsers.length;

  let verifiedMappings;
  emitProgress(onProgress, 'resolving_identities', 0, sourceUserTotal);
  try {
    const resolved = await resolveMappings({ sourceUsers: snapshot.sourceUsers, mappings, github });
    verifiedMappings = validateClockifyUserMapping(snapshot.sourceUsers, resolved);
  } catch {
    throw new Error(RESOLUTION_FAILURE_MESSAGE);
  }
  emitProgress(onProgress, 'resolving_identities', sourceUserTotal, sourceUserTotal);

  const importedMappings = verifiedMappings.filter(mapping => !mapping.skipped);
  const importedTotal = importedMappings.length;
  const importedSourceIds = new Set(importedMappings.map(mapping => mapping.sourceUserId));
  const importedSourceUsers = snapshot.sourceUsers.filter(user => importedSourceIds.has(user.userId));
  let provisioned;
  let provisionOutcomes;
  let provisionCompleted = 0;
  emitProgress(onProgress, 'preparing_storage', 0, importedTotal);
  try {
    provisioned = await provisionBranches({
      sourceUsers: importedSourceUsers, mappings: importedMappings, github, sourceBranch,
      onProgress: event => {
        const completed = event?.completed;
        if (Number.isSafeInteger(completed) && completed >= provisionCompleted && completed <= importedTotal) {
          provisionCompleted = completed;
          emitProgress(onProgress, 'preparing_storage', completed, importedTotal);
        }
      },
    });
  } catch { provisioned = []; }
  if (provisionCompleted < importedTotal) emitProgress(onProgress, 'preparing_storage', importedTotal, importedTotal);
  try { provisionOutcomes = canonicalProvisionOutcomes(provisioned); }
  catch { provisionOutcomes = []; }
  const entriesBySourceId = new Map(importedMappings.map(mapping => [mapping.sourceUserId, []]));
  for (const entry of normalizedEntries) if (entriesBySourceId.has(entry.userId)) entriesBySourceId.get(entry.userId).push(entry);

  const outcomes = [];
  let recordsCompleted = 0;
  emitProgress(onProgress, 'writing_records', recordsCompleted, importedTotal);
  for (const mapping of importedMappings) {
    const provision = provisionOutcomes.find(outcome => isVerifiedProvision(outcome, mapping));
    if (!provision) {
      const provisionOutcome = provisionOutcomes.find(outcome => outcome.sourceUserId === mapping.sourceUserId);
      outcomes.push({
        sourceUserId: mapping.sourceUserId,
        githubUser: { ...mapping.githubUser },
        status: 'failed',
        failureReason: provisionOutcome?.failureReason || 'storage_branch_unavailable',
        error: { message: PROVISION_FAILURE_MESSAGE, reason: provisionOutcome?.failureReason || 'storage_branch_unavailable' },
      });
      recordsCompleted += 1;
      emitProgress(onProgress, 'writing_records', recordsCompleted, importedTotal);
      continue;
    }
    let imported;
    try { imported = await importRecords({ github, githubUser: { ...mapping.githubUser }, entries: entriesBySourceId.get(mapping.sourceUserId) }); }
    catch { imported = { status: 'failed' }; }
    outcomes.push(safeOutcome(mapping, imported));
    recordsCompleted += 1;
    emitProgress(onProgress, 'writing_records', recordsCompleted, importedTotal);
  }
  emitProgress(onProgress, 'completed', importedTotal, importedTotal);
  return outcomes;
}
