# Key concepts

The few terms Clockoli uses everywhere: what a task is, where time is stored, and how work is routed and shared.

## Task

A task is the work you track, identified by its HTTP(S) URL: a GitHub issue or pull request, a ticket, a document, a dashboard, or any other page. The URL is the identity; two timers on the same canonical URL are the same task.

- **Title** is optional metadata, such as a GitHub issue title. Changing it does not create a new task.
- **Description** is an optional note on one time entry, such as what you did. It can span several lines.
- GitHub issue and pull-request URLs are normalized, so notification links and query strings do not create duplicates. Other sites keep their query strings.
- Time imported from Clockify without a matching URL uses a non-clickable `owner/project/task-slug` identity until you [merge it](settings.md#merge-tasks) into a real URL.

## Timer and time entry

The **timer** is the one running clock. Clockoli runs one timer at a time across all your repositories and browsers: starting another task saves the running one first.

A **time entry** is one completed interval: a task, a start, an end, and an optional description. You can [add and edit entries](editing-time.md) at any time.

## Time repository

A **time repository** is a private GitHub repository where Clockoli stores your timers and completed entries as readable files. You can connect several, one of them being the **default time repository**. See [Time repositories](time-data-repository.md).

A **source repository** is a repository whose issues or pull requests you track. It is not a time repository, and Clockoli never writes to it.

Each person writes to their own **personal branch** in a time repository, named `clockoli/users/{github-user-id}`, so teammates do not overwrite each other. Reports reads every personal branch you can access.

## Project

A **project** is a routing rule: a list of URL fragments, a time repository, and an optional client. When you start a task, the first project whose fragment appears in the URL decides which repository receives the time; unmatched URLs go to the default. See [Projects and routing](projects-and-routing.md).

A **client** is who you bill. Assigning clients to projects lets an [invoice](invoicing.md) cover one client's work.

## Task source

In Reports, the **task source** is where a task lives: `owner/repository` for a GitHub issue or pull request, or the hostname for any other URL. It is separate from the time repository that stores the entry.

## Saved locally, synced later

Every change is saved in your browser first and sent to GitHub in the background, about 15 seconds after your last change. Clockoli keeps working while GitHub is unreachable. See [Sync and offline work](sync.md).

## What stays in your browser

Hourly rates, invoices, client details, and display preferences never leave your browser and are never written to a time repository. Back them up with [Export settings](settings.md#backup--restore).
