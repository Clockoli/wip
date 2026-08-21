// Public GitHub App configuration. The client ID and slug are not secrets.
// A release build must replace the empty values after the RepoClock GitHub App
// is registered with Device Flow and expiring user tokens enabled.
export const GITHUB_APP_CLIENT_ID = '';
export const GITHUB_APP_SLUG = '';

export function githubAppInstallationUrl() {
  return GITHUB_APP_SLUG ? `https://github.com/apps/${encodeURIComponent(GITHUB_APP_SLUG)}/installations/new` : '';
}

export const GITHUB_AUTHORIZATIONS_URL = 'https://github.com/settings/apps/authorizations';
export const GITHUB_NEW_REPOSITORY_URL = 'https://github.com/new';
