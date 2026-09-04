# Contributing to Clockoli

Clockoli is a Chrome/Chromium Manifest V3 extension built with browser-native JavaScript modules. The extension has no runtime package dependencies. The framework-neutral timeline component, its build tooling, and its complete test harness live in this repository as an npm workspace. Node.js is used for tests and validation, and Python is used only to build deterministic release archives.

## Prerequisites

- Git
- Node.js 20.19 or newer; CI uses Node.js 22
- npm
- Python 3 for release packaging
- Chrome or another Chromium browser, version 102 or newer, for manual browser verification

## Set up a development checkout

```bash
git clone https://github.com/Clockoli/clockoli.git
cd clockoli
npm ci
npm test
npm run check
```

Chrome loads checked-in extension files directly. When changing the timeline source under `packages/elastic-timeline-editor/`, regenerate its content-script IIFE and CSS with `npm run build:timeline` before testing or loading the extension.

To load the extension:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose the repository root containing `manifest.json`.
5. Reload the extension from `chrome://extensions` after changing the manifest, service worker, permissions, or assets.
6. Reload open GitHub tabs after changing the content script or its styles.

Use a private test repository and test credentials. Never commit tokens, repository data, exported settings, or browser profiles.

## Repository map

| Path | Responsibility |
|---|---|
| `manifest.json` | Manifest V3 entry points, permissions, and packaged assets |
| `src/content/github.js` | GitHub-page UI; handles only page-safe task data |
| `src/background/service-worker.js` | Credentials, GitHub API calls, durable state, synchronization, mutations, and toolbar state |
| `src/background/message-policy.js` | Trust boundary for runtime messages and sender validation |
| `src/api/github-client.js` | GitHub reads and SHA-guarded writes, deletes, and atomic commits |
| `src/domain/` | Canonical values, work records, paths, validation, and projections |
| `src/services/` | Tracking, onboarding, reports, metadata, recovery, and exchange-rate workflows |
| `src/storage/chrome-store.js` | Extension-origin IndexedDB state and migrations |
| `src/popup/`, `src/options/`, `src/reports/`, `src/tasks/`, `src/times/` | Extension pages and their presentation logic |
| `packages/elastic-timeline-editor/` | Timeline source, public types, demo, unit tests, Chromium E2E tests, package smoke test, and content-script build |
| `test/` | Node test suite, behavioral contracts, security checks, and release checks |
| `scripts/` | Extension validation and deterministic release packaging |
| `docs/` | User documentation and normative data-format documentation |

Read `docs/spec-compliance.md` before changing architecture or behavior. Read `docs/data-format-v1.md` before touching persisted records, paths, serialization, or migrations.

## Core invariants

### Security and privacy

- Credentials and billing settings stay in extension-controlled contexts. They must never enter the content-script source, DOM, page payloads, logs, commits, or release files.
- The content script sends only validated, page-safe work-item data.
- Every new runtime message must be classified in `src/background/message-policy.js`. Privileged messages must remain extension-only. Content-origin messages must validate the sender and must not let a page select another task URL or tab.
- Toolbar mutations are tab-scoped. Derive the tab from the validated `sender`; do not accept a caller-provided tab ID from a content script.
- Keep permissions and host access minimal. `npm run validate:extension` rejects unexpected permissions and unsafe browser code.
- Do not add remote scripts, inline scripts, `eval`, `new Function`, or unsafe HTML assignment.

### Manifest V3 lifecycle

- Treat the service worker as disposable. Do not rely on module globals for durable truth.
- Persist accepted mutations before starting remote reconciliation.
- Restore state from `ChromeStore` after worker suspension or restart.
- Make alarms, message handlers, retries, Stop, and reconciliation idempotent.
- Keep asynchronous work attached to an awaited message response or another MV3-supported lifecycle mechanism.

### Work records and concurrency

