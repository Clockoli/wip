import { activeTextPath, assertUserMonthlyTextPath, monthlyTextPath, normalizePlainTitle, parseActiveText, parseMonthlyText, serializeActiveText, serializeMonthlyText } from '../domain/monthly-text.js';
import { applyEntryEdits, buildActiveTimer, buildEntry, validateActiveTimer, validateEntry } from '../domain/records.js';
import { createUlid } from '../domain/ulid.js';
import { entryDateValue, localDateParts, normalizeIssue, validateEntryId, validatePathSegment } from '../domain/values.js';

export class TrackerConflictError extends Error {
  constructor(message) { super(message); this.name = 'TrackerConflictError'; this.code = 'conflict'; }
}

function isNotFound(error) { return error?.status === 404 || error?.code === 'not_found'; }
function isConflict(error) { return error?.status === 409 || error?.code === 'conflict'; }
function isRetryableReadFailure(error) { return error instanceof TypeError || Number(error?.status) >= 500; }
function issueLabel(issue) { return `${issue.owner}/${issue.repo}#${issue.number}`; }
function sameTimer(a, b) { return Boolean(a && b) && a.issue?.url === b.issue?.url && a.startedAt === b.startedAt; }
function sameCompletion(entry, operation) {
  const expected = operation.entry;
  return Boolean(entry && expected) && entry.issue?.url === expected.issue?.url && entry.startedAt === expected.startedAt
    && entry.endedAt === expected.endedAt && entry.description === expected.description;
}
function matchesOriginal(entry, original) {
  return Boolean(entry && original) && entry.issue?.url === original.issueUrl && String(entry.issueTitle || '') === String(original.issueTitle || '')
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

  validateIssue(issue) {
    const normalized = normalizeIssue(issue);
    return normalized;
  }

  async confirmFileMissing(error) {
    if (!isNotFound(error)) throw error;
    await this.github.assertDestinationReachable();
  }

  async refreshActive({ signal } = {}) {
    const path = activeTextPath(this.user);
    try {
      const file = await this.github.getText(path, { signal });
      signal?.throwIfAborted();
      const active = parseActiveText(file.text, { user: this.user, path, sha: file.sha });
      validateActiveTimer(active);
      await this.store.patchState({ activeCache: active });
      return active;
    } catch (error) {
      await this.confirmFileMissing(error);
      await this.store.patchState({ activeCache: null });
      return null;
    }
  }

  async getState({ refresh = false, signal } = {}) {
    const state = await this.store.getState();
    signal?.throwIfAborted();
    let active = state.activeCache;
    if (refresh) {
      try { active = await this.refreshActive({ signal }); }
      catch (error) { if (!active || !isRetryableReadFailure(error)) throw error; }
    }
    signal?.throwIfAborted();
    return { active, recent: state.recentCache ?? [], pendingWrites: state.pendingWrites ?? [] };
  }

  async start(issue, issueTitle = '', description = '') {
    const state = await this.store.getState();
    if ((state.pendingWrites ?? []).length) throw new Error('A stopped entry is still waiting to sync. Sync it before starting another timer.');
    const existing = await this.refreshActive();
    if (existing) throw new Error(`A timer is already running on ${issueLabel(existing.issue)}`);
    const now = this.clock();
    const active = buildActiveTimer({ user: this.user, issue: this.validateIssue(issue), startedAt: now, description, issueTitle });
    const path = activeTextPath(this.user);
    try {
      const result = await this.github.putText(path, serializeActiveText(active), `timer: start ${this.user} on ${issueLabel(active.issue)}`);
      const cached = { ...active, _path: path, _sha: result.sha };
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
      const file = await this.readMonthly(monthlyTextPath(this.user, cached.entryDate));
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
    const sameStart = (next.recentCache ?? []).filter(item => sameTimer(item, operation.activeSnapshot));
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
      await this.store.patchState({ activeCache: active });
      if (sameTimer(active, operation.activeSnapshot)) { operation.activeSha = file.sha; return 'matching'; }
      return 'changed';
    } catch (error) {
      await this.confirmFileMissing(error);
      await this.store.patchState({ activeCache: null }); return 'missing';
    }
  }

  async completionAlreadySaved(file, operation) {
    const exact = file.entries.find(entry => sameCompletion(entry, operation));
    if (exact) return exact;
    const sameStart = file.entries.filter(entry => sameTimer(entry, operation.activeSnapshot));
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
      const result = await this.putMonthly(file, proposed, `time: add ${this.user} on ${issueLabel(operation.entry.issue)}`);
      return parseMonthlyText(serializeMonthlyText(proposed), { user: this.user, month: file.month, path: file.path, sha: result.sha }).at(-1);
    } catch (error) {
      if (!isConflict(error) && error?.code !== 'validation') throw error;
      file = await this.readMonthly(operation.monthlyPath);
      found = await this.completionAlreadySaved(file, operation);
      if (found) return found;
      if (file.entries.some(entry => sameTimer(entry, operation.activeSnapshot))) {
        throw new Error('Another Stop is still synchronizing this timer. Retry will converge automatically.');
      }
      throw new TrackerConflictError('The monthly time file changed while the timer was stopping. Retry synchronization.');
    }
  }

  async clearMatchingActive(operation) {
    const path = activeTextPath(this.user);
    let sha = operation.activeSha;
    if (!sha) {
      try {
        const file = await this.github.getText(path), remote = parseActiveText(file.text, { user: this.user, path, sha: file.sha });
        if (!sameTimer(remote, operation.activeSnapshot)) {
          await this.store.patchState({ activeCache: remote });
          throw new TrackerConflictError('The active timer changed on another device. The completed entry was saved, but the newer timer was not cleared.');
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
          await this.store.patchState({ activeCache: remote });
          throw new TrackerConflictError('The active timer changed while it was being cleared. The newer timer was preserved.');
        }
        try { await this.github.deleteFile(path, `timer: clear ${this.user}`, file.sha); return; }
        catch (retryError) { if (isConflict(retryError)) throw new TrackerConflictError('The active timer changed while it was being cleared.'); throw retryError; }
      }
      throw error;
    }
  }

  async syncPending() {
    const state = await this.store.getState(), queue = [...(state.pendingWrites ?? [])];
    for (const operation of [...queue]) {
      if (operation.status === 'conflict') continue;
      try {
        if (!['verifyActive', 'appendMonthly', 'clearActive'].includes(operation.stage)) {
          throw new TrackerConflictError('This queued completion uses an unsupported storage stage. It was preserved for manual recovery.');
        }
        if (operation.stage === 'verifyActive') {
          const activeState = await this.activeStateFor(operation);
          if (activeState === 'changed') throw new TrackerConflictError('The active timer changed on another device before this completion could be verified. No completion was saved.');
          if (activeState === 'missing') {
            const file = await this.readMonthly(operation.monthlyPath);
            const matches = file.entries.filter(entry => sameTimer(entry, operation.activeSnapshot));
            if (matches.length > 1) throw new TrackerConflictError('Multiple completed entries match the timer that disappeared during verification. Reload before continuing.');
            if (matches.length === 0) throw new TrackerConflictError('The active timer no longer exists and no matching completion was found. No completion was saved.');
            operation.entry = matches[0]; operation.stage = 'clearActive'; operation.lastError = '';
          } else {
            operation.stage = 'appendMonthly'; operation.lastError = '';
          }
          await this.store.patchState({ pendingWrites: queue });
        }
        if (operation.stage === 'appendMonthly') {
          operation.entry = await this.ensureEntry(operation);
          operation.stage = 'clearActive'; operation.lastError = '';
          await this.store.patchState({ pendingWrites: queue });
        }
        await this.clearMatchingActive(operation);
        const latest = await this.store.getState();
        const index = queue.findIndex(item => item.id === operation.id);
        if (index >= 0) queue.splice(index, 1);
        const recentCache = [operation.entry, ...(latest.recentCache ?? []).filter(item =>
          !sameCompletion(item, operation) && !(item._pending && sameTimer(item, operation.activeSnapshot)))]
          .sort(newestFirst).slice(0, 50);
        await this.store.patchState({ pendingWrites: queue, activeCache: null, recentCache });
      } catch (error) {
        operation.retryCount = (operation.retryCount ?? 0) + 1;
        operation.lastError = error.message || 'GitHub is temporarily unreachable';
        operation.status = error instanceof TrackerConflictError ? 'conflict' : 'pending';
        await this.store.patchState({ pendingWrites: queue });
        if (isNotFound(error)) throw error;
      }
    }
    return queue;
  }

  async resolvePendingConflict(id) {
    validateEntryId(id);
    const state = await this.store.getState();
    const operation = (state.pendingWrites ?? []).find(item => item.id === id);
    if (!operation || operation.status !== 'conflict') throw new Error('Only a pending conflict can be resolved');
    if (operation.stage === 'clearActive' || operation.stage === 'verifyActive') {
      const active = await this.refreshActive();
      const changed = Boolean(active && !sameTimer(active, operation.activeSnapshot));
      if (operation.stage === 'verifyActive' && !active) {
        const file = await this.readMonthly(operation.monthlyPath);
        const matches = file.entries.filter(entry => sameTimer(entry, operation.activeSnapshot));
        if (matches.length > 1) throw new TrackerConflictError('Multiple completed entries match the timer that disappeared during verification. Reload before continuing.');
        if (matches.length === 1) {
          operation.entry = matches[0]; operation.stage = 'clearActive'; operation.status = 'pending'; operation.lastError = '';
          await this.store.patchState({ pendingWrites: state.pendingWrites });
          const remaining = await this.syncPending();
          return { resolved: !remaining.some(item => item.id === id) };
        }
      }
      const canAcknowledge = !active || changed;
      if (canAcknowledge) {
        const pendingWrites = (state.pendingWrites ?? []).filter(item => item.id !== id);
        const retained = (state.recentCache ?? []).filter(item => !(item._pending && sameTimer(item, operation.activeSnapshot)));
        const recentCache = (operation.stage === 'clearActive'
          ? [operation.entry, ...retained.filter(item => !sameCompletion(item, operation))]
          : retained).sort(newestFirst).slice(0, 50);
        await this.store.patchState({ pendingWrites, recentCache });
        return { resolved: true };
      }
    }
    operation.status = 'pending'; operation.lastError = '';
    await this.store.patchState({ pendingWrites: state.pendingWrites });
    const remaining = await this.syncPending();
    return { resolved: !remaining.some(item => item.id === id) };
  }

  async backfillIssueTitles(files, knownTitles = new Map()) {
    const untitled = files.flatMap(file => file.entries).filter(entry => !entry.issueTitle)
      .sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime());
    if (!untitled.length) return files;
    const titles = new Map();
    for (const entry of untitled) {
      const known = normalizePlainTitle(knownTitles.get(entry.issue.url));
      if (known) titles.set(entry.issue.url, known);
    }
    const unresolved = [...new Map(untitled.filter(entry => !titles.has(entry.issue.url)).map(entry => [entry.issue.url, entry.issue])).values()].slice(0, 100);
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
    const touched = files.filter(file => file.entries.some(entry => !entry.issueTitle && titles.has(entry.issue.url))).map(file => ({
      ...file,
      entries: file.entries.map(entry => !entry.issueTitle && titles.has(entry.issue.url)
        ? { ...entry, issueTitle: titles.get(entry.issue.url) } : entry),
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
      if (isConflict(error)) throw new TrackerConflictError('A monthly time file changed while missing issue titles were being saved. Reload.');
      throw error;
    }
  }

  async backfillActiveIssueTitle(active, knownTitles = new Map()) {
    if (!active || active.issueTitle || !knownTitles.has(active.issue?.url)) return active;
    const issueTitle = normalizePlainTitle(knownTitles.get(active.issue.url));
    if (!issueTitle) return active;
    const path = activeTextPath(this.user);
    try {
      const file = await this.github.getText(path), remote = parseActiveText(file.text, { user: this.user, path, sha: file.sha });
      if (!sameTimer(remote, active)) throw new TrackerConflictError('The active timer changed while its missing issue title was being saved. Reload.');
      if (remote.issueTitle) return remote;
      const result = await this.github.putText(path, serializeActiveText({ ...remote, issueTitle }), `timer: add missing title ${this.user}`, file.sha);
      const saved = parseActiveText(serializeActiveText({ ...remote, issueTitle }), { user: this.user, path, sha: result.sha });
      await this.store.patchState({ activeCache: saved });
      return saved;
    } catch (error) {
      if (isConflict(error)) throw new TrackerConflictError('The active timer changed while its missing issue title was being saved. Reload.');
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
    const pending = pendingWrites.filter(operation => operation.operation === 'completeTimer' && operation.entry
      && startDate(operation.entry) >= earliest && startDate(operation.entry) <= today && !persisted.some(entry => sameCompletion(entry, operation)))
      .map(operation => ({ ...operation.entry, _path: operation.monthlyPath, _sha: null, _index: -1, _pending: true }));
    const allEntries = [...persisted, ...pending], recent = allEntries.filter(entry => dateSet.has(startDate(entry))).sort(newestFirst).slice(0, limit);
    const summaries = summaryRanges.map(range => ({ ...range, seconds: allEntries
      .filter(entry => startDate(entry) >= range.startDate && startDate(entry) <= range.endDate)
      .reduce((sum, entry) => sum + Math.max(0, Number(entry.durationSeconds) || 0), 0) }));
    await this.store.patchState({ recentCache: recent });
    const active = activeCache ? {
      issue: activeCache.issue, startedAt: activeCache.startedAt,
      description: activeCache.description || '', issueTitle: activeCache.issueTitle || '',
    } : null;
    return {
      recent, summaries, todaySeconds: summaries[0].seconds, reportDate: today, active,
      pendingCount: pendingWrites.length,
      pendingWrites: pendingWrites.map(({ id, status, stage }) => ({ id, status, stage })),
    };
  }

  async loadRecent(limit = 50) { return (await this.loadMenuData(limit)).recent; }

  async editEntry({ path, originalSha, index, original, edits }) {
    const source = await this.readMonthly(path);
    if (source.sha !== originalSha) throw new TrackerConflictError('This monthly time file changed after you opened it. Reload before saving.');
    const position = locateEntry(source.entries, index, original);
    if (position < 0) throw new TrackerConflictError('This time entry changed after you opened it. Reload before saving.');
    const normalized = { ...edits, ...(edits.issue ? { issue: this.validateIssue(edits.issue) } : {}) };
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
