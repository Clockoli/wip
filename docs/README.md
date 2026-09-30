# Clockoli documentation

For contributor setup, development invariants, testing, browser verification, and release packaging, see [Contributing to Clockoli](../CONTRIBUTING.md).

Clockoli tracks time against HTTP(S) task URLs and routes records to private personal or organization GitHub time repositories. Start with the setup guide, then use the topic pages when you need more detail.

## User guides

- [Getting started](getting-started.md): install Clockoli, sign in with GitHub, check and explicitly connect a time repository, choose a default, finish setup, and track the first task.
- [Feature guide](features.md): tracking, multi-repository routing, correction, aggregated reads, Reports, billable rates, settings backup, and synchronization.
- [Why Clockoli](why-clockoli.md): how the Git-backed model differs from SaaS trackers, local-only timers, spreadsheets, and issue-only integrations.
- [Data, privacy, and security](data-and-privacy.md): what is stored, where it is stored, destination permissions, personal branches, and security boundaries.
- [Packaged add-ons](add-ons.md): first-party integrations, user-granted host access, and provider-data boundaries.
- [Time-data repository setup](time-data-repository.md): live repository discovery, confirmed setup actions, shared access, repository layout, and routing.
- [Troubleshooting](troubleshooting.md): common setup, synchronization, Clockify migration, reporting, and data-format problems.

## Maintainer reference

- [Specification compliance](spec-compliance.md): implementation and acceptance-test mapping for maintainers.

## Product scope

The current beta supports Chrome/Chromium 102 or newer and manual completed-entry creation through the Activity bulk importer. It does not provide Firefox packaging, reminders, a mobile app, or automatic updates for unpacked installations.
