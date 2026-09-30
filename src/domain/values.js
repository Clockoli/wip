const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPO_RE = /^[A-Za-z0-9_.-]{1,100}$/;
const USER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const ID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const TASK_URL_MAX = 2048;

export function normalizeTaskUrl(value) {
  const candidate = typeof value === 'string' ? value : value?.taskUrl ?? value?.issue?.url ?? value?.url;
  if (typeof candidate !== 'string' || !candidate || candidate.length > TASK_URL_MAX) throw new Error('Invalid task URL');
  let parsed;
  try { parsed = new URL(candidate); } catch { throw new Error('Invalid task URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Invalid task URL');
  if (parsed.protocol === 'https:' && parsed.hostname === 'github.com'
      && /^\/[^/]+\/[^/]+\/(?:issues|pull)\/[1-9]\d*\/?$/.test(parsed.pathname)) {
    parsed.search = ''; parsed.hash = '';
  }
  if (parsed.href.length > TASK_URL_MAX) throw new Error('Invalid task URL');
  return parsed.href;
}

// Stored Clockify work may have a deterministic identity without a navigable URL.
// Browser-created tasks still go through normalizeTaskUrl before reaching storage.
export function normalizeStoredTaskIdentity(value) {
  const candidate = typeof value === 'string' ? value : value?.taskUrl ?? value?.issue?.url ?? value?.url;
  if (typeof candidate === 'string' && candidate.length <= TASK_URL_MAX) {
    const parts = candidate.split('/');
    if (parts.length === 3 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(parts[1])
        && /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(parts[2])) {
      validateOwner(parts[0]);
      return candidate;
    }
  }
  return normalizeTaskUrl(candidate);
}

export function taskUrlOf(value) { return normalizeStoredTaskIdentity(value); }

export function validateOwner(value) {
  if (typeof value !== 'string' || !OWNER_RE.test(value) || value.includes('--')) throw new Error('Invalid owner');
  return value;
}

export function validateRepo(value) {
  if (typeof value !== 'string' || !REPO_RE.test(value) || value === '.' || value === '..' || value.includes('/')) throw new Error('Invalid repository');
  return value;
}


export function validateBranch(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 100 || value !== value.trim() ||
      !/^[A-Za-z0-9._/-]+$/.test(value) || value.startsWith('/') || value.endsWith('/') || value.endsWith('.') ||
      value.includes('..') || value.includes('//') || value.includes('@{') || value.split('/').some(part => !part || part.startsWith('.') || part.endsWith('.lock'))) {
    throw new Error('Invalid branch name');
  }
  return value;
}

export function validatePathSegment(value, label = 'path segment') {
  const pattern = label === 'user' ? USER_RE : /^[A-Za-z0-9_.-]{1,100}$/;
  if (typeof value !== 'string' || !pattern.test(value) || value === '.' || value === '..' || value.includes('/') || value.includes('\\')) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

export function validateEntryId(value) {
  if (typeof value !== 'string' || !ID_RE.test(value)) throw new Error('Invalid entry ID');
  return value;
}

export function normalizeIssue({ type = 'issue', owner, repo, number, url } = {}) {
  if (!['issue', 'pull_request'].includes(type)) throw new Error('Invalid issue type');
  owner = validateOwner(owner);
  repo = validateRepo(repo);
  number = Number(number);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error('Invalid issue number');
  const route = type === 'pull_request' ? 'pull' : 'issues';
  const canonicalUrl = `https://github.com/${owner}/${repo}/${route}/${number}`;
  if (url && url !== canonicalUrl) throw new Error('Invalid issue URL');
  return { type, owner, repo, number, url: canonicalUrl };
}

export function parseIssueUrl(value) {
  try {
    const url = new URL(normalizeTaskUrl(value));
    if (url.protocol !== 'https:' || url.hostname !== 'github.com') return null;
    const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/(issues|pull)\/([1-9]\d*)\/?$/);
    if (!match) return null;
    return normalizeIssue({
      type: match[3] === 'pull' ? 'pull_request' : 'issue',
      owner: decodeURIComponent(match[1]),
      repo: decodeURIComponent(match[2]),
      number: Number(match[4]),
    });
  } catch {
    return null;
  }
}

export function parseGitHubTaskUrl(value) { return parseIssueUrl(value); }

export function parseIssueReference(value, type = 'issue') {
  const match = String(value ?? '').trim().match(/^([^/#\s]+)\/([^/#\s]+)#([1-9]\d*)$/);
  if (!match) throw new Error('Enter a valid issue such as owner/repo#123');
  try {
    return normalizeIssue({ type, owner: match[1], repo: match[2], number: Number(match[3]) });
  } catch {
    throw new Error('Enter a valid issue such as owner/repo#123');
  }
}

export function localDateParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid date');
  return {
    year: String(date.getFullYear()).padStart(4, '0'),
    month: String(date.getMonth() + 1).padStart(2, '0'),
    day: String(date.getDate()).padStart(2, '0'),
  };
}


function validateDateParts({ year, month, day }) {
  if (!/^(?!0000)\d{4}$/.test(year) || !/^(0[1-9]|1[0-2])$/.test(month) || !/^(0[1-9]|[12]\d|3[01])$/.test(day)) throw new Error('Invalid entry date path');
  const maxDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  if (Number(day) > maxDay) throw new Error('Invalid entry date path');
  return { year, month, day };
}

export function utcDateParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid date');
  return {
    year: String(date.getUTCFullYear()).padStart(4, '0'),
    month: String(date.getUTCMonth() + 1).padStart(2, '0'),
    day: String(date.getUTCDate()).padStart(2, '0'),
  };
}

export function entryDateValue(parts) {
  const { year, month, day } = validateDateParts(parts);
  return `${year}-${month}-${day}`;
}

export function entryDateParts(value) {
  const match = typeof value === 'string' ? value.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  if (!match) throw new Error('Invalid entry date');
  return validateDateParts({ year: match[1], month: match[2], day: match[3] });
}
