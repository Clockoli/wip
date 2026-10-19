# Contributing to Clockoli

Clockoli is a Chrome/Chromium Manifest V3 extension built with browser-native JavaScript modules. The extension has no runtime package dependencies. The framework-neutral timeline component, its build tooling, and its complete test harness live in this repository as an npm workspace. Node.js is used for tests and validation, and Python builds release archives and orchestrates the macOS Safari build.

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

To measure coverage for the extension source, run `npm run test:coverage`. The
generated timeline bundle is excluded because it is built and verified by the
timeline workspace checks.

Chrome loads checked-in extension files directly. When changing the timeline source or adapter under `packages/task-timeline-component/`, regenerate `src/content/task-timeline-component.js` with `npm run build:timeline` before testing or loading the extension.

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
| `src/auth/` | GitHub App Device Flow and credential rotation |
| `src/domain/` | Canonical values, work records, paths, validation, and projections |
| `src/services/` | Tracking, onboarding, reports, metadata, recovery, and exchange-rate workflows |
| `src/storage/chrome-store.js` | Extension-origin IndexedDB state and migrations |
| `src/popup/`, `src/options/`, `src/reports/`, `src/tasks/`, `src/times/` | Extension pages and their presentation logic |
| `packages/task-timeline-component/` | Clockoli-owned TaskTimeline, Clockoli adapter, unit tests, Chromium E2E tests, package smoke test, and content-script build |
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

## Contributions and licensing

Clockoli-owned source is licensed under GPL-3.0-only; third-party files retain
their own notices. See [LICENSE](LICENSE), [third-party notices](THIRD_PARTY_NOTICES.md),
and [licensing information](docs/licensing.md).

The copyright holder for Clockoli-owned source is **Manticore Software LTD**.
See [COPYRIGHT](COPYRIGHT).

Before merging code **authored by outside contributors**, maintainers must obtain
an explicit written contributor agreement granting Manticore Software LTD sufficient
rights to use the contribution under GPLv3 and alternative licenses (including
commercial licensing). This is necessary to preserve future relicensing options.
A pull request by itself does not transfer copyright or give these additional
rights. Contributors can retain their copyright under the agreement. Contact
the maintainers before starting a substantial external contribution.

Do not strip or replace third-party copyright and license notices; do not add
new bundled dependencies without checking their license terms and Corresponding
Source obligations.

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

`npm test` runs both Clockoli's Node suite and the complete internal timeline suite, including Chromium E2E and package-consumer smoke coverage. `npm run check` runs extension validation and release-inventory validation. Do not replace either command with a narrower check. When a coverage report is required, run `npm run test:coverage`; it reports the extension source under `src/` and excludes the generated timeline bundle.

Run `npm run test:options:functional` for the Settings repository-disclosure, access-menu, and device-code handoff Chromium checks. These load a temporary extension with synthetic responses and perform no GitHub access mutations. CI runs them under Xvfb.

Run `npm run test:activity:functional` for the Activity List, Add time, and weekly Timeline/Calendar browser checks on the Activity page and GitHub panel. These use a temporary extension with synthetic responses and run headless locally; CI runs them under Xvfb.

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

## Build release packages

Version values in `package.json` and `manifest.json` must match. `manifest.json` remains the Chrome development manifest. `scripts/target-manifest.js` derives Firefox and Safari manifests without changing it; validation and inventory traversal use those generated manifests. Chrome archive bytes retain the original packaging format.

Run all checks, then build outside the repository:

```bash
npm ci
npm run build:timeline
npm test
npm run check
npm run lint:firefox
python3 scripts/build-release.py /tmp/Clockoli-<version>.zip
python3 scripts/build-release.py --target firefox /tmp/Clockoli-<version>-firefox.xpi
python3 scripts/build-release.py --target safari /tmp/Clockoli-<version>-safari-extension.zip
```

`--target chrome` is optional. `--unpacked OUTPUT_DIRECTORY` writes a new directory for temporary browser loading or native Safari conversion. The packager validates the target, derives a sorted runtime-only inventory, scans for secrets, fixes ZIP timestamps and permissions, and verifies all bytes after writing. Tests, docs, scripts and source maps stay out of browser packages. The separate Corresponding Source ZIP is built only from a **clean checkout**
of the requested tag, with a reviewed path allowlist that excludes internal
planning documents and scans included source for potential secrets.

For distributable Chrome/Firefox packages and native Safari apps, pass
`--release-ref X.Y.Z`. This requires a clean working tree at the exact tagged
commit, so binary packages match the published source archive. Local development
builds can omit this flag.

To regenerate and check the pinned html2pdf npm notices before a release:

```sh
python3 scripts/package-source.py HEAD /tmp/clockoli-source.zip
python3 scripts/generate-pdf-notices.py /tmp/clockoli-source.zip --check
python3 scripts/verify-pdf-rebuild.py /tmp/clockoli-source.zip
python3 scripts/test-safari-licenses.py
```

