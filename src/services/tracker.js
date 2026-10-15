import { activeRecordPath, assertUserMonthlyRecordsPath, localTimestamp, monthlyRecordsPath, normalizePlainTitle, parseActiveRecord, parseMonthlyRecords, serializeActiveRecord, serializeMonthlyRecords } from '../domain/work-records.js';
import { applyActiveEdits, applyActiveStartEdit, applyEntryEdits, buildActiveTimer, buildEntry, validateActiveTimer, validateEntry } from '../domain/records.js';
import { parseBulkTimeText } from '../domain/bulk-time.js';
import { applyTaskIndexChanges, parseTaskIndex, serializeTaskIndex, TASK_INDEX_PATH } from '../domain/task-index.js';
import { createUlid } from '../domain/ulid.js';
import { entryDateParts, entryDateValue, localDateParts, normalizeStoredTaskIdentity, normalizeTaskUrl, parseGitHubTaskUrl, taskUrlOf, validateEntryId, validatePathSegment } from '../domain/values.js';

export class TrackerConflictError extends Error {
  constructor(message, reason = '') { super(message); this.name = 'TrackerConflictError'; this.code = 'conflict'; this.reason = reason; }
}

function isNotFound(error) { return error?.status === 404 || error?.code === 'not_found'; }
function isConflict(error) { return error?.status === 409 || error?.code === 'conflict'; }
function isRejectedCreate(error) { return isConflict(error) || error?.status === 422 || error?.code === 'validation'; }
function isRetryableReadFailure(error) { return error instanceof TypeError || Number(error?.status) >= 500; }
function isRemoteRecord(record) { return !record._pending && typeof record._sha === 'string' && record._sha.length > 0; }
function recoveryProjection({ active, recent, pendingWrites }) {
  const records = [active, ...recent].filter(Boolean);
  return {
    pendingCount: pendingWrites.length,
    pendingWrites: pendingWrites.map(({ id, operation, status, stage, conflictReason }) => ({
      id, status, stage, ...(status === 'conflict' ? { operation } : {}), ...(conflictReason ? { conflictReason } : {}),
    })),
    // Successful writes retain the returned blob SHA; an empty queue is not proof of a save.
    remoteWriteConfirmed: pendingWrites.length === 0 && records.length > 0
      && records.every(isRemoteRecord),
  };
}

function isPermanentQueuedWriteFailure(error) {
  const status = Number(error?.status);
  return Number.isInteger(status) && status >= 400 && status < 500
    && ![404, 409].includes(status) && error?.code !== 'rate_limit';
}
function taskTitleOf(value) { return normalizePlainTitle(value?.taskTitle ?? value?.issueTitle); }
function withTaskIdentityHistory(updated, previous) {
  const metadata = structuredClone(updated.metadata ?? {});
  const clockoli = metadata.clockoli && typeof metadata.clockoli === 'object' && !Array.isArray(metadata.clockoli)
    ? structuredClone(metadata.clockoli) : {};
  const history = Array.isArray(clockoli.task_identity_history) ? structuredClone(clockoli.task_identity_history) : [];
  clockoli.task_identity_history = [...history, { url: taskUrlOf(previous), title: taskTitleOf(previous) }];
  return { ...updated, metadata: { ...metadata, clockoli } };
}
function taskLabel(value) { const url = taskUrlOf(value), github = parseGitHubTaskUrl(url); return github ? `${github.owner}/${github.repo}#${github.number}` : url; }
function trackedDurationLabel(value) {
  const total = Math.max(0, Math.floor(Number(value?.durationSeconds) || 0));
  const hours = Math.floor(total / 3600), minutes = Math.floor((total % 3600) / 60), seconds = total % 60;
  return `${hours ? `${hours}h ` : ''}${minutes ? `${minutes}m ` : ''}${seconds}s`;
}
function githubActorRelationships(github, actor) {
  const actorId = String(actor?.id || '').match(/^github:(\d+)$/)?.[1] || '';
  const actorName = String(actor?.name || '').toLowerCase();
  const matches = identity => Boolean(identity) && (actorId
    ? String(identity.id || '') === actorId
    : actorName && String(identity.login || '').toLowerCase() === actorName);
  const relationships = [];
  if (matches(github?.author)) relationships.push('author');
  if ((github?.assignees ?? []).some(matches)) relationships.push('assignee');
  if ((github?.pull_request?.requested_reviewers ?? []).some(value => value?.kind === 'user' && matches(value))) relationships.push('reviewer');
  return relationships.length ? relationships : ['other'];
}

function sameTimer(a, b) { return Boolean(a?.id && b?.id) && a.id === b.id; }
function timerStartedAt(value) { return new Date(value?.startedAt).getTime(); }
function assertNoActiveOverlap(entries, active) {
  if (active && entries.some(entry => entry.id !== active.id && new Date(entry.endedAt).getTime() > timerStartedAt(active))) {
    throw new Error('This edit would overlap the running timer. Set the entry End no later than the timer Start.');
  }
}
function isNewerTimer(candidate, current) { return timerStartedAt(candidate) > timerStartedAt(current); }
function sameCompletion(entry, operation) { return Boolean(entry?.id && operation?.entry?.id) && entry.id === operation.entry.id; }

function sameValue(left, right) { return JSON.stringify(left) === JSON.stringify(right); }

function mergeSupersededEntryRequests(earlier, later) {
  const earliestOriginal = structuredClone(earlier.original);
  const edits = { ...(later.edits ?? {}) };
  for (const [field, earlierValue] of Object.entries(earlier.edits ?? {})) {
    if (Object.hasOwn(edits, field)) continue;
    if (!Object.hasOwn(later.original ?? {}, field)) {
      edits[field] = earlierValue;
      continue;
    }
    const latestAcceptedValue = later.original[field];
    if (!sameValue(latestAcceptedValue, earliestOriginal?.[field])) edits[field] = structuredClone(latestAcceptedValue);
  }
  return {
    ...later,
    path: earlier.path,
    originalSha: earlier.originalSha,
    index: earlier.index,
    original: earliestOriginal,
    edits,
  };
}

function entryEditHasValidInterval(request) {
  const startedAt = new Date(request?.edits?.startedAt ?? request?.original?.startedAt).getTime();
  const endedAt = new Date(request?.edits?.endedAt ?? request?.original?.endedAt).getTime();
  return Number.isFinite(startedAt) && Number.isFinite(endedAt) && endedAt >= startedAt;
}

function assertQueuedEntryIntervals(requests) {
  if (!Array.isArray(requests) || !requests.length || requests.some(request => !entryEditHasValidInterval(request))) {
    throw new TrackerConflictError(
      'The saved edit has an invalid time range. End time must not be before start time.',
      'queued_write_validation',
    );
  }
}

function repairInvertedEntryEdit(request, recentCache) {
  if (entryEditHasValidInterval(request)) return request;
  const cached = (recentCache ?? []).find(entry => entry?._pending && entry?._path === request?.path
    && entry?.id && entry.id === request?.original?.id);
  const cachedStart = new Date(cached?.startedAt).getTime(), cachedEnd = new Date(cached?.endedAt).getTime();
  if (!Number.isFinite(cachedStart) || !Number.isFinite(cachedEnd) || cachedEnd < cachedStart) return request;
  const edits = { ...(request.edits ?? {}) };
  for (const field of ['startedAt', 'endedAt']) {
    if (sameValue(cached[field], request.original?.[field])) delete edits[field];
    else edits[field] = cached[field];
  }
  return { ...request, edits };
}

function compactSupersededQueue(pendingWrites, recentCache = []) {
  const queue = structuredClone(pendingWrites ?? []), latestByTarget = new Map(), removed = new Set();
  for (let index = queue.length - 1; index >= 0; index -= 1) {
    const operation = queue[index], type = operation.operation ?? operation.stage;
    if (type === 'editEntry') {
      const request = operation.request, targetId = request?.original?.id;
      if (!request?.path || !targetId) { latestByTarget.clear(); continue; }
      const key = `entry\u0000${request.path}\u0000${targetId}`, laterIndex = latestByTarget.get(key);
      if (laterIndex === undefined) { latestByTarget.set(key, index); continue; }
      const later = queue[laterIndex];
      later.request = mergeSupersededEntryRequests(request, later.request);
      removed.add(index);
      continue;
    }
    if (type === 'editActiveStart') {
      const targetId = operation.original?.id;
      if (!targetId) { latestByTarget.clear(); continue; }
      const key = `active\u0000${targetId}`, laterIndex = latestByTarget.get(key);
      if (laterIndex === undefined) { latestByTarget.set(key, index); continue; }
      const later = queue[laterIndex];
      later.original = structuredClone(operation.original);
      if (later.startedAt === undefined && operation.startedAt !== undefined) later.startedAt = operation.startedAt;
      if (later.description === undefined && operation.description !== undefined) later.description = operation.description;
      removed.add(index);
      continue;
    }
    // Multi-record edits and timer lifecycle operations are ordering barriers.
    // Their atomic/dependency semantics must remain intact.
    latestByTarget.clear();
  }
  for (const operation of queue) {
    if ((operation.operation ?? operation.stage) !== 'editEntry') continue;
    const repaired = repairInvertedEntryEdit(operation.request, recentCache);
    if (repaired === operation.request) continue;
    operation.request = repaired;
    if (operation.conflictReason === 'queued_write_validation') {
      operation.status = 'pending';
      operation.lastError = '';
      operation.conflictReason = '';
    }
  }
  return queue.filter((_, index) => !removed.has(index));
}

function trailingSupersedable(queue, matches) {
  for (let index = queue.length - 1; index >= 0; index -= 1) {
    const operation = queue[index], type = operation.operation ?? operation.stage;
    if (!['editEntry', 'editActiveStart'].includes(type)) return null;
    if (matches(operation)) return operation;
  }
  return null;
}

function operationEditsEntry(operation, id) {
  const type = operation?.operation ?? operation?.stage;
  if (type === 'editEntry') return operation.request?.original?.id === id;
  if (type === 'editEntries') return (operation.request?.entries ?? []).some(request => request?.original?.id === id);
  return false;
}

function hasLaterEntryEdit(queue, operationId, id) {
  const index = (queue ?? []).findIndex(operation => operation.id === operationId);
  return index >= 0 && queue.slice(index + 1).some(operation => operationEditsEntry(operation, id));
}

function retargetLaterEntryEdits(queue, currentIndex, savedEntries) {
  const savedById = new Map((savedEntries ?? []).map(entry => [entry.id, entry]));
  const retarget = request => {
    const saved = savedById.get(request?.original?.id);
    return saved ? {
      ...request,
      path: saved._path,
      originalSha: saved._sha,
      index: saved._index,
      original: stripInternal(saved),
    } : request;
  };
  for (let index = currentIndex + 1; index < queue.length; index += 1) {
    const operation = queue[index], type = operation.operation ?? operation.stage;
    if (type === 'editEntry' || type === 'deleteEntry') operation.request = retarget(operation.request);
    else if (type === 'editEntries') operation.request = {
      ...operation.request,
      entries: (operation.request?.entries ?? []).map(retarget),
    };
  }
}

function matchesOriginal(entry, original) {
  if (!entry || !original) return false;
  if (original.id) return entry.id === original.id;
  return false;
}

function locateEntry(entries, index, original) {
  if (Number.isInteger(index) && entries[index] && (!original || matchesOriginal(entries[index], original))) return index;
  if (original) {
    const matches = entries.map((entry, position) => matchesOriginal(entry, original) ? position : -1).filter(position => position >= 0);
    if (matches.length === 1) return matches[0];
  }
  return -1;
}
function startDate(entry) { return entry.entryDate; }
function localReportDate(now, offset = 0) {
  return entryDateValue(localDateParts(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, 12, 0, 0)));
}
function runningTrackedMs(active, now, start, end) {
  return active && startDate(active) >= start && startDate(active) <= end
    ? Math.max(0, now.getTime() - new Date(active.startedAt).getTime()) : 0;
}
function overlayPendingEntries(entries, pendingWrites) {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  for (const operation of pendingWrites) {
    if (['completeTimer', 'completeTimerAndStart'].includes(operation.operation) && operation.entry && !byId.has(operation.entry.id)) {
      byId.set(operation.entry.id, { ...operation.entry, _path: operation.monthlyPath, _sha: null, _index: -1, _pending: true });
    }
    if (operation.operation === 'deleteEntry') byId.delete(operation.request?.original?.id);
    const requests = operation.operation === 'editEntry' ? [operation.request]
      : operation.operation === 'editEntries' ? operation.request.entries : [];
    for (const request of requests) {
      // The accepted original is authoritative even if the remote entry changed or disappeared.
      const updated = applyEntryEdits(request.original, request.edits, new Date(Math.max(
        new Date(operation.queuedAt).getTime(), new Date(request.original.updatedAt).getTime(),
      )));
      const cached = byId.get(updated.id);
      byId.set(updated.id, { ...updated, _path: request.path, _sha: cached?._sha ?? request.originalSha, _index: cached?._index ?? request.index, _pending: true });
    }
  }
  return [...byId.values()];
}

