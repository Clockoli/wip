# Add-ons

Clockoli ships first-party, **packaged-only** add-ons. They are versioned and shipped in Clockoli extension releases; Clockoli does not load external or remote executable plugins.

## User control and contract

A user must explicitly enable an add-on in Clockoli Settings. Before enablement, Settings discloses the add-on's requested host permissions and capabilities. An add-on descriptor declares its `id`, `version`, `title`, `description`, `requested origins`, and `capabilities`. Enablement requests the descriptor's exact origins through Chrome; a denied request does not enable the add-on, and disabling removes its optional origin before persisting the disabled state.

The privileged core remains separate from each untrusted provider adapter. Add-ons never collect or persist provider credentials. The core owns credentials, storage, GitHub access, validation, and record writes; an adapter can only supply data through its declared capability. Add-on enablement is available only to extension-origin Settings messages, never to content scripts or provider pages.

The planned version 1 permits only the `import_completed_records` capability. Remote code, arbitrary messages, and arbitrary GitHub calls are forbidden. Disabling an add-on stops integration but never deletes imported records.

## Clockify migration

Clockify supports two explicit user-initiated annual-report transports: capture of Clockify's native CSV export and page-to-page capture from the open Detailed Report. Both transports produce the same normalized preview and require explicit user mapping/confirmation before writing. The final per-user import outcome is retained in extension storage so reopening the preview after a service-worker restart reports the completed result rather than guessing or rerunning the import.

The Clockify migration add-on reads only a completed Detailed Report result or native CSV export from a user-opened authenticated Clockify tab. Clockify tokens, cookies, request headers, request bodies, report-task markers, and raw provider responses are never collected or retained.

Enable the add-on in Settings and open Clockify's Detailed Report page. Click **CSV migration** in the Clockoli banner above Clockify's Export control. Clockoli first scans report years, then opens Clockify's native Export menu, selects **Save as CSV**, and captures each completed export in memory for the Clockoli preview. **Page to page migration** is a fallback that captures completed Detailed Report pages and advances Clockify's pagination controls; it does not trigger CSV export or download. These actions capture from the open tab; there is no separate CSV file-upload step. Clockoli does not invoke Clockify APIs directly, collect provider credentials, or retain raw CSV or report payloads after normalization for the expiring preview.

Wait for the year capture to finish and review the preview's people and entry counts. GitHub logins for people with access to the configured Clockoli repository are suggestions only. Manually map the Clockify person whose time belongs to your signed-in Clockoli GitHub user; explicitly **Skip this person** for everyone else. Confirm the mapping and choose **Import completed time**. The preview shows progress and a per-person outcome; check for **Imported**, **Already present**, or a failure before treating migration as complete. Other Clockify users cannot be written to your personal branch.

The content adapter is untrusted. It forwards bounded allowlisted CSV text to the privileged core, which revalidates and normalizes the data. The preview expires after one hour and is consumed before import. Its preview handoff uses temporary, privileged extension IndexedDB storage and is not constrained by `chrome.storage.session`’s quota; Clockoli content scripts do not access extension storage. An explicit capture arm is scoped to the current tab and expires after 30 minutes. Migration writes only to the branch already configured for the signed-in Clockoli user—the same branch used for routine timer work. It never creates or switches to an additional branch. Imported records retain an opaque deduplication digest rather than source entry or user IDs. Clockoli does not infer, guess, or look up GitHub task URLs during migration. Unresolved imported work uses a validated, non-navigable `owner/project/task-slug` identity and the normalized Clockify project/task title; the owner is the configured time repository's owner, not a guessed source repository. The entry description remains the Clockoli description. When a new Clockify interval overlaps earlier imported source time or existing destination history, Clockoli leaves existing records unchanged and moves that imported interval forward past each conflict while preserving its duration. A replay of the one unambiguous matching prior Clockify import replaces that prior record instead of duplicating it. See [Data Format v1](data-format-v1.md#7-work-item) for the identity contract.

### Optional host-permission evidence

The add-on requests only `https://app.clockify.me/*` as an optional origin, and Chrome prompts only from the Settings enable-button user gesture. Its content scripts are limited to the Detailed Report route. Automated tests cover the permission and message boundaries; an authenticated browser migration must still be manually verified before release.
