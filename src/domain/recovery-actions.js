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

  globalThis.ClockoliRecovery = Object.freeze({ actionFor });
})();
