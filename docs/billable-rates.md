# Billable rates

Every hourly rate belongs to a **client**. Rates stay in your browser and in settings backups you explicitly export. Nothing is saved to GitHub.

There are no global, default, or shared rate cards. Clients, rate cards, and invoicing settings exist only in your browser's extension-local storage.

## Create a client and rate card

1. In **Settings → More settings → Clients**, create and **Save** a client. You can use a client solely to evaluate team work; invoice details are optional.
2. Open **Billable rates**, choose that client, and add the hourly rates of GitHub users whose time you want to evaluate.
3. Enter the rate and currency (such as `100.00 USD` or `€55.50`), optionally set effective dates, then **Save billable rates**.
4. Repeat for each client. One person can have different rates for different clients.

Dates are inclusive and stored with each rate period; rates use integer minor currency units. A missing employee or uncovered period is **Unrated**: Clockoli does not substitute a rate from another client.

## Reports

Use **Client** to filter work by the project owner's client. Use **Billable rates → Calculate amounts using** to choose either a specific client's rate card (useful for team-manager reporting across multiple projects), or **Each project's client** to evaluate entries by the client assigned to their project. All money calculations remain local.

Missing rates contribute no calculated amount and are shown as unrated. Report totals group different currencies separately, with optional historical exchange-rate conversion for charts. Clockoli sends only currency codes and dates to Frankfurter.

## Invoices

When creating an invoice, choose a client. The invoice is calculated **only** from that client's rates, regardless of which projects you deliberately include. A project belonging to a different client produces a warning; review your selection carefully.

## Privacy and backups

No rate or calculated monetary amount is committed to GitHub or shared with teammates. Each browser can have entirely different client records and rate cards for the same time repository. Export your settings backup after changes and protect it: it contains confidential rate and client information.
