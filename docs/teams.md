# Work as a team

Share one private time repository with your team, invite and remove teammates, and report on everyone's time together.

Teammates track into the same repository, each on a personal branch, and Reports reads everyone's branches as one view. There is no Clockoli workspace or admin role: GitHub repository access decides who can read and write.

## Before you start

Repository readers can see every stored URL, title, timestamp, and description included in shared reporting. Use separate time repositories for groups with different access boundaries.

Initializing an organization repository requires GitHub repository-admin permission; Clockoli does not create a permanent Clockoli admin role. An ordinary employee cannot use the join flow to initialize an unmarked organization repository. Repository discovery and inspection never write a marker, branch, membership, or work record.

## Set up a shared repository

1. A repository administrator signs in, chooses a dedicated private time repository from autocomplete or enters its URL, and grants the Clockoli GitHub App access only if needed. The repository may belong to a person or an organization.
2. If the repository is not initialized, the administrator checks it, reviews the privacy disclosure, and explicitly confirms **Initialize repository**.
3. The administrator gives each teammate GitHub write access to the repository, either through **Invite teammates** in Settings (below) or directly on GitHub.
4. The teammate opens a Clockoli invitation URL such as `https://clockoli.com/join/#repo=acme%2Ftime-data`, keeps that tab open, installs Clockoli and signs in to GitHub. The extension discovers the invitation and prepares **Join a team** with the exact repository. With several invitation tabs, the teammate chooses one. If automatic pickup is unavailable, they can paste the full invitation link or the GitHub repository URL manually.
5. The teammate accepts any pending GitHub repository invitation. If Clockoli App access is missing, the repository administrator must grant the App Contents write access. Clockoli checks access again before offering a join action.
6. After reviewing the disclosure, the teammate explicitly confirms **Connect repository** if storage is already ready, **Join repository** for a new member, or **Set up storage branch** if they are already a member with a missing branch.
7. Clockoli creates and verifies each user's personal storage branch, named from their stable GitHub user ID.
8. Teammates can add the shared repository alongside other personal or organization time repositories and [route projects](projects-and-routing.md) to it.

Give reporting-only users read access only if they may inspect all stored work data in that repository.

## Invite teammates

In the connected repository card in Settings, open **Invite teammates** with the + circle beside collaborator avatars. A repository administrator can search by GitHub username and review each result's login, public display name (if set), and avatar. Choose the account and confirm **Check access and invite**.

Clockoli rechecks the selected GitHub user ID, repository coordinates, accepted collaborator access, and pending invitations, then requests GitHub repository **write** access only if neither exists. **About access and invitations** explains the permission scope; **Copy Clockoli invitation link** creates a safe `clockoli.com/join#repo=...` link for the selected repository. It does not grant GitHub access or send an invitation on its own. **What your teammate does next** also contains shareable setup steps.

Inviting requires both the signed-in user's repository-admin rights and **Administration: Read and write** on the Clockoli GitHub App installation. The App owner must enable that permission in the App settings and installations must accept the updated permission request before inviting works. Choose **Only select repositories** and grant the App access to the intended time repository; App permissions apply to every repository selected for that installation, **not** automatically to all repositories in your GitHub account. Organization and enterprise policies may forbid outside collaborators.

A GitHub invitation is not a Clockoli join: the recipient accepts on GitHub, grants the App access to the same repository if needed, and confirms their own join or branch setup in Clockoli. Search and membership checks do not write to the time repository.

## See who has access

Settings shows up to four current GitHub collaborator avatars and four pending GitHub account invitations beside each connected time repository, with separate ellipses when more verified accounts exist. Pending invitations have a dashed accent ring and a dot; hovering an avatar shows the GitHub login and, for pending invitees, the invitation state. The adjacent + circle has an **Add teammate** hover title and opens that repository's invitation form; it does not send an invitation.

These are repository access states, not Clockoli-joined users or task assignees. Email-only invitations have no GitHub account avatar and are not shown; the pending lookup scans up to five pages so an email-only page does not imply more account avatars. The read-only lookup is scoped to that configured repository; a failed or inconclusive invitation read silently omits unavailable status and preserves known collaborators. A failed collaborator read shows “Collaborators unavailable”. Avatars come only from GitHub's avatar host, with an initial as fallback.

## Remove access

Select a verified collaborator avatar beside the connected repository in Settings and choose **Remove @user** from its dropdown; a pending GitHub account invitation avatar instead offers **Cancel invitation for @user**. Your own account avatar is not a removal control.

Confirm the repository and account before Clockoli verifies repository identity, admin permissions, account ID, and current access and asks GitHub to remove the collaborator or cancel the invitation. Removing access does not delete existing time records or Git history. A failure retains the action for retry; confirmed success refreshes the displayed avatars.

Only the first four accounts in each category appear here; use **Manage GitHub access** for others or email-only invitations. Avatar actions require a connected GitHub App installation with Administration write permission and repository-admin rights; PAT connections show noninteractive avatars.

## Report across the team

[Reports](reports.md) combines the selected visible repositories and every valid personal branch in them. On GitHub issue and pull-request pages, the stopwatch dialog can show **Tracked on this issue/PR** totals for all participants. Hourly rates stay in each browser, so teammates sharing a repository can use different rate cards.
