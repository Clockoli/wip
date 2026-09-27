import { scoreClockifyResolverCandidate } from './clockify-resolver-model.js';

const GITHUB_OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const GITHUB_REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const ISSUE_NUMBER = /(?:^|\s)(?:#|issues?\s*#?)(\d{1,9})(?:\s+([^\n]+))?$/i;

function unresolved(evidence = []) {
  return {
    status: 'unresolved',
    resolution: { provider: 'unknown', confidence: 0, resolutionMethod: 'unresolved', evidence },
  };
}

function repositoryList(values) {
  if (!Array.isArray(values)) throw new TypeError('Resolver repository allowlist must be an array.');
  const seen = new Set();
  const repositories = [];
  for (const value of values) {
    if (typeof value !== 'string') throw new TypeError('Resolver repository allowlist entries must be strings.');
    const [organization, repository, extra] = value.trim().split('/');
    if (extra !== undefined || !GITHUB_OWNER.test(organization || '') || !GITHUB_REPOSITORY.test(repository || '')) {
      throw new TypeError('Resolver repository allowlist contains invalid GitHub coordinates.');
    }
    const key = `${organization.toLowerCase()}/${repository.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      repositories.push({ organization, repository, fullName: `${organization}/${repository}`, key });
    }
  }
  return repositories;
}

function textFields(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
  const fields = [entry.project, entry.task, entry.description, ...(Array.isArray(entry.tags) ? entry.tags : [])];
  return fields.filter(value => typeof value === 'string').map(value => value.trim()).filter(Boolean);
}

function exactRepository(fields, repositories) {
  const candidates = new Map();
  for (const field of fields) {
    const normalized = field.toLowerCase();
    for (const repository of repositories) {
      if (normalized === repository.key || normalized === repository.repository.toLowerCase()) candidates.set(repository.key, repository);
      const ownerRepo = new RegExp(`(?:^|[^A-Za-z0-9_.-])${repository.fullName.replace('/', '\\/')}(?=$|[^A-Za-z0-9_.-])`, 'i');
      const repoHash = new RegExp(`(?:^|[^A-Za-z0-9_.-])${repository.repository}\\s*\\/#`, 'i');
      if (ownerRepo.test(field) || repoHash.test(field)) candidates.set(repository.key, repository);
    }
  }
  return candidates.size === 1 ? [...candidates.values()][0] : null;
}

function exactIssue(fields) {
  for (const field of fields) {
    const match = field.match(ISSUE_NUMBER);
    if (!match) continue;
    const number = Number(match[1]);
    if (Number.isSafeInteger(number) && number > 0) return { number, title: (match[2] || '').trim() };
  }
  return null;
}

function canonicalValidation(value, candidate) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const expectedUrl = `https://github.com/${candidate.organization}/${candidate.repository}/`;
  if (value.provider !== 'github' || value.organization?.toLowerCase() !== candidate.organization.toLowerCase()
      || value.repository?.toLowerCase() !== candidate.repository.toLowerCase() || String(value.externalId) !== String(candidate.number)
      || !['issue', 'pull_request'].includes(value.entityType) || typeof value.title !== 'string'
      || typeof value.externalUrl !== 'string' || !value.externalUrl.startsWith(expectedUrl)) return null;
  return {
    provider: 'github', organization: value.organization, repository: value.repository, entityType: value.entityType,
    externalId: String(candidate.number), title: value.title, externalUrl: value.externalUrl,
  };
}

function titleTokens(value) {
  return new Set(String(value).toLowerCase().match(/[a-z0-9]{2,}/g) || []);
}

function titleSimilarity(left, right) {
  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);
  return leftTokens.size || rightTokens.size ? [...leftTokens].filter(token => rightTokens.has(token)).length / new Set([...leftTokens, ...rightTokens]).size : 0;
}

function resolverFeatures(fields, issue, repository, candidate) {
  const source = fields.join(' ');
  const normalizedSource = source.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const normalizedTitle = candidate.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const prefixLength = [...normalizedSource].reduce((length, character, index) => length === index && character === normalizedTitle[index] ? length + 1 : length, 0);
  const edit = normalizedSource.length || normalizedTitle.length
    ? 1 - Math.abs(normalizedSource.length - normalizedTitle.length) / Math.max(normalizedSource.length, normalizedTitle.length)
    : 0;
  return {
    issue_id_exact_match: Number(issue?.number === Number(candidate.externalId)),
    repository_exact_match: Number(repository?.key === `${candidate.organization}/${candidate.repository}`.toLowerCase()),
    title_token_jaccard: titleSimilarity(source, candidate.title),
    title_prefix_similarity: prefixLength / Math.max(1, normalizedTitle.length),
    title_edit_similarity: edit,
    pattern_type_code: issue && repository ? 2 : issue ? 1 : 0,
    repository_validation_frequency: 0,
    user_repository_frequency: 0,
  };
}