function summaryProjection(state, now) {
  const cache = state.summaryCache, today = localReportDate(now);
  if (!cache || cache.reportDate !== today || !Array.isArray(cache.weekEntries)) {
    return { todayTrackedMs: null, weekTrackedMs: null, remoteWriteConfirmed: false };
  }
  const thisWeekStart = localReportDate(now, -((now.getDay() + 6) % 7));
  const pendingWrites = state.pendingWrites ?? [];
  const entries = overlayPendingEntries([...cache.weekEntries, ...(state.recentCache ?? [])], pendingWrites);
  const trackedMs = start => entries.filter(entry => startDate(entry) >= start && startDate(entry) <= today)
    .reduce((sum, entry) => sum + Math.max(0, new Date(entry.endedAt) - new Date(entry.startedAt)), 0)
    + runningTrackedMs(state.activeCache, now, start, today);
  return {
    todayTrackedMs: trackedMs(today), weekTrackedMs: trackedMs(thisWeekStart),
    remoteWriteConfirmed: recoveryProjection({ active: state.activeCache, recent: entries, pendingWrites }).remoteWriteConfirmed,
  };
}
function newestFirst(a, b) { return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(); }
function stripInternal(value) { return Object.fromEntries(Object.entries(value || {}).filter(([key]) => !['_path', '_sha', '_index', '_pending', 'destinationId'].includes(key))); }
function appendQueueDiagnostic(operation, message) {
  const diagnostics = Array.isArray(operation.diagnostics) ? operation.diagnostics : (operation.diagnostics = []);
  diagnostics.push({ at: new Date().toISOString(), message: String(message).slice(0, 300) });
  if (diagnostics.length > 60) diagnostics.splice(0, diagnostics.length - 60);
}
function monthFromPath(path, user) { return assertUserMonthlyRecordsPath(path, user).month; }
function monthsInRange(startDate, endDate) {
  const start = entryDateParts(startDate), end = entryDateParts(endDate);
  if (startDate > endDate) throw new Error('Task merge end date must not precede start date');
  const months = [];
  for (let year = Number(start.year), month = Number(start.month); year < Number(end.year) || (year === Number(end.year) && month <= Number(end.month));) {
    months.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month === 13) { year += 1; month = 1; }
  }
  return months;
}
function editClock(clock, entry) { return new Date(Math.max(clock().getTime(), new Date(entry.updatedAt).getTime())); }
function localMidnight(date) {
  const [year, month, day] = date.split('-').map(Number);
  return localTimestamp(new Date(year, month - 1, day, 0, 0, 0, 0));
}
function nextLocalMidnight(date) {
  const [year, month, day] = date.split('-').map(Number);
  return localTimestamp(new Date(year, month - 1, day + 1, 0, 0, 0, 0));
}
function replaceCachedFiles(cache, replacements, touchedPaths = replacements.map(entry => entry._path)) {
  const paths = new Set(touchedPaths);
  return [...replacements, ...(cache ?? []).filter(entry => !paths.has(entry._path))]
    .sort(newestFirst).slice(0, 50);
}

function replaceCachedDeletedFile(cache, saved, path) {
  const cachedIds = new Set((cache ?? []).filter(entry => entry._path === path).map(entry => entry.id));
  return replaceCachedFiles(cache, saved.filter(entry => cachedIds.has(entry.id)), [path]);
}

export class TrackerService {
  constructor({
    github, store, reports = null, user, actorId = '', actorName = user, producer, timezone,
    clock = () => new Date(), idFactory = () => createUlid(), recentDays = 7,
  }) {
    this.github = github;
    this.store = store;
    this.reports = reports;
    this.user = validatePathSegment(user, 'user');
    this.actor = { kind: 'human', id: actorId || `clockoli-user:${this.user}`, name: actorName || this.user };
    this.producer = producer;
    this.timezone = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    this.clock = clock;
    this.idFactory = idFactory;
    this.stopTail = Promise.resolve();
    this.recentDays = Math.min(31, Math.max(1, Number(recentDays) || 7));
    this.currentQueueDiagnostic = null;
    const priorRequestDiagnostics = this.github.requestDiagnostics;
    this.github.requestDiagnostics = event => {
      try { priorRequestDiagnostics?.(event); }
      finally { this.currentQueueDiagnostic?.(event); }
    };
  }

