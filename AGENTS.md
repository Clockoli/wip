# AGENTS.md

This file applies to the entire Clockoli repository.

## Start here

Before changing code:

1. Read `CONTRIBUTING.md`.
2. Read `docs/spec-compliance.md` for product invariants and acceptance coverage.
3. Read `docs/data-format-v1.md` and `docs/time-data-repository.md` before changing persisted data or repository operations.
4. Inspect the relevant implementation and tests. Source code and executable tests are authoritative when documentation is stale.
5. Check `package.json`, `.github/workflows/ci.yml`, and the scripts under `scripts/` rather than inventing commands.

Clockoli is the first product version. Do not add legacy compatibility, migration code, aliases, or `repoclock` branding unless the task explicitly requires them.

## Architecture boundaries

Clockoli is a Chrome/Chromium Manifest V3 extension written as browser-native JavaScript modules.

- `src/background/service-worker.js` is the privileged runtime and owns GitHub access, persistence, synchronization, and other operations requiring extension privileges.
- `src/background/message-policy.js` defines the accepted runtime-message boundary. New messages must have an explicit allowlist entry and validate sender, payload, and task identity before privileged work begins.
- Content scripts are untrusted presentation adapters. They may render controls and send narrowly scoped requests, but must not receive credentials or unrestricted privileged state.
- Browser UI code must tolerate service-worker suspension and restart. Do not rely on in-memory background state surviving between messages.
- Storage access belongs behind the existing storage abstractions. Preserve the separation between local extension state and Git-backed time records.
- Keep domain validation and normalization centralized. Reuse existing value objects and services instead of duplicating parsing rules in UI code.

## Security rules

These rules are mandatory:

- Credentials, API keys, tokens, passwords, and connection strings must remain in `chrome.storage.local` and privileged background code.
- Never place credentials in the DOM, content-script payloads, URLs, logs, fixtures, screenshots, generated artifacts, documentation, or Git history.
- If a secret is encountered, do not reproduce it. Replace its value with `[REDACTED]` in any report or example.
- Never weaken sender validation, message allowlists, host checks, URL validation, or GitHub repository-coordinate checks to make a test pass.
- Treat all page-derived values and runtime-message payloads as untrusted input.
- Request no additional extension permission or host permission without demonstrating why the existing permissions are insufficient.

## Task identity and behavior

- Preserve canonical task URL normalization. GitHub issue and pull-request URLs must normalize to their canonical forms; arbitrary supported HTTP(S) task URLs retain their validated URL identity.
- A task URL is the identity. Titles and descriptions are metadata, not identifiers.
- Preserve the one-running-timer invariant and conflict-safe writes.
- Tracking mutations must preserve panel scroll position.
- Starting a task from the Top tasks surface must stop the active timer before starting the selected task.
- On GitHub, animate the stopwatch only when the active timer belongs to the canonical task currently open in the tab.
- Preserve optimistic-concurrency behavior and atomic updates when one edit repairs adjacent interval boundaries.
- Do not silently discard pending writes, conflict information, or data that remains recoverable from Git history.

## Change discipline

- Keep diffs minimal and scoped to the requested behavior.
- Reuse existing modules, services, components, CSS conventions, and test helpers before introducing new abstractions.
- Do not perform unrelated cleanup, renaming, formatting, dependency changes, version bumps, or release work.
- Do not edit generated release artifacts.
- Update user or maintainer documentation when behavior, setup, storage, security boundaries, or release procedures change.
- Do not claim browser, GitHub, synchronization, or release behavior was verified unless that exact path was exercised.

## Testing workflow

For behavior changes, use RED → GREEN → REFACTOR:

1. Add or identify a focused test that fails for the expected reason.
2. Run it and record the RED result.
3. Implement the smallest correct change.
4. Run the focused test until GREEN.
5. Run the broader relevant suite.
6. Refactor only while tests remain green.

Tests must cover the contract, not merely implementation details. Include security rejection paths, service-worker restart behavior, concurrency/conflict handling, and failure ordering when relevant.

## Required verification

Use the commands defined by the current `package.json`. At minimum, before declaring a change complete:

```bash
npm test
npm run check
git diff --check
git status --short
```

Also perform the relevant browser verification for UI, content-script, service-worker, permissions, storage, or cross-context messaging changes. Reload the unpacked extension after source changes and inspect both the page UI and extension service-worker console for errors.

For release-related work, use the existing release scripts and inventory checks under `scripts/`. Inspect the produced archive and verify that it contains only the intended extension files. Do not infer release success from a unit-test run.

## Completion report

Report:

- files changed;
- behavior or documentation added;
- exact commands executed and their observed results;
- browser or release checks actually performed;
- any checks not run and why;
- remaining risks or follow-up work.

Do not call work complete while required checks are failing or while unreviewed/unexpected files remain in `git status`.
