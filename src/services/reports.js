import { recordDate } from '../domain/reporting.js';
import { normalizeReportingUtc } from '../domain/local-settings.js';
import { parseMonthlyRecords, parseMonthlyRecordsPath } from '../domain/work-records.js';
import { parseTaskIndex, taskIndexRecord, TASK_INDEX_PATH } from '../domain/task-index.js';
import { entryDateParts, normalizeStoredTaskIdentity, taskUrlOf, validatePathSegment } from '../domain/values.js';
import { discoverUserStorageBranches } from './user-storage-branch.js';

const CACHE_VERSION = 1;
const DEFAULT_USER_BUDGET = Object.freeze({ maxFiles: 13, maxBytes: 20 * 1024 * 1024, maxRecords: 100000 });
const DEFAULT_TASK_USER_BUDGET = 1_000;

function sortedValue(value) {
  if (Array.isArray(value)) return value.map(sortedValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortedValue(value[key])]));
  return value;
}

export function canonicalRecordBody(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('A parsed persistent record body is required');
  const body = record._record && typeof record._record === 'object' && !Array.isArray(record._record)
    ? record._record
    : Object.fromEntries(Object.entries(record).filter(([key]) => !key.startsWith('_')
      && !['destinationId', 'timeRepository', 'duplicateDestinations', 'duplicateTimeRepositories'].includes(key)));
  return JSON.stringify(sortedValue(body));
}

function destinationLabel(destination) {
  return destination?.label || (destination?.owner && destination?.repo ? `${destination.owner}/${destination.repo}` : 'Unknown repository');
}

export function annotateDestinationRecord(record, destination) {
  if (!record || typeof record !== 'object' || typeof destination?.id !== 'string' || !destination.id) throw new Error('A parsed record and destination are required');
  return { ...record, destinationId: destination.id, timeRepository: destinationLabel(destination) };
}

function sanitizedReadError(error) {
  return {
    code: error?.name === 'AbortError' ? 'aborted' : String(error?.code || 'read_failed').slice(0, 80),
    message: 'This time repository could not be read.',
    ...(error?.retryAt ? { retryAt: error.retryAt } : {}),
  };
}

export function mergeDestinationRecords(destinationResults, destinationOrder = []) {
  const order = new Map(destinationOrder.map((id, index) => [id, index])), byId = new Map();
  for (const result of destinationResults ?? []) {
    for (const source of result.records ?? []) {
      const record = source.destinationId ? source : annotateDestinationRecord(source, result.destination);
      const origins = byId.get(record.id) ?? [];
      origins.push({ record, body: canonicalRecordBody(record) }); byId.set(record.id, origins);
    }
  }
  const records = [], conflicts = [];
  for (const [id, origins] of byId) {
    origins.sort((left, right) => (order.get(left.record.destinationId) ?? Infinity) - (order.get(right.record.destinationId) ?? Infinity));
    const destinationIds = [...new Set(origins.map(item => item.record.destinationId))];
    const timeRepositories = [...new Set(origins.map(item => item.record.timeRepository))];
    if (new Set(origins.map(item => item.body)).size > 1) {
      conflicts.push({ code: 'record_id_conflict', id, destinationIds, timeRepositories }); continue;
    }
    records.push(origins.length > 1 ? {
      ...origins[0].record, duplicateDestinations: destinationIds, duplicateTimeRepositories: timeRepositories,
    } : origins[0].record);
  }
  return { records, conflicts };
}

