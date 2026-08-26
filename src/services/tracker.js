import { activeTextPath, assertUserMonthlyTextPath, localTimestamp, monthlyTextPath, normalizePlainTitle, parseActiveText, parseMonthlyText, serializeActiveText, serializeMonthlyText } from '../domain/monthly-text.js';
import { applyEntryEdits, buildActiveTimer, buildEntry, validateActiveTimer, validateEntry } from '../domain/records.js';
import { parseBulkTimeText } from '../domain/bulk-time.js';
import { createUlid } from '../domain/ulid.js';
import { entryDateValue, localDateParts, normalizeTaskUrl, parseGitHubTaskUrl, taskUrlOf, validateEntryId, validatePathSegment } from '../domain/values.js';

export class TrackerConflictError extends Error {
  constructor(message, reason = '') { super(message); this.name = 'TrackerConflictError'; this.code = 'conflict'; this.reason = reason; }
}

function isNotFound(error) { return error?.status === 404 || error?.code === 'not_found'; }
function isConflict(error) { return error?.status === 409 || error?.code === 'conflict'; }
function isRetryableReadFailure(error) { return error instanceof TypeError || Number(error?.status) >= 500; }
function taskTitleOf(value) { return normalizePlainTitle(value?.taskTitle ?? value?.issueTitle); }
function taskLabel(value) { const url = taskUrlOf(value), github = parseGitHubTaskUrl(url); return github ? `${github.owner}/${github.repo}#${github.number}` : url; }
function sameTimer(a, b) { return Boolean(a && b) && taskUrlOf(a) === taskUrlOf(b) && a.startedAt === b.startedAt; }
function sameDurableTitle(a, b) { return taskTitleOf(a) === taskTitleOf(b); }
function sameDurableTimer(a, b) { return sameTimer(a, b) && sameDurableTitle(a, b); }
function sameCompletion(entry, operation) {
  const expected = operation.entry;
  return sameDurableTimer(entry, expected) && entry.endedAt === expected.endedAt && entry.description === expected.description;
}
function matchesOriginal(entry, original) {
  return Boolean(entry && original) && taskUrlOf(entry) === String(original.taskUrl || original.issueUrl) && taskTitleOf(entry) === normalizePlainTitle(original.taskTitle ?? original.issueTitle)
    && entry.startedAt === original.startedAt && entry.endedAt === original.endedAt && entry.description === String(original.description || '');
}
function locateEntry(entries, index, original) {
  if (Number.isInteger(index) && entries[index] && (!original || matchesOriginal(entries[index], original))) return index;
  if (original) {
    const matches = entries.map((entry, position) => matchesOriginal(entry, original) ? position : -1).filter(position => position >= 0);
    if (matches.length === 1) return matches[0];
  }
  return -1;
}
function startDate(entry) { return entry.startedAt.slice(0, 10); }
function newestFirst(a, b) { return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(); }
function stripInternal(value) { return Object.fromEntries(Object.entries(value || {}).filter(([key]) => !key.startsWith('_'))); }
function monthFromPath(path, user) { return assertUserMonthlyTextPath(path, user).month; }
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

export class TrackerService {
  constructor({ github, store, user, clock = () => new Date(), idFactory = () => createUlid(), recentDays = 7 }) {
    this.github = github;
    this.store = store;
    this.user = validatePathSegment(user, 'user');
    this.clock = clock;
    this.idFactory = idFactory;
    this.stopTail = Promise.resolve();
    this.recentDays = Math.min(31, Math.max(1, Number(recentDays) || 7));
  }

  validateTaskUrl(value) { return normalizeTaskUrl(value); }

  async mutateState(mutate) {
    if (typeof this.store.mutateState === 'function') return this.store.mutateState(mutate);
    const state = await this.store.getState(), patch = mutate(state);
    if (patch) await this.store.patchState(patch);
    return { ...state, ...(patch || {}) };
  }

