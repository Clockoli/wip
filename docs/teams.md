# Work as a team

Teammates can track time into the same private GitHub repository. Each person writes to a personal branch, and Reports combines the branches you can read.

There is no separate Clockoli workspace or administrator role. **GitHub repository permissions control access.** Anyone with read access to the time repository can see stored task URLs, titles, times, and descriptions.

## Set up a shared repository

1. A GitHub repository administrator connects a dedicated private [time repository](time-data-repository.md), grants the Clockoli App access, and confirms **Initialize repository** if needed.
2. Give each teammate GitHub write access, using **Invite teammate** in Clockoli or GitHub's repository settings.
3. Send the teammate the Clockoli invitation message.
4. The teammate accepts any GitHub invitation, installs Clockoli, signs in, and selects **Join a team**.
5. Clockoli checks access. The teammate confirms **Connect repository**, **Join repository**, or **Set up storage branch**, depending on the repository state.

The invitation URL (`https://clockoli.com/join/?repo=acme%2Ftime-data`) identifies the repository but does not grant permission to it. Ask teammates to **keep the invitation page open** during setup. Clockoli can detect it automatically; if it cannot, they can paste the link. Older `#repo=` links also work.

An ordinary teammate can join an already initialized organization repository, but cannot initialize an unmarked one without repository-admin permission.

## Invite teammates

Open **Settings → Time repositories** and select **Invite teammate** for the shared repository.

1. Search for the person's GitHub account and select it.
2. Select **Send invitation to the repository** and confirm the access you are granting.
3. Select **Copy Clockoli invitation message** and send the copied message to the teammate.

![Invite teammate with GitHub search and invitation message](images/invite-teammate.png)

Sending a GitHub invitation and joining Clockoli are two separate steps. Clockoli avoids duplicate invitations when GitHub already shows access or a pending invitation.

Inviting requires **repository-admin permission** for your account and **Administration: Read and write** for the Clockoli GitHub App. If either is missing, use **Manage GitHub access** or ask the repository administrator. Organization policies may restrict external collaborators.

## View the team

Each connected repository has a **Team** section showing collaborators and pending invitations. Expand **More collaborators** or **More pending invitations** to see additional accounts.

![Team section with collaborators and invitation states](images/team.png)

The statuses mean:

- **GitHub invitation pending:** access has not been accepted.
- **GitHub access granted:** GitHub allows access, but Clockoli storage has not been verified.
- **Clockoli storage ready:** the person's branch and task index are valid.

**Clockoli storage ready** does not prove that the extension is currently installed or that the person recently tracked time.

## Remove access

In **Team**, open the person's **⋯** menu and select **Remove @user** or **Cancel invitation for @user**. Confirm the action.

Removing access does **not** delete their existing entries or Git history. Access inherited through an organization or GitHub team may need to be changed in GitHub itself. The Team section reports the result and links to GitHub when additional changes are needed.

Only repository administrators with the required App permission can invite or remove people. PAT connections do not provide these controls.

## Report across the team

[Reports](reports.md) combines time from readable personal branches in selected repositories. GitHub issue and pull-request pages can show each participant's tracked total.

Hourly rates are local to each browser. Sharing time does not share a manager's private rates or invoices.

Use separate time repositories for groups that should not see each other's records.