export function mergeDestinationTaskSummaries(destinationResults, destinationOrder = []) {
  const order = new Map(destinationOrder.map((id, index) => [id, index])), summaries = new Map(), ownersByRecordId = new Map();
  for (const result of destinationResults ?? []) {
    const destinationId = result.destination?.id, timeRepository = destinationLabel(result.destination);
    for (const record of result.records ?? []) {
      const taskUrl = taskUrlOf(record), user = String(record.user || '').trim();
      const durationSeconds = Number(record.durationSeconds);
      if (!taskUrl || !user || !Number.isFinite(durationSeconds) || durationSeconds < 0 || !Array.isArray(record.recordIds)) throw new Error('Invalid task summary');
      const key = `${taskUrl}\n${user.toLowerCase()}`;
      const summary = summaries.get(key) ?? {
        user, taskUrl, durationSeconds: 0, recordIds: new Set(), destinationIds: new Set(), timeRepositories: new Set(), conflicted: false,
      };
      for (const id of record.recordIds) {
        if (typeof id !== 'string' || !id) throw new Error('Invalid task summary record ID');
        const owner = ownersByRecordId.get(id);
        if (owner && owner.destinationId !== destinationId) { owner.summary.conflicted = true; summary.conflicted = true; }
        else ownersByRecordId.set(id, { destinationId, summary });
      }
      summary.durationSeconds += durationSeconds;
      for (const id of record.recordIds) summary.recordIds.add(id);
      if (destinationId) summary.destinationIds.add(destinationId);
      if (timeRepository) summary.timeRepositories.add(timeRepository);
      summaries.set(key, summary);
    }
  }
  const sortDestinations = values => [...values].sort((left, right) => (order.get(left) ?? Infinity) - (order.get(right) ?? Infinity) || left.localeCompare(right));
  const conflicts = [...summaries.values()].filter(summary => summary.conflicted).map(summary => ({
    code: 'task_summary_record_id_conflict', taskUrl: summary.taskUrl, user: summary.user,
    recordIds: [...summary.recordIds].sort(), destinationIds: sortDestinations(summary.destinationIds),
    timeRepositories: [...summary.timeRepositories],
  }));
  return {
    records: [...summaries.values()].filter(summary => !summary.conflicted).map(summary => ({
      user: summary.user, taskUrl: summary.taskUrl, durationSeconds: summary.durationSeconds,
      recordIds: [...summary.recordIds].sort(), destinationIds: sortDestinations(summary.destinationIds),
      timeRepositories: [...summary.timeRepositories],
    })),
    conflicts,
  };
}

export async function loadDestinationRecords(destinations, read, { signal, concurrency = 4, merge = mergeDestinationRecords } = {}) {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
  if (signal?.aborted) abortFromParent(); else signal?.addEventListener('abort', abortFromParent, { once: true });
  try {
    const inputs = destinations ?? [], settled = new Array(inputs.length);
    let next = 0;
    const worker = async () => {
      while (next < inputs.length && !controller.signal.aborted) {
        const index = next++;
        try { settled[index] = { status: 'fulfilled', value: await read(inputs[index], controller.signal) }; }
        catch (reason) {
          settled[index] = { status: 'rejected', reason };
          if (reason?.name === 'AbortError') controller.abort(reason);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(inputs.length, Math.max(1, Number(concurrency) || 1)) }, worker));
    if (signal?.aborted || controller.signal.aborted) throw signal?.reason ?? controller.signal.reason;
    const successful = [], readStatus = [];
    settled.forEach((result, index) => {
      const destination = inputs[index], base = { destinationId: destination.id, timeRepository: destinationLabel(destination) };
      if (result.status === 'fulfilled') { successful.push({ destination, records: result.value }); readStatus.push({ ...base, status: 'ok' }); }
      else readStatus.push({ ...base, status: 'error', error: sanitizedReadError(result.reason) });
    });
    if (!successful.length) {
      const error = new Error('All configured time repositories failed to load.');
      error.code = 'all_destinations_failed'; error.readStatus = readStatus; throw error;
    }
    const merged = merge(successful, inputs.map(destination => destination.id));
    return { ...merged, readStatus, partial: successful.length !== inputs.length || merged.conflicts.length > 0 };
  } finally { signal?.removeEventListener('abort', abortFromParent); }
}

export function withoutInternalMetadata(record) {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !key.startsWith('_')));
}

const withoutStorageMetadata = withoutInternalMetadata;

function reportRecordKey(record) { return record.id; }


function mergeReportRecords(primary, fallback) {
  const merged = new Map();
  for (const record of [...primary, ...fallback]) {
    const key = reportRecordKey(record);
    if (!merged.has(key)) merged.set(key, record);
  }
  return [...merged.values()];
}