function candidateFromDiscovery(value, allowlist) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const organization = typeof value.organization === 'string' ? value.organization : '';
  const repository = typeof value.repository === 'string' ? value.repository : '';
  const number = Number(value.externalId);
  const allowlisted = allowlist.find(candidate => candidate.key === `${organization}/${repository}`.toLowerCase());
  if (!allowlisted || !Number.isSafeInteger(number) || number < 1) return null;
  const candidate = { organization: allowlisted.organization, repository: allowlisted.repository, number, title: typeof value.title === 'string' ? value.title : '' };
  const validated = canonicalValidation(value, candidate);
  return validated ? { candidate, resolution: validated } : null;
}

function confidence(logit) {
  return logit >= 0 ? 1 / (1 + Math.exp(-logit)) : Math.exp(logit) / (1 + Math.exp(logit));
}

/**
 * Resolves exact references automatically. With an imported model and bounded
 * authenticated discovery callback, it ranks canonical GitHub candidates into
 * preview-only suggestions; it never auto-applies a learned result.
 */
export function createClockifyGitHubResolver({ repositories, validate, discover = null, modelArtifact = null } = {}) {
  const allowlist = repositoryList(repositories);
  if (typeof validate !== 'function') throw new TypeError('Resolver requires a GitHub validation function.');
  if (discover !== null && typeof discover !== 'function') throw new TypeError('Resolver candidate discovery function is invalid.');

  return {
    async resolve(entry) {
      const fields = textFields(entry);
      const issue = exactIssue(fields);
      const initialEvidence = issue ? [{ type: 'issue_number_exact', value: String(issue.number) }] : [];
      const repository = exactRepository(fields, allowlist);
      const evidence = repository ? [...initialEvidence, { type: 'repository_exact', value: repository.fullName }] : initialEvidence;
      if (issue && repository) {
        const candidate = { organization: repository.organization, repository: repository.repository, number: issue.number, title: issue.title };
        let validated;
        try { validated = canonicalValidation(await validate(candidate), candidate); } catch { return unresolved(evidence); }
        if (!validated) return unresolved(evidence);
        return { status: 'auto_applied', resolution: { ...validated, confidence: 1, resolutionMethod: 'deterministic', evidence: [...evidence, { type: 'github_validation', value: 'canonical_entity' }] } };
      }
      if (!modelArtifact || !discover) return unresolved(evidence);
      const query = [entry?.task, entry?.description, ...(Array.isArray(entry?.tags) ? entry.tags : [])]
        .filter(value => typeof value === 'string').join(' ').replace(/\s+/g, ' ').trim().slice(0, 300);
      if (!query) return unresolved(evidence);
      const scopedRepositories = repository ? [repository] : allowlist;
      let values;
      try { values = await discover({ repositories: scopedRepositories, query, limit: 20 }); } catch { return unresolved(evidence); }
      if (!Array.isArray(values) || values.length > 20) return unresolved(evidence);
      const candidates = [];
      const seen = new Set();
      for (const value of values) {
        const candidate = candidateFromDiscovery(value, allowlist);
        if (candidate && !seen.has(candidate.resolution.externalUrl)) { seen.add(candidate.resolution.externalUrl); candidates.push(candidate); }
      }
      if (!candidates.length) return unresolved(evidence);
      let selected;
      try {
        selected = candidates.map(candidate => ({ ...candidate, score: scoreClockifyResolverCandidate(modelArtifact, resolverFeatures(fields, issue, repository, candidate.resolution)) }))
          .sort((left, right) => right.score - left.score)[0];
      } catch { return unresolved(evidence); }
      let validated;
      try { validated = canonicalValidation(await validate(selected.candidate), selected.candidate); } catch { return unresolved([...evidence, { type: 'github_candidate_discovery', value: String(candidates.length) }]); }
      if (!validated) return unresolved([...evidence, { type: 'github_candidate_discovery', value: String(candidates.length) }]);
      return {
        status: 'suggestion',
        resolution: {
          ...validated, confidence: confidence(selected.score), resolutionMethod: 'catboost_suggestion',
          evidence: [...evidence, { type: 'github_candidate_discovery', value: String(candidates.length) }, { type: 'github_validation', value: 'canonical_entity' }],
        },
      };
    },
  };
}
