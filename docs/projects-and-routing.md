# Projects and routing

Projects decide which time repository receives a new timer. Use them when one GitHub account tracks work for several clients, teams, or privacy boundaries.

## How routing works

Projects are ordered, case-insensitive URL-substring rules. Clockoli checks them from top to bottom; the first matching project chooses the time repository for a new Start. An explicit default time repository receives URLs that match no project.

A running timer and every accepted queued write remain pinned to their original destination if you later reorder rules or change the default. Routing changes affect only future Starts; they do not move, delete, or transfer existing records.

## Set up projects

1. Connect each time repository you need under **Time repositories** in Settings; see [Time repositories](time-data-repository.md).
2. In **Projects and routing**, choose the time repository and optional client for **Tasks that do not match a named project**. This is the default destination, and its name defaults to `Other`.
3. Select **Add project** for each named project. Enter one URL substring per line and choose the project's time repository and optional client.
4. Order the projects with the ↑ and ↓ buttons so more specific rules come first. **✕** removes a project.
5. Select **Save projects and routing**. Success or an error appears beside the button.

A project's client is used by [Invoicing](invoicing.md): picking a client narrows an invoice to the work of that client's projects.

## Examples

| Project | URL substrings | Time repository |
|---|---|---|
| Acme | `github.com/acme/`<br>`acme.atlassian.net` | `acme/time-data` |
| Internal | `github.com/my-company/` | `my-company/time` |
| Tasks that do not match a named project | (everything else) | `me/clockoli-data` |

With these rules, `https://github.com/acme/web/issues/12` goes to `acme/time-data`, and a Google Doc goes to the default `me/clockoli-data`.

## Limits

- Multi-repository routing requires GitHub App sign-in. PAT compatibility mode supports exactly one destination.
- Imported tasks without an HTTP(S) URL keep their existing time repository when restarted or added through **Add time**.
- Removing a destination or changing authentication is blocked while it would strand active or pending work.

## A task went to the wrong repository

Check the rules top to bottom: the first match wins, and unmatched URLs use the default. Reorder or correct the rules for future Starts. A running timer or queued write remains in the destination chosen when Clockoli accepted it, and edits are sent back to the record's original repository. To move a completed entry, add it again with **Add time** after fixing the rules, then delete the original.
