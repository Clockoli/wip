const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

/** Invitation actions are separate from the completed migration and never run during import. */
export function renderMigrationInvitations({ container, outcome, send, confirm, collaboratorIds = new Set() }) {
  container.replaceChildren();
  if (!outcome || typeof outcome.id !== 'string' || !/^github:[1-9]\d*$/.test(outcome.destinationId || '')
      || !Array.isArray(outcome.outcomes)) return;
  const candidates = outcome.outcomes.filter(item => ['imported', 'already_present'].includes(item?.status)
    && Number.isSafeInteger(item?.githubUser?.id) && item.githubUser.id > 0
    && LOGIN_RE.test(item.githubUser.login) && typeof item.sourceUserId === 'string'
    && !collaboratorIds.has(item.githubUser.id));
  if (!candidates.length) return;
  const heading = document.createElement('h3'); heading.textContent = 'Invite imported people?';
  const explanation = document.createElement('p');
  explanation.textContent = 'Optional: invite these GitHub accounts to your default time repository. No invitation is sent unless you choose one below. Clockoli checks existing access and pending invitations first.';
  container.append(heading, explanation);
  for (const candidate of candidates) {
    const row = document.createElement('div'); row.className = 'migration-invitation';
    const label = document.createElement('span'); label.textContent = `@${candidate.githubUser.login}`;
    const invite = document.createElement('button'); invite.type = 'button'; invite.textContent = 'Check access and invite';
    const skip = document.createElement('button'); skip.type = 'button'; skip.className = 'secondary'; skip.textContent = 'Not now';
    const feedback = document.createElement('span'); feedback.setAttribute('role', 'status');
    skip.addEventListener('click', () => row.remove());
    invite.addEventListener('click', async () => {
      if (invite.disabled || !confirm(`If @${candidate.githubUser.login} does not already have access, send them a write invitation to the default time repository?`)) return;
      invite.disabled = true; skip.disabled = true; feedback.textContent = 'Checking repository access…';
      try {
        const result = await send({ type: 'INVITE_MIGRATED_USER', payload: { id: outcome.id, sourceUserId: candidate.sourceUserId } });
        feedback.textContent = result.status === 'invited' ? `Invitation sent to @${result.login}. They must accept it on GitHub.`
          : result.status === 'already_invited' ? `@${result.login} already has a pending invitation.`
          : result.status === 'read_only_access' ? `@${result.login} has read-only access. Grant write access on GitHub.`
          : `@${result.login} already has repository access.`;
        if (['invited', 'already_invited', 'already_has_access', 'read_only_access'].includes(result.status)) {
          invite.remove(); skip.remove();
        }
      } catch (error) {
        feedback.textContent = error.message || 'Could not check repository access. Try again later.';
        invite.disabled = false; skip.disabled = false;
      }
    });
    row.append(label, invite, skip, feedback); container.append(row);
  }
}
