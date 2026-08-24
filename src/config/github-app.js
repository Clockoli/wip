// Public GitHub App configuration. The client ID and slug are not secrets.
// Never add a client secret, private key, or installation token here.
export const GITHUB_APP_CLIENT_ID = 'Iv23likdAVTSplt9U2oW';
export const GITHUB_APP_SLUG = 'repoclock';

export function githubAppInstallationUrl() {
  return GITHUB_APP_SLUG ? `https://github.com/apps/${encodeURIComponent(GITHUB_APP_SLUG)}/installations/new` : '';
}

export const GITHUB_AUTHORIZATIONS_URL = 'https://github.com/settings/apps/authorizations';
export const GITHUB_NEW_REPOSITORY_URL = 'https://github.com/new?owner=%40me&name=clockoli-data&description=Private%20Clockoli%20time%20data&visibility=private&template_owner=repoclock&template_name=data-template';
