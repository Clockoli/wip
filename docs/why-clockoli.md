# Why Clockoli

Clockoli stores your time in private GitHub repositories you control, without a Clockoli account or application server.

This approach favors **control and portability** over some of the convenience of a hosted service.

## What you gain

### Your records stay yours

Completed time entries are readable JSON Lines files in your GitHub repository. You can clone the repository, back it up, inspect the history, and read the data without Clockoli. Edits and deletions appear in Git history, although repository administrators can rewrite that history.

### No separate Clockoli server

The extension connects directly to GitHub. There is no Clockoli service that stores your task URLs, descriptions, or time records. GitHub remains a dependency: connectivity, permissions, and API limits can affect synchronization.

### Track work wherever it happens

A task can be a GitHub issue, a pull request, a document, a support ticket, or another HTTP(S) page. Its canonical URL identifies it; a title is optional. You do not need to create a matching task in a separate tracker.

### Share time, not private rates

Teammates with access to the same time repository can contribute entries on separate personal branches. Reports combines the entries you can read.

Hourly rates, client details, and invoices stay in each browser rather than in the shared time repository. To move those settings to another installation, export and protect a settings backup.

### Keep an audit trail and recover data

Git commits let you inspect and restore previous versions of tracked time. The format is [documented](data-format-v1.md), so you can also process it with scripts or other tools. Git history is **not** a tamper-proof audit log.

## Tradeoffs

| Clockoli is a good fit when… | A hosted tracker may fit better when… |
|---|---|
| You already use GitHub and want control over storage and access. | You want a service that manages storage and accounts for you. |
| You value readable files and Git history. | You prefer built-in workflows without using Git. |
| Your team can use GitHub repositories. | Your team should not need GitHub access. |
| You track work on many websites, not only one issue tracker. | You need native mobile tracking or reminders. |
| You want billing settings kept locally. | You need centralized rates, recurring invoices, or payment collection. |

## What to consider before using it

- **GitHub access is required.** Every person who tracks time needs a GitHub account and suitable repository permissions.
- **Repository readers can see the work.** Task URLs, titles, timestamps, and descriptions are visible to people with read access. Use separate repositories for different privacy boundaries.
- **GitHub must allow direct writes.** Strict branch rules can block Clockoli's storage branches.
- **Local settings need backups.** Rates, invoice details, and some preferences are not synchronized between browsers.
- **Browser support varies.** Chromium installations from the Chrome Web Store update automatically. Firefox and Safari builds are currently distributed as release files and require manual updates. There is no mobile app or reminder system.
- **Conflicts can need attention.** Clockoli saves changes locally first and syncs them in the background, but concurrent edits may require review.

If that balance works for you, [get started](getting-started.md). For details about what leaves your browser, see [Data, privacy, and security](data-and-privacy.md).
