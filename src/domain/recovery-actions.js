(() => {
  const kinds = Object.freeze({
    connect: new Set(['authentication', 'auth_required', 'auth_expired', 'github_app_auth_required', 'authentication_failed', 'invalid_device_flow']),
    grant: new Set(['app_installation_required', 'org_approval_required', 'permission', 'app_contents_write_required']),
    choose: new Set([
      'repository_access_required', 'branch_policy_rejected', 'empty_repository', 'custom_branch_unverified',
      'repository_identity_unverified', 'repository_identity_changed', 'repository_coordinates_changed',
      'repository_branch_changed', 'repository_unavailable', 'private_required', 'user_write_required',
    ]),
    repair: new Set([
      'incompatible_storage_format', 'storage_login_conflict', 'storage_layout_budget',
      'migration_identity_mismatch', 'migration_identity_unverified',
    ]),
  });
  const labels = Object.freeze({
    connect: 'Connect GitHub',
    grant: 'Grant access',
    choose: 'Choose another repository',
    repair: 'Repair storage',
    retry: 'Retry',
  });

  function actionFor(value) {
    const code = String(value || '');
    if (!code) return null;
    const kind = Object.keys(kinds).find(name => kinds[name].has(code)) || 'retry';
    return Object.freeze({ kind, label: labels[kind] });
  }

  function describeConnectionError(error) {
    const code = error?.code || 'error';
    let headline = "Couldn't reach GitHub";
    if (kinds.connect.has(code) || kinds.grant.has(code)) headline = 'GitHub access was revoked';
    else if (['not_found', 'private_required', 'repository_access_required'].includes(code)) headline = 'Repository not found or not private';
    else if (code === 'rate_limit') {
      headline = 'GitHub rate limit reached';
      const retryAt = error?.retryAt ? new Date(error.retryAt) : null;
      if (retryAt && Number.isFinite(retryAt.getTime())) {
        headline += ` — retry after ${retryAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}`;
      }
    } else if (code === 'conflict') headline = 'Your changes need review before saving';
    else if (kinds.choose.has(code)) headline = 'GitHub repository needs attention';
    else if (kinds.repair.has(code)) headline = 'Time storage needs repair';
    else if (code === 'validation') headline = "GitHub couldn't save these changes";
    return {
      headline, detail: error?.message || '',
      action: code === 'not_found' ? 'choose' : actionFor(code).kind,
      recovery: error?.recovery === 'mutation-recovery' ? 'mutation-recovery' : 'read-retry',
    };
  }

  function describeSaveStatus(state) {
    const writes = state?.pendingWrites ?? [];
    const pending = Math.max(writes.length, Number(state?.pendingCount) || 0);
    if (writes.some(write => write.status === 'conflict')) {
      return { label: 'Your changes need review before saving', pending, conflict: true, recovery: 'mutation-recovery' };
    }
    if (state?.error) {
      const { headline, ...detail } = describeConnectionError({ ...state.error, message: state.error.message, recovery: 'mutation-recovery' });
      return { label: headline, ...detail };
    }
    if (state?.saving) return { label: 'Saving on this device' };
    if (pending) return { label: 'Saved on this device · waiting for GitHub', pending };
    if (state?.remoteWriteConfirmed === true) return { label: 'Saved to GitHub' };
    return { label: 'Save to GitHub not confirmed', code: 'unconfirmed' };
  }

  globalThis.ClockoliRecovery = Object.freeze({ actionFor, describeSaveStatus, describeConnectionError });
})();
