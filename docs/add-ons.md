# Add-ons

Clockoli ships first-party, **packaged-only** add-ons. They are versioned and shipped in Clockoli extension releases; Clockoli does not load external or remote executable plugins.

## User control and contract

A user must explicitly enable an add-on in Clockoli Settings. Before enablement, Settings discloses the add-on's requested host permissions and capabilities. An add-on descriptor declares its `id`, `version`, `title`, `description`, `requested origins`, and `capabilities`. Enablement requests the descriptor's exact origins through Chrome; a denied request does not enable the add-on, and disabling removes its optional origin before persisting the disabled state.

The privileged core remains separate from each untrusted provider adapter. Add-ons never collect or persist provider credentials. The core owns credentials, storage, GitHub access, validation, and record writes; an adapter can only supply data through its declared capability. Add-on enablement is available only to extension-origin Settings messages, never to content scripts or provider pages.

The planned version 1 permits only the `import_completed_records` capability. Remote code, arbitrary messages, and arbitrary GitHub calls are forbidden. Disabling an add-on stops integration but never deletes imported records.

## Clockify migration add-on

The Clockify migration add-on reads only a completed Detailed Report result in a user-opened authenticated Clockify tab. Clockify tokens, cookies, request headers, request bodies, report-task markers, and raw provider responses are never collected or retained.

Enable the add-on in Settings, open the Detailed Report page, and click the Clockoli icon next to Clockify’s Export control. From that explicit gesture, Clockoli drives Clockify’s existing report pagination controls: it requests 200 results per page where that control is available, starts at the first page, and advances through pages until the report total is complete. It captures only the completed results already returned through Clockify’s page UI; it does not invoke Clockify Export or issue direct provider requests. The extension opens a session-only preview only after a complete bounded report, showing the source roster and entry counts. It suggests GitHub logins for people with access to the configured Clockoli repository, but never assigns a mapping: the user must explicitly map each person to a unique GitHub login or explicitly skip that person before any GitHub operation begins.

The content adapter is untrusted. It forwards a bounded allowlisted JSON text to the privileged core, which revalidates and normalizes the data. The preview expires within 30 minutes and is consumed before import. Its handoff uses `chrome.storage.session` only in privileged extension code; Clockoli content scripts do not access extension storage. An explicit capture arm is also scoped to the current tab, expires after two minutes, and survives only the Clockify report reload needed to apply the selected page size. Each verified mapping receives an isolated `clockoli/users/{github-id}` branch; import never falls back to an administrator or default branch. Imported records retain an opaque deduplication digest rather than source entry or user IDs. They retain the Clockify project and task as the readable task title, and the entry description as the Clockoli description. If the project is a repository name and the task is exactly `#<number> <issue title>`, Clockoli checks that issue in the configured GitHub owner and uses its canonical URL only when its title matches exactly. When a new Clockify interval overlaps earlier imported source time or existing destination history, Clockoli leaves existing records unchanged and moves that imported interval forward past each conflict while preserving its duration. A replay of the one unambiguous matching prior Clockify import replaces that prior record instead of duplicating it.

### Optional host-permission evidence

The add-on requests only `https://app.clockify.me/*` as an optional origin, and Chrome prompts only from the Settings enable-button user gesture. Its content scripts are limited to the Detailed Report route. Automated tests cover the permission and message boundaries; an authenticated browser migration must still be manually verified before release.