  validateTaskUrl(value) { return normalizeTaskUrl(value); }
  buildActive(values) {
    return buildActiveTimer({ user: this.user, actor: this.actor, producer: this.producer, timezone: this.timezone,
      ...values, importedStoredIdentity: !/^https?:\/\//.test(values.taskUrl) });
  }

  async enrichGitHubMetadata(active) {
    const issue = active?.issue ?? parseGitHubTaskUrl(taskUrlOf(active));
    if (!issue || active?.metadata?.github || typeof this.github.getTaskMetadata !== 'function') return active;
    let details;
    try { details = (await this.github.getTaskMetadata([issue], { batchSize: 1, maxRequests: 1, includeSnapshot: true })).get(issue.url); }
    catch { return active; }
    if (!details?.github || typeof details.github !== 'object' || Array.isArray(details.github)) return active;
    const github = structuredClone(details.github);
    github.actor_relationship = githubActorRelationships(github, active.actor);
    const title = taskTitleOf(active) || normalizePlainTitle(details.title);
    const capturedAt = github.snapshot?.captured_at;
    return {
      ...active,
      ...(title ? { taskTitle: title, issueTitle: title } : {}),
      metadata: { ...(active.metadata ?? {}), github },
      ...(capturedAt && !Number.isNaN(new Date(capturedAt).getTime()) ? { updatedAt: new Date(capturedAt).toISOString() } : {}),
    };
  }

  uniqueRecordId(timestamp, usedIds) {
    let id = this.idFactory(timestamp), offset = 1;
    while (usedIds.has(id)) id = createUlid(timestamp + offset++);
    usedIds.add(id);
    return id;
  }

  async mutateState(mutate) {
    if (typeof this.store.mutateState === 'function') return this.store.mutateState(mutate);
    const state = await this.store.getState(), patch = mutate(state);
    if (patch) await this.store.patchState(patch);
    return { ...state, ...(patch || {}) };
  }

  async persistQueueOperation(operation, { remove = false, patch = {}, savedEntries = [] } = {}) {
    return this.mutateState(state => {
      const pendingWrites = [...(state.pendingWrites ?? [])], index = pendingWrites.findIndex(item => item.id === operation.id);
      if (index < 0) return null;
      const hasLaterOperation = index < pendingWrites.length - 1;
      if (remove && savedEntries.length) retargetLaterEntryEdits(pendingWrites, index, savedEntries);
      if (remove) pendingWrites.splice(index, 1); else pendingWrites[index] = structuredClone(operation);
      const resolved = typeof patch === 'function' ? patch(state) : patch;
      if (hasLaterOperation && Object.hasOwn(resolved, 'activeCache')) delete resolved.activeCache;
      return { ...resolved, pendingWrites };
    });
  }

  async patchActiveForOperation(operation, activeCache) {
    return this.mutateState(state => {
      const pendingWrites = state.pendingWrites ?? [], index = pendingWrites.findIndex(item => item.id === operation.id);
      return index >= 0 && index === pendingWrites.length - 1 ? { activeCache } : null;
    });
  }

  async confirmFileMissing(error) {
    if (!isNotFound(error)) throw error;
    await this.github.assertDestinationReachable();
  }

  async readRemoteActive({ signal } = {}) {
    const path = activeRecordPath(this.user);
    try {
      const file = await this.github.getText(path, { signal });
      signal?.throwIfAborted();
      const active = parseActiveRecord(file.text, { user: this.user, path, sha: file.sha });
      validateActiveTimer(active);
      return active;
    } catch (error) {
      await this.confirmFileMissing(error);
      return null;
    }
  }

  async refreshActive({ signal } = {}) {
    const remoteActive = await this.readRemoteActive({ signal });
    let effectiveActive = remoteActive;
    await this.mutateState(state => {
      if ((state.pendingWrites ?? []).length) {
        effectiveActive = state.activeCache;
        return {};
      }
      return { activeCache: remoteActive };
    });
    return effectiveActive;
  }

  async getState({ refresh = false, signal, includeSummary = false } = {}) {
    let state = await this.store.getState();
    signal?.throwIfAborted();
    if (refresh) {
      try { await this.refreshActive({ signal }); }
      catch (error) {
        state = await this.store.getState();
        if (!state.activeCache || !isRetryableReadFailure(error)) throw error;
      }
      state = await this.store.getState();
    }
    signal?.throwIfAborted();
    return {
      active: state.activeCache, recent: state.recentCache ?? [], pendingWrites: state.pendingWrites ?? [],
      ...(includeSummary ? summaryProjection(state, this.clock()) : {}),
    };
  }

  async projectActivityRecords(remoteRecords, { startDate: from, endDate: through } = {}) {
    // The unsynced IndexedDB state remains authoritative for Activity reloads.
    // Apply the complete pending queue before filtering: edits can move records
    // across the requested day boundary.
    const state = await this.store.getState();
    const records = overlayPendingEntries(remoteRecords, state.pendingWrites ?? []);
    return {
      records: records.filter(entry => (!from || entry.entryDate >= from)
        && (!through || entry.entryDate <= through)),
      recovery: recoveryProjection({
        active: state.activeCache, recent: records, pendingWrites: state.pendingWrites ?? [],
      }),
    };
  }

  async getRecoveryState() { return recoveryProjection(await this.getState()); }

  async getCachedSummary() {
    return summaryProjection(await this.store.getState(), this.clock());
  }

  async start(taskUrl, taskTitle = '', description = '', { background = false } = {}) {
    if (background) return this.queueStart(taskUrl, taskTitle, description);
    const state = await this.store.getState();
    if ((state.pendingWrites ?? []).length) throw new Error('A stopped entry is still waiting to sync. Sync it before starting another timer.');
    const existing = await this.refreshActive();
    if (existing) throw new Error(`A timer is already tracking ${taskLabel(existing)}`);
    const now = this.clock(), id = this.idFactory(now.getTime());
    const active = await this.enrichGitHubMetadata(this.buildActive({ id, taskUrl: normalizeStoredTaskIdentity(taskUrl), startedAt: now, description, taskTitle }));
    const path = activeRecordPath(this.user);
    try {
      const result = await this.github.putText(path, serializeActiveRecord(active), `timer: start ${this.user}`);
      const cached = { ...active, _path: path, _sha: result.sha };
      await this.store.patchState({ activeCache: cached });
      return cached;
    } catch (error) {
      if (isConflict(error)) throw new TrackerConflictError('Your timer changed on another device. Reload the GitHub timer before starting.');
      throw error;
    }
  }

  async queueStart(taskUrl, taskTitle = '', description = '') {
    const state = await this.store.getState();
    if (state.activeCache) throw new Error(`A timer is already tracking ${taskLabel(state.activeCache)}`);
    const { operation, pendingActive } = this.prepareQueuedStart(taskUrl, taskTitle, description);
    await this.mutateState(current => {
      if (current.activeCache) throw new Error(`A timer is already tracking ${taskLabel(current.activeCache)}`);
      return { pendingWrites: [...(current.pendingWrites ?? []), operation], activeCache: pendingActive };
    });
    return pendingActive;
  }

  prepareQueuedStart(taskUrl, taskTitle = '', description = '', { startedAt = this.clock(), id = null, blockedBy = null } = {}) {
    const start = new Date(startedAt), activeId = id || this.idFactory(start.getTime());
    const active = this.buildActive({ id: activeId, taskUrl: normalizeStoredTaskIdentity(taskUrl), startedAt: start, description, taskTitle });
    const operation = {
      operation: 'startTimer', id: activeId, status: 'pending', retryCount: 0,
      stage: blockedBy ? 'awaitSourceCompletion' : 'startNext',
      nextActive: stripInternal(active), queuedAt: start.toISOString(), lastError: '',
      ...(blockedBy ? { blockedBy: structuredClone(blockedBy) } : {}),
    };
    return {
      operation,
      pendingActive: { ...active, _path: activeRecordPath(this.user), _sha: null, _pending: true },
    };
  }

  async switchTask(taskUrl, taskTitle = '', description = '', { background = false } = {}) {
    const targetUrl = normalizeStoredTaskIdentity(taskUrl);
    if (background) return this.queueTaskSwitch(targetUrl, taskTitle, description);
    const current = await this.refreshActive();
    if (!current) return { stopped: null, active: await this.queueStart(targetUrl, taskTitle, ''), pending: true };
    if (taskUrlOf(current) === targetUrl) return { stopped: null, active: current };
    const stopped = await this.stop(description);
    if (stopped.pending) throw new Error('The previous timer was saved locally but must sync before another timer can start.');
    return { stopped, active: await this.start(targetUrl, taskTitle, '') };
  }

  async queueTaskSwitch(targetUrl, taskTitle = '', description = '') {
    const state = await this.store.getState();
    const current = state.activeCache;
    if (!current) return { stopped: null, active: await this.queueStart(targetUrl, taskTitle, ''), pending: true };
    validateActiveTimer(current);
    if (taskUrlOf(current) === targetUrl) return { stopped: null, active: current, pending: false };
    const changedAt = this.clock(), id = current.id;
    const entry = buildEntry({ active: current, endedAt: changedAt, now: changedAt, description });
    const generatedNextId = this.idFactory(changedAt.getTime());
    const nextId = generatedNextId === id ? createUlid(changedAt.getTime() + 1) : generatedNextId;
    const nextActive = this.buildActive({ id: nextId, taskUrl: targetUrl, taskTitle, startedAt: changedAt, description: '' });
    const operation = {
      operation: 'completeTimerAndStart', id, status: 'pending', retryCount: 0, stage: 'verifyActive',
      monthlyPath: monthlyRecordsPath(this.user, current.entryDate), entry, activeSnapshot: stripInternal(current), activeSha: current._sha,
      nextActive: stripInternal(nextActive), queuedAt: changedAt.toISOString(), lastError: '',
    };
    const pendingEntry = { ...entry, _path: operation.monthlyPath, _sha: null, _index: -1, _pending: true };
    const pendingActive = { ...nextActive, _path: activeRecordPath(this.user), _sha: null, _pending: true };
    await this.mutateState(latest => {
      if (!sameTimer(latest.activeCache, current)) throw new Error('The local timer changed before this switch was accepted. Retry the action.');
      return {
        pendingWrites: [...(latest.pendingWrites ?? []), operation], activeCache: pendingActive,
        recentCache: [pendingEntry, ...(latest.recentCache ?? []).filter(item => !sameCompletion(item, operation))].slice(0, 50),
      };
    });
    return { stopped: { entry, pending: true }, active: pendingActive, pending: true };
  }

  stop(description = '', { background = false } = {}) {
    const result = this.stopTail.then(() => background ? this.queueStop(description) : this.stopInternal(description));
    this.stopTail = result.catch(() => {});
    return result;
  }

  async queueStop(description = '') {
    const state = await this.store.getState();
    const active = state.activeCache;
    if (!active) throw new Error('No timer is running');
    const { operation, pendingEntry, entry } = this.prepareQueuedStop(active, description);
    await this.mutateState(latest => {
      if (!sameTimer(latest.activeCache, active)) throw new Error('The local timer changed before Stop was accepted. Retry the action.');
      return {
        pendingWrites: [...(latest.pendingWrites ?? []), operation], activeCache: null,
        recentCache: [pendingEntry, ...(latest.recentCache ?? []).filter(item => !sameCompletion(item, operation))].slice(0, 50),
      };
    });
    return { entry: pendingEntry, pending: true };
  }

  prepareQueuedStop(active, description = '', { endedAt = this.clock() } = {}) {
    const persistedActive = stripInternal(active);
    validateActiveTimer(persistedActive);
    const end = new Date(endedAt), id = persistedActive.id;
    const entry = buildEntry({ active: persistedActive, endedAt: end, now: end, description });
    const operation = {
      operation: 'completeTimer', id, status: 'pending', retryCount: 0, stage: 'verifyActive',
      monthlyPath: monthlyRecordsPath(this.user, active.entryDate), entry, activeSnapshot: stripInternal(active), activeSha: active._sha,
      queuedAt: end.toISOString(), lastError: '',
    };
    return {
      operation, entry,
      pendingEntry: { ...entry, _path: operation.monthlyPath, _sha: null, _index: -1, _pending: true },
    };
  }

  async discardActive({ background = false } = {}) {
    const discarded = await this.queueDiscardActive();
    if (!background) await this.syncPending();
    const pending = (await this.store.getState()).pendingWrites.some(operation => operation.id === discarded.operationId);
    return { id: discarded.id, operationId: discarded.operationId, pending };
  }

  async queueDiscardActive() {
    const queuedAt = this.clock();
    return this.mutateState(state => {
      const active = state.activeCache;
      if (!active) throw new Error('No timer is running');
      validateActiveTimer(active);
      const operation = {
        operation: 'discardActive', id: createUlid(queuedAt.getTime() + (state.pendingWrites ?? []).length),
        status: 'pending', retryCount: 0, stage: 'discardActive', activeSnapshot: stripInternal(active),
        activeSha: active._sha, queuedAt: queuedAt.toISOString(), lastError: '',
      };
      return { pendingWrites: [...(state.pendingWrites ?? []), operation], activeCache: null };
    }).then(state => {
      const operation = state.pendingWrites.at(-1);
      return { id: operation.activeSnapshot.id, operationId: operation.id, pending: true };
    });
  }

  async stopInternal(description = '') {
    const state = await this.store.getState();
    if ((state.pendingWrites ?? []).some(operation => operation.nextActive)) {
      throw new Error('The task switch is still syncing. Wait for it to finish before stopping.');
    }
    const cached = state.activeCache;
    let active, activeVerified = true;
    try { active = await this.refreshActive(); }
    catch (error) {
      if (!cached || !isRetryableReadFailure(error)) throw error;
      active = cached; activeVerified = false;
    }
    if (cached && active && !sameTimer(cached, active)) throw new TrackerConflictError('The active timer changed on another device. Reload before stopping.');
    const candidate = active || cached;
    const existing = (state.pendingWrites ?? []).find(operation => operation.operation === 'completeTimer' && sameTimer(operation.activeSnapshot, candidate));
    if (existing) { await this.store.patchState({ activeCache: null }); return { entry: existing.entry, pending: true }; }
    if (!active && cached) {
      validateActiveTimer(cached);
      const file = await this.readMonthly(monthlyRecordsPath(this.user, cached.entryDate));
      const matches = file.entries.filter(entry => sameTimer(entry, cached));
      if (matches.length > 1) throw new TrackerConflictError('Multiple completed entries match the timer that another device stopped. Reload before continuing.');
      if (matches.length === 1) {
        const adopted = matches[0];
        const recentCache = [adopted, ...(state.recentCache ?? []).filter(item =>
          item._path !== adopted._path || item._index !== adopted._index)].sort(newestFirst).slice(0, 50);
        await this.store.patchState({ activeCache: null, recentCache });
        return { entry: adopted, pending: false };
      }
    }
    if (!active) throw new Error('No timer is running');
    const endedAt = this.clock();
    const id = active.id;
    const entry = buildEntry({ active, endedAt, now: endedAt, description });
    const operation = {
      operation: 'completeTimer', id, status: 'pending', retryCount: 0, stage: activeVerified ? 'appendMonthly' : 'verifyActive',
      monthlyPath: monthlyRecordsPath(this.user, active.entryDate), entry, activeSnapshot: stripInternal(active), activeSha: active._sha,
      queuedAt: endedAt.toISOString(), lastError: '',
    };
    const pendingEntry = { ...entry, _path: operation.monthlyPath, _sha: null, _index: -1, _pending: true };
    await this.store.patchState({
      pendingWrites: [...(state.pendingWrites ?? []), operation], activeCache: null,
      recentCache: [pendingEntry, ...(state.recentCache ?? []).filter(item => !sameCompletion(item, operation))].slice(0, 50),
    });
    await this.syncPending();
    const next = await this.store.getState();
    const pending = (next.pendingWrites ?? []).some(item => item.id === id);
    const exact = (next.recentCache ?? []).find(item => sameCompletion(item, operation));
    const sameStart = (next.recentCache ?? []).filter(item => sameTimer(item, operation.activeSnapshot));
    const persisted = exact || (sameStart.length === 1 ? sameStart[0] : entry);
    return { entry: persisted, pending };
  }

  async readMonthly(path) {
    const month = monthFromPath(path, this.user);
    try {
      const file = await this.github.getText(path);
      return { path, month, sha: file.sha, entries: parseMonthlyRecords(file.text, { user: this.user, month, path, sha: file.sha }) };
    } catch (error) {
      await this.confirmFileMissing(error);
      return { path, month, sha: null, entries: [] };
    }
  }

  async putMonthly(file, entries, message) {
    const text = serializeMonthlyRecords(entries);
    if (!text) {
      if (!file.sha) return { sha: null };
      await this.github.deleteFile(file.path, message, file.sha);
      return { sha: null };
    }
    return this.github.putText(file.path, text, message, file.sha || undefined);
  }

  async readTaskIndex() {
    try {
      const file = await this.github.getText(TASK_INDEX_PATH);
      return { path: TASK_INDEX_PATH, sha: file.sha, index: parseTaskIndex(file.text, { user: this.user }) };
    } catch (error) {
      if (isNotFound(error)) throw new Error('The mandatory Clockoli task index is missing from this personal branch.', { cause: error });
      throw error;
    }
  }

  async updateCompletedRecords(changes, message, { remove = [], add = [], guards = [], expectedHeadSha = null, indexFile = null } = {}) {
    indexFile ||= await this.readTaskIndex();
    const index = applyTaskIndexChanges(indexFile.index, { remove, add });
    return this.github.updateTextsAtomic([
      ...changes,
      { path: TASK_INDEX_PATH, sha: indexFile.sha, text: serializeTaskIndex(index) },
    ], message, { guards, expectedHeadSha });
  }

  async activeStateFor(operation) {
    const path = activeRecordPath(this.user);
    try {
      const file = await this.github.getText(path), active = parseActiveRecord(file.text, { user: this.user, path, sha: file.sha });
      if (sameTimer(active, operation.activeSnapshot)) {
        operation.activeSha = file.sha;
        const remoteActive = stripInternal(active), localCompletion = operation.entry;
        operation.activeSnapshot = remoteActive;
        operation.entry = buildEntry({
          active: remoteActive,
          endedAt: localCompletion.endedAt,
          now: localCompletion.updatedAt,
          description: localCompletion.description,
        });
        operation.monthlyPath = monthlyRecordsPath(this.user, remoteActive.entryDate);
        return 'matching';
      }
      await this.patchActiveForOperation(operation, active);
      if (operation.nextActive && operation.entry && isNewerTimer(active, operation.activeSnapshot)) {
        const localCompletion = operation.entry;
        const endedAt = new Date(Math.min(new Date(localCompletion.endedAt).getTime(), timerStartedAt(active))).toISOString();
        operation.entry = buildEntry({
          active: operation.activeSnapshot,
          endedAt,
          now: localCompletion.updatedAt,
          description: localCompletion.description,
        });
        operation.preserveActive = true;
        operation.activeCleared = true;
        return 'superseded';
      }
      return 'changed';
    } catch (error) {
      await this.confirmFileMissing(error);
      await this.patchActiveForOperation(operation, null); return 'missing';
    }
  }

  async completionAlreadySaved(file, operation) {
    const exact = file.entries.find(entry => sameCompletion(entry, operation));
    if (exact) return exact;
    const sameStart = file.entries.filter(entry => sameTimer(entry, operation.entry));
    if (!sameStart.length) return null;
    const activeState = await this.activeStateFor(operation);
    if (activeState === 'missing' && sameStart.length === 1) return sameStart[0];
    if (activeState === 'changed') throw new TrackerConflictError('The active timer changed on another device while this completion was syncing.');
    return null;
  }

  async ensureEntry(operation) {
    let [file, indexFile] = await Promise.all([
      this.readMonthly(operation.monthlyPath),
      this.readTaskIndex(),
    ]);
    let found = await this.completionAlreadySaved(file, operation);
    if (found) return found;
    const proposed = [...file.entries, operation.entry];
    try {
      const activePath = activeRecordPath(this.user);
      const changes = [
        { path: file.path, sha: file.sha, text: serializeMonthlyRecords(proposed) },
        ...(operation.preserveActive ? [] : [{ path: activePath, sha: operation.activeSha, text: null }]),
      ];
      const result = await this.updateCompletedRecords(changes, `time: ${this.user} tracked ${trackedDurationLabel(operation.entry)} on ${taskLabel(operation.entry)}`, { add: [operation.entry], indexFile });
      operation.activeSha = null; operation.activeCleared = true;
      return parseMonthlyRecords(serializeMonthlyRecords(proposed), {
        user: this.user, month: file.month, path: file.path, sha: result.blobShas[file.path],
      }).at(-1);
    } catch (error) {
      if (!isConflict(error) && error?.code !== 'validation') throw error;
      file = await this.readMonthly(operation.monthlyPath);
      found = await this.completionAlreadySaved(file, operation);
      if (found) return found;
      const activeState = await this.activeStateFor(operation);
      if (activeState === 'matching') {
        throw new Error('The repository changed while this timer was stopping. Retry will converge automatically.');
      }
      if (activeState === 'changed') {
        throw new TrackerConflictError('The active timer changed on another device while this completion was syncing.');
      }
      throw new TrackerConflictError('The active timer disappeared before its completion was saved.');
    }
  }

  async clearMatchingActive(operation) {
    const path = activeRecordPath(this.user);
    let sha = operation.activeSha;
    if (!sha) {
      try {
        const file = await this.github.getText(path), remote = parseActiveRecord(file.text, { user: this.user, path, sha: file.sha });
        if (!sameTimer(remote, operation.activeSnapshot)) {
          await this.patchActiveForOperation(operation, remote);
          throw new TrackerConflictError('The active timer changed on another device. The completed entry was saved, but the newer timer was not cleared.', 'completion_saved_newer_timer');
        }
        sha = file.sha;
      } catch (error) { await this.confirmFileMissing(error); return; }
    }
    try { await this.github.deleteFile(path, `timer: clear ${this.user}`, sha); }
    catch (error) {
      if (isNotFound(error)) {
        try { await this.github.getText(path); } catch (verificationError) { await this.confirmFileMissing(verificationError); return; }
      }
      if (isConflict(error)) {
        let file;
        try { file = await this.github.getText(path); } catch (readError) { await this.confirmFileMissing(readError); return; }
        const remote = parseActiveRecord(file.text, { user: this.user, path, sha: file.sha });
        if (!sameTimer(remote, operation.activeSnapshot)) {
          await this.patchActiveForOperation(operation, remote);
          throw new TrackerConflictError('The active timer changed while it was being cleared. The newer timer was preserved.', 'completion_saved_newer_timer');
        }
        try { await this.github.deleteFile(path, `timer: clear ${this.user}`, file.sha); return; }
        catch (retryError) { if (isConflict(retryError)) throw new TrackerConflictError('The active timer changed while it was being cleared.', 'completion_saved_newer_timer'); throw retryError; }
      }
      throw error;
    }
  }

  async startQueuedActive(operation) {
    const path = activeRecordPath(this.user), queuedTarget = operation.nextActive;
    if (!queuedTarget) return null;
    const target = await this.enrichGitHubMetadata(queuedTarget);
    let sha = undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const result = await this.github.putText(path, serializeActiveRecord(target), `timer: start ${this.user}`, sha);
        return { ...target, _path: path, _sha: result.sha };
      } catch (error) {
        if (!isRejectedCreate(error)) throw error;
        let file;
        try { file = await this.github.getText(path); }
        catch (readError) { throw error; }
        const remote = parseActiveRecord(file.text, { user: this.user, path, sha: file.sha });
        if (sameTimer(remote, target)) return remote;
        // Deterministic conflict policy: the later timer start wins. Equal start times
        // preserve the remote timer, avoiding an arbitrary overwrite across devices.
        if (!isNewerTimer(target, remote)) return remote;
        sha = file.sha;
      }
    }
    throw new Error('The active timer changed repeatedly while applying the latest start. Retry will converge automatically.');
  }

