# Clockoli documentation

Clockoli tracks time against any HTTP(S) task URL and writes the records to private GitHub time repositories you control. New to Clockoli? Install it, then follow [Getting started](getting-started.md).

## Getting started

- [Why Clockoli](why-clockoli.md): how the Git-backed model differs from hosted trackers, local-only timers, spreadsheets, and issue-only integrations.
- [Install Clockoli](install.md): install from the Chrome Web Store or a release file for Firefox and Safari, load a development checkout, and update.
- [Getting started](getting-started.md): sign in with GitHub, check and connect a time repository, and track your first task.

## Track time

- [Track a task](tracking.md): start, stop, and switch the single timer from the toolbar panel or the GitHub stopwatch, and describe your work.
- [Activity](activity.md): review a week of tracked time in Timeline, Calendar, and List, move and resize entries, and search older history.
- [Add and edit time](editing-time.md): add a single or bulk entry, edit or delete completed time, fix overlaps, and change a running timer's start.
- [Top tasks](top-tasks.md): see recently tracked tasks with their totals and restart any of them with one click.

## Reports and billing

- [Reports](reports.md): filter tracked time by period, person, project, and source, chart it, and export CSV, JSON, or PDF timesheets.
- [Billable rates](billable-rates.md): set effective-dated hourly rates per person that stay in your browser, with mixed-currency conversion.
- [Invoicing](invoicing.md): turn a filtered report into a numbered, taxed invoice and print it or save it as PDF without committing it.

## Repositories and teams

- [Time repositories](time-data-repository.md): repository requirements, the check and connect flow, branch layout, and safe manual editing.
- [Projects and routing](projects-and-routing.md): send new time to the right repository with ordered URL rules and an explicit default.
- [Work as a team](teams.md): share a time repository, invite and remove teammates, and report across everyone's personal branches.

## Settings and data

- [Settings](settings.md): every Settings section, from interface width and recent entries to merge tasks, backups, and sign-out.
- [Sync and offline work](sync.md): how changes are saved locally first, synchronized with GitHub, and protected against conflicts.
- [Data, privacy, and security](data-and-privacy.md): what is stored where, GitHub permissions, security boundaries, and what stays private.
- [Data format reference](data-format-v1.md): the normative version 1 schema for active timers, monthly JSONL records, and the task index.

## Integrations

- [Add-ons and Clockify migration](add-ons.md): enable packaged add-ons and import Clockify history with a preview and explicit user mapping.

## Help

- [Troubleshooting](troubleshooting.md): fixes for installation, GitHub connection, tracking, synchronization, editing, reports, and Clockify problems.
- [Licensing and source releases](licensing.md): GPLv3 terms, third-party notices, and Corresponding Source archives for each release.

## Product scope

The current beta supports Chrome and other Chromium browsers 102 or newer from the Chrome Web Store, Firefox 140 or newer, and Safari 18 or newer on macOS. Firefox and Safari builds ship as release files and are not yet listed in their browser stores. Completed entries can be added with **Add time** or **Bulk time adding** on Activity. Clockoli does not provide reminders, a mobile app, a side-by-side conflict editor, or automatic updates for unpacked or file installations.

## Maintainer reference

Contributor setup, development invariants, testing, browser verification, and release packaging are in [Contributing to Clockoli](../CONTRIBUTING.md). Maintainers also use the [specification compliance](spec-compliance.md) map of requirements to tests and the [browser release contracts](browser-releases.md).