function emptyCache(repositoryKey) {
  return { version: CACHE_VERSION, repositoryKey, etag: '', snapshotReady: false, files: [], blobs: {} };
}

function normalizeCache(value, repositoryKey) {
  if (!value || value.version !== CACHE_VERSION || value.repositoryKey !== repositoryKey
      || !Array.isArray(value.files) || !value.blobs || typeof value.blobs !== 'object' || Array.isArray(value.blobs)) {
    return emptyCache(repositoryKey);
  }
  const files = value.files.filter(file => file && typeof file.path === 'string' && /^[0-9a-f]{40}$/i.test(file.sha))
    .map(file => ({ path: file.path, sha: file.sha, ...(Number.isSafeInteger(file.size) && file.size >= 0 ? { size: file.size } : {}) }));
  const blobs = {};
  for (const [sha, text] of Object.entries(value.blobs)) {
    if (/^[0-9a-f]{40}$/i.test(sha) && typeof text === 'string') blobs[sha] = text;
  }
  const completeFiles = files.length === value.files.length;
  const hasSnapshotMarker = Object.prototype.hasOwnProperty.call(value, 'snapshotReady');
  const snapshotReady = completeFiles
    && (value.snapshotReady === true || (!hasSnapshotMarker && files.length > 0));
  return { version: CACHE_VERSION, repositoryKey, etag: typeof value.etag === 'string' ? value.etag : '', snapshotReady, files, blobs };
}