  async rebaseQueuedEntryEdit(operation) {
    const operationType = operation.operation ?? operation.stage;
    const requests = ['editEntry', 'deleteEntry'].includes(operationType) ? [operation.request] : operation.request?.entries;
    if (!Array.isArray(requests) || !requests.length) throw new Error('The saved edit is incomplete and cannot be retried.');
    const sources = new Map();
    for (const request of requests) {
      if (!sources.has(request.path)) sources.set(request.path, await this.readMonthly(request.path));
    }
    const rebased = requests.map(request => {
      const source = sources.get(request.path), position = locateEntry(source.entries, request.index, request.original);
      if (position < 0) throw new TrackerConflictError('The edited entry no longer exists in the latest Activity data. Reload Activity and review it before editing again.', 'queued_entry_missing');
      return { ...request, originalSha: source.sha, index: position, original: stripInternal(source.entries[position]) };
    });
    operation.request = ['editEntry', 'deleteEntry'].includes(operationType) ? rebased[0] : { ...operation.request, entries: rebased };
  }

  async compactPendingQueue() {
    return this.mutateState(state => {
      const pendingWrites = compactSupersededQueue(state.pendingWrites, state.recentCache);
      return { pendingWrites };
    }).then(state => state.pendingWrites ?? []);
  }

  async syncPending() {
    const queue = await this.compactPendingQueue();
    for (const operation of [...queue]) {
      if (!queue.some(item => item.id === operation.id)) continue;
      if (operation.stage === 'awaitSourceCompletion') break;
      const attemptStartedAt = Date.now();
      this.currentQueueDiagnostic = event => {
        appendQueueDiagnostic(operation, `GitHub ${event.method} ${event.path}: ${event.status} in ${event.durationMs}ms.`);
      };
      appendQueueDiagnostic(operation, `Sync attempt ${(operation.retryCount ?? 0) + 1} started at ${operation.stage}.`);
      try {
        const operationType = operation.operation ?? operation.stage;
        if (operation.status === 'conflict') {
          if (String(operation.conflictReason || '').startsWith('queued_write_')) break;
          const retryQueuedStart = operation.stage === 'startNext' && operation.nextActive;
          if (retryQueuedStart) {
            operation.status = 'pending'; operation.lastError = ''; operation.conflictReason = '';
            await this.persistQueueOperation(operation);
          } else {
            if (!['editEntry', 'editEntries', 'deleteEntry'].includes(operationType)) break;
            operation.operation ??= operationType;
            await this.rebaseQueuedEntryEdit(operation);
            operation.status = 'pending'; operation.lastError = ''; operation.conflictReason = '';
            await this.persistQueueOperation(operation);
          }
        }
        if (operationType === 'editEntry') assertQueuedEntryIntervals([operation.request]);
        if (operationType === 'editEntries') assertQueuedEntryIntervals(operation.request?.entries);
        if (operation.operation === 'editEntry') {
          // Batch only consecutive independent edits. Stop/switch operations
          // stay as FIFO barriers so each completion retains its issue-linked
          // "time: ... tracked ..." commit.
          const startIndex = queue.findIndex(item => item.id === operation.id);
          const batch = [];
          const targets = new Set();
          for (const candidate of queue.slice(startIndex)) {
            if (candidate.operation !== 'editEntry' || candidate.status === 'conflict'
                || !candidate.request?.original?.id || !candidate.request.path) break;
            const key = candidate.request.path + '\\u0000' + candidate.request.original.id;
            if (targets.has(key) || batch.length === 50) break;
            targets.add(key);
            batch.push(candidate);
          }
          if (batch.length > 1) {
            try {
              const saved = await this.editEntries({ entries: batch.map(item => item.request) }, { updateCache: false });
              const batchIds = new Set(batch.map(item => item.id));
              const savedById = new Map(saved.map(item => [item.id, item]));
              await this.mutateState(latest => {
                const pendingWrites = structuredClone(latest.pendingWrites ?? []);
                for (const item of batch) {
                  const index = pendingWrites.findIndex(op => op.id === item.id);
                  if (index !== -1) retargetLaterEntryEdits(pendingWrites, index, saved);
                }
                const remaining = pendingWrites.filter(item => !batchIds.has(item.id));
                return {
                  pendingWrites: remaining,
                  recentCache: (latest.recentCache ?? []).map(entry => {
                    const persisted = savedById.get(entry.id);
                    return persisted && !remaining.some(item => item.operation === 'editEntry'
                      && item.request?.original?.id === entry.id) ? persisted : entry;
                  }),
                };
              });
              for (const item of batch) {
                const index = queue.findIndex(candidate => candidate.id === item.id);
                if (index !== -1) queue.splice(index, 1);
              }
              continue;
            } catch (error) {
              if (!(error instanceof TrackerConflictError)) throw error;
              // Preserve existing per-entry rebasing and conflict reporting.
              // Do not drop a queued operation when a batch cannot be committed.
            }
          }
          let saved;
          try { saved = await this.editEntry(operation.request, { updateCache: false }); }
          catch (error) {
            if (!(error instanceof TrackerConflictError)) throw error;
            await this.rebaseQueuedEntryEdit(operation);
            assertQueuedEntryIntervals([operation.request]);
            saved = await this.editEntry(operation.request, { updateCache: false });
          }
          const index = queue.findIndex(item => item.id === operation.id);
          if (index >= 0) queue.splice(index, 1);
          await this.persistQueueOperation(operation, { remove: true, savedEntries: [saved], patch: latest => ({
            recentCache: hasLaterEntryEdit(latest.pendingWrites, operation.id, saved.id)
              ? latest.recentCache ?? []
              : (latest.recentCache ?? []).map(entry => entry.id === saved.id ? saved : entry),
          }) });
          continue;
        }
        if (operation.operation === 'editEntries') {
          let saved;
          try { saved = await this.editEntries(operation.request, { updateCache: false }); }
          catch (error) {
            if (!(error instanceof TrackerConflictError)) throw error;
            await this.rebaseQueuedEntryEdit(operation);
            assertQueuedEntryIntervals(operation.request?.entries);
            saved = await this.editEntries(operation.request, { updateCache: false });
          }
          const index = queue.findIndex(item => item.id === operation.id);
          if (index >= 0) queue.splice(index, 1);
          await this.persistQueueOperation(operation, { remove: true, savedEntries: saved, patch: latest => {
            const savedById = new Map(saved.map(entry => [entry.id, entry]));
            return { recentCache: (latest.recentCache ?? []).map(entry => {
              const persisted = savedById.get(entry.id);
              return persisted && !hasLaterEntryEdit(latest.pendingWrites, operation.id, entry.id) ? persisted : entry;
            }) };
          } });
          continue;
        }
        if (operation.operation === 'deleteEntry') {
          let result;
          try { result = await this.deleteEntry(operation.request, { updateCache: false }); }
          catch (error) {
            if (!(error instanceof TrackerConflictError)) throw error;
            await this.rebaseQueuedEntryEdit(operation);
            result = await this.deleteEntry(operation.request, { updateCache: false });
          }
          const index = queue.findIndex(item => item.id === operation.id);
          if (index >= 0) queue.splice(index, 1);
          await this.persistQueueOperation(operation, { remove: true, savedEntries: result.entries, patch: latest => ({
            recentCache: replaceCachedDeletedFile(latest.recentCache, result.entries, operation.request.path),
          }) });
          continue;
        }
        if (operation.operation === 'discardActive') {
          await this.clearMatchingActive(operation);
          const index = queue.findIndex(item => item.id === operation.id);
          if (index >= 0) queue.splice(index, 1);
          await this.persistQueueOperation(operation, { remove: true, patch: latest => ({
            activeCache: sameTimer(latest.activeCache, operation.activeSnapshot) ? null : latest.activeCache,
          }) });
          continue;
        }
        if (operation.operation === 'editActiveStart') {
          const saved = await this.editActiveStart(
            { original: operation.original, startedAt: operation.startedAt, description: operation.description },
            { updateCache: false },
          );
          const index = queue.findIndex(item => item.id === operation.id);
          if (index >= 0) queue.splice(index, 1);
          await this.persistQueueOperation(operation, { remove: true, patch: { activeCache: saved } });
          continue;
        }
        if (!['verifyActive', 'appendMonthly', 'commitCompletion', 'clearActive', 'startNext'].includes(operation.stage)) {
          throw new TrackerConflictError('This queued completion uses an unsupported storage stage. It was preserved for manual recovery.');
        }
        if (operation.stage === 'verifyActive') {
          const activeState = await this.activeStateFor(operation);
          if (activeState === 'missing' || activeState === 'changed') {
            const file = await this.readMonthly(operation.monthlyPath);
            const matches = file.entries.filter(entry => sameTimer(entry, operation.entry));
            if (matches.length > 1) throw new TrackerConflictError('Multiple completed entries match the timer that disappeared during verification. Reload before continuing.');
            if (matches.length === 0) {
              const missing = activeState === 'missing';
              throw new TrackerConflictError(
                missing ? 'The active timer no longer exists and no matching completion was found. No completion was saved.'
                  : 'The active timer changed on another device and no matching completion was found. No completion was saved.',
                missing ? 'active_missing_no_completion' : 'active_changed_no_completion',
              );
            }
            operation.entry = matches[0]; operation.stage = 'clearActive'; operation.lastError = ''; operation.conflictReason = '';
          } else {
            operation.stage = 'appendMonthly'; operation.lastError = ''; operation.conflictReason = '';
          }
          await this.persistQueueOperation(operation, { patch: operation.nextActive ? { activeCache: { ...operation.nextActive, _path: activeRecordPath(this.user), _sha: null, _pending: true } } : {} });
        }
        if (operation.stage === 'appendMonthly') {
          operation.stage = 'commitCompletion'; operation.lastError = '';
          await this.persistQueueOperation(operation, { patch: operation.nextActive ? { activeCache: { ...operation.nextActive, _path: activeRecordPath(this.user), _sha: null, _pending: true } } : {} });
        }
        if (operation.stage === 'commitCompletion') {
          operation.entry = await this.ensureEntry(operation);
          operation.stage = 'clearActive'; operation.lastError = '';
          await this.persistQueueOperation(operation, { patch: operation.nextActive ? { activeCache: { ...operation.nextActive, _path: activeRecordPath(this.user), _sha: null, _pending: true } } : {} });
        }
        let nextActive = null;
        if (operation.stage !== 'startNext') {
          if (!operation.activeCleared) await this.clearMatchingActive(operation);
          if (operation.nextActive) { operation.stage = 'startNext'; await this.persistQueueOperation(operation, { patch: { activeCache: { ...operation.nextActive, _path: activeRecordPath(this.user), _sha: null, _pending: true } } }); }
        }
        if (operation.stage === 'startNext') nextActive = await this.startQueuedActive(operation);
        const index = queue.findIndex(item => item.id === operation.id);
        if (index >= 0) queue.splice(index, 1);
        await this.persistQueueOperation(operation, {
          remove: true, savedEntries: operation.entry ? [operation.entry] : [],
          patch: latest => {
            const deletedAfterCompletion = (latest.pendingWrites ?? []).some(item =>
              item.operation === 'deleteEntry' && item.request?.original?.id === operation.entry?.id);
            const retained = (latest.recentCache ?? []).filter(item =>
              !sameCompletion(item, operation) && !(item._pending && sameTimer(item, operation.activeSnapshot)));
            return {
              activeCache: nextActive,
              // A later locally accepted Delete must win even when this Stop
              // finishes syncing after the Delete removed its cached entry.
              recentCache: operation.entry && !deletedAfterCompletion
                ? [operation.entry, ...retained].sort(newestFirst).slice(0, 50)
                : retained,
            };
          },
        });
      } catch (caughtError) {
        const rejectionDetail = String(caughtError?.message || '').trim();
        const detail = rejectionDetail && rejectionDetail !== 'GitHub rejected the request' ? ` GitHub said: ${rejectionDetail}` : '';
        const error = isPermanentQueuedWriteFailure(caughtError)
          ? new TrackerConflictError(
            operation.stage === 'startNext'
              ? `GitHub rejected starting this queued timer. Check the configured repository and access, then retry.${detail}`
              : `GitHub rejected this queued write. Check the configured repository and access, then retry.${detail}`,
            `queued_write_${caughtError.code || caughtError.status}`,
          )
          : caughtError;
        operation.retryCount = (operation.retryCount ?? 0) + 1;
        operation.lastError = error.message || 'GitHub is temporarily unreachable';
        operation.status = error instanceof TrackerConflictError ? 'conflict' : 'pending';
        operation.conflictReason = error instanceof TrackerConflictError
          ? (error.reason || (['editEntry', 'editEntries', 'deleteEntry'].includes(operation.operation) ? 'queued_entry_edit_conflict' : '')) : '';
        const remoteConflict = error instanceof TrackerConflictError && operation.stage === 'startNext' ? error.remoteActive : null;
        const keepPendingTarget = operation.nextActive && (!remoteConflict && (!(error instanceof TrackerConflictError) || operation.stage === 'startNext'));
        await this.persistQueueOperation(operation, { patch:
          remoteConflict ? { activeCache: remoteConflict }
            : keepPendingTarget ? { activeCache: { ...operation.nextActive, _path: activeRecordPath(this.user), _sha: null, _pending: true } } : {}
        });
        if (isNotFound(error)) throw error;
        break;
      } finally {
        const elapsedMs = Math.max(0, Date.now() - attemptStartedAt);
        appendQueueDiagnostic(operation, `Sync attempt finished in ${elapsedMs}ms.`);
        this.currentQueueDiagnostic = null;
      }
    }
    return (await this.store.getState()).pendingWrites ?? [];
  }

