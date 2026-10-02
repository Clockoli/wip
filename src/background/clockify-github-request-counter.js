// Temporary diagnostic for GitHub traffic initiated by the Clockify migration flow.
const KEY = 'clockify-mapping-github-request-count-v1';
const RATE_LIMIT_RESOURCES = new Set(['core', 'search', 'code_search', 'graphql']);

function safeNumber(value) {
  return typeof value === 'string' && /^\d{1,12}$/.test(value) && Number.isSafeInteger(Number(value))
    ? Number(value) : 'unknown';
}

export class ClockifyGitHubRequestCounter {
  constructor({ storage, log = console.info }) {
    this.storage = storage;
    this.log = log;
    this.queue = Promise.resolve();
  }

  serialize(work) {
    const result = this.queue.then(work, work);
    this.queue = result.catch(() => {});
    return result;
  }

  start() {
    return this.serialize(async () => {
      await this.storage.set(KEY, { total: 0, search: 0, other: 0 });
      this.log('[Clockify mapping GitHub requests] total=0 search=0 other=0 (started)');
    });
  }

  record(url, options) {
    return this.serialize(async () => {
      const requestUrl = new URL(url);
      if (requestUrl.origin !== 'https://api.github.com') return;
      const previous = await this.storage.get(KEY);
      if (!previous) return;
      let search = requestUrl.pathname === '/search/users';
      if (requestUrl.pathname === '/graphql' && options?.method === 'POST' && typeof options.body === 'string') {
        try { search = JSON.parse(options.body)?.query?.startsWith('query ClockifyUserSearch(') === true; }
        catch { /* Other GraphQL traffic is not classified as a user search. */ }
      }
      const counts = {
        total: previous.total + 1,
        search: previous.search + (search ? 1 : 0),
        other: previous.other + (search ? 0 : 1),
      };
      await this.storage.set(KEY, counts);
      this.log(`[Clockify mapping GitHub requests] total=${counts.total} search=${counts.search} other=${counts.other}`);
    });
  }

  recordResponse(url, response) {
    return this.serialize(async () => {
      if (new URL(url).origin !== 'https://api.github.com' || ![403, 429].includes(response.status)
          || !await this.storage.get(KEY)) return;
      const headers = response.headers;
      const resource = headers?.get('x-ratelimit-resource');
      const limit = safeNumber(headers?.get('x-ratelimit-limit'));
      const remaining = safeNumber(headers?.get('x-ratelimit-remaining'));
      const reset = safeNumber(headers?.get('x-ratelimit-reset'));
      const resetDate = reset !== 'unknown' && reset > 0 ? new Date(reset * 1000) : null;
      const resetAt = resetDate && Number.isFinite(resetDate.getTime()) ? resetDate.toISOString() : 'unknown';
      const retryAfterSeconds = safeNumber(headers?.get('retry-after'));
      this.log(`[Clockify mapping GitHub requests] response status=${response.status} resource=${RATE_LIMIT_RESOURCES.has(resource) ? resource : 'unknown'} limit=${limit} remaining=${remaining} resetAt=${resetAt} retryAfterSeconds=${retryAfterSeconds}`);
    });
  }

  wrapFetch(fetchImpl) {
    return async (url, options) => {
      try { await this.record(url, options); } catch { /* A diagnostic must never prevent an API request. */ }
      const response = await fetchImpl(url, options);
      try { await this.recordResponse(url, response); } catch { /* A diagnostic must never affect an API response. */ }
      return response;
    };
  }
}