function budgetValue(value, fallback, label) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid task ${label} budget`);
  return parsed;
}

function taskScanBudgetError(resource, used, maximum) {
  const error = new Error(`Clockoli history exceeds the safe exact-participant scan limit (${used} ${resource}; maximum ${maximum}).`);
  error.code = 'task_scan_budget';
  return error;
}

function consumeTaskScanBudget(budget, resource, amount) {
  if (!budget || amount <= 0) return;
  const suffix = `${resource[0].toUpperCase()}${resource.slice(1)}`;
  const usedKey = `used${suffix}`, maxKey = `max${suffix}`;
  const next = budget[usedKey] + amount;
  if (next > budget[maxKey]) throw taskScanBudgetError(resource, next, budget[maxKey]);
  budget[usedKey] = next;
}

class RequestLimiter {
  constructor(limit) {
    this.limit = limit;
    this.active = 0;
    this.waiters = [];
  }

  async run(task, signal) {
    signal?.throwIfAborted();
    if (this.active >= this.limit) {
      await new Promise((resolve, reject) => {
        const waiter = { resolve, reject, signal, onAbort: null };
        waiter.onAbort = () => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
        };
        signal?.addEventListener('abort', waiter.onAbort, { once: true });
        this.waiters.push(waiter);
      });
    } else {
      this.active += 1;
    }
    try {
      signal?.throwIfAborted();
      return await task();
    } finally {
      this.active -= 1;
      const waiter = this.waiters.shift();
      if (waiter) {
        this.active += 1; // Reserve the released slot before waking the next caller.
        waiter.signal?.removeEventListener('abort', waiter.onAbort);
        waiter.resolve();
      }
    }
  }
}

async function settleConcurrent(items, signal, operation) {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(signal.reason);
  if (signal?.aborted) abortFromParent();
  else signal?.addEventListener('abort', abortFromParent, { once: true });
  let firstError = null;
  try {
    const results = await Promise.allSettled(items.map(async item => {
      try { return await operation(item, controller.signal); }
      catch (error) {
        if (!firstError) {
          firstError = error;
          controller.abort(error);
        }
        throw error;
      }
    }));
    if (firstError) throw firstError;
    return results.map(result => result.value);
  } finally {
    signal?.removeEventListener('abort', abortFromParent);
  }
}

export class ReportService {
  constructor({ github, cache = null, concurrency = 6, onProgress = null, requestLimiter = null }) {
    this.github = github;
    this.cache = cache;
    this.onProgress = typeof onProgress === 'function' ? onProgress : () => {};
    this.concurrency = Math.min(12, Math.max(1, Number(concurrency) || 6));
    this.requestLimiter = requestLimiter ?? new RequestLimiter(this.concurrency);
  }

  async readCache(repositoryKey) {
    return normalizeCache(await this.cache?.getReportCache?.(repositoryKey), repositoryKey);
  }

  async cachedMonthly(path, sha) {
    if (!sha) return null;
    const cache = await this.readCache(this.github.repositoryKey || 'repository');
    if (!cache.files.some(file => file.path === path && file.sha === sha) || typeof cache.blobs[sha] !== 'string') return null;
    const { user, month } = parseMonthlyRecordsPath(path);
    return { path, sha, entries: parseMonthlyRecords(cache.blobs[sha], { user, month, path, sha }) };
  }

  async saveCache(value) {
    await this.cache?.saveReportCache?.(value);
  }

  async loadRepositoryRange(range, { defaultBranch = null, signal, includeStorageMetadata = false } = {}) {
    this.onProgress({ label: 'Discovering people and time files…', value: 20 });
    if (!defaultBranch || typeof this.github.forBranch !== 'function' || typeof this.github.listBranches !== 'function') {
      return this.loadRange(range, { signal, includeStorageMetadata });
    }
    const defaultGithub = this.github.forBranch(defaultBranch, 'default');
    const users = await discoverUserStorageBranches(defaultGithub, { signal, concurrency: this.concurrency });
    if (!users.length) return [];
    const personalRecords = [];
    for (let offset = 0; offset < users.length; offset += this.concurrency) {
      signal?.throwIfAborted();
      const chunk = await settleConcurrent(users.slice(offset, offset + this.concurrency), signal, (user, branchSignal) => (
        new ReportService({
          github: user.github, cache: this.cache, concurrency: this.concurrency,
          onProgress: this.onProgress, requestLimiter: this.requestLimiter,
        }).loadUserRange(range, user.login, { signal: branchSignal, includeStorageMetadata })
      ));
      personalRecords.push(...chunk.flat());
    }
    return mergeReportRecords(personalRecords, [])
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.user.localeCompare(b.user));
  }

  async loadRepositoryUserRange(range, { defaultBranch = null, githubUserId = null, user, signal, includeStorageMetadata = false, budgets = {} } = {}) {
    const validatedUser = validatePathSegment(user, 'user');
    if (!defaultBranch || !Number.isSafeInteger(githubUserId) || githubUserId <= 0
        || typeof this.github.forBranch !== 'function' || typeof this.github.listBranches !== 'function') {
      return this.loadUserRange(range, validatedUser, { signal, includeStorageMetadata }, budgets);
    }
    const defaultGithub = this.github.forBranch(defaultBranch, 'default');
    const users = await discoverUserStorageBranches(defaultGithub, { signal, concurrency: this.concurrency });
    const mappedUser = users.find(candidate => candidate.id === githubUserId
      && candidate.login.toLowerCase() === validatedUser.toLowerCase());
    if (!mappedUser) return this.loadUserRange(range, validatedUser, { signal, includeStorageMetadata }, budgets);
    return new ReportService({
      github: mappedUser.github, cache: this.cache, concurrency: this.concurrency,
      onProgress: this.onProgress, requestLimiter: this.requestLimiter,
    }).loadUserRange(range, mappedUser.login, { signal, includeStorageMetadata }, budgets);
  }

  async loadRepositoryTask(taskUrl, { defaultBranch = null, signal, budgets = {} } = {}) {
    const canonicalTaskUrl = normalizeStoredTaskIdentity(taskUrl);
    const maxUsers = budgetValue(budgets.maxUsers, DEFAULT_TASK_USER_BUDGET, 'user');
    this.onProgress({ label: 'Discovering people and task indexes…', value: 20 });
    if (!defaultBranch || typeof this.github.forBranch !== 'function' || typeof this.github.listBranches !== 'function') {
      const index = await this.readTaskIndex(this.github, null, { signal });
      const record = taskIndexRecord(index, canonicalTaskUrl);
      return record ? [record] : [];
    }
    const defaultGithub = this.github.forBranch(defaultBranch, 'default');
    const users = await discoverUserStorageBranches(defaultGithub, { signal, concurrency: this.concurrency });
    if (!users.length) return [];
    if (users.length > maxUsers) throw taskScanBudgetError('users', users.length, maxUsers);
    const personalRecords = [];
    for (let offset = 0; offset < users.length; offset += this.concurrency) {
      signal?.throwIfAborted();
      const chunk = await settleConcurrent(users.slice(offset, offset + this.concurrency), signal, async (user, branchSignal) => {
        const index = await this.readTaskIndex(user.github, user.login, { signal: branchSignal });
        return taskIndexRecord(index, canonicalTaskUrl);
      });
      personalRecords.push(...chunk.filter(Boolean));
    }
    return personalRecords.sort((a, b) => a.user.localeCompare(b.user));
  }

  async readTaskIndex(github, user, { signal } = {}) {
    try {
      const file = await this.requestLimiter.run(() => github.getText(TASK_INDEX_PATH, { signal }), signal);
      signal?.throwIfAborted();
      return parseTaskIndex(file.text, user ? { user } : {});
    } catch (error) {
      if (error?.name === 'AbortError' || signal?.aborted) throw error;
      throw new Error(`Clockoli task index is unavailable or invalid${user ? ` for ${user}` : ''}: ${error.message}`, { cause: error });
    }
  }

  async loadUserRange(range, user, options = {}, budgets = {}) {
    const validatedUser = validatePathSegment(user, 'user');
    return this.loadRange(range, {
      ...options,
      user: validatedUser,
      maxFiles: budgetValue(budgets.maxFiles, DEFAULT_USER_BUDGET.maxFiles, 'file'),
      maxBytes: budgetValue(budgets.maxBytes, DEFAULT_USER_BUDGET.maxBytes, 'byte'),
      maxRecords: budgetValue(budgets.maxRecords, DEFAULT_USER_BUDGET.maxRecords, 'record'),
    });
  }

  async loadRange({ startDate, endDate, reportingUtc = false }, {
    signal, user = null, taskUrl = null, maxFiles = Infinity, maxBytes = Infinity,
    maxRecords = Infinity, includeStorageMetadata = false, resourceBudget = null,
  } = {}) {
    normalizeReportingUtc(reportingUtc);
    entryDateParts(startDate); entryDateParts(endDate);
    if (startDate > endDate) throw new Error('Report end date must not precede start date');
    const canonicalTaskUrl = taskUrl === null ? null : normalizeStoredTaskIdentity(taskUrl);
    signal?.throwIfAborted();

    const repositoryKey = this.github.repositoryKey || 'repository';
    this.onProgress({ label: 'Checking the local time-file cache…', value: 35 });
    const cache = await this.readCache(repositoryKey);
    const needsSizes = (user || resourceBudget) && cache.files.some(file => !Number.isSafeInteger(file.size));
    const snapshotEtag = cache.snapshotReady && !needsSizes ? cache.etag : '';
    let snapshot = await this.requestLimiter.run(
      () => this.github.listTextFilesSnapshot('times/', { etag: snapshotEtag, signal }), signal,
    );
    signal?.throwIfAborted();
    if (snapshot.notModified && !cache.snapshotReady) {
      snapshot = await this.requestLimiter.run(
        () => this.github.listTextFilesSnapshot('times/', { etag: '', signal }), signal,
      );
      signal?.throwIfAborted();
    }
    if (snapshot.notModified) {
      if (!cache.snapshotReady) throw new Error('GitHub returned 304 for an unconditional report snapshot request');
      cache.etag = snapshot.etag || cache.etag;
    } else {
      cache.etag = snapshot.etag || '';
      cache.snapshotReady = true;
      cache.files = snapshot.files ?? [];
      const currentShas = new Set(cache.files.map(file => file.sha));
      cache.blobs = Object.fromEntries(Object.entries(cache.blobs).filter(([sha]) => currentShas.has(sha)));
      if (!resourceBudget) await this.saveCache(cache);
    }

    let startMonth = startDate.slice(0, 7), endMonth = endDate.slice(0, 7);
    if (reportingUtc) {
      // Files are partitioned by local date, so UTC boundary records can live in either adjacent month.
      const start = new Date(`${startDate}T00:00:00Z`), end = new Date(`${endDate}T00:00:00Z`);
      start.setUTCDate(1); start.setUTCMonth(start.getUTCMonth() - 1);
      end.setUTCDate(1); end.setUTCMonth(end.getUTCMonth() + 1);
      startMonth = start.toISOString().slice(0, 7); endMonth = end.toISOString().slice(0, 7);
    }
    const files = cache.files.map(file => {
      try { return { ...file, ...parseMonthlyRecordsPath(file.path) }; }
      catch { return null; }
    }).filter(file => file && file.month >= startMonth && file.month <= endMonth && (!user || file.user === user));

    if (files.length > maxFiles) throw new Error(`Task file budget exceeded (${files.length} files; maximum ${maxFiles}). Choose a shorter period.`);
    consumeTaskScanBudget(resourceBudget, 'files', files.length);
    const knownBytes = files.reduce((sum, file) => sum + (Number.isSafeInteger(file.size) ? file.size : 0), 0);
    if (knownBytes > maxBytes) throw new Error(`Task byte budget exceeded (${knownBytes} bytes; maximum ${maxBytes}). Choose a shorter period.`);
    consumeTaskScanBudget(resourceBudget, 'bytes', knownBytes);
    if (resourceBudget && !snapshot.notModified) await this.saveCache(cache);

    const missing = files.filter(file => typeof cache.blobs[file.sha] !== 'string');
    try {
      for (let offset = 0; offset < missing.length; offset += this.concurrency) {
        signal?.throwIfAborted();
        const chunk = missing.slice(offset, offset + this.concurrency);
        this.onProgress({ label: `Downloading time files from GitHub (${Math.min(offset + chunk.length, missing.length)} of ${missing.length})…`, value: 40 + Math.round(30 * Math.min(offset + chunk.length, missing.length) / Math.max(1, missing.length)) });
        const blobs = await Promise.all(chunk.map(file => this.requestLimiter.run(
          () => this.github.getBlobText(file.path, file.sha, { signal }), signal,
        )));
        for (const blob of blobs) cache.blobs[blob.sha] = blob.text;
        await this.saveCache(cache);
      }
    } catch (error) {
      await this.saveCache(cache);
      throw error;
    }

    const actualBytes = files.reduce((sum, file) => sum + new TextEncoder().encode(cache.blobs[file.sha] ?? '').length, 0);
    if (actualBytes > maxBytes) throw new Error(`Task byte budget exceeded (${actualBytes} bytes; maximum ${maxBytes}). Choose a shorter period.`);
    consumeTaskScanBudget(resourceBudget, 'bytes', Math.max(0, actualBytes - knownBytes));

    this.onProgress({ label: 'Preparing time records…', value: 75 });
    const records = [];
    for (const file of files) {
      try {
        const parsed = parseMonthlyRecords(cache.blobs[file.sha], {
          user: file.user, month: file.month, path: file.path, sha: file.sha,
        });
        consumeTaskScanBudget(resourceBudget, 'records', parsed.length);
        records.push(...parsed
          .filter(record => recordDate(record, reportingUtc) >= startDate && recordDate(record, reportingUtc) <= endDate
            && (!canonicalTaskUrl || record.taskUrl === canonicalTaskUrl))
          .map(record => includeStorageMetadata ? record : withoutStorageMetadata(record)));
      } catch (error) {
        if (error?.code === 'task_scan_budget') throw error;
        throw new Error(`Invalid time data in ${file.path}: ${error.message}`);
      }
    }
    if (records.length > maxRecords) throw new Error(`Task record budget exceeded (${records.length} records; maximum ${maxRecords}). Choose a shorter period.`);
    return records.sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.user.localeCompare(b.user));
  }
}
