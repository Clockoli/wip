import { parseMonthlyText, parseMonthlyTextPath } from '../domain/monthly-text.js';
import { entryDateParts, taskUrlOf, validatePathSegment } from '../domain/values.js';
import { discoverUserStorageBranches } from './user-storage-branch.js';

const CACHE_VERSION = 1;
const DEFAULT_USER_BUDGET = Object.freeze({ maxFiles: 13, maxBytes: 20 * 1024 * 1024, maxRecords: 100000 });

function withoutStorageMetadata(record) {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !key.startsWith('_')));
}

function reportRecordKey(record) {
  return [record.user.toLowerCase(), taskUrlOf(record), record.startedAt, record.endedAt].join('\u0000');
}

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

export class ReportService {
  constructor({ github, cache = null, concurrency = 6, onProgress = null }) {
    this.github = github;
    this.cache = cache;
    this.onProgress = typeof onProgress === 'function' ? onProgress : () => {};
    this.concurrency = Math.min(12, Math.max(1, Number(concurrency) || 6));
  }

  async readCache(repositoryKey) {
    return normalizeCache(await this.cache?.getReportCache?.(repositoryKey), repositoryKey);
  }

  async saveCache(value) {
    await this.cache?.saveReportCache?.(value);
  }

  async loadRepositoryRange(range, { defaultBranch = null, signal } = {}) {
    this.onProgress({ label: 'Discovering people and time files…', value: 20 });
    if (!defaultBranch || typeof this.github.forBranch !== 'function' || typeof this.github.listBranches !== 'function') {
      return this.loadRange(range, { signal });
    }
    const defaultGithub = this.github.forBranch(defaultBranch, 'default');
    const users = await discoverUserStorageBranches(defaultGithub, { signal });
    if (!users.length) return new ReportService({ github: defaultGithub, cache: this.cache, concurrency: this.concurrency, onProgress: this.onProgress }).loadRange(range, { signal });
    const legacy = await new ReportService({ github: defaultGithub, cache: this.cache, concurrency: this.concurrency, onProgress: this.onProgress }).loadRange(range, { signal });
    const personalRecords = [];
    for (const user of users) {
      signal?.throwIfAborted();
      const personal = await new ReportService({ github: user.github, cache: this.cache, concurrency: this.concurrency, onProgress: this.onProgress })
        .loadUserRange(range, user.login, { signal });
      personalRecords.push(...personal);
    }
    return mergeReportRecords(personalRecords, legacy)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.user.localeCompare(b.user));
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

  async loadRange({ startDate, endDate }, { signal, user = null, maxFiles = Infinity, maxBytes = Infinity, maxRecords = Infinity, includeStorageMetadata = false } = {}) {
    entryDateParts(startDate); entryDateParts(endDate);
    if (startDate > endDate) throw new Error('Report end date must not precede start date');
    signal?.throwIfAborted();

    const repositoryKey = this.github.repositoryKey || 'repository';
    this.onProgress({ label: 'Checking the local time-file cache…', value: 35 });
    const cache = await this.readCache(repositoryKey);
    const needsSizes = user && cache.files.some(file => !Number.isSafeInteger(file.size));
    const snapshotEtag = cache.snapshotReady && !needsSizes ? cache.etag : '';
    let snapshot = await this.github.listTextFilesSnapshot('times/', { etag: snapshotEtag, signal });
    signal?.throwIfAborted();
    if (snapshot.notModified && !cache.snapshotReady) {
      snapshot = await this.github.listTextFilesSnapshot('times/', { etag: '', signal });
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
      await this.saveCache(cache);
    }

    const startMonth = startDate.slice(0, 7), endMonth = endDate.slice(0, 7);
    const files = cache.files.map(file => {
      try { return { ...file, ...parseMonthlyTextPath(file.path) }; }
      catch { return null; }
    }).filter(file => file && file.month >= startMonth && file.month <= endMonth && (!user || file.user === user));

    if (files.length > maxFiles) throw new Error(`Task file budget exceeded (${files.length} files; maximum ${maxFiles}). Choose a shorter period.`);
    const knownBytes = files.reduce((sum, file) => sum + (Number.isSafeInteger(file.size) ? file.size : 0), 0);
    if (knownBytes > maxBytes) throw new Error(`Task byte budget exceeded (${knownBytes} bytes; maximum ${maxBytes}). Choose a shorter period.`);

    const missing = files.filter(file => typeof cache.blobs[file.sha] !== 'string');
    try {
      for (let offset = 0; offset < missing.length; offset += this.concurrency) {
        signal?.throwIfAborted();
        const chunk = missing.slice(offset, offset + this.concurrency);
        this.onProgress({ label: `Downloading time files from GitHub (${Math.min(offset + chunk.length, missing.length)} of ${missing.length})…`, value: 40 + Math.round(30 * Math.min(offset + chunk.length, missing.length) / Math.max(1, missing.length)) });
        const blobs = await Promise.all(chunk.map(file => this.github.getBlobText(file.path, file.sha, { signal })));
        for (const blob of blobs) cache.blobs[blob.sha] = blob.text;
        await this.saveCache(cache);
      }
    } catch (error) {
      await this.saveCache(cache);
      throw error;
    }

    const actualBytes = files.reduce((sum, file) => sum + new TextEncoder().encode(cache.blobs[file.sha] ?? '').length, 0);
    if (actualBytes > maxBytes) throw new Error(`Task byte budget exceeded (${actualBytes} bytes; maximum ${maxBytes}). Choose a shorter period.`);

    this.onProgress({ label: 'Preparing time records…', value: 75 });
    const records = files.flatMap(file => {
      try {
        return parseMonthlyText(cache.blobs[file.sha], { user: file.user, month: file.month, path: file.path, sha: file.sha })
          .filter(record => record.entryDate >= startDate && record.entryDate <= endDate)
          .map(record => includeStorageMetadata ? record : withoutStorageMetadata(record));
      } catch (error) {
        throw new Error(`Invalid time data in ${file.path}: ${error.message}`);
      }
    });
    if (records.length > maxRecords) throw new Error(`Task record budget exceeded (${records.length} records; maximum ${maxRecords}). Choose a shorter period.`);
    return records.sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.user.localeCompare(b.user));
  }
}
