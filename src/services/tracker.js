import { activePath, assertUserEntryPath, entryDateParts, entryDateValue, entryPath, localDateParts, normalizeIssue, utcDateParts, validateEntryId, validatePathSegment } from '../domain/values.js';
import { applyEntryEdits, buildActiveTimer, buildEntry, validateActiveTimer, validateEntry } from '../domain/records.js';
import { createDeterministicUlid, createUlid } from '../domain/ulid.js';

export class TrackerConflictError extends Error {
  constructor(message) { super(message); this.name = 'TrackerConflictError'; this.code = 'conflict'; }
}

const MAX_RECENT_CANDIDATES = 200;

function isNotFound(error) { return error?.status === 404 || error?.code === 'not_found'; }
function isConflict(error) { return error?.status === 409 || error?.code === 'conflict'; }
function isRetryableReadFailure(error) { return error instanceof TypeError || Number(error?.status) >= 500; }
function persistedActive(active) {
  if (!active || typeof active !== 'object') return active;
  return Object.fromEntries(Object.entries(active).filter(([key]) => !key.startsWith('_')));
}
function sameActive(a, b) { return canonicalJson(persistedActive(a)) === canonicalJson(persistedActive(b)); }
function assertEntryIdentity(path, entry, user) {
  assertUserEntryPath(path, user);
  const segments = path.split('/');
  const pathId = segments.at(-1).slice(0, -'.json'.length);
  const pathDate = segments.slice(2, 5).join('-');
  const recordDate = entry?.entryDate ?? entryDateValue(utcDateParts(new Date(entry?.startedAt)));
  if (entry?.user !== user || entry?.id !== pathId || pathDate !== recordDate) throw new Error('Entry identity does not match its storage path');
  return entry;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sameEntry(a, b) { return canonicalJson(a) === canonicalJson(b); }
function sameCompletionSource(entry, active) {
  return Boolean(active) && entry.user === active.user && entry.startedAt === active.startedAt && canonicalJson(entry.issue) === canonicalJson(active.issue);
}
function reconcileStoredEntry(existing, operation, user) {
  let entry;
  try {
    entry = validateEntry(existing.data);
    assertEntryIdentity(operation.entryPath, entry, user);
  } catch (error) {
    throw new TrackerConflictError(`The pending entry path contains invalid data: ${error.message}`);
  }
  if (!sameEntry(entry, operation.entry) && !sameCompletionSource(entry, operation.activeSnapshot)) {
    throw new TrackerConflictError('The pending entry path is occupied by unrelated data.');
  }
  return { sha: existing.sha, entry };
}
function legacyEntryEntropy(active) {
  return [active.user, active.issue.owner, active.issue.repo, active.issue.number, active.startedAt, active.createdAt].join('|');
}

function issueLabel(issue) { return `${issue.owner}/${issue.repo}#${issue.number}`; }
function durationLabel(seconds) {
  const minutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}h${rest ? `${rest}m` : ''}` : `${rest}m`;
}

export class TrackerService {
  constructor({ github, store, user, clock = () => new Date(), idFactory = () => createUlid(), recentDays = 7, allowedIssueOwners = null }) {
    this.github = github;
    this.store = store;
    this.user = validatePathSegment(user, 'user');
    this.clock = clock;
    this.idFactory = idFactory;
    this.stopTail = Promise.resolve();
    this.recentDays = Math.min(31, Math.max(1, Number(recentDays) || 7));
    this.allowedIssueOwners = allowedIssueOwners?.length ? new Set(allowedIssueOwners.map(owner => owner.toLowerCase())) : null;
  }

  validateIssue(issue) {
    const normalized = normalizeIssue(issue);
    if (this.allowedIssueOwners && !this.allowedIssueOwners.has(normalized.owner.toLowerCase())) {
      throw new Error(`${normalized.owner} is not allowed by the configured issue-owner policy`);
    }
    return normalized;
  }

  async refreshActive() {
    try {
      const file = await this.github.getFile(activePath(this.user));
      validateActiveTimer(file.data);
      if (file.data.user !== this.user) throw new Error('Active timer user does not match authenticated user');
      const active = { ...file.data, _sha: file.sha };
      await this.store.patchState({ activeCache: active });
      return active;
    } catch (error) {
      if (!isNotFound(error)) throw error;
      await this.store.patchState({ activeCache: null });
      return null;
    }
  }

  async getState({ refresh = false } = {}) {
    const state = await this.store.getState();
    let active = state.activeCache;
    if (refresh) {
      try { active = await this.refreshActive(); }
      catch (error) {
        if (!active || !isRetryableReadFailure(error)) throw error;
      }
    }
    return { active, recent: state.recentCache ?? [], pendingWrites: state.pendingWrites ?? [] };
  }

  async start(issue, issueTitle = '', description = '') {
    const state = await this.store.getState();
    if ((state.pendingWrites ?? []).length) throw new Error('A stopped entry is still waiting to sync. Sync it before starting another timer.');
    const existing = await this.refreshActive();
    if (existing) throw new Error(`A timer is already running on ${issueLabel(existing.issue)}`);
    const now = this.clock();
    const active = buildActiveTimer({ user: this.user, issue: this.validateIssue(issue), startedAt: now, entryId: this.idFactory(now.getTime()), description, issueTitle });
    try {
      const result = await this.github.putJson(activePath(this.user), active, `timer: start ${this.user} on ${issueLabel(active.issue)}`);
      const cached = { ...active, _sha: result.sha };
      await this.store.patchState({ activeCache: cached });
      return cached;
    } catch (error) {
      if (isConflict(error)) throw new TrackerConflictError('Your timer changed on another device. Reload the GitHub timer before starting.');
      throw error;
    }
  }

  stop(description = '') {
    const result = this.stopTail.then(() => this.stopInternal(description));
    this.stopTail = result.catch(() => {});
    return result;
  }

  async stopInternal(description = '') {
    const state = await this.store.getState();
    let active = state.activeCache;
    if (!active) active = await this.refreshActive();
    if (!active) throw new Error('No timer is running');
    const existingOperation = (state.pendingWrites ?? []).find(operation => operation.operation === 'completeTimer' && sameActive(operation.activeSnapshot, active));
    if (existingOperation) {
      await this.store.patchState({ activeCache: null });
      return { entry: existingOperation.entry, pending: true };
    }
    const endedAt = this.clock();
    const id = active.entryId || await createDeterministicUlid(new Date(active.startedAt).getTime(), legacyEntryEntropy(active));
    const entry = buildEntry({ active, id, endedAt, now: endedAt, description });
    const { _sha: _activeSha, ...activeSnapshot } = active;
    const operation = {
      operation: 'completeTimer',
      id,
      status: 'pending',
      retryCount: 0,
      stage: 'createEntry',
      entryPath: entryPath(this.user, entryDateParts(entry.entryDate), id),
      entry,
      activeSnapshot,
      queuedAt: endedAt.toISOString(),
      lastError: '',
    };
    const queue = [...(state.pendingWrites ?? []), operation];
    const pendingEntry = { ...entry, _path: operation.entryPath, _sha: null, _pending: true };
    const recentCache = [pendingEntry, ...(state.recentCache ?? []).filter(item => item.id !== entry.id)].slice(0, 50);
    await this.store.patchState({ pendingWrites: queue, activeCache: null, recentCache });
    await this.syncPending();
    const next = await this.store.getState();
    const pending = (next.pendingWrites ?? []).some(item => item.id === id);
    const persistedEntry = (next.recentCache ?? []).find(item => item.id === id) || entry;
    return { entry: persistedEntry, pending };
  }

  async ensureEntry(operation) {
    try {
      const existing = await this.github.getFile(operation.entryPath);
      return reconcileStoredEntry(existing, operation, this.user);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    try {
      const result = await this.github.putJson(operation.entryPath, operation.entry,
        `time: add ${this.user} ${durationLabel(operation.entry.durationSeconds)} on ${issueLabel(operation.entry.issue)}`);
      return { sha: result.sha, entry: operation.entry };
    } catch (error) {
      if (!isConflict(error) && error?.code !== 'validation') throw error;
      let existing;
      try { existing = await this.github.getFile(operation.entryPath); }
      catch (readError) { if (isNotFound(readError)) throw error; throw readError; }
      return reconcileStoredEntry(existing, operation, this.user);
    }
  }

  async clearMatchingActive(operation) {
    let remote;
    try { remote = await this.github.getFile(activePath(this.user)); }
    catch (error) { if (isNotFound(error)) return; throw error; }
    if (!sameActive(remote.data, operation.activeSnapshot)) {
      throw new TrackerConflictError('The active timer changed on another device. The completed entry was saved, but the newer timer was not cleared.');
    }
    try { await this.github.deleteFile(activePath(this.user), `timer: clear ${this.user}`, remote.sha); }
    catch (error) { if (isConflict(error)) throw new TrackerConflictError('The active timer changed while it was being cleared.'); throw error; }
  }

  async syncPending() {
    const state = await this.store.getState();
    const queue = [...(state.pendingWrites ?? [])];
    for (const operation of [...queue]) {
      if (operation.status === 'conflict') continue;
      try {
        if (operation.stage === 'createEntry') {
          const persisted = await this.ensureEntry(operation);
          operation.entrySha = persisted.sha;
          operation.entry = persisted.entry;
          operation.stage = 'clearActive';
          operation.lastError = '';
          await this.store.patchState({ pendingWrites: queue });
        }
        await this.clearMatchingActive(operation);
        if (!operation.entrySha) operation.entrySha = (await this.github.getFile(operation.entryPath)).sha;
        const latestState = await this.store.getState();
        const completedEntry = { ...operation.entry, _path: operation.entryPath, _sha: operation.entrySha };
        const recentCache = [completedEntry, ...(latestState.recentCache ?? []).filter(item => item.id !== operation.id)].slice(0, 50);
        const index = queue.findIndex(item => item.id === operation.id);
        if (index >= 0) queue.splice(index, 1);
        await this.store.patchState({ pendingWrites: queue, activeCache: null, recentCache });
      } catch (error) {
        operation.retryCount = (operation.retryCount ?? 0) + 1;
        operation.lastError = error.message || 'GitHub is temporarily unreachable';
        operation.status = error instanceof TrackerConflictError ? 'conflict' : 'pending';
        await this.store.patchState({ pendingWrites: queue });
      }
    }
    return queue;
  }

  async resolvePendingConflict(id) {
    validateEntryId(id);
    const state = await this.store.getState();
    const operation = (state.pendingWrites ?? []).find(item => item.id === id);
    if (!operation || operation.status !== 'conflict') {
      throw new Error('Only a pending conflict can be resolved');
    }
    if (operation.stage === 'createEntry') {
      operation.status = 'pending';
      operation.lastError = '';
      await this.store.patchState({ pendingWrites: state.pendingWrites });
      const remaining = await this.syncPending();
      return { resolved: !remaining.some(item => item.id === id) };
    }
    if (operation.stage !== 'clearActive') throw new Error('Unsupported pending conflict stage');
    const saved = await this.github.getFile(operation.entryPath);
    validateEntry(saved.data);
    if (!sameEntry(saved.data, operation.entry)) throw new TrackerConflictError('The saved entry differs from the pending completion. Review it before resolving.');
    const activeCache = await this.refreshActive();
    const pendingWrites = state.pendingWrites.filter(item => item.id !== id);
    const completedEntry = { ...saved.data, _path: operation.entryPath, _sha: saved.sha };
    const recentCache = [completedEntry, ...(state.recentCache ?? []).filter(item => item.id !== id)].slice(0, 50);
    await this.store.patchState({ pendingWrites, activeCache, recentCache });
    return { resolved: true };
  }

  async loadRecent(limit = 50) {
    const files = [];
    const now = this.clock();
    for (let offset = 0; offset < this.recentDays; offset += 1) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset, 12, 0, 0);
      const { year, month, day: date } = localDateParts(day);
      const directory = `entries/${this.user}/${year}/${month}/${date}`;
      try {
        const listed = await this.github.listDirectory(directory);
        files.push(...listed.filter(item => item.type === 'file' && /^[0-9A-HJKMNP-TV-Z]{26}\.json$/.test(item.name)));
        if (files.length > MAX_RECENT_CANDIDATES) {
          throw new Error(`Recent-entry candidate safety limit (${MAX_RECENT_CANDIDATES}) exceeded; reduce the recent window or repair the data directories.`);
        }
      } catch (error) { if (!isNotFound(error)) throw error; }
    }
    const entries = [];
    const newestFiles = files.sort((a, b) => b.name.localeCompare(a.name));
    for (const file of newestFiles) {
      let loaded;
      try { loaded = await this.github.getFile(file.path); }
      catch (error) { if (!isNotFound(error)) throw error; else continue; }
      try {
        const entry = validateEntry(loaded.data);
        assertEntryIdentity(file.path, entry, this.user);
        entries.push({ ...entry, _path: file.path, _sha: loaded.sha });
      } catch { /* Ignore malformed GitHub records without breaking the recent list. */ }
    }
    entries.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    await this.store.patchState({ recentCache: entries.slice(0, limit) });
    return entries.slice(0, limit);
  }

  async editEntry({ path, originalSha, edits }) {
    assertUserEntryPath(path, this.user);
    const latest = await this.github.getFile(path);
    if (latest.sha !== originalSha) throw new TrackerConflictError('This time entry changed after you opened it. Reload the latest version before saving.');
    const latestEntry = validateEntry(latest.data);
    assertEntryIdentity(path, latestEntry, this.user);
    const normalizedEdits = { ...edits, ...(edits.issue ? { issue: this.validateIssue(edits.issue) } : {}) };
    const entry = applyEntryEdits(latestEntry, normalizedEdits, this.clock());
    try {
      const result = await this.github.putJson(path, entry, `time: edit ${entry.id}`, latest.sha);
      await this.loadRecent();
      return { ...entry, _path: path, _sha: result.sha };
    } catch (error) {
      if (isConflict(error)) throw new TrackerConflictError('This time entry changed while you were saving it. Reload the latest version.');
      throw error;
    }
  }

  async deleteEntry({ path, originalSha }) {
    assertUserEntryPath(path, this.user);
    const latest = await this.github.getFile(path);
    if (latest.sha !== originalSha) throw new TrackerConflictError('This time entry changed after you opened it. Reload it before deleting.');
    const latestEntry = validateEntry(latest.data);
    assertEntryIdentity(path, latestEntry, this.user);
    try { await this.github.deleteFile(path, `time: delete ${latestEntry.id}`, latest.sha); }
    catch (error) { if (isConflict(error)) throw new TrackerConflictError('This time entry changed while you were deleting it.'); throw error; }
    const state = await this.store.getState();
    await this.store.patchState({ recentCache: (state.recentCache ?? []).filter(entry => entry._path !== path) });
  }
}
