const DEFAULT_TTL_MS = 15 * 60 * 1000;

function readEntry(value, now, ttlMs) {
  if (!value || !Number.isFinite(value.fetchedAt) || now - value.fetchedAt < 0 || now - value.fetchedAt >= ttlMs) return { fresh: false, details: null };
  if (value.details === null) return { fresh: true, details: null };
  const details = value.details;
  if (!details || typeof details.title !== 'string' || !['OPEN', 'CLOSED', 'MERGED'].includes(details.status)) return { fresh: false, details: null };
  return { fresh: true, details: { title: details.title.slice(0, 500), status: details.status } };
}

export class TaskMetadataService {
  constructor({ github, cache, scopeKey, configurationGeneration, now = () => Date.now(), ttlMs = DEFAULT_TTL_MS }) {
    this.github = github;
    this.cache = cache;
    this.scopeKey = scopeKey;
    this.configurationGeneration = configurationGeneration;
    this.now = now;
    this.ttlMs = ttlMs;
  }

  async load(issues, { signal } = {}) {
    const now = this.now(), cached = await this.cache.getTaskMetadataCache(this.scopeKey);
    const cachedEntries = cached?.entries && typeof cached.entries === 'object' ? cached.entries : {};
    const entries = {}, metadata = new Map(), missing = [];
    for (const issue of issues) {
      const entry = readEntry(cachedEntries[issue.url], now, this.ttlMs);
      if (!entry.fresh) missing.push(issue);
      else {
        entries[issue.url] = cachedEntries[issue.url];
        if (entry.details) metadata.set(issue.url, entry.details);
      }
    }
    if (missing.length) {
      const loaded = await this.github.getTaskMetadata(missing, { batchSize: 50, maxRequests: 40, signal });
      signal?.throwIfAborted();
      for (const issue of missing) {
        const details = loaded.get(issue.url) ?? null;
        entries[issue.url] = { fetchedAt: now, details };
        if (details) metadata.set(issue.url, details);
      }
    }
    signal?.throwIfAborted();
    const saved = await this.cache.saveTaskMetadataCache(
      { repositoryKey: this.scopeKey, entries }, this.configurationGeneration,
    );
    if (!saved) throw new DOMException('Task metadata load was superseded by a configuration change.', 'AbortError');
    return metadata;
  }
}
