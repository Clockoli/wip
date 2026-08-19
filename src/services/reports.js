import { parseMonthlyText, parseMonthlyTextPath } from '../domain/monthly-text.js';
import { entryDateParts } from '../domain/values.js';

const CACHE_VERSION = 1;

function withoutStorageMetadata(record) {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !key.startsWith('_')));
}

function emptyCache(repositoryKey) {
  return { version: CACHE_VERSION, repositoryKey, etag: '', files: [], blobs: {} };
}

function normalizeCache(value, repositoryKey) {
  if (!value || value.version !== CACHE_VERSION || value.repositoryKey !== repositoryKey
      || !Array.isArray(value.files) || !value.blobs || typeof value.blobs !== 'object' || Array.isArray(value.blobs)) {
    return emptyCache(repositoryKey);
  }
  const files = value.files.filter(file => file && typeof file.path === 'string' && /^[0-9a-f]{40}$/i.test(file.sha));
  const blobs = {};
  for (const [sha, text] of Object.entries(value.blobs)) {
    if (/^[0-9a-f]{40}$/i.test(sha) && typeof text === 'string') blobs[sha] = text;
  }
  return { version: CACHE_VERSION, repositoryKey, etag: typeof value.etag === 'string' ? value.etag : '', files, blobs };
}

export class ReportService {
  constructor({ github, cache = null, concurrency = 6 }) {
    this.github = github;
    this.cache = cache;
    this.concurrency = Math.min(12, Math.max(1, Number(concurrency) || 6));
  }

  async readCache(repositoryKey) {
    return normalizeCache(await this.cache?.getReportCache?.(repositoryKey), repositoryKey);
  }

  async saveCache(value) {
    await this.cache?.saveReportCache?.(value);
  }

  async loadRange({ startDate, endDate }, { signal } = {}) {
    entryDateParts(startDate); entryDateParts(endDate);
    if (startDate > endDate) throw new Error('Report end date must not precede start date');
    signal?.throwIfAborted();

    const repositoryKey = this.github.repositoryKey || 'repository';
    const cache = await this.readCache(repositoryKey);
    const snapshot = await this.github.listTextFilesSnapshot('times/', { etag: cache.etag, signal });
    signal?.throwIfAborted();
    if (snapshot.notModified) {
      if (!cache.files.length) throw new Error('GitHub returned an unchanged report snapshot without a local cache');
      cache.etag = snapshot.etag || cache.etag;
    } else {
      cache.etag = snapshot.etag || '';
      cache.files = snapshot.files ?? [];
      const currentShas = new Set(cache.files.map(file => file.sha));
      cache.blobs = Object.fromEntries(Object.entries(cache.blobs).filter(([sha]) => currentShas.has(sha)));
      await this.saveCache(cache);
    }

    const startMonth = startDate.slice(0, 7), endMonth = endDate.slice(0, 7);
    const files = cache.files.map(file => {
      try { return { ...file, ...parseMonthlyTextPath(file.path) }; }
      catch { return null; }
    }).filter(file => file && file.month >= startMonth && file.month <= endMonth);

    const missing = files.filter(file => typeof cache.blobs[file.sha] !== 'string');
    try {
      for (let offset = 0; offset < missing.length; offset += this.concurrency) {
        signal?.throwIfAborted();
        const chunk = missing.slice(offset, offset + this.concurrency);
        const blobs = await Promise.all(chunk.map(file => this.github.getBlobText(file.path, file.sha, { signal })));
        for (const blob of blobs) cache.blobs[blob.sha] = blob.text;
        await this.saveCache(cache);
      }
    } catch (error) {
      await this.saveCache(cache);
      throw error;
    }

    const records = files.flatMap(file => {
      try {
        return parseMonthlyText(cache.blobs[file.sha], { user: file.user, month: file.month, path: file.path, sha: file.sha })
          .filter(record => record.entryDate >= startDate && record.entryDate <= endDate)
          .map(withoutStorageMetadata);
      } catch (error) {
        throw new Error(`Invalid time data in ${file.path}: ${error.message}`);
      }
    });
    return records.sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.user.localeCompare(b.user));
  }
}
