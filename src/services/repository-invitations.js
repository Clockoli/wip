import { validatePathSegment } from '../domain/values.js';
import { githubAvatarUrl } from '../api/github-client.js';

function error(message, code) { return Object.assign(new Error(message), { code }); }
function loginOf(value) { return validatePathSegment(value, 'user'); }

export class RepositoryInvitationService {
  constructor({ github, installationId }) {
    this.github = github;
    if (!Number.isSafeInteger(installationId) || installationId <= 0) throw error('This destination has no verified GitHub App installation.', 'invitation_unavailable');
    this.installationId = installationId;
  }

  async search(query) {
    if (typeof query !== 'string' || query.length < 2 || query.length > 39 || !/^[A-Za-z0-9-]+$/.test(query)) return [];
    const result = await this.github.request(`/search/users?q=${encodeURIComponent(`${query} in:login`)}&per_page=10`);
    if (!Array.isArray(result?.items) || result.items.length > 10) throw error('GitHub returned invalid user suggestions.', 'invalid_github_response');
    return Promise.all(result.items.map(async item => {
      if (!Number.isSafeInteger(item?.id) || item.id <= 0) throw error('GitHub returned invalid user suggestions.', 'invalid_github_response');
      let login;
      try { login = loginOf(item.login); }
      catch { throw error('GitHub returned invalid user suggestions.', 'invalid_github_response'); }
      const profile = await this.github.request(`/users/${encodeURIComponent(login)}`);
      if (profile?.id !== item.id || typeof profile.login !== 'string'
          || profile.login.toLowerCase() !== login.toLowerCase()) {
        throw error('GitHub returned an unverified user profile.', 'invalid_github_response');
      }
      return { id: item.id, login, name: typeof profile.name === 'string' ? profile.name.trim().slice(0, 120) || null : null,
        avatarUrl: githubAvatarUrl(profile.avatar_url, item.id) };
    }));
  }

  async assertAdminAccess() {
    const repo = await this.github.validateRepository();
    if (repo.id !== this.github.expectedRepositoryId) throw error('The configured repository identity changed. Check access before inviting.', 'repository_identity_changed');
    this.github.assertCanonicalCoordinates(repo);
    if (repo.permissions?.admin !== true) throw error('GitHub repository admin access is required to invite teammates.', 'repository_admin_required');
    let installation;
    for (let page = 1; page <= 20; page += 1) {
      const result = await this.github.request(`/user/installations?per_page=100&page=${page}`);
      if (!Array.isArray(result?.installations) || result.installations.length > 100) throw error('GitHub returned invalid App installations.', 'invalid_github_response');
      installation = result.installations.find(value => value.id === this.installationId);
      if (installation || result.installations.length < 100) break;
    }
    if (installation?.permissions?.administration !== 'write') {
      throw error('Clockoli needs GitHub App Administration: write for this installation before it can invite teammates. Review the App permissions on GitHub.', 'app_administration_required');
    }
  }

  async invite(login, userId) {
    const requested = loginOf(login);
    if (!Number.isSafeInteger(userId) || userId <= 0) throw error('Select a verified GitHub user before inviting.', 'invalid_invitee');
    await this.assertAdminAccess();
    const identity = await this.github.getUserIdentity(requested);
    if (identity.id !== userId) throw error('The selected GitHub user identity changed. Search again before inviting.', 'invitee_identity_changed');
    const base = `/repos/${encodeURIComponent(this.github.owner)}/${encodeURIComponent(this.github.repo)}`;
    const path = `${base}/collaborators/${encodeURIComponent(identity.login)}`;
    try {
      const membership = await this.github.request(`${path}/permission`);
      if (membership?.user?.id !== identity.id) throw error('GitHub returned an unverified collaborator.', 'invalid_github_response');
      if (['read', 'triage'].includes(membership.permission)) {
        return { status: 'read_only_access', login: identity.login };
      }
      if (['admin', 'maintain', 'write'].includes(membership.permission)) return { status: 'already_has_access', login: identity.login };
      if (membership.permission !== 'none') throw error('GitHub returned an unverified collaborator permission.', 'invalid_github_response');
    } catch (reason) { if (reason?.status !== 404) throw reason; }
    for (let page = 1; page <= 5; page += 1) {
      const invitations = await this.github.request(`${base}/invitations?per_page=100&page=${page}`);
      if (!Array.isArray(invitations) || invitations.length > 100) throw error('GitHub returned invalid invitations.', 'invalid_github_response');
      if (invitations.some(invitation => invitation?.invitee?.id === identity.id)) return { status: 'already_invited', login: identity.login };
      if (invitations.length < 100) break;
      if (page === 5) throw error('Too many pending invitations to verify this user safely. Check invitations on GitHub.', 'invitation_check_limit');
    }
    // Revalidate repository/admin rights at the mutation boundary, not merely at selection time.
    await this.assertAdminAccess();
    const result = await this.github.requestDetailed(path, { method: 'PUT', body: JSON.stringify({ permission: 'push' }) });
    if (result.status === 201 && result.body?.invitee?.id === identity.id) return { status: 'invited', login: identity.login };
    if (result.status === 204) return { status: 'already_has_access', login: identity.login };
    throw error('GitHub did not verify the repository invitation. Check repository invitations on GitHub before trying again.', 'invitation_unverified');
  }
}
