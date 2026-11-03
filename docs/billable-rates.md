# Billable rates

Set hourly rates per person to turn tracked hours into billable amounts. Rates stay in your browser and are never written to GitHub.

Rates and calculated amounts stay in this browser's extension-local storage. They are never written to the time repository, so teammates who share it never see them.

## Add a rate

Open **Settings** → **More settings** → **Billable rates**. Add a non-negative hourly rate for each GitHub login (matching is case-insensitive) and include the currency directly in each rate, for example `$15.50`, `20.15$`, `€55.50`, `750 RUB`, or `888 GEL`. A currency sign or a 2–12 letter description is required in every rate value. Select **Save billable rates**; success or an error appears beside the button.

- Rates can be effective-dated: add date ranges when a rate changes, and reports use the applicable rate for each entry's date.
- Rates are stored as integer minor units.
- A teammate's browser can use different rates for the same shared repository. Rates are not read from the shared repository or synchronized from a colleague's browser.
- Missing rates contribute zero and are identified in the report summary.

Export a [settings backup](settings.md#backup--restore) after changing rates. The backup contains your rate card, so protect the file.

## How amounts are rounded

Displayed billable totals aggregate tracked seconds before rounding. Exported per-entry billable amounts are rounded individually, and invoice amounts are rounded per completed invoice line.

## Mixed currencies

Different currencies remain separate. Reports exposes a currency selector for billable charts when needed and converts mixed-currency amounts by day using locally cached [Frankfurter](https://frankfurter.dev/) rates. Conversion requires a three-letter currency code or one of `$`, `€`, `£`, or `¥`; unsupported currency descriptions cannot be converted.

Clockoli sends Frankfurter only the selected target currency, the source currency codes, and the required date range; see [Exchange rates for reports](data-and-privacy.md#exchange-rates-for-reports).

## When an amount is zero or incomplete

- Include a currency sign or 2–12 letter description in every hourly rate.
- Add a rate for each GitHub login whose time you bill.
- Check that the rate's date range covers the entries.
- Save rates, then reload Reports.
