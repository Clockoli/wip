# Add-ons and Clockify migration

Turn on packaged add-ons in Settings, and import your Clockify history into Clockoli with a preview and explicit people mapping.

## What add-ons are

Clockoli ships first-party, **packaged-only** add-ons. They are versioned and shipped in Clockoli extension releases; Clockoli does not load external or remote executable plugins.

### Turn an add-on on or off

A user must explicitly enable an add-on in Clockoli Settings. Before enablement, Settings discloses the add-on's requested host permissions and capabilities. Enablement requests the descriptor's exact origins through Chrome; a denied request does not enable the add-on, and disabling removes its optional origin before persisting the disabled state. Disabling an add-on stops integration but never deletes imported records.

### What an add-on can do

An add-on descriptor declares its `id`, `version`, `title`, `description`, `requested origins`, and `capabilities`. The planned version 1 permits only the `import_completed_records` capability. Remote code, arbitrary messages, and arbitrary GitHub calls are forbidden.

The privileged core remains separate from each untrusted provider adapter. Add-ons never collect or persist provider credentials. The core owns credentials, storage, GitHub access, validation, and record writes; an adapter can only supply data through its declared capability. Add-on enablement is available only to extension-origin Settings messages, never to content scripts or provider pages.

## Clockify migration

The Clockify migration add-on reads only a completed Detailed Report result or native CSV export from a user-opened authenticated Clockify tab. Clockify tokens, cookies, request headers, request bodies, report-task markers, and raw provider responses are never collected or retained.

### Migrate your Clockify history

1. In Clockoli **Settings** → **Add-ons**, select **Enable Clockify migration** and allow the `https://app.clockify.me/*` permission.
2. Open Clockify's Detailed Report page in a signed-in tab. Reload it if it was already open.
3. The Clockoli banner above Clockify's Export control offers **CSV migration** and **Page to page migration**. Start with **CSV migration**.
4. Wait for the year capture to finish and review the preview's people and entry counts.
5. For each person you want to import, select a GitHub account or enter its login. Keep **Skip this person** selected for anyone you do not want to import.
6. Confirm the mappings and choose **Import completed time**.
7. Review each person's **Imported**, **Already present**, or failure outcome before treating migration as complete.

### How capture works

Clockify supports two explicit user-initiated annual-report transports: capture of Clockify's native CSV export and page-to-page capture from the open Detailed Report. Both transports produce the same normalized preview and require explicit user mapping/confirmation before writing.

With **CSV migration**, Clockoli first scans report years, waits for each requested annual report to finish, then opens Clockify's native Export menu, selects **Save as CSV**, and captures each completed export in memory for the Clockoli preview. If Clockify shows “The report will be sent to your email” instead, Clockoli closes that prompt and re-requests the same annual report before trying the CSV export again. After the third email-only response for the same year, CSV capture stops and suggests **Page to page migration**.

**Page to page migration** captures completed Detailed Report pages and advances Clockify's pagination controls; it does not trigger CSV export or download. These actions capture from the open tab; there is no separate CSV file-upload step. Clockoli does not invoke Clockify APIs directly, collect provider credentials, or retain raw CSV or report payloads after normalization for the expiring preview.

If a report year was confirmed to contain entries but its captured export contains no importable entries, history capture stops rather than opening an incomplete preview. Review the source report and try **Page to page migration**; do not delete existing records based only on an export preview.

### Map Clockify people to GitHub accounts

The default time repository's collaborators appear initially with avatars, logins, and public names, while typed GitHub login search uses GraphQL and shows logins only, without profile lookups or avatars. The Settings teammate picker also uses GraphQL, requesting public names and avatars in the same search request. Collaborator suggestions are reused for the same preview, destination and signed-in GitHub account for up to five minutes.

Repository membership is only a suggestion, not a requirement: Clockoli verifies every selected account's identity before writing.

After a successful import, Clockoli can offer to check access and invite a mapped account to the default time repository; invitations require a separate explicit confirmation and are never sent automatically. Existing access or pending invitations are checked before attempting to invite.

### Where imported time goes

Each verified account's records are imported only to that account's isolated `clockoli/users/<GitHub ID>` branch, with ownership metadata checked before writing; the configured user's records remain in their configured writer branch. Branch preparation or record writes can fail independently, and failures are shown per person rather than redirected to another branch.

Clockoli does not infer, guess, or look up GitHub task URLs during migration. Unresolved imported work uses a validated, non-navigable `owner/project/task-slug` identity and the normalized Clockify project/task title; the owner is the configured time repository's owner, not a guessed source repository. The entry description remains the Clockoli description. To attach imported time to a real issue or page later, use [Merge tasks](settings.md#merge-tasks). See [Data Format v1](data-format-v1.md#7-work-item) for the identity contract.

When a new Clockify interval overlaps earlier imported source time or existing destination history, Clockoli leaves existing records unchanged and moves that imported interval forward past each conflict while preserving its duration. A replay of the one unambiguous matching prior Clockify import replaces that prior record instead of duplicating it. Imported records retain an opaque deduplication digest rather than source entry or user IDs.

### Preview and privacy

The content adapter is untrusted. It forwards bounded allowlisted CSV text to the privileged core, which revalidates and normalizes the data. The preview expires after one hour and is consumed before import. Its preview handoff uses temporary, privileged extension IndexedDB storage and is not constrained by `chrome.storage.session`’s quota; Clockoli content scripts do not access extension storage. An explicit capture arm is scoped to the current tab and expires after 30 minutes.

The final per-user import outcome is retained in extension storage so reopening the preview after a service-worker restart reports the completed result rather than guessing or rerunning the import.

The add-on requests only `https://app.clockify.me/*` as an optional origin, and Chrome prompts only from the Settings enable-button user gesture. Its content scripts are limited to the Detailed Report route. Automated tests cover the permission and message boundaries; an authenticated browser migration must still be manually verified before release.

For capture, preview, and rate-limit problems, see [Clockify migration troubleshooting](troubleshooting.md#clockify-migration).

### Count GitHub requests while mapping

This temporary diagnostic helps when GitHub throttles a large mapping. Open the extension service-worker console from `chrome://extensions` before opening the mapping preview. A `[Clockify mapping GitHub requests]` line starts at zero and updates before each migration-related outbound `api.github.com` request, including collaborator profiles, live login searches, retries, import verification, and optional invitations. `search` counts the mapping's GraphQL user-search operation and any REST `/search/users` requests; `other` includes every other GitHub API operation and is **not** a rate-limit-bucket classification. Reloading the mapping preview resets the total; extension worker restarts retain it in extension-local storage. Cached suggestions, avatar image downloads, and unrelated Settings requests are not counted. Logs contain counts only, never URLs, logins, or credentials. GraphQL and REST can both be subject to secondary throttling; the switch does not guarantee searches will avoid HTTP 403 or 429 responses.

On an HTTP 403 or 429 response, an additional line records the status and GitHub's safe `x-ratelimit-resource`, `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset` (as `resetAt`), and `retry-after` (as `retryAfterSeconds`) headers. Missing or unrecognized values appear as `unknown`; the counter never infers an exhausted bucket from the request path. A nonzero `remaining` with throttling may indicate a secondary limit. Network failures have no response headers to report. Do not share request Authorization headers when troubleshooting.