  async persistQueueOperation(operation, { remove = false, patch = {} } = {}) {
    return this.mutateState(state => {
      const pendingWrites = [...(state.pendingWrites ?? [])], index = pendingWrites.findIndex(item => item.id === operation.id);
      if (index < 0) return null;
      const hasLaterOperation = index < pendingWrites.length - 1;
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
    const path = activeTextPath(this.user);
    try {
      const file = await this.github.getText(path, { signal });
      signal?.throwIfAborted();
      const active = parseActiveText(file.text, { user: this.user, path, sha: file.sha });
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

  async getState({ refresh = false, signal } = {}) {
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
    return { active: state.activeCache, recent: state.recentCache ?? [], pendingWrites: state.pendingWrites ?? [] };
  }

  async start(taskUrl, taskTitle = '', description = '', { background = false } = {}) {
    if (background) return this.queueStart(taskUrl, taskTitle, description);
    const state = await this.store.getState();
    if ((state.pendingWrites ?? []).length) throw new Error('A stopped entry is still waiting to sync. Sync it before starting another timer.');
    const existing = await this.refreshActive();
    if (existing) throw new Error(`A timer is already tracking ${taskLabel(existing)}`);
    const now = this.clock();
    const active = buildActiveTimer({ user: this.user, taskUrl: this.validateTaskUrl(taskUrl), startedAt: now, description, taskTitle });
    const path = activeTextPath(this.user);
    try {
      const result = await this.github.putText(path, serializeActiveText(active), `timer: start ${this.user} on ${taskLabel(active)}`);
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
    const startedAt = this.clock(), id = this.idFactory(startedAt.getTime());
    const active = buildActiveTimer({ user: this.user, taskUrl: this.validateTaskUrl(taskUrl), startedAt, description, taskTitle });
    const operation = {
      operation: 'startTimer', id, status: 'pending', retryCount: 0, stage: 'startNext',
      nextActive: stripInternal(active), queuedAt: startedAt.toISOString(), lastError: '',
    };
    const pendingActive = { ...active, _path: activeTextPath(this.user), _sha: null, _pending: true };
    await this.mutateState(current => {
      if (current.activeCache) throw new Error(`A timer is already tracking ${taskLabel(current.activeCache)}`);
      return { pendingWrites: [...(current.pendingWrites ?? []), operation], activeCache: pendingActive };
    });
    return pendingActive;
  }

  async switchTask(taskUrl, taskTitle = '', description = '', { background = false } = {}) {
    const targetUrl = this.validateTaskUrl(taskUrl);
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
    const changedAt = this.clock(), id = this.idFactory(changedAt.getTime());
    const entry = buildEntry({ active: current, id, endedAt: changedAt, now: changedAt, description });
    const nextActive = buildActiveTimer({ user: this.user, taskUrl: targetUrl, taskTitle, startedAt: changedAt, description: '' });
    const operation = {
      operation: 'completeTimerAndStart', id, status: 'pending', retryCount: 0, stage: 'verifyActive',
      monthlyPath: monthlyTextPath(this.user, current.entryDate), entry, activeSnapshot: stripInternal(current), activeSha: current._sha,
      nextActive: stripInternal(nextActive), queuedAt: changedAt.toISOString(), lastError: '',
    };
    const pendingEntry = { ...entry, _path: operation.monthlyPath, _sha: null, _index: -1, _pending: true };
    const pendingActive = { ...nextActive, _path: activeTextPath(this.user), _sha: null, _pending: true };
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
    validateActiveTimer(active);
    const endedAt = this.clock(), id = this.idFactory(endedAt.getTime());
    const entry = buildEntry({ active, id, endedAt, now: endedAt, description });
    const operation = {
      operation: 'completeTimer', id, status: 'pending', retryCount: 0, stage: 'verifyActive',
      monthlyPath: monthlyTextPath(this.user, active.entryDate), entry, activeSnapshot: stripInternal(active), activeSha: active._sha,
      queuedAt: endedAt.toISOString(), lastError: '',
    };
    const pendingEntry = { ...entry, _path: operation.monthlyPath, _sha: null, _index: -1, _pending: true };
    await this.mutateState(latest => {
      if (!sameTimer(latest.activeCache, active)) throw new Error('The local timer changed before Stop was accepted. Retry the action.');
      return {
        pendingWrites: [...(latest.pendingWrites ?? []), operation], activeCache: null,
        recentCache: [pendingEntry, ...(latest.recentCache ?? []).filter(item => !sameCompletion(item, operation))].slice(0, 50),
      };
    });
    return { entry, pending: true };
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
    const existing = (state.pendingWrites ?? []).find(operation => operation.operation === 'completeTimer' && sameDurableTimer(operation.activeSnapshot, candidate));
    if (existing) { await this.store.patchState({ activeCache: null }); return { entry: existing.entry, pending: true }; }
    if (!active && cached) {
      validateActiveTimer(cached);
      const file = await this.readMonthly(monthlyTextPath(this.user, cached.entryDate));
      const matches = file.entries.filter(entry => sameDurableTimer(entry, cached));
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
    const id = this.idFactory(endedAt.getTime());
    const entry = buildEntry({ active, id, endedAt, now: endedAt, description });
    const operation = {
      operation: 'completeTimer', id, status: 'pending', retryCount: 0, stage: activeVerified ? 'appendMonthly' : 'verifyActive',
      monthlyPath: monthlyTextPath(this.user, active.entryDate), entry, activeSnapshot: stripInternal(active), activeSha: active._sha,
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
    const sameStart = (next.recentCache ?? []).filter(item => sameDurableTimer(item, operation.activeSnapshot));
    const persisted = exact || (sameStart.length === 1 ? sameStart[0] : entry);
    return { entry: persisted, pending };
  }

  async readMonthly(path) {
    const month = monthFromPath(path, this.user);
    try {
      const file = await this.github.getText(path);
      return { path, month, sha: file.sha, entries: parseMonthlyText(file.text, { user: this.user, month, path, sha: file.sha }) };
    } catch (error) {
      await this.confirmFileMissing(error);
      return { path, month, sha: null, entries: [] };
    }
  }

  async putMonthly(file, entries, message) {
    const text = serializeMonthlyText(entries);
    if (!text) {
      if (!file.sha) return { sha: null };
      await this.github.deleteFile(file.path, message, file.sha);
      return { sha: null };
    }
    return this.github.putText(file.path, text, message, file.sha || undefined);
  }

  async activeStateFor(operation) {
    const path = activeTextPath(this.user);
    try {
      const file = await this.github.getText(path), active = parseActiveText(file.text, { user: this.user, path, sha: file.sha });
      if (sameTimer(active, operation.activeSnapshot)) {
        operation.activeSha = file.sha;
        const remoteTitle = taskTitleOf(active);
        if (remoteTitle !== taskTitleOf(operation.activeSnapshot)) {
          operation.activeSnapshot = { ...operation.activeSnapshot, taskTitle: remoteTitle, issueTitle: remoteTitle };
          operation.entry = { ...operation.entry, taskTitle: remoteTitle, issueTitle: remoteTitle };
        }
        return 'matching';
      }
      await this.patchActiveForOperation(operation, active);
      return 'changed';
    } catch (error) {
      await this.confirmFileMissing(error);
      await this.patchActiveForOperation(operation, null); return 'missing';
    }
  }

  async completionAlreadySaved(file, operation) {
    const exact = file.entries.find(entry => sameCompletion(entry, operation));
    if (exact) return exact;
    const sameStart = file.entries.filter(entry => sameDurableTimer(entry, operation.entry));
    if (!sameStart.length) return null;
    const activeState = await this.activeStateFor(operation);
    if (activeState === 'missing' && sameStart.length === 1) return sameStart[0];
    if (activeState === 'changed') throw new TrackerConflictError('The active timer changed on another device while this completion was syncing.');
    return null;
  }

  async ensureEntry(operation) {
    let file = await this.readMonthly(operation.monthlyPath);
    let found = await this.completionAlreadySaved(file, operation);
    if (found) return found;
    const proposed = [...file.entries, operation.entry];
    try {
      const activePath = activeTextPath(this.user);
      const result = await this.github.updateTextsAtomic([
        { path: file.path, sha: file.sha, text: serializeMonthlyText(proposed) },
        { path: activePath, sha: operation.activeSha, text: null },
      ], `time: stop ${this.user} on ${taskLabel(operation.entry)}`);
      operation.activeSha = null; operation.activeCleared = true;
      return parseMonthlyText(serializeMonthlyText(proposed), {
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
    const path = activeTextPath(this.user);
    let sha = operation.activeSha;
    if (!sha) {
      try {
        const file = await this.github.getText(path), remote = parseActiveText(file.text, { user: this.user, path, sha: file.sha });
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
        const remote = parseActiveText(file.text, { user: this.user, path, sha: file.sha });
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
    const path = activeTextPath(this.user), target = operation.nextActive;
    if (!target) return null;
    try {
      const result = await this.github.putText(path, serializeActiveText(target), `timer: start ${this.user} on ${taskLabel(target)}`);
      return { ...target, _path: path, _sha: result.sha };
    } catch (error) {
      if (!isConflict(error)) throw error;
      let file;
      try { file = await this.github.getText(path); }
      catch (readError) { throw error; }
      const remote = parseActiveText(file.text, { user: this.user, path, sha: file.sha });
      if (!sameDurableTimer(remote, target)) {
        const conflict = new TrackerConflictError('Another timer started before the queued task switch completed. The queued target was preserved for recovery.');
        conflict.remoteActive = remote;
        throw conflict;
      }
      return remote;
    }
  }

  async syncPending() {
    const state = await this.store.getState(), queue = [...(state.pendingWrites ?? [])];
    for (const operation of [...queue]) {
      if (operation.status === 'conflict') break;
      try {
        if (!['verifyActive', 'appendMonthly', 'clearActive', 'startNext'].includes(operation.stage)) {
          throw new TrackerConflictError('This queued completion uses an unsupported storage stage. It was preserved for manual recovery.');
        }
        if (operation.stage === 'verifyActive') {
          const activeState = await this.activeStateFor(operation);
          if (activeState === 'missing' || activeState === 'changed') {
            const file = await this.readMonthly(operation.monthlyPath);
            const matches = file.entries.filter(entry => sameDurableTimer(entry, operation.entry));
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
          await this.persistQueueOperation(operation, { patch: operation.nextActive ? { activeCache: { ...operation.nextActive, _path: activeTextPath(this.user), _sha: null, _pending: true } } : {} });
        }
        if (operation.stage === 'appendMonthly') {
          operation.entry = await this.ensureEntry(operation);
          operation.stage = 'clearActive'; operation.lastError = '';
          await this.persistQueueOperation(operation, { patch: operation.nextActive ? { activeCache: { ...operation.nextActive, _path: activeTextPath(this.user), _sha: null, _pending: true } } : {} });
        }
        let nextActive = null;
        if (operation.stage !== 'startNext') {
          if (!operation.activeCleared) await this.clearMatchingActive(operation);
          if (operation.nextActive) { operation.stage = 'startNext'; await this.persistQueueOperation(operation, { patch: { activeCache: { ...operation.nextActive, _path: activeTextPath(this.user), _sha: null, _pending: true } } }); }
        }
        if (operation.stage === 'startNext') nextActive = await this.startQueuedActive(operation);
        const index = queue.findIndex(item => item.id === operation.id);
        if (index >= 0) queue.splice(index, 1);
        await this.persistQueueOperation(operation, { remove: true, patch: latest => ({
          activeCache: nextActive,
          recentCache: operation.entry
            ? [operation.entry, ...(latest.recentCache ?? []).filter(item =>
              !sameCompletion(item, operation) && !(item._pending && sameTimer(item, operation.activeSnapshot)))]
              .sort(newestFirst).slice(0, 50)
            : latest.recentCache ?? [],
        }) });
      } catch (error) {
        operation.retryCount = (operation.retryCount ?? 0) + 1;
        operation.lastError = error.message || 'GitHub is temporarily unreachable';
        operation.status = error instanceof TrackerConflictError ? 'conflict' : 'pending';
        operation.conflictReason = error instanceof TrackerConflictError ? (error.reason || '') : '';
        const remoteConflict = error instanceof TrackerConflictError && operation.stage === 'startNext' ? error.remoteActive : null;
        const keepPendingTarget = operation.nextActive && (!remoteConflict && (!(error instanceof TrackerConflictError) || operation.stage === 'startNext'));
        await this.persistQueueOperation(operation, { patch:
          remoteConflict ? { activeCache: remoteConflict }
            : keepPendingTarget ? { activeCache: { ...operation.nextActive, _path: activeTextPath(this.user), _sha: null, _pending: true } } : {}
        });
        if (isNotFound(error)) throw error;
        break;
      }
    }
    return (await this.store.getState()).pendingWrites ?? [];
  }

  async resolvePendingConflict(id, action = '') {
    validateEntryId(id);
    const state = await this.store.getState();
    const operation = (state.pendingWrites ?? []).find(item => item.id === id);
    if (!operation || operation.status !== 'conflict') throw new Error('Only a pending conflict can be resolved');
    if (operation.stage === 'clearActive' || operation.stage === 'verifyActive') {
      const active = await this.readRemoteActive();
      const changed = Boolean(active && !sameDurableTimer(active, operation.activeSnapshot));
      if (operation.stage === 'verifyActive' && (!active || changed)) {
        const file = await this.readMonthly(operation.monthlyPath);
        const matches = file.entries.filter(entry => sameDurableTimer(entry, operation.entry));
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
          const current = pendingWrites[index], retained = (latest.recentCache ?? []).filter(item => !(item._pending && sameDurableTimer(item, current.activeSnapshot)));
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
        const changes = touched.map(file => ({ path: file.path, sha: file.sha, text: serializeMonthlyText(file.entries) }));
        ({ blobShas } = await this.github.updateTextsAtomic(changes, `time: add missing titles ${this.user}`));
      }
      const saved = new Map(touched.map(file => [file.path, {
        ...file,
        sha: blobShas[file.path],
        entries: parseMonthlyText(serializeMonthlyText(file.entries), { user: this.user, month: file.month, path: file.path, sha: blobShas[file.path] }),
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
    const path = activeTextPath(this.user);
    try {
      const file = await this.github.getText(path), remote = parseActiveText(file.text, { user: this.user, path, sha: file.sha });
      if (!sameTimer(remote, active)) throw new TrackerConflictError('The active timer changed while its missing task title was being saved. Reload.');
      if (taskTitleOf(remote)) return remote;
      const titled = { ...remote, taskTitle, issueTitle: taskTitle };
      const result = await this.github.putText(path, serializeActiveText(titled), `timer: add missing title ${this.user}`, file.sha);
      const saved = parseActiveText(serializeActiveText(titled), { user: this.user, path, sha: result.sha });
      await this.store.patchState({ activeCache: saved });
      return saved;
    } catch (error) {
      if (isConflict(error)) throw new TrackerConflictError('The active timer changed while its missing task title was being saved. Reload.');
      throw error;
    }
  }

  async loadMenuData(limit = 50, { knownTitles = new Map() } = {}) {
    const now = this.clock(), dateFor = offset => {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, 12, 0, 0);
      return entryDateValue(localDateParts(day));
    };
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
    let missingReachability = null;
    let files = await Promise.all(months.map(async month => {
      const path = monthlyTextPath(this.user, `${month}-01`);
      try {
        const file = await this.github.getText(path);
        return { path, month, sha: file.sha, entries: parseMonthlyText(file.text, { user: this.user, month, path, sha: file.sha }) };
      } catch (error) {
        if (!isNotFound(error)) throw error;
        missingReachability ||= this.confirmFileMissing(error);
        await missingReachability;
        return { path, month, sha: null, entries: [] };
      }
    }));
    files = await this.backfillIssueTitles(files, knownTitles);
    const persisted = files.flatMap(file => file.entries).filter(entry => startDate(entry) >= earliest && startDate(entry) <= today);
    const state = await this.store.getState(), pendingWrites = state.pendingWrites ?? [];
    const activeCache = await this.backfillActiveIssueTitle(state.activeCache, knownTitles);
    const pending = pendingWrites.filter(operation => ['completeTimer', 'completeTimerAndStart'].includes(operation.operation) && operation.entry
      && startDate(operation.entry) >= earliest && startDate(operation.entry) <= today && !persisted.some(entry => sameTimer(entry, operation.entry)))
      .map(operation => ({ ...operation.entry, _path: operation.monthlyPath, _sha: null, _index: -1, _pending: true }));
    const allEntries = [...persisted, ...pending], recent = allEntries.filter(entry => dateSet.has(startDate(entry))).sort(newestFirst).slice(0, limit);
    const summaries = summaryRanges.map(range => ({ ...range, seconds: allEntries
      .filter(entry => startDate(entry) >= range.startDate && startDate(entry) <= range.endDate)
      .reduce((sum, entry) => sum + Math.max(0, Number(entry.durationSeconds) || 0), 0) }));
    await this.store.patchState({ recentCache: recent });
    const active = activeCache ? {
      taskUrl: taskUrlOf(activeCache), taskTitle: taskTitleOf(activeCache), ...(activeCache.issue ? { issue: activeCache.issue } : {}), startedAt: activeCache.startedAt,
      description: activeCache.description || '', issueTitle: taskTitleOf(activeCache),
    } : null;
    return {
      recent, summaries, todaySeconds: summaries[0].seconds, reportDate: today, active,
      pendingCount: pendingWrites.length,
      pendingWrites: pendingWrites.map(({ id, status, stage, conflictReason }) => ({ id, status, stage, ...(conflictReason ? { conflictReason } : {}) })),
    };
  }

  async loadRecent(limit = 50) { return (await this.loadMenuData(limit)).recent; }

  async editEntry({ path, originalSha, index, original, edits }) {
    const source = await this.readMonthly(path);
    if (source.sha !== originalSha) throw new TrackerConflictError('This monthly time file changed after you opened it. Reload before saving.');
    const position = locateEntry(source.entries, index, original);
    if (position < 0) throw new TrackerConflictError('This time entry changed after you opened it. Reload before saving.');
    const normalized = { ...edits, ...((edits.taskUrl || edits.issue) ? { taskUrl: this.validateTaskUrl(edits.taskUrl ?? edits.issue) } : {}) };
    const updated = applyEntryEdits(source.entries[position], normalized, editClock(this.clock, source.entries[position]));
    updated.entryDate = startDate(updated);
    const destinationPath = monthlyTextPath(this.user, updated.entryDate);
    try {
      if (destinationPath === path) {
        const entries = source.entries.with(position, updated);
        const result = await this.putMonthly(source, entries, `time: edit ${this.user} ${source.month}`);
        const saved = parseMonthlyText(serializeMonthlyText(entries), { user: this.user, month: source.month, path, sha: result.sha });
        const state = await this.store.getState(); await this.store.patchState({ recentCache: replaceCachedFiles(state.recentCache, saved) });
        return saved[position];
      }
      const destination = await this.readMonthly(destinationPath);
      const sourceEntries = source.entries.filter((_, current) => current !== position), destinationEntries = [...destination.entries, updated];
      const changes = [
        { path: source.path, sha: source.sha, text: serializeMonthlyText(sourceEntries) || null },
        { path: destination.path, sha: destination.sha, text: serializeMonthlyText(destinationEntries) },
      ];
      const result = await this.github.updateTextsAtomic(changes, `time: move edited entry ${this.user}`);
      const savedSource = parseMonthlyText(serializeMonthlyText(sourceEntries), { user: this.user, month: source.month, path: source.path, sha: result.blobShas[source.path] ?? null });
      const savedDestination = parseMonthlyText(serializeMonthlyText(destinationEntries), { user: this.user, month: destination.month, path: destination.path, sha: result.blobShas[destination.path] });
      const replacements = [...savedSource, ...savedDestination];
      const state = await this.store.getState(); await this.store.patchState({ recentCache: replaceCachedFiles(state.recentCache, replacements, [source.path, destination.path]) });
      return savedDestination.at(-1);
    } catch (error) { if (isConflict(error)) throw new TrackerConflictError('A monthly time file changed while you were saving. Reload.'); throw error; }
  }


  async editEntries({ entries: requests }) {
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
    const targetPaths = updated.map(entry => monthlyTextPath(this.user, entry.entryDate));
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
      let blobShas = {};
      if (touched.length === 1) {
        const file = touched[0], result = await this.putMonthly(file, file.entries, `time: edit linked entries ${this.user} ${file.month}`);
        blobShas[file.path] = result.sha;
      } else {
        const changes = touched.map(file => ({ path: file.path, sha: file.sha, text: serializeMonthlyText(file.entries) || null }));
        ({ blobShas } = await this.github.updateTextsAtomic(changes, `time: edit linked entries ${this.user}`));
      }
      const savedByPath = new Map(touched.map(file => [file.path, parseMonthlyText(serializeMonthlyText(file.entries), {
        user: this.user, month: file.month, path: file.path, sha: blobShas[file.path] ?? null,
      })]));
      const replacements = [...savedByPath.values()].flat(), state = await this.store.getState();
      await this.store.patchState({ recentCache: replaceCachedFiles(state.recentCache, replacements, touchedPaths) });
      return resultLocations.map(location => savedByPath.get(location.path)[location.index]);
    } catch (error) {
      if (isConflict(error)) throw new TrackerConflictError('A monthly time file changed while linked time edits were being saved. Reload.');
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
      const path = monthlyTextPath(this.user, `${month}-01`);
      files.set(path, await this.readMonthly(path));
    }
    const added = [];
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
      const active = buildActiveTimer({ user: this.user, taskUrl: item.taskUrl, startedAt, description: item.description });
      const entry = buildEntry({ active, id: this.idFactory(latestEnd), endedAt, now: endedAt, description: item.description });
      entry.entryDate = item.date;
      const path = monthlyTextPath(this.user, item.date), file = files.get(path);
      file.entries.push(entry); file.entries.sort((left, right) => new Date(left.startedAt) - new Date(right.startedAt));
      added.push(entry);
    }
    const touched = [...touchedMonths].sort().map(month => files.get(monthlyTextPath(this.user, `${month}-01`)));
    const staged = touched.map(file => {
      const text = serializeMonthlyText(file.entries);
      const entries = parseMonthlyText(text, { user: this.user, month: file.month, path: file.path });
      return { file, text, entries };
    });
    try {
      const touchedPaths = new Set(touched.map(file => file.path));
      const changes = staged.map(({ file, text }) => ({ path: file.path, sha: file.sha, text }));
      const guards = [...files.values()].filter(file => !touchedPaths.has(file.path)).map(file => ({ path: file.path, sha: file.sha }));
      guards.push({ path: activeTextPath(this.user), sha: activeTimer?._sha ?? null });
      const { blobShas } = await this.github.updateTextsAtomic(changes, `time: bulk add ${added.length} entries ${this.user}`, { guards, expectedHeadSha: snapshot.headSha || null });
      const saved = staged.flatMap(({ file, entries }) => entries.map(entry => ({ ...entry, _sha: blobShas[file.path] })));
      const state = await this.store.getState(); await this.store.patchState({ recentCache: replaceCachedFiles(state.recentCache, saved, touched.map(file => file.path)) });
      return { added: added.length };
    } catch (error) {
      if (isConflict(error)) throw new TrackerConflictError('A monthly time file changed during bulk import. No entries were added; reload and try again.');
      throw error;
    }
  }

  async deleteEntry({ path, originalSha, index, original }) {
    const file = await this.readMonthly(path);
    if (file.sha !== originalSha) throw new TrackerConflictError('This monthly time file changed after the panel loaded. Reload before deleting.');
    const located = locateEntry(file.entries, index, original);
    if (located < 0) throw new TrackerConflictError('This time entry changed after the panel loaded. Reload before deleting.');
    const entries = file.entries.filter((_, position) => position !== located);
    try {
      const result = await this.putMonthly(file, entries, `time: delete ${this.user} ${file.month}`);
      const saved = parseMonthlyText(serializeMonthlyText(entries), { user: this.user, month: file.month, path, sha: result.sha });
      const state = await this.store.getState(); await this.store.patchState({ recentCache: replaceCachedFiles(state.recentCache, saved, [path]) });
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
    const targetPaths = [requests[0].path, monthlyTextPath(this.user, updated[1].entryDate)];
    for (const targetPath of targetPaths) if (!files.has(targetPath)) files.set(targetPath, await this.readMonthly(targetPath));
    for (let i = 0; i < requests.length; i += 1) {
      const request = requests[i], targetPath = targetPaths[i], source = files.get(request.path);
      if (targetPath === request.path) source.entries[request.position] = updated[i];
      else { source.entries.splice(request.position, 1); files.get(targetPath).entries.push(updated[i]); }
    }
    const touched = [...new Set([...requests.map(request => request.path), ...targetPaths])].map(path => files.get(path));
    const resultLocations = updated.map((entry, index) => ({ path: targetPaths[index], index: files.get(targetPaths[index]).entries.indexOf(entry) }));
    try {
      let blobShas = {};
      if (touched.length === 1) {
        const file = touched[0], result = await this.putMonthly(file, file.entries, `time: move boundary ${this.user}`);
        blobShas[file.path] = result.sha;
      } else {
        const changes = touched.map(file => ({ path: file.path, sha: file.sha, text: serializeMonthlyText(file.entries) || null }));
        ({ blobShas } = await this.github.updateTextsAtomic(changes, `time: move boundary ${this.user}`));
      }
      const savedByPath = new Map(touched.map(file => [file.path, parseMonthlyText(serializeMonthlyText(file.entries), { user: this.user, month: file.month, path: file.path, sha: blobShas[file.path] ?? null })]));
      const replacements = [...savedByPath.values()].flat();
      const state = await this.store.getState(); await this.store.patchState({ recentCache: replaceCachedFiles(state.recentCache, replacements, touched.map(file => file.path)) });
      return resultLocations.map(location => savedByPath.get(location.path)[location.index]);
    } catch (error) {
      if (isConflict(error)) throw new TrackerConflictError('A monthly time file changed while the boundary was being saved. Reload.');
      throw error;
    }
  }

}