  async resolvePendingConflict(id, action = '') {
    validateEntryId(id);
    const state = await this.store.getState();
    const operation = (state.pendingWrites ?? []).find(item => item.id === id);
    if (!operation || operation.status !== 'conflict') throw new Error('Only a pending conflict can be resolved');
    if (['editEntry', 'editEntries', 'deleteEntry'].includes(operation.operation)) {
      if (action === 'discard_queued_edit') {
        await this.mutateState(latest => {
          const pendingWrites = [...(latest.pendingWrites ?? [])], index = pendingWrites.findIndex(item => item.id === id);
          if (index < 0 || pendingWrites[index].status !== 'conflict') throw new Error('The pending conflict changed before it was resolved.');
          pendingWrites.splice(index, 1);
          return { pendingWrites };
        });
        return { resolved: true, discarded: true };
      }
      await this.rebaseQueuedEntryEdit(operation);
      await this.mutateState(latest => {
        const pendingWrites = [...(latest.pendingWrites ?? [])], index = pendingWrites.findIndex(item => item.id === id);
        if (index < 0 || pendingWrites[index].status !== 'conflict') throw new Error('The pending conflict changed before it was resolved.');
        const current = pendingWrites[index];
        current.request = operation.request;
        current.status = 'pending'; current.lastError = ''; current.conflictReason = '';
        return { pendingWrites };
      });
      const remaining = await this.syncPending();
      return { resolved: !remaining.some(item => item.id === id) };
    }
    if (operation.stage === 'clearActive' || operation.stage === 'verifyActive') {
      const active = await this.readRemoteActive();
      const changed = Boolean(active && !sameTimer(active, operation.activeSnapshot));
      if (operation.stage === 'verifyActive' && (!active || changed)) {
        const file = await this.readMonthly(operation.monthlyPath);
        const matches = file.entries.filter(entry => sameTimer(entry, operation.entry));
        if (matches.length > 1) throw new TrackerConflictError('Multiple completed entries match the timer that disappeared during verification. Reload before continuing.');
        if (matches.length === 1) {
          await this.mutateState(latest => {
            const pendingWrites = [...(latest.pendingWrites ?? [])], index = pendingWrites.findIndex(item => item.id === id);
            if (index < 0 || pendingWrites[index].status !== 'conflict') throw new Error('The pending conflict changed before it was resolved.');
            pendingWrites[index] = { ...pendingWrites[index], entry: matches[0], stage: 'clearActive', status: 'pending', lastError: '', conflictReason: '' };
            return { pendingWrites, ...(index === pendingWrites.length - 1 ? { activeCache: active } : {}) };
          });
          const remaining = await this.syncPending();
          return { resolved: !remaining.some(item => item.id === id) };
        }
      }
      const canAcknowledge = !active || changed;
      if (canAcknowledge) {
        if (operation.stage === 'verifyActive' && action !== 'discard_unsaved_completion') {
          throw new Error('An explicit discard action is required because this completion was not saved.');
        }
        await this.mutateState(latest => {
          const pendingWrites = [...(latest.pendingWrites ?? [])], index = pendingWrites.findIndex(item => item.id === id);
          if (index < 0 || pendingWrites[index].status !== 'conflict') throw new Error('The pending conflict changed before it was resolved.');
          const current = pendingWrites[index], retained = (latest.recentCache ?? []).filter(item => !(item._pending && sameTimer(item, current.activeSnapshot)));
          const recentCache = (current.stage === 'clearActive'
            ? [current.entry, ...retained.filter(item => !sameCompletion(item, current))]
            : retained).sort(newestFirst).slice(0, 50);
          pendingWrites.splice(index, 1);
          return { pendingWrites, recentCache, ...(index === pendingWrites.length ? { activeCache: active } : {}) };
        });
        return { resolved: true };
      }
    }
    await this.mutateState(latest => {
      const pendingWrites = [...(latest.pendingWrites ?? [])], index = pendingWrites.findIndex(item => item.id === id);
      if (index < 0 || pendingWrites[index].status !== 'conflict') throw new Error('The pending conflict changed before it was resolved.');
      pendingWrites[index] = { ...pendingWrites[index], status: 'pending', lastError: '' };
      return { pendingWrites };
    });
    const remaining = await this.syncPending();
    return { resolved: !remaining.some(item => item.id === id) };
  }