- Persistent records use only `schema_version: 1` and the canonical codec in `src/domain/work-records.js`.
- Preserve stable ULIDs and unknown fields during supported read-modify-write operations.
- Validate complete JSON/JSONL files; do not silently skip malformed records.
- Preserve local-date, timezone, monthly partition, actor, producer, metadata, and metrics semantics.
- Use blob SHAs for rewrites and stable record IDs for lookup. Preflight linked or cross-month mutations and publish them atomically.
- Preserve FIFO, operation-ID-aware pending mutations. A stale Stop must not clear or resurrect a newer timer.

### UI behavior

- GitHub is a single-page application. Features must survive history navigation, remount after DOM replacement, and clean up observers, timers, animation, and stale state.
- Tracking state is task-URL-specific. A timer for one task must not make another task appear active.
- Keep the content UI usable in its closed Shadow DOM and do not expose secret state through it.
- Keep success messages outcome-led. Put actionable failures next to the control that caused them.

## Make a change

1. Start from an up-to-date branch.
2. Locate the existing owner of the behavior; avoid parallel implementations and broad refactors.
3. Add or update a focused test that fails for the missing behavior.
4. Make the smallest change that satisfies the contract.
5. Run the focused test while iterating:

```bash
node --test test/<relevant-file>.test.js
```

6. Run the complete required checks:

```bash
npm test
npm run check
git diff --check
```

`npm test` runs both Clockoli's Node suite and the complete internal timeline suite, including Chromium E2E and package-consumer smoke coverage. `npm run check` runs extension validation and release-inventory validation. Do not replace either command with a narrower check.

## Browser verification

Automated Node tests do not replace browser verification for content scripts, service-worker lifecycle, runtime messaging, permissions, IndexedDB behavior, or toolbar icons.

For browser-affecting changes:

1. Load a clean unpacked extension profile.
2. Exercise the real UI on canonical GitHub issue and pull-request URLs.
3. Verify the changed state and the cleanup path: navigation, Stop, tab visibility, extension reload, and service-worker restart where relevant.
4. Inspect `chrome://extensions` for service-worker errors and the GitHub tab console for content-script errors.
5. Confirm that no credential or private state is visible in the page DOM or page console.

A canonical GitHub work-item URL has the form:

```text
https://github.com/{owner}/{repo}/issues/{number}
https://github.com/{owner}/{repo}/pull/{number}
```

When behavior depends on the current task, explicitly verify both a matching URL and a non-matching URL.

## Documentation

Update documentation in the same change when behavior, setup, privacy, storage, or troubleshooting changes. Keep these sources aligned:

- `README.md` for the product overview;
- `docs/getting-started.md` for user setup;
- `docs/features.md` for behavior;
- `docs/data-and-privacy.md` for data flows and disclosure;
- `docs/troubleshooting.md` for recovery steps;
- `docs/data-format-v1.md` for the normative persistent format.

Use the Clockoli name only. Do not introduce legacy product names or unsupported compatibility promises.

## Build a release archive

Version values in `package.json` and `manifest.json` must match. If examples expose the producer version, update the applicable documentation examples too.

Run all checks, then build the deterministic archive outside the repository:

```bash
npm test
npm run check
python3 scripts/build-release.py /tmp/Clockoli-<version>.zip
```

The packaging script:

- derives the inventory from manifest and local runtime references;
- excludes tests, docs, scripts, source maps, logs, and temporary files;
- scans runtime files for common secret patterns;
- writes stable timestamps and permissions;
- reads the archive back and verifies every entry;
- prints the path, file count, byte size, and SHA-256 digest.

Before publishing, inspect the archive inventory and load the unpacked release contents in a clean browser profile. Do not publish an archive built from an uncommitted or unverified tree.

## Pull requests

A pull request should contain:

- a concise description of the user-visible change and why it is needed;
- the important invariants or risks affected;
- tests added or changed;
- exact commands run and their results;
- browser evidence for browser-affecting changes;
- screenshots only when they clarify a visual change;
- no unrelated formatting or refactoring.

CI runs `npm test` and `npm run check` on Node.js 22. A change is not complete until local checks and CI pass.
