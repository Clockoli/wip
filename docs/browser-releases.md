# Browser release contracts

`manifest.json` is the Chrome development source. `scripts/target-manifest.js` generates the other manifests; the source tree and extension permissions do not branch at runtime for packaging.

## Verified compatibility sources

Checked against Mozilla's Browser Compatibility Data and vendor documentation on 2026-10-12. These are documented API support claims, not evidence of successful Clockoli browser execution.

| Feature | Firefox | Safari | Source |
|---|---|---|---|
| MV3 background | Module `background.scripts`, modules since 112; no extension service workers | `background.service_worker` since 15.4; `type: module` since 16.4 | [background compatibility](https://github.com/mdn/browser-compat-data/blob/main/webextensions/manifest/background.json) |
| Static content-script `world: MAIN` | 128 | 18 | [content script compatibility](https://github.com/mdn/browser-compat-data/blob/main/webextensions/manifest/content_scripts.json) |
| `optional_host_permissions` | 128 | 15.5 | [optional host compatibility](https://github.com/mdn/browser-compat-data/blob/main/webextensions/manifest/optional_host_permissions.json) |
| `alarms` | 45 | 14 | [alarms compatibility](https://github.com/mdn/browser-compat-data/blob/main/webextensions/api/alarms.json) |
| `scripting` / `executeScript` | 102 | 15.4 | [scripting compatibility](https://github.com/mdn/browser-compat-data/blob/main/webextensions/api/scripting.json) |
| `activeTab` | 48 | 14 | [permission compatibility](https://github.com/mdn/browser-compat-data/blob/main/webextensions/manifest/permissions.json) |
| Built-in data consent | Desktop 140; Android 142 | Not applicable | [Mozilla consent guidance](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/) |

The generated desktop Firefox floor is **140.0**, because the extension relies on built-in consent instead of adding a custom consent UI for earlier browsers. Safari's floor is **18.0**. Android is not a release target; Firefox lint may report its separate consent floor.

The Firefox declaration uses `authenticationInfo`, `personallyIdentifyingInfo`, `browsingActivity`, and `websiteContent`, using conservative disclosure categories for extension data. These describe GitHub authentication, identities, selected tracked URLs/titles/times, and imported Clockify content. Rates and invoices stay local; there is no analytics declaration. See [Mozilla's exact manifest keys](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings).

The background audit found no `self.registration`, `clients`, `skipWaiting`, `importScripts`, service-worker install/activate listeners, or `ServiceWorkerGlobalScope` dependencies under `src/background/`. Background module imports, IndexedDB persistence, and WebExtension event registration can therefore retain the same source. This audit does not establish end-to-end Firefox or Safari runtime correctness.

Chrome's original manifest and ZIP format are preserved. Its existing `minimum_chrome_version: 102` predates static MAIN-world support (111 in the linked compatibility data); this release work does not change that existing Chrome contract.

## Distribution licensing

Clockoli-owned code is under GPL-3.0-only. Packaging and GitHub Releases work
in private repositories, but private release assets are accessible only to
those with access. When distributing through public browser stores, provide a
matching publicly accessible `Clockoli-X.Y.Z-source.zip` and the required
license notices.

With Apple signing configured, Safari builds produce both a notarized
Developer ID app ZIP and a signed `.pkg` for optional **manual** submission to
Mac App Store Connect. Building or attaching the `.pkg` to a GitHub Release does
not submit anything to Apple's store. Before actually submitting, check the
App Store distribution terms against GPLv3 and obtain any necessary permissions.
The native `.app` and `.appex` are checked for matching legal files.

## Artifacts and verification

| File | Purpose |
|---|---|
| `Clockoli-X.Y.Z.zip` | Chrome Web Store upload; extract for Load unpacked |
| `Clockoli-X.Y.Z-firefox.xpi` | AMO upload or Firefox temporary loading |
| `Clockoli-X.Y.Z-firefox-signed.xpi` | Optional unlisted AMO-signed file installation |
| `Clockoli-X.Y.Z-source.zip` | Matching Corresponding Source (public download required for release; also used for AMO review) |
| `Clockoli-X.Y.Z-safari-extension.zip` | Safari extension sources for **Add Temporary Extension…** |
| `Clockoli-X.Y.Z-safari-unsigned.zip` | Ad-hoc signed macOS app for Allow Unsigned Extensions |
| `Clockoli-X.Y.Z-safari.zip` | Optional Developer ID app, notarized and stapled |
| `Clockoli-X.Y.Z-safari.pkg` | Optional signed package for manual submission via Transporter / App Store Connect |

Publishable Chrome, Firefox, and Safari packages use `--release-ref X.Y.Z` to
require a clean Git checkout at the exact release commit. Development builds
can omit this flag. The source ZIP is assembled from the same tagged commit.

Extension archives use sorted inventories, fixed timestamps, and byte verification. Safari app archives additionally preserve executable modes and symlinks, including bundle framework links. Native executable/signature bytes depend on Xcode and signing services and are not promised reproducible. No generated files belong in the repository.

Safari app icons are rasterized from tracked `src/assets/clockoli.svg` using the existing Playwright dependency. The complete macOS app icon catalog includes 512pt @2x (1024px), without scaling up the 128px extension PNG. Apple recommends 512px and 1024px icons in its [Safari extension guidance](https://developer.apple.com/videos/play/wwdc2020/10665/). A complete catalog still requires Xcode asset compilation and App Store validation; image generation alone does not prove acceptance.

For release review, run the commands in CONTRIBUTING.md and inspect each archive with `unzip -l`. Load the resulting packages in clean profiles, inspect page and background consoles, and exercise Settings, timer start/switch/stop, arbitrary URLs, GitHub canonical tasks, optional Clockify permission, background restart and pending-write recovery. Never substitute lint results for those browser checks.

The release workflow supports `dry_run=true` on a selected branch and runs a
read-only preview automatically for PRs modifying the release workflow. It
builds Chrome, Firefox, Safari and matching source archives, verifies the
collected `release-zip` assets and extracts notes from `CHANGELOG.md`, without
creating a GitHub Release or submitting to any browser store. Firefox signing
is disabled for previews, and Apple signing/notarization is disabled unless
explicitly requested with `sign_safari=true` and valid Apple credentials.

Tagged pushes and manual dispatches with `dry_run=false` publish releases.
The local release job validates assets, creates a draft, uploads files, and
publishes; existing release assets are replaced with `--clobber`. None of
these steps automatically submits packages to browser stores.

The PDF bundle is also rebuilt in CI and tagged release jobs from the exact source archive, and the final patched bytes must match the distributed bundle. See [rebuild instructions](licensing.md#rebuilding-the-modified-html-to-pdf-bundle).
