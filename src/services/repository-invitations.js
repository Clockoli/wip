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

  async search(query, { profiles = true } = {}) {
    if (typeof query !== 'string' || query.length < 2 || query.length > 39 || !/^[A-Za-z0-9-]+$/.test(query)) return [];
    const result = await this.github.request('/graphql', { method: 'POST', body: JSON.stringify({
      query: `query ${profiles ? 'InviteeUserSearch' : 'ClockifyUserSearch'}($query: String!) { search(query: $query, type: USER, first: 10) { nodes { __typename ... on User { databaseId login${profiles ? ' name avatarUrl' : ''} } } } }`,
      variables: { query: `${query} in:login` },
    }) });
    if (Array.isArray(result?.errors) && result.errors.length) throw error('GitHub user search failed. Try again later.', 'github_search_failed');
    const nodes = result?.data?.search?.nodes;
    if (!Array.isArray(nodes) || nodes.length > 10) throw error('GitHub returned invalid user suggestions.', 'invalid_github_response');
    return nodes.flatMap(node => {
      if (node?.__typename === 'Organization') return [];
      if (node?.__typename !== 'User' || !Number.isSafeInteger(node.databaseId) || node.databaseId <= 0) {
        throw error('GitHub returned invalid user suggestions.', 'invalid_github_response');
      }
      let login;
      try { login = loginOf(node.login); }
      catch { throw error('GitHub returned invalid user suggestions.', 'invalid_github_response'); }
      return [{ id: node.databaseId, login,
        name: profiles && typeof node.name === 'string' ? node.name.trim().slice(0, 120) || null : null,
        avatarUrl: profiles ? githubAvatarUrl(node.avatarUrl, node.databaseId) : null }];
    });
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

  async remove(login, userId, kind) {
    const requested = loginOf(login);
    if (!Number.isSafeInteger(userId) || userId <= 0 || !['collaborator', 'pending'].includes(kind)) {
      throw error('Select a verified collaborator or pending invitee.', 'invalid_invitee');
    }
    await this.assertAdminAccess();
    const identity = await this.github.getUserIdentity(requested);
    if (identity.id !== userId) throw error('The selected GitHub user identity changed. Refresh repository access.', 'invitee_identity_changed');
    const actor = await this.github.getAuthenticatedIdentity();
    if (actor.id === identity.id) throw error('You cannot remove your own repository access here.', 'self_removal_forbidden');
    const base = `/repos/${encodeURIComponent(this.github.owner)}/${encodeURIComponent(this.github.repo)}`;
    const collaboratorPath = `${base}/collaborators/${encodeURIComponent(identity.login)}`;
    let membership = null;
    try { membership = await this.github.request(`${collaboratorPath}/permission`); }
    catch (reason) { if (reason?.status !== 404) throw reason; }
    if (membership && (membership.user?.id !== identity.id || membership.user?.login?.toLowerCase() !== identity.login.toLowerCase())) {
      throw error('GitHub returned an unverified collaborator.', 'invalid_github_response');
    }
    let path;
    if (kind === 'collaborator') {
      if (!['read', 'triage', 'write', 'maintain', 'admin'].includes(membership?.permission)) {
        throw error('This account is no longer a verified collaborator. Refresh repository access.', 'access_changed');
      }
      path = collaboratorPath;
    } else {
      if (membership && membership.permission !== 'none') {
        throw error('This account already has collaborator access. Refresh repository access.', 'access_changed');
      }
      let invitationId;
      for (let page = 1; page <= 5; page += 1) {
        const invitations = await this.github.request(`${base}/invitations?per_page=100&page=${page}`);
        if (!Array.isArray(invitations) || invitations.length > 100) throw error('GitHub returned invalid invitations.', 'invalid_github_response');
        for (const invitation of invitations) {
          if (invitation?.invitee?.id !== identity.id) continue;
          if (invitation.invitee.login?.toLowerCase() !== identity.login.toLowerCase()
              || !Number.isSafeInteger(invitation.id) || invitation.id <= 0 || invitationId) {
            throw error('GitHub returned an unverified invitation.', 'invalid_github_response');
          }
          invitationId = invitation.id;
        }
        if (invitations.length < 100) break;
        if (page === 5) throw error('Too many invitations to verify safely. Manage access on GitHub.', 'invitation_check_limit');
      }
      if (!invitationId) throw error('The invitation is no longer pending. Refresh repository access.', 'access_changed');
      path = `${base}/invitations/${invitationId}`;
    }
    await this.assertAdminAccess();
    const result = await this.github.requestDetailed(path, { method: 'DELETE' });
    if (result.status !== 204) throw error('GitHub did not confirm access removal. Check access on GitHub before trying again.', 'removal_unverified');
    return { status: kind === 'pending' ? 'cancelled' : 'removed', login: identity.login };
  }
}
