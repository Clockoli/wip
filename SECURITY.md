# Security policy

## Supported versions

Security fixes go into the latest release. Update to the newest version from the Chrome Web Store or the [GitHub releases](https://github.com/clockoli/clockoli/releases) before you report an issue.

## Reporting a vulnerability

Do not report security vulnerabilities in public GitHub issues.

Email [contact@clockoli.com](mailto:contact@clockoli.com) with:

- a description of the issue and its impact;
- the steps to reproduce it;
- the Clockoli version and the browser and version you used.

Never include real GitHub tokens, credentials or private time-repository contents in a report. Replace them with `[REDACTED]`.

## Scope

In scope:

- the Clockoli browser extension in this repository, for every supported browser;
- how it stores and handles GitHub credentials;
- the boundary between content scripts and the privileged background service worker;
- how it reads and writes time repositories.

Out of scope:

- GitHub itself, including GitHub Apps, device-flow sign-in and repository permissions;
- the Frankfurter exchange-rate service;
- third-party sites you track.

[Data, privacy, and security](docs/data-and-privacy.md) describes the storage model and security boundaries.
