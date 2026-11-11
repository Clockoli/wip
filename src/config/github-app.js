// Public GitHub App configuration. The client ID and slug are not secrets.
// Never add a client secret, private key, or installation token here.
export const GITHUB_APP_CLIENT_ID = 'Iv23likdAVTSplt9U2oW';
export const GITHUB_APP_SLUG = 'clockoli';

export function githubAppInstallationUrl() {
  return GITHUB_APP_SLUG ? `https://github.com/apps/${encodeURIComponent(GITHUB_APP_SLUG)}/installations/new` : '';
}

export const GITHUB_AUTHORIZATIONS_URL = 'https://github.com/settings/apps/authorizations';

export function githubNewRepositoryUrl(owner) {
  const url = new URL('https://github.com/new');
  if (owner) url.searchParams.set('owner', owner);
  url.searchParams.set('name', 'clockoli-data');
  url.searchParams.set('description', 'Private Clockoli time data');
  url.searchParams.set('visibility', 'private');
  url.searchParams.set('template_owner', 'Clockoli');
  url.searchParams.set('template_name', 'data-template');
  return url.href;
}

export const GITHUB_NEW_REPOSITORY_URL = githubNewRepositoryUrl('@me');
export const GITHUB_NEW_ORGANIZATION_REPOSITORY_URL = githubNewRepositoryUrl();