For Firefox signing, a dirty checkout is rejected. Never submit a source ZIP
whose commit differs from the packaged extension.

Firefox uses module background scripts instead of a service worker. Its floor is 140 because built-in data consent is required; MAIN-world content scripts and optional host permissions alone require 128. Firefox and Safari omit Chrome's `favicon` permission and virtual `_favicon/*` resource. See [browser compatibility and verification](docs/browser-releases.md) for source links and limitations.

### Signed Firefox files

With `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` in the environment:

```bash
npm run sign:firefox -- /tmp/clockoli-signed
```

The script builds the Firefox extension, creates a matching Corresponding Source ZIP with `scripts/package-source.py HEAD`, verifies pinned notices and a byte-identical PDF rebuild, and then submits to AMO's **unlisted** channel; it requires a signed XPI result. Run from the verified release tag with no local changes. Listed AMO submissions remain manual. Version numbers are unique across listed and unlisted channels: after listing the add-on, remove both signing secrets and distribute the AMO-signed listed XPI instead.

### Safari apps

On macOS with Xcode and its command-line tools selected, install the existing Playwright Chromium runtime for icon rasterization:

```bash
npx playwright install chromium
python3 scripts/build-safari.py --build-number 1 /tmp/clockoli-safari
```

The converter creates a macOS-only Swift application with copied extension resources, app name Clockoli, and bundle ID `com.clockoli.Clockoli`. The script derives a full 16–1024px app icon set from tracked `src/assets/clockoli.svg`; it does not use `store-assets/`. Release builds include both arm64 and x86_64. Manifest version becomes the marketing version, and `--build-number` sets both app and extension build versions.

Without Apple signing variables, this creates `Clockoli-X.Y.Z-safari-unsigned.zip`, ad-hoc signed for **Allow Unsigned Extensions**. To also sign with Developer ID, notarize and staple `Clockoli-X.Y.Z-safari.zip`, provide all six variables: `APPLE_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`, `APPLE_CERTIFICATES_P12_BASE64`, and `APPLE_CERTIFICATES_PASSWORD`. Signed builds require `--release-ref X.Y.Z` from a clean tagged checkout. Partial signing configuration fails. Signing material and the temporary keychain are cleaned up. Notarization submits the Developer ID app to Apple's notarization service. Signed builds also export `Clockoli-X.Y.Z-safari.pkg` for optional manual submission through Transporter. No build is automatically uploaded or submitted to App Store Connect.

Only the extension ZIP/XPI files are byte-reproducible. Native builds, signing and notarization introduce toolchain and signing data; app ZIP entry order, timestamps, modes and symlinks are preserved and verified.

### Release from a tag

Tags are `X.Y.Z` with no `v` prefix. Before tagging, update the version and matching `CHANGELOG.md` section, run checks and browser verification, and merge to `main`.

`.github/workflows/release.yml`:

- checks that tag and manifest version match, runs tests, validation and Firefox lint on Ubuntu;
- builds Chrome ZIP, Firefox XPI and Safari web-extension ZIP for temporary loading, plus a curated `Clockoli-X.Y.Z-source.zip` with matching source and pinned PDF dependencies;
- signs Firefox only when AMO signing secrets are configured; partial credentials fail;
- builds Safari from the same clean tagged ref with `github.run_number` as the build number, always producing the unsigned app and adding signed artifacts when all Apple secrets exist;
- rebuilds html2pdf.js from the tagged source ZIP and verifies the exact distributed PDF code and upstream notices;
- collects all files into the `release-zip` Actions artifact, verifies the final packages and release notes, and publishes with an in-repository release job.

Preview a complete release before merging by updating `.github/workflows/release.yml`
(the PR automatically runs a safe read-only preview), or dispatch manually from
a branch:

```sh
gh workflow run release.yml --ref YOUR_BRANCH -f dry_run=true
```

The preview creates and validates Chrome, Firefox, unsigned Safari, and
Corresponding Source archives; it also verifies the final `release-zip` and
release notes. It does not create a GitHub Release or contact the browser
stores. To test signed Safari and `.pkg` export, add `-f sign_safari=true` with
Apple signing secrets configured. This optional test contacts Apple's
notarization service, but does not submit to the Mac App Store.

For an actual manual release, use `dry_run=false` and `tag=X.Y.Z` pointing to
an existing version-matching tag; pushing a matching tag still releases
normally. Publishing from a private repository is supported, but for public
store distribution the matching source ZIP must be accessible to recipients.

Store uploads are manual. Before publishing, inspect archive inventories and exercise the packaged extension in each browser, including background restart, message rejection, Settings, GitHub and arbitrary-task tracking, optional Clockify access, and favicon behavior. Inspect the page and background consoles. Successful packaging or lint does not prove browser or store acceptance.

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
