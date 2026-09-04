# Clockoli documentation

For contributor setup, development invariants, testing, browser verification, and release packaging, see [Contributing to Clockoli](../CONTRIBUTING.md).

Clockoli tracks time against HTTP(S) task URLs and stores the records in a private GitHub repository. Start with the setup guide, then use the topic pages when you need more detail.

## User guides

- [Getting started](getting-started.md): install Clockoli, connect GitHub, choose a data repository, and track the first task.
- [Feature guide](features.md): tracking, correction, Tasks, Times, Reports, billable rates, settings backup, and synchronization.
- [Why Clockoli](why-clockoli.md): how the Git-backed model differs from SaaS trackers, local-only timers, spreadsheets, and issue-only integrations.
- [Data, privacy, and security](data-and-privacy.md): what is stored, where it is stored, permissions, personal branches, and security boundaries.
- [Add-ons](add-ons.md): planned first-party packaged add-on architecture and provider boundaries.
- [Time-data repository setup](time-data-repository.md): individual and shared-repository administration.
- [Troubleshooting](troubleshooting.md): common setup, synchronization, reporting, and data-format problems.

## Maintainer reference

- [Specification compliance](spec-compliance.md): implementation and acceptance-test mapping for maintainers.

## Product scope

The current beta supports Chrome/Chromium 102 or newer and manual completed-entry creation through the Times bulk importer. It does not provide Firefox packaging, reminders, a mobile app, or automatic updates for unpacked installations.
