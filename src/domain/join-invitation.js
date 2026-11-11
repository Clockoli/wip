// A Clockoli /join link is an unverified repository hint, not an authorization.
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPOSITORY = /^[A-Za-z0-9._-]{1,100}$/;

export function validateJoinRepository(value) {
  if (typeof value !== 'string' || value.length > 140) return '';
  const pair = value.split('/');
  if (pair.length !== 2 || !OWNER.test(pair[0]) || !REPOSITORY.test(pair[1])
      || pair[1] === '.' || pair[1] === '..') return '';
  return value;
}

// Accept the current ?repo= form and the legacy #repo= form. Both must
// identify the same repository when present, matching the website contract.
// URLSearchParams decodes once; never decode the repository a second time.
export function parseClockoliInvitationUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) return '';
  try {
    const url = new URL(raw);
    if (url.origin !== 'https://clockoli.com' || !['/join', '/join/'].includes(url.pathname)
        || url.username || url.password) return '';

    // Query parameters such as utm_source are fine, but repo must be unique.
    const queryValues = url.searchParams.getAll('repo');
    if (queryValues.length > 1) return '';
    const queryRepo = queryValues.length === 1 ? validateJoinRepository(queryValues[0]) : '';
    if (queryValues.length && !queryRepo) return '';

    let fragmentRepo = '';
    if (url.hash) {
      if (url.hash.length > 512) return '';
      const params = new URLSearchParams(url.hash.slice(1));
      if ([...params].length !== 1 || params.getAll('repo').length !== 1) return '';
      fragmentRepo = validateJoinRepository(params.get('repo'));
      if (!fragmentRepo) return '';
    }
    if (queryRepo && fragmentRepo && queryRepo !== fragmentRepo) return '';
    return queryRepo || fragmentRepo;
  } catch { return ''; }
}

export function discoverClockoliInvitations(tabs) {
  const unique = new Map();
  for (const tab of Array.isArray(tabs) ? tabs : []) {
    const name = parseClockoliInvitationUrl(tab?.url);
    if (name && !unique.has(name.toLowerCase())) unique.set(name.toLowerCase(), name);
  }
  return [...unique.values()].sort((a, b) => a.localeCompare(b));
}

export function clockoliInvitationLink(repository) {
  const name = validateJoinRepository(repository);
  if (!name) return '';
  const url = new URL('https://clockoli.com/join/');
  url.searchParams.set('repo', name);
  return url.href;
}
