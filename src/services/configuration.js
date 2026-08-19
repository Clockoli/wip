import { activeTextPath, parseActiveText } from '../domain/daily-text.js';
import { validateBranch, validateOwner, validateRepo } from '../domain/values.js';

function isNotFound(error) { return error?.status === 404 || error?.code === 'not_found'; }

function normalizePayload(payload = {}) {
  const owner = validateOwner(String(payload.owner || '').trim());
  const repo = validateRepo(String(payload.repo || '').trim());
  const branch = validateBranch(String(payload.branch || 'main').trim());
  const recentDays = Number(payload.recentDays);
  if (!Number.isInteger(recentDays) || recentDays < 1 || recentDays > 31) throw new Error('Recent-entry window must be between 1 and 31 days');
  const token = String(payload.token || '').trim();
  if (!token || token.length > 1000) throw new Error('GitHub token is required');
  const requestedOwners = Array.isArray(payload.allowedIssueOwners) ? payload.allowedIssueOwners : [];
  const allowedIssueOwners = [...new Set((requestedOwners.length ? requestedOwners : [owner]).map(value => validateOwner(String(value).trim())))];
  if (allowedIssueOwners.length > 100) throw new Error('Too many allowed issue owners');
  return { config: { owner, repo, branch, recentDays, allowedIssueOwners }, token };
}

function destinationChanged(previous, next) {
  return Boolean(previous) && (previous.owner !== next.owner || previous.repo !== next.repo || previous.branch !== next.branch);
}

export class ConfigurationService {
  constructor({ store, githubFactory }) { this.store = store; this.githubFactory = githubFactory; }

  async previousActive(previousConfig, previousToken, state) {
    if (state.activeCache) return state.activeCache;
    if (!previousConfig || !previousToken) return null;
    const github = this.githubFactory({ token: previousToken, ...previousConfig });
    const user = state.user || await github.getAuthenticatedUser();
    try { const path = activeTextPath(user), file = await github.getText(path); return parseActiveText(file.text, { user, path, sha: file.sha }); }
    catch (error) { if (isNotFound(error)) return null; throw error; }
  }

  async save(payload) {
    const { config, token } = normalizePayload(payload);
    const github = this.githubFactory({ token, ...config });
    const [user] = await Promise.all([github.getAuthenticatedUser(), github.validateRepository(), github.validateBranch()]);

    // This method is invoked by the service worker's SerialExecutor. Reading state
    // after remote validation closes the previous settings-vs-Stop race window.
    const [{ config: previousConfig, token: previousToken }, state] = await Promise.all([this.store.getConfig(), this.store.getState()]);
    let previousUser = state.user;
    if (!previousUser && previousConfig && previousToken) {
      previousUser = await this.githubFactory({ token: previousToken, ...previousConfig }).getAuthenticatedUser();
    }
    const changesDestination = destinationChanged(previousConfig, config);
    const changesUser = Boolean(previousUser && previousUser !== user);
    if (changesDestination || changesUser) {
      if ((state.pendingWrites || []).length) throw new Error('Sync pending entries before changing the time-data repository or GitHub user.');
      if (await this.previousActive(previousConfig, previousToken, { ...state, user: previousUser })) throw new Error('Stop the active timer before changing the time-data repository or GitHub user.');
    }

    await this.store.saveConfiguration(config, token, { user, activeCache: null, recentCache: [], pendingWrites: state.pendingWrites ?? [], dataVersion: 2 });
    return { user, config };
  }
}