  async backfillIssueTitles(files, knownTitles = new Map()) {
    const untitled = files.flatMap(file => file.entries).filter(entry => !taskTitleOf(entry))
      .sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime());
    if (!untitled.length) return files;
    const titles = new Map();
    for (const entry of untitled) {
      const url = taskUrlOf(entry), known = normalizePlainTitle(knownTitles.get(url));
      if (known) titles.set(url, known);
    }
    const unresolved = [...new Map(untitled.flatMap(entry => {
      const url = taskUrlOf(entry), issue = entry.issue ?? parseGitHubTaskUrl(url);
      return !titles.has(url) && issue ? [[url, issue]] : [];
    })).values()].slice(0, 100);
    if (unresolved.length && typeof this.github.getTaskMetadata === 'function') {
      try {
        const metadata = await this.github.getTaskMetadata(unresolved, { batchSize: 50, maxRequests: 2 });
        for (const [url, details] of metadata) {
          const title = normalizePlainTitle(details?.title);
          if (title) titles.set(url, title);
        }
      } catch (error) {
        if (!['authentication', 'permission', 'not_found', 'rate_limit'].includes(error?.code)) throw error;
      }
    }
    if (!titles.size) return files;
    const touched = files.filter(file => file.entries.some(entry => !taskTitleOf(entry) && titles.has(taskUrlOf(entry)))).map(file => ({
      ...file,
      entries: file.entries.map(entry => !taskTitleOf(entry) && titles.has(taskUrlOf(entry))
        ? { ...entry, taskTitle: titles.get(taskUrlOf(entry)), issueTitle: titles.get(taskUrlOf(entry)) } : entry),
    }));
    if (!touched.length) return files;
    try {
      let blobShas = {};
      if (touched.length === 1) {
        const file = touched[0], result = await this.putMonthly(file, file.entries, `time: add missing titles ${this.user} ${file.month}`);
        blobShas[file.path] = result.sha;
      } else {
        const changes = touched.map(file => ({ path: file.path, sha: file.sha, text: serializeMonthlyRecords(file.entries) }));
        ({ blobShas } = await this.github.updateTextsAtomic(changes, `time: add missing titles ${this.user}`));
      }
      const saved = new Map(touched.map(file => [file.path, {
        ...file,
        sha: blobShas[file.path],
        entries: parseMonthlyRecords(serializeMonthlyRecords(file.entries), { user: this.user, month: file.month, path: file.path, sha: blobShas[file.path] }),
      }]));
      return files.map(file => saved.get(file.path) ?? file);
    } catch (error) {
      if (isConflict(error)) throw new TrackerConflictError('A monthly time file changed while missing task titles were being saved. Reload.');
      throw error;
    }
  }

  async backfillActiveIssueTitle(active, knownTitles = new Map()) {
    if (!active || taskTitleOf(active) || !knownTitles.has(taskUrlOf(active))) return active;
    const state = await this.store.getState();
    if ((state.pendingWrites ?? []).some(operation => sameTimer(operation.activeSnapshot, active))) return active;
    const taskTitle = normalizePlainTitle(knownTitles.get(taskUrlOf(active)));
    if (!taskTitle) return active;
    const path = activeRecordPath(this.user);
    try {
      const file = await this.github.getText(path), remote = parseActiveRecord(file.text, { user: this.user, path, sha: file.sha });
      if (!sameTimer(remote, active)) throw new TrackerConflictError('The active timer changed while its missing task title was being saved. Reload.');
      if (taskTitleOf(remote)) return remote;
      const titled = { ...remote, taskTitle, issueTitle: taskTitle };
      const result = await this.github.putText(path, serializeActiveRecord(titled), `timer: add missing title ${this.user}`, file.sha);
      const saved = parseActiveRecord(serializeActiveRecord(titled), { user: this.user, path, sha: result.sha });
      await this.store.patchState({ activeCache: saved });
      return saved;
    } catch (error) {
      if (isConflict(error)) throw new TrackerConflictError('The active timer changed while its missing task title was being saved. Reload.');
      throw error;
    }
  }

  async cachedMenuData(limit = 50, now = this.clock()) {
    const state = await this.store.getState();
    const recent = (state.recentCache ?? []).slice(0, limit);
    const summary = summaryProjection(state, now);
    return {
      configured: true,
      recent,
      summaries: [],
      reportDate: localReportDate(now),
      active: state.activeCache,
      pendingWrites: state.pendingWrites ?? [],
      pendingCount: state.pendingWrites?.length ?? 0,
      ...summary,
    };
  }

  async loadMenuData(limit = 50, { knownTitles = new Map() } = {}) {
    const now = this.clock(), dateFor = offset => localReportDate(now, offset);
    const today = dateFor(0), mondayOffset = (now.getDay() + 6) % 7;
    const thisWeekStart = dateFor(-mondayOffset), lastWeekStart = dateFor(-mondayOffset - 7), lastWeekEnd = dateFor(-mondayOffset - 1);
    const thisMonthStart = `${today.slice(0, 7)}-01`;
    const summaryRanges = [
      { key: 'today', label: 'Today', startDate: today, endDate: today, displayMs: 2000 },
      { key: 'this-week', label: 'This week', startDate: thisWeekStart, endDate: today, displayMs: 1000 },
      { key: 'last-week', label: 'Last week', startDate: lastWeekStart, endDate: lastWeekEnd, displayMs: 1000 },
      { key: 'this-month', label: 'This month', startDate: thisMonthStart, endDate: today, displayMs: 1000 },
    ];
    const dates = Array.from({ length: this.recentDays }, (_, offset) => dateFor(-offset));
    const dateSet = new Set(dates), earliest = [lastWeekStart, thisMonthStart, dates.at(-1)].sort()[0];
    const months = [];
    for (let cursor = new Date(`${earliest.slice(0, 7)}-01T12:00:00`), end = new Date(`${today.slice(0, 7)}-01T12:00:00`); cursor <= end; cursor.setMonth(cursor.getMonth() + 1)) {
      months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
    }
    const initial = await this.store.getState();
    // Keep the local projection available if the GitHub read fails, while
    // retaining remote reads for complete summary totals and queue rebasing.
    let missingReachability = null;
    let files;
    try {
      files = await Promise.all(months.map(async month => {
      const path = monthlyRecordsPath(this.user, `${month}-01`);
      try {
        const file = await this.github.getText(path);
        return { path, month, sha: file.sha, entries: parseMonthlyRecords(file.text, { user: this.user, month, path, sha: file.sha }) };
      } catch (error) {
        if (!isNotFound(error)) throw error;
        missingReachability ||= this.confirmFileMissing(error);
        await missingReachability;
        return { path, month, sha: null, entries: [] };
      }
      }));
    } catch (error) {
      if (initial.pendingWrites?.length || initial.recentCache?.length) return this.cachedMenuData(limit, now);
      throw error;
    }
    files = await this.backfillIssueTitles(files, knownTitles);
    const remoteEntries = files.flatMap(file => file.entries).filter(entry => startDate(entry) >= earliest && startDate(entry) <= today);
    const initialState = await this.store.getState();
    // The remote request was started against an older local generation. Do not
    // overwrite local edits that were accepted or completed while it ran.
    if (JSON.stringify([initial.activeCache, initial.recentCache, initial.pendingWrites, initial.summaryCache])
        !== JSON.stringify([initialState.activeCache, initialState.recentCache, initialState.pendingWrites, initialState.summaryCache])) {
      return this.cachedMenuData(limit, now);
    }
    await this.backfillActiveIssueTitle(initialState.activeCache, knownTitles);
    const summaryCache = {
      reportDate: today,
      weekEntries: remoteEntries.filter(entry => startDate(entry) >= thisWeekStart),
      computedAt: now.getTime(),
      ...(initialState.summaryCache?.silentPull ? { silentPull: initialState.summaryCache.silentPull } : {}),
    };
    // Apply the queue inside the storage transaction so a concurrent acceptance cannot be overwritten.
    let staleResponse = false;
    await this.mutateState(state => {
      if (JSON.stringify([state.activeCache, state.recentCache, state.pendingWrites, state.summaryCache])
          !== JSON.stringify([initialState.activeCache, initialState.recentCache, initialState.pendingWrites, initialState.summaryCache])) {
        staleResponse = true;
        return null;
      }
      return {
        recentCache: overlayPendingEntries(remoteEntries, state.pendingWrites ?? [])
          .filter(entry => dateSet.has(startDate(entry))).sort(newestFirst).slice(0, limit),
        summaryCache,
      };
    });
    if (staleResponse) {
      // A timer may have been accepted during this read. Retain its local
      // interval and queue, but populate missing totals from the completed
      // records we already fetched, overlaying the newer queued mutation.
      await this.mutateState(state => state.summaryCache ? null : { summaryCache });
      return this.cachedMenuData(limit, now);
    }
    const state = await this.store.getState(), pendingWrites = state.pendingWrites ?? [], activeCache = state.activeCache;
    const allEntries = overlayPendingEntries([...remoteEntries, ...(state.recentCache ?? [])], pendingWrites);
    const recent = state.recentCache ?? [];
    const summaries = summaryRanges.map(range => ({ ...range, seconds: allEntries
      .filter(entry => startDate(entry) >= range.startDate && startDate(entry) <= range.endDate)
      .reduce((sum, entry) => sum + Math.max(0, Number(entry.durationSeconds) || 0), 0) }));
    const recovery = recoveryProjection({ active: activeCache, recent: allEntries, pendingWrites });
    const active = activeCache ? {
      id: activeCache.id, taskUrl: taskUrlOf(activeCache), taskTitle: taskTitleOf(activeCache), ...(activeCache.issue ? { issue: activeCache.issue } : {}), startedAt: activeCache.startedAt,
      description: activeCache.description || '', issueTitle: taskTitleOf(activeCache),
      entryDate: activeCache.entryDate, timezone: activeCache.timezone,
    } : null;
    return {
      recent, summaries, todaySeconds: summaries[0].seconds, reportDate: today, active,
      ...recovery,
      ...summaryProjection(state, this.clock()),
    };
  }

  async loadRecent(limit = 50) { return (await this.loadMenuData(limit)).recent; }

  // This is deliberately separate from loadMenuData(): the one-minute background
  // pull must never set UI loading state or perform remote writes.
  async pullRemoteSilently({ signal, maxBytes = 8 * 1024 * 1024 } = {}) {
    const initial = await this.store.getState();
    // A pending local mutation is authoritative. Recheck GitHub after it is
    // committed or explicitly resolved, rather than overwriting its projection.
    if (initial.pendingWrites?.length) return false;

    const now = this.clock(), today = localReportDate(now);
    const mondayOffset = (now.getDay() + 6) % 7;
    const lastWeekStart = localReportDate(now, -mondayOffset - 7);
    const thisWeekStart = localReportDate(now, -mondayOffset);
    const earliest = [lastWeekStart, `${today.slice(0, 7)}-01`, localReportDate(now, 1 - this.recentDays)].sort()[0];
    const days = new Set(Array.from({ length: this.recentDays }, (_, offset) => localReportDate(now, -offset)));
    const activePath = activeRecordPath(this.user);
    const repoKey = this.github.repositoryKey;
    const previous = initial.summaryCache?.silentPull;
    const etag = previous?.key === repoKey && previous.day === today ? previous.etag : '';
    const snapshot = await this.github.listTextFilesSnapshot('times/', { etag, signal, includeActive: activePath });
    if (snapshot.notModified) return false;

    const available = new Map((snapshot.files ?? []).map(file => [file.path, file]));
    const monthlyPaths = monthsInRange(earliest, today).map(month => monthlyRecordsPath(this.user, `${month}-01`));
    const needed = [...monthlyPaths, activePath].map(path => available.get(path)).filter(Boolean);
    if (needed.some(file => !Number.isSafeInteger(file.size) || file.size > maxBytes)
        || needed.reduce((sum, file) => sum + file.size, 0) > maxBytes) return false;

    // Immutable Git blobs keep every file in this read pinned to one branch
    // snapshot, even if another browser pushes in the middle of the pull.
    const fetched = await Promise.all(needed.map(file => this.github.getBlobText(file.path, file.sha, { signal })));
    if (fetched.reduce((sum, file) => sum + new TextEncoder().encode(file.text).byteLength, 0) > maxBytes) return false;
    const contents = new Map(fetched.map(file => [file.path, file]));
    const remoteEntries = monthlyPaths.flatMap(path => {
      const file = contents.get(path);
      if (!file) return [];
      return parseMonthlyRecords(file.text, { user: this.user, month: monthFromPath(path, this.user), path, sha: file.sha });
    });
    const activeFile = contents.get(activePath);
    const remoteActive = activeFile
      ? parseActiveRecord(activeFile.text, { user: this.user, path: activePath, sha: activeFile.sha })
      : null;
    if (remoteActive) validateActiveTimer(remoteActive);

    // An IndexedDB transaction serializes this comparison with local accepts
    // and queue completions. If anything changed during network I/O, defer
    // the pull rather than applying an older snapshot over newer local work.
    const trackingKey = state => JSON.stringify([
      state.activeCache, state.recentCache, state.summaryCache, state.pendingWrites,
    ]);
    const expected = trackingKey(initial);
    let applied = false;
    await this.mutateState(state => {
      if (state.pendingWrites?.length || trackingKey(state) !== expected) return null;
      applied = true;
      return {
        activeCache: remoteActive,
        recentCache: remoteEntries.filter(entry => days.has(startDate(entry))).sort(newestFirst).slice(0, 50),
        summaryCache: {
          reportDate: today,
          weekEntries: remoteEntries.filter(entry => startDate(entry) >= thisWeekStart),
          computedAt: now.getTime(),
          silentPull: { key: repoKey, day: today, etag: snapshot.etag || '' },
        },
      };
    });
    return applied;
  }

  async historicalQueueEntries(requests) {
    const state = await this.store.getState();
    const missing = requests.filter(request => !(state.recentCache ?? []).some(entry => entry._path === request.path && entry.id === request.original?.id));
    const files = new Map();
    for (const request of missing) {
      validateEntryId(request.original?.id);
      monthFromPath(request.path, this.user);
      const key = `${request.path}\u0000${request.originalSha || ''}`;
      if (!files.has(key)) files.set(key,
        await this.reports?.cachedMonthly(request.path, request.originalSha) ?? await this.readMonthly(request.path));
    }
    return new Map(missing.map(request => {
      const file = files.get(`${request.path}\u0000${request.originalSha || ''}`);
      const position = locateEntry(file.entries, request.index, request.original);
      return [`${request.path}\u0000${request.original.id}`, position < 0 ? null : file.entries[position]];
    }));
  }

  queuedEntry(state, request, historical) {
    const cached = (state.recentCache ?? []).find(entry => entry.id === request.original?.id && entry._path === request.path);
    if (cached) return cached;
    const key = `${request.path}\u0000${request.original?.id}`;
    const remote = historical.get(key);
    if (!remote) return null;
    const relevant = (state.pendingWrites ?? []).filter(operation => {
      const type = operation.operation ?? operation.stage;
      if (type === 'editEntry' || type === 'deleteEntry') return operation.request?.path === request.path && operation.request?.original?.id === remote.id;
      return type === 'editEntries' && operation.request?.entries?.some(item => item.path === request.path && item.original?.id === remote.id);
    });
    if (relevant.some(operation => (operation.operation ?? operation.stage) === 'deleteEntry')) return null;
    return overlayPendingEntries([remote], relevant).find(entry => entry.id === remote.id && entry._path === request.path) ?? null;
  }

  async queueEntryEdit({ path, originalSha, index, original, edits }) {
    const queuedAt = this.clock();
    const historical = await this.historicalQueueEntries([{ path, originalSha, index, original }]);
    return this.mutateState(state => {
      const cached = this.queuedEntry(state, { path, original }, historical);
      if (!cached) throw new TrackerConflictError('This time entry is no longer available locally. Reload before editing.');
      const updated = applyEntryEdits(cached, edits, editClock(this.clock, cached));
      if (updated.startedAt !== cached.startedAt || updated.endedAt !== cached.endedAt) assertNoActiveOverlap([updated], state.activeCache);
      const pendingWrites = [...(state.pendingWrites ?? [])];
      const existing = trailingSupersedable(pendingWrites, operation => operation.operation === 'editEntry'
        && operation.request?.path === path && operation.request?.original?.id === original.id);
      const request = existing?.request ?? { path, originalSha: cached._sha, index: cached._index, original: stripInternal(cached), edits: {} };
      request.edits = { ...request.edits, ...edits };
      const operation = existing ?? {
        operation: 'editEntry', id: createUlid(queuedAt.getTime() + pendingWrites.length), status: 'pending', retryCount: 0,
        stage: 'editEntry', request, queuedAt: queuedAt.toISOString(), lastError: '',
      };
      operation.lastLocalEditAt = queuedAt.toISOString();
      if (existing) Object.assign(existing, operation); else pendingWrites.push(operation);
      const recentCache = (state.recentCache ?? []).map(entry => entry.id === original.id && entry._path === path
        ? { ...updated, _path: entry._path, _sha: entry._sha, _index: entry._index, _pending: true } : entry);
      return { pendingWrites, recentCache };
    }).then(state => ({
      operationId: trailingSupersedable(state.pendingWrites ?? [], operation => operation.operation === 'editEntry'
        && operation.request?.path === path && operation.request?.original?.id === original.id)?.id,
      pending: true,
    }));
  }

  async queueEntryDelete({ path, originalSha, index, original }) {
    const queuedAt = this.clock();
    const historical = await this.historicalQueueEntries([{ path, originalSha, index, original }]);
    return this.mutateState(state => {
      const cached = this.queuedEntry(state, { path, original }, historical);
      if (!cached) throw new TrackerConflictError('This time entry is no longer available locally. Reload before deleting.');
      const pendingWrites = [...(state.pendingWrites ?? [])];
      const operation = {
        operation: 'deleteEntry', id: createUlid(queuedAt.getTime() + pendingWrites.length), status: 'pending', retryCount: 0,
        stage: 'deleteEntry', request: { path, originalSha: cached._sha, index: cached._index, original: stripInternal(cached) },
        queuedAt: queuedAt.toISOString(), lastError: '',
      };
      pendingWrites.push(operation);
      const recentCache = (state.recentCache ?? []).filter(entry => !(entry.id === cached.id && entry._path === path));
      return { pendingWrites, recentCache };
    }).then(state => {
      const operation = state.pendingWrites.at(-1);
      return { operationId: operation?.operation === 'deleteEntry' ? operation.id : null, pending: true };
    });
  }

  async queueEntriesEdit({ entries }) {
    const queuedAt = this.clock();
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > 50) throw new Error('One to fifty linked time entries are required');
    const historical = await this.historicalQueueEntries(entries);
    return this.mutateState(state => {
      const cachedByIdentity = new Map(entries.map(request => [
        `${request?.path}\u0000${request?.original?.id}`, this.queuedEntry(state, request, historical),
      ]));
      const requestEntries = entries.map(request => {
        const cached = cachedByIdentity.get(`${request?.path}\u0000${request?.original?.id}`);
        if (!cached) throw new TrackerConflictError('A linked time entry is no longer available locally. Reload before editing.');
        return { ...request, originalSha: cached._sha, index: cached._index, original: stripInternal(cached) };
      });
      const identities = new Set(requestEntries.map(request => `${request.path}\u0000${request.original.id}`));
      if (identities.size !== requestEntries.length) throw new Error('Linked time entries must be distinct');
      const updatedByIdentity = new Map(requestEntries.map(request => {
        const cached = cachedByIdentity.get(`${request.path}\u0000${request.original.id}`);
        return [`${request.path}\u0000${request.original.id}`, applyEntryEdits(cached, request.edits, editClock(this.clock, cached))];
      }));
      assertNoActiveOverlap(requestEntries.flatMap(request => {
        const key = `${request.path}\u0000${request.original.id}`, cached = cachedByIdentity.get(key), updated = updatedByIdentity.get(key);
        return updated.startedAt !== cached.startedAt || updated.endedAt !== cached.endedAt ? [updated] : [];
      }), state.activeCache);
      const pendingWrites = [...(state.pendingWrites ?? [])];
      const existing = pendingWrites.at(-1)?.operation === 'editEntries' ? pendingWrites.at(-1) : null;
      const request = existing?.request ?? { entries: [] };
      const existingByIdentity = new Map(request.entries.map(item => [`${item.path}\u0000${item.original.id}`, item]));
      for (const item of requestEntries) {
        const identity = `${item.path}\u0000${item.original.id}`, prior = existingByIdentity.get(identity);
        if (prior) prior.edits = { ...prior.edits, ...item.edits };
        else { request.entries.push(item); existingByIdentity.set(identity, item); }
      }
      const operation = existing ?? {
        operation: 'editEntries', id: createUlid(queuedAt.getTime() + pendingWrites.length), status: 'pending', retryCount: 0,
        stage: 'editEntries', request, queuedAt: queuedAt.toISOString(), lastError: '',
      };
      operation.lastLocalEditAt = queuedAt.toISOString();
      if (!existing) pendingWrites.push(operation);
      const recentCache = (state.recentCache ?? []).map(entry => {
        const updated = updatedByIdentity.get(`${entry._path}\u0000${entry.id}`);
        return updated ? { ...updated, _path: entry._path, _sha: entry._sha, _index: entry._index, _pending: true } : entry;
      });
      return { pendingWrites, recentCache };
    }).then(state => ({ operationId: state.pendingWrites.at(-1)?.operation === 'editEntries' ? state.pendingWrites.at(-1).id : null, pending: true }));
  }

  async queueActiveStartEdit({ original, startedAt, description }) {
    const queuedAt = this.clock();
    return this.mutateState(state => {
      const active = state.activeCache;
      if (!active || active.id !== original?.id || active.startedAt !== original?.startedAt) throw new TrackerConflictError('The active timer changed before its edit was queued. Reload before trying again.');
      const edits = {
        ...(startedAt !== undefined ? { startedAt } : {}),
        ...(description !== undefined ? { description } : {}),
      };
      const updated = applyActiveEdits(active, edits, queuedAt);
      const pendingWrites = [...(state.pendingWrites ?? [])];
      const existing = trailingSupersedable(pendingWrites, operation => operation.operation === 'editActiveStart'
        && operation.original?.id === active.id);
      const operation = existing ?? {
        operation: 'editActiveStart', id: createUlid(queuedAt.getTime() + pendingWrites.length), status: 'pending', retryCount: 0,
        stage: 'editActiveStart', original: { id: active.id, startedAt: active.startedAt }, startedAt: updated.startedAt, description: updated.description, queuedAt: queuedAt.toISOString(), lastError: '',
      };
      operation.startedAt = updated.startedAt;
      operation.description = updated.description;
      operation.lastLocalEditAt = queuedAt.toISOString();
      if (!existing) pendingWrites.push(operation);
      return { pendingWrites, activeCache: { ...updated, _path: active._path, _sha: active._sha, _pending: true } };
    }).then(state => ({
      operationId: trailingSupersedable(state.pendingWrites ?? [], operation => operation.operation === 'editActiveStart'
        && operation.original?.id === original.id)?.id,
      pending: true,
    }));
  }

  async editEntry({ path, originalSha, index, original, edits }, { updateCache = true } = {}) {
    const source = await this.readMonthly(path);
    if (source.sha !== originalSha) throw new TrackerConflictError('This monthly time file changed after you opened it. Reload before saving.');
    const position = locateEntry(source.entries, index, original);
    if (position < 0) throw new TrackerConflictError('This time entry changed after you opened it. Reload before saving.');
    const normalized = { ...edits, ...((edits.taskUrl || edits.issue) ? { taskUrl: this.validateTaskUrl(edits.taskUrl ?? edits.issue) } : {}) };
    const updated = applyEntryEdits(source.entries[position], normalized, editClock(this.clock, source.entries[position]));
    const timeChanged = updated.startedAt !== source.entries[position].startedAt || updated.endedAt !== source.entries[position].endedAt;
    const active = timeChanged ? await this.readRemoteActive() : null;
    if (timeChanged) assertNoActiveOverlap([updated], active);
    const guards = timeChanged ? [{ path: activeRecordPath(this.user), sha: active?._sha ?? null }] : [];
    updated.entryDate = startDate(updated);
    const destinationPath = monthlyRecordsPath(this.user, updated.entryDate);
    try {
      if (destinationPath === path) {
        const entries = source.entries.with(position, updated);
        const { blobShas } = await this.updateCompletedRecords([
          { path: source.path, sha: source.sha, text: serializeMonthlyRecords(entries) },
        ], `time: edit ${this.user} ${source.month}`, { remove: [source.entries[position]], add: [updated], guards });
        const saved = parseMonthlyRecords(serializeMonthlyRecords(entries), { user: this.user, month: source.month, path, sha: blobShas[path] });
        if (updateCache) {
          const state = await this.store.getState();
          await this.store.patchState({ recentCache: replaceCachedFiles(state.recentCache, saved) });
        }
        return saved[position];
      }
      const destination = await this.readMonthly(destinationPath);
      const sourceEntries = source.entries.filter((_, current) => current !== position), destinationEntries = [...destination.entries, updated];
      const changes = [
        { path: source.path, sha: source.sha, text: serializeMonthlyRecords(sourceEntries) || null },
        { path: destination.path, sha: destination.sha, text: serializeMonthlyRecords(destinationEntries) },
      ];
      const result = await this.updateCompletedRecords(changes, `time: move edited entry ${this.user}`, {
        remove: [source.entries[position]], add: [updated], guards,
      });
      const savedSource = parseMonthlyRecords(serializeMonthlyRecords(sourceEntries), { user: this.user, month: source.month, path: source.path, sha: result.blobShas[source.path] ?? null });
      const savedDestination = parseMonthlyRecords(serializeMonthlyRecords(destinationEntries), { user: this.user, month: destination.month, path: destination.path, sha: result.blobShas[destination.path] });
      const replacements = [...savedSource, ...savedDestination];
      if (updateCache) {
        const state = await this.store.getState();
        await this.store.patchState({ recentCache: replaceCachedFiles(state.recentCache, replacements, [source.path, destination.path]) });
      }
      return savedDestination.at(-1);
    } catch (error) { if (isConflict(error)) throw new TrackerConflictError('A monthly time file changed while you were saving. Reload.'); throw error; }
  }


  async editActiveStart({ original, startedAt, description }, { updateCache = true } = {}) {
    const active = await this.readRemoteActive();
    if (!active) throw new TrackerConflictError('The running timer is no longer active. Reload before saving.');
    if (!matchesOriginal(active, original) || active.startedAt !== original?.startedAt) {
      throw new TrackerConflictError('The running timer changed after the timeline loaded. Reload before saving.');
    }
    const updated = applyActiveEdits(active, { startedAt, description }, this.clock());
    try {
      const result = await this.github.putText(activeRecordPath(this.user), serializeActiveRecord(updated), `timer: edit start ${this.user}`, active._sha);
      const cached = { ...updated, _path: activeRecordPath(this.user), _sha: result.sha };
      if (updateCache) await this.store.patchState({ activeCache: cached });
      return cached;
    } catch (error) {
      if (isConflict(error)) throw new TrackerConflictError('The running timer changed while you were saving. Reload before saving.');
      throw error;
    }
  }

  async editEntries({ entries: requests }, { updateCache = true } = {}) {
    if (!Array.isArray(requests) || requests.length < 1 || requests.length > 50) throw new Error('One to fifty linked time entries are required');
    const files = new Map();
    for (const request of requests) {
      if (!request?.path) throw new Error('Each linked time entry requires a monthly path');
      if (!files.has(request.path)) files.set(request.path, await this.readMonthly(request.path));
      const file = files.get(request.path);
      if (file.sha !== request.originalSha) throw new TrackerConflictError('A monthly time file changed after the panel loaded. Reload before saving.');
      request.position = locateEntry(file.entries, request.index, request.original);
      if (request.position < 0) throw new TrackerConflictError('A linked time entry changed inside its monthly file. Reload before saving.');
      request.originalEntry = file.entries[request.position];
    }
    const identities = new Set(requests.map(request => `${request.path}\u0000${request.position}`));
    if (identities.size !== requests.length) throw new Error('Linked time entries must be distinct');
    const updated = requests.map(request => {
      const edits = { ...request.edits, ...((request.edits?.taskUrl || request.edits?.issue)
        ? { taskUrl: this.validateTaskUrl(request.edits.taskUrl ?? request.edits.issue) } : {}) };
      const entry = applyEntryEdits(request.originalEntry, edits, editClock(this.clock, request.originalEntry));
      entry.entryDate = startDate(entry);
      return entry;
    });
    const changedTimes = updated.filter((entry, index) => entry.startedAt !== requests[index].originalEntry.startedAt
      || entry.endedAt !== requests[index].originalEntry.endedAt);
    const active = changedTimes.length ? await this.readRemoteActive() : null;
    assertNoActiveOverlap(changedTimes, active);
    const guards = changedTimes.length ? [{ path: activeRecordPath(this.user), sha: active?._sha ?? null }] : [];
    const targetPaths = updated.map(entry => monthlyRecordsPath(this.user, entry.entryDate));
    for (const targetPath of targetPaths) if (!files.has(targetPath)) files.set(targetPath, await this.readMonthly(targetPath));
    for (const request of requests) {
      const source = files.get(request.path);
      source.entries = source.entries.filter(entry => entry !== request.originalEntry);
    }
    updated.forEach((entry, index) => files.get(targetPaths[index]).entries.push(entry));
    const touchedPaths = [...new Set([...requests.map(request => request.path), ...targetPaths])];
    const touched = touchedPaths.map(path => files.get(path));
    for (const file of touched) file.entries.sort((left, right) => new Date(left.startedAt) - new Date(right.startedAt));
    const resultLocations = updated.map((entry, index) => ({ path: targetPaths[index], index: files.get(targetPaths[index]).entries.indexOf(entry) }));
    try {
      const changes = touched.map(file => ({ path: file.path, sha: file.sha, text: serializeMonthlyRecords(file.entries) || null }));
      const { blobShas } = await this.updateCompletedRecords(changes, `time: edit linked entries ${this.user}`, {
        remove: requests.map(request => request.originalEntry), add: updated, guards,
      });
      const savedByPath = new Map(touched.map(file => [file.path, parseMonthlyRecords(serializeMonthlyRecords(file.entries), {
        user: this.user, month: file.month, path: file.path, sha: blobShas[file.path] ?? null,
      })]));
      const replacements = [...savedByPath.values()].flat();
      if (updateCache) {
        const state = await this.store.getState();
        await this.store.patchState({ recentCache: replaceCachedFiles(state.recentCache, replacements, touchedPaths) });
      }
      return resultLocations.map(location => savedByPath.get(location.path)[location.index]);
    } catch (error) {
      if (isConflict(error)) throw new TrackerConflictError('A monthly time file changed while linked time edits were being saved. Reload.');
      throw error;
    }
  }

  async mergeTasks({ pairs, startDate, endDate }) {
    if (!Array.isArray(pairs) || !pairs.length || pairs.length > 100) throw new Error('Choose one to one hundred task merges');
    const replacements = new Map();
    for (const pair of pairs) {
      const sourceUrl = normalizeStoredTaskIdentity(pair?.sourceTaskUrl), targetUrl = this.validateTaskUrl(pair?.targetTaskUrl);
      if (sourceUrl === targetUrl) throw new Error('Choose two different tasks to merge');
      if (replacements.has(sourceUrl)) throw new Error('Each task can be replaced only once');
      replacements.set(sourceUrl, { taskUrl: targetUrl, taskTitle: String(pair?.targetTaskTitle || '').trim().slice(0, 300) });
    }
    const state = await this.store.getState();
    if ((state.pendingWrites ?? []).length) throw new Error('Sync pending changes before merging tasks.');
    const files = new Map();
    for (const month of monthsInRange(startDate, endDate)) {
      const path = monthlyRecordsPath(this.user, `${month}-01`);
      files.set(path, await this.readMonthly(path));
    }
    const removed = [], added = [], touched = [];
    for (const file of files.values()) {
      let changed = false;
      file.entries = file.entries.map(entry => {
        const replacement = replacements.get(taskUrlOf(entry));
        if (entry.entryDate < startDate || entry.entryDate > endDate || !replacement) return entry;
        const updated = withTaskIdentityHistory(applyEntryEdits(entry, replacement, editClock(this.clock, entry)), entry);
        removed.push(entry); added.push(updated); changed = true; return updated;
      });
      if (changed) touched.push(file);
    }
    const active = await this.readRemoteActive();
    const activeReplacement = active ? replacements.get(taskUrlOf(active)) : null;
    const mergeActive = Boolean(active && active.entryDate >= startDate && active.entryDate <= endDate && activeReplacement);
    const updatedActive = mergeActive
      ? withTaskIdentityHistory(applyActiveEdits(active, activeReplacement, this.clock()), active) : active;
    if (!touched.length && !mergeActive) return { mergedEntries: 0, mergedActive: false };
    const activePath = activeRecordPath(this.user);
    const changes = touched.map(file => ({ path: file.path, sha: file.sha, text: serializeMonthlyRecords(file.entries) }));
    if (mergeActive) changes.push({ path: activePath, sha: active._sha, text: serializeActiveRecord(updatedActive) });
    try {
      const result = removed.length
        ? await this.updateCompletedRecords(changes, `time: merge tasks ${this.user}`, { remove: removed, add: added })
        : await this.github.updateTextsAtomic(changes, `timer: merge active task ${this.user}`);
      const replacements = touched.flatMap(file => parseMonthlyRecords(serializeMonthlyRecords(file.entries), {
        user: this.user, month: file.month, path: file.path, sha: result.blobShas[file.path],
      }));
      const patch = {};
      if (touched.length) patch.recentCache = replaceCachedFiles(state.recentCache, replacements, touched.map(file => file.path));
      if (mergeActive) patch.activeCache = { ...updatedActive, _path: activePath, _sha: result.blobShas[activePath] };
      await this.store.patchState(patch);
      return { mergedEntries: removed.length, mergedActive: mergeActive };
    } catch (error) {
      if (isConflict(error)) throw new TrackerConflictError('Time data changed while tasks were being merged. Reload and try again.');
      throw error;
    }
  }

  async bulkAddTimes(text) {
    const requested = parseBulkTimeText(text);
    const activeTimer = await this.refreshActive();
    const activeStartMs = activeTimer ? new Date(activeTimer.startedAt).getTime() : Infinity;
    const touchedMonths = new Set(requested.map(item => item.date.slice(0, 7)));
    const validationMonths = new Set(touchedMonths), latestTouchedMonth = [...touchedMonths].sort().at(-1);
    const snapshot = await this.github.listTextFilesSnapshot('times/');
    for (const file of snapshot.files ?? []) {
      try {
        const month = monthFromPath(file.path, this.user);
        if (month <= latestTouchedMonth) validationMonths.add(month);
      } catch { /* Another user's or unrelated text file. */ }
    }
    const files = new Map();
    for (const month of [...validationMonths].sort()) {
      const path = monthlyRecordsPath(this.user, `${month}-01`);
      files.set(path, await this.readMonthly(path));
    }
    const added = [], usedIds = new Set([...files.values()].flatMap(file => file.entries.map(record => record.id)));
    for (const item of requested) {
      const dayStart = localMidnight(item.date), dayEnd = nextLocalMidnight(item.date);
      const dayStartMs = new Date(dayStart).getTime(), dayEndMs = new Date(dayEnd).getTime();
      const existing = [...files.values()].flatMap(file => file.entries).filter(entry => {
        const start = new Date(entry.startedAt).getTime(), end = new Date(entry.endedAt).getTime();
        return start < dayEndMs && end > dayStartMs;
      }).sort((left, right) => new Date(left.startedAt) - new Date(right.startedAt));
      for (let index = 1; index < existing.length; index += 1) {
        if (new Date(existing[index].startedAt) < new Date(existing[index - 1].endedAt)) {
          throw new Error(`Line ${item.line}: existing time on ${item.date} already overlaps. No entries were added.`);
        }
      }
      const latestEnd = existing.reduce((latest, entry) => Math.max(latest, new Date(entry.endedAt).getTime()), dayStartMs);
      const startedAt = latestEnd === dayStartMs ? dayStart : localTimestamp(new Date(latestEnd));
      const endedAt = localTimestamp(new Date(latestEnd + item.durationSeconds * 1000)), endedAtMs = new Date(endedAt).getTime();
      if (endedAtMs > dayEndMs) throw new Error(`Line ${item.line}: ${item.durationSeconds / 3600} hours do not fit after existing time on ${item.date}. No entries were added.`);
      if (endedAtMs > activeStartMs) throw new Error(`Line ${item.line}: imported time would overlap the running timer that started at ${activeTimer.startedAt}. No entries were added.`);
      const active = this.buildActive({ id: this.uniqueRecordId(latestEnd, usedIds), taskUrl: item.taskUrl, startedAt, entryDate: item.date, description: item.description });
      const entry = buildEntry({ active, endedAt, now: endedAt, description: item.description });
      entry.entryDate = item.date;
      const path = monthlyRecordsPath(this.user, item.date), file = files.get(path);
      file.entries.push(entry); file.entries.sort((left, right) => new Date(left.startedAt) - new Date(right.startedAt));
      added.push(entry);
    }
    const touched = [...touchedMonths].sort().map(month => files.get(monthlyRecordsPath(this.user, `${month}-01`)));
    const staged = touched.map(file => {
      const text = serializeMonthlyRecords(file.entries);
      const entries = parseMonthlyRecords(text, { user: this.user, month: file.month, path: file.path });
      return { file, text, entries };
    });
    try {
      const touchedPaths = new Set(touched.map(file => file.path));
      const changes = staged.map(({ file, text }) => ({ path: file.path, sha: file.sha, text }));
      const guards = [...files.values()].filter(file => !touchedPaths.has(file.path)).map(file => ({ path: file.path, sha: file.sha }));
      guards.push({ path: activeRecordPath(this.user), sha: activeTimer?._sha ?? null });
      const { blobShas } = await this.updateCompletedRecords(changes, `time: bulk add ${added.length} entries ${this.user}`, {
        add: added, guards, expectedHeadSha: snapshot.headSha || null,
      });
      const saved = staged.flatMap(({ file, entries }) => entries.map(entry => ({ ...entry, _sha: blobShas[file.path] })));
      const state = await this.store.getState(); await this.store.patchState({ recentCache: replaceCachedFiles(state.recentCache, saved, touched.map(file => file.path)) });
      return { added: added.length };
    } catch (error) {
      if (isConflict(error)) throw new TrackerConflictError('A monthly time file changed during bulk import. No entries were added; reload and try again.');
      throw error;
    }
  }

  async deleteEntry({ path, originalSha, index, original }, { updateCache = true } = {}) {
    const file = await this.readMonthly(path);
    if (file.sha !== originalSha) throw new TrackerConflictError('This monthly time file changed after the panel loaded. Reload before deleting.');
    const located = locateEntry(file.entries, index, original);
    if (located < 0) throw new TrackerConflictError('This time entry changed after the panel loaded. Reload before deleting.');
    const entries = file.entries.filter((_, position) => position !== located);
    try {
      const { blobShas } = await this.updateCompletedRecords([
        { path: file.path, sha: file.sha, text: serializeMonthlyRecords(entries) || null },
      ], `time: delete ${this.user} ${file.month}`, { remove: [file.entries[located]] });
      const saved = parseMonthlyRecords(serializeMonthlyRecords(entries), { user: this.user, month: file.month, path, sha: blobShas[path] ?? null });
      if (updateCache) {
        const state = await this.store.getState();
        await this.store.patchState({ recentCache: replaceCachedDeletedFile(state.recentCache, saved, path) });
      }
      return { deleted: true, entries: saved };
    } catch (error) { if (isConflict(error)) throw new TrackerConflictError('This monthly time file changed while deleting. Reload.'); throw error; }
  }

  async moveBoundary({ upper, lower }) {
    if (!upper || !lower) throw new Error('Two adjacent entries are required');
    const requests = [
      { ...upper, edits: { endedAt: upper.endedAt } },
      { ...lower, edits: { startedAt: lower.startedAt } },
    ];
    const files = new Map();
    for (const request of requests) {
      if (!files.has(request.path)) files.set(request.path, await this.readMonthly(request.path));
      const file = files.get(request.path);
      if (file.sha !== request.originalSha) throw new TrackerConflictError('A monthly time file changed after the panel loaded. Reload before moving the boundary.');
      request.position = locateEntry(file.entries, request.index, request.original);
      if (request.position < 0) throw new TrackerConflictError('An adjacent entry changed inside its monthly file. Reload before moving the boundary.');
    }
    if (requests[0].path === requests[1].path && requests[0].position === requests[1].position) throw new Error('Adjacent entries must be distinct');
    const originals = requests.map(request => files.get(request.path).entries[request.position]);
    const updated = requests.map((request, i) => applyEntryEdits(originals[i], request.edits, editClock(this.clock, originals[i])));
    updated[1].entryDate = startDate(updated[1]);
    const upperDelta = new Date(updated[0].endedAt).getTime() - new Date(originals[0].endedAt).getTime();
    const lowerDelta = new Date(updated[1].startedAt).getTime() - new Date(originals[1].startedAt).getTime();
    if (upperDelta !== lowerDelta) throw new Error('Both sides of an adjacent boundary must move by the same amount');
    const targetPaths = [requests[0].path, monthlyRecordsPath(this.user, updated[1].entryDate)];
    for (const targetPath of targetPaths) if (!files.has(targetPath)) files.set(targetPath, await this.readMonthly(targetPath));
    for (let i = 0; i < requests.length; i += 1) {
      const request = requests[i], targetPath = targetPaths[i], source = files.get(request.path);
      if (targetPath === request.path) source.entries[request.position] = updated[i];
      else { source.entries.splice(request.position, 1); files.get(targetPath).entries.push(updated[i]); }
    }
    const touched = [...new Set([...requests.map(request => request.path), ...targetPaths])].map(path => files.get(path));
    const resultLocations = updated.map((entry, index) => ({ path: targetPaths[index], index: files.get(targetPaths[index]).entries.indexOf(entry) }));
    try {
      const changes = touched.map(file => ({ path: file.path, sha: file.sha, text: serializeMonthlyRecords(file.entries) || null }));
      const { blobShas } = await this.updateCompletedRecords(changes, `time: move boundary ${this.user}`, {
        remove: originals, add: updated,
      });
      const savedByPath = new Map(touched.map(file => [file.path, parseMonthlyRecords(serializeMonthlyRecords(file.entries), { user: this.user, month: file.month, path: file.path, sha: blobShas[file.path] ?? null })]));
      const replacements = [...savedByPath.values()].flat();
      const state = await this.store.getState(); await this.store.patchState({ recentCache: replaceCachedFiles(state.recentCache, replacements, touched.map(file => file.path)) });
      return resultLocations.map(location => savedByPath.get(location.path)[location.index]);
    } catch (error) {
      if (isConflict(error)) throw new TrackerConflictError('A monthly time file changed while the boundary was being saved. Reload.');
      throw error;
    }
  }

}
