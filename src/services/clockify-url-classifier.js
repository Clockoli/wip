const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const URL = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d{1,9})$/;
const ISSUE = /(?:^|\s)#(\d{1,9})(?=\s|$)/i;
const TOKEN = /[a-z0-9]{2,}/g;

function catalog(value) {
  if (!Array.isArray(value) || !value.length || value.length > 5000) throw new TypeError('GitHub repository catalog must be a bounded non-empty array.');
  const result = new Set();
  for (const repository of value) {
    const owner = String(repository?.owner ?? repository?.organization ?? '').trim();
    const repo = String(repository?.repo ?? repository?.repository ?? '').trim();
    if (!OWNER.test(owner) || !REPOSITORY.test(repo)) throw new TypeError('GitHub repository catalog contains invalid coordinates.');
    result.add(`${owner.toLowerCase()}/${repo.toLowerCase()}`);
  }
  return result;
}

function candidateUrl(url) {
  const match = typeof url === 'string' ? url.match(URL) : null;
  return match ? url : null;
}

function tokens(entry) {
  const text = [entry?.project, entry?.task, entry?.description]
    .filter(value => typeof value === 'string').join(' ').toLowerCase();
  return text.match(TOKEN) || [];
}

function title(entry) {
  const text = [entry?.task, entry?.description, entry?.project].find(value => typeof value === 'string' && value.trim()) || 'Imported Clockify work';
  return text.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 300);
}

function validateArtifact(model) {
  if (!model || typeof model !== 'object' || model.version !== 2 || model.modelType !== 'multinomial-naive-bayes-url-classifier'
      || model.textSchemaVersion !== 1 || !Number.isSafeInteger(model.vocabularySize) || model.vocabularySize < 1 || model.vocabularySize > 100000
      || !Array.isArray(model.classes) || !Array.isArray(model.exactReferences) || model.classes.length > 10000 || model.exactReferences.length > 100000) {
    throw new TypeError('Clockify URL classifier artifact is invalid.');
  }
  return model;
}

function compileModel(model) {
  const totalDocuments = model.classes.reduce((total, value) => total + (Number.isSafeInteger(value?.documentCount) && value.documentCount > 0 ? value.documentCount : 0), 0);
  const classes = [];
  for (const value of model.classes) {
    const url = candidateUrl(value?.url);
    if (!url || !Number.isSafeInteger(value.documentCount) || value.documentCount < 1 || !value.tokenCounts || typeof value.tokenCounts !== 'object') continue;
    let totalTokens = 0;
    for (const count of Object.values(value.tokenCounts)) {
      if (!Number.isSafeInteger(count) || count < 0) { totalTokens = -1; break; }
      totalTokens += count;
    }
    if (totalTokens >= 0) classes.push({ url, tokenCounts: value.tokenCounts, baseScore: Math.log(value.documentCount / totalDocuments), denominator: totalTokens + model.vocabularySize });
  }
  const exactReferences = new Map();
  for (const reference of model.exactReferences) {
    const project = typeof reference?.project === 'string' ? reference.project.trim().toLowerCase() : '';
    const issueNumber = reference?.issueNumber;
    const url = candidateUrl(reference?.url);
    if (project && Number.isSafeInteger(issueNumber) && url && !exactReferences.has(`${project}\u0000${issueNumber}`)) exactReferences.set(`${project}\u0000${issueNumber}`, url);
  }
  return { classes, exactReferences };
}

function exactMatch(entry, exactReferences) {
  const project = typeof entry?.project === 'string' ? entry.project.trim().toLowerCase() : '';
  const issue = [entry?.project, entry?.task, entry?.description].find(value => typeof value === 'string' && ISSUE.test(value))?.match(ISSUE);
  const issueNumber = Number(issue?.[1]);
  return project && Number.isSafeInteger(issueNumber) ? exactReferences.get(`${project}\u0000${issueNumber}`) || null : null;
}

function prediction(entry, compiled) {
  const words = tokens(entry);
  if (!words.length || !compiled.classes.length) return null;
  let selected = null;
  for (const value of compiled.classes) {
    let score = value.baseScore;
    for (const word of words) score += Math.log(((value.tokenCounts[word] || 0) + 1) / value.denominator);
    if (!selected || score > selected.score || (score === selected.score && value.url.localeCompare(selected.url) < 0)) selected = { url: value.url, score };
  }
  return selected?.url || null;
}

function resolverInputKey(entry) {
  return JSON.stringify([
    typeof entry?.project === 'string' ? entry.project : null,
    typeof entry?.task === 'string' ? entry.task : null,
    typeof entry?.description === 'string' ? entry.description : null,
  ]);
}

/** Local classifier only: repository access builds scope; it never looks up the suggested issue or PR remotely. */
export function resolveClockifyUrlSuggestions({ entries, repositories, modelArtifact, onProfile = null } = {}) {
  if (!Array.isArray(entries)) throw new TypeError('Clockify entries must be an array.');
  if (onProfile !== null && typeof onProfile !== 'function') throw new TypeError('Clockify URL classifier profile callback is invalid.');
  catalog(repositories);
  const compiled = compileModel(validateArtifact(modelArtifact));
  const cache = new Map();
  let cacheHits = 0;
  const result = entries.map(entry => {
    const key = resolverInputKey(entry);
    let url;
    if (cache.has(key)) { url = cache.get(key); cacheHits += 1; }
    else {
      url = exactMatch(entry, compiled.exactReferences) || prediction(entry, compiled);
      cache.set(key, url);
    }
    return url ? { ...entry, resolvedIssue: { url, title: title(entry) } } : entry;
  });
  if (onProfile) onProfile({ entryCount: entries.length, uniqueInputs: cache.size, cacheHits });
  return result;
}
