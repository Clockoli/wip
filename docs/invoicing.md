# Invoicing

Turn a filtered report into a numbered, taxed invoice, then print it or save it as PDF. Invoices never leave your browser.

Invoices are generated in the browser from your time records and local settings. No invoice, invoice number, rate, or client detail is ever written to the time repository.

## Set up invoicing

Open **Settings** → **More settings** → **Invoicing** and save the seller and client details, invoice numbering, payment terms, and tax defaults used for invoice previews. Select **Save invoicing settings**; success or an error appears beside the button. Invoicing needs [billable rates](billable-rates.md) for the people you bill.

Saving rates or invoicing keeps stored clients even when their metadata is empty. New client cards are omitted only while empty and untouched, and only if neither a named project nor the main project selects them. Clients can own [projects](projects-and-routing.md).

### Payment terms

Payment terms (days) in Settings determines the due date from the issue date; zero means due on receipt.

Older text terms recognize “due on receipt” and “on receipt” without regard to case as zero days, then prefer the number following “net” (so “2% 10, Net 30” means 30 days). Otherwise they use a sole number or default to 30, clamped to 0–365. Unless the original text is exactly “Net {N}” for the resulting days or a due-on-receipt phrase, it is preserved as a separate “Payment terms: ” line in Notes without duplicating an existing exact line. If adding it would exceed the 1,000-character notes limit, existing notes remain unchanged. Notes supports line breaks.

## Create an invoice

1. Open **Reports** and filter it: the selected period, people, projects, and sources define what is billed.
2. Choose **Create invoice**.
3. Choose a client and currency, review the preview, then choose **Print** or **Save as PDF**.

Each invoice uses one target currency. When effective-dated rates change within the period, Clockoli keeps the corresponding invoice lines separate; when the covered records use multiple currencies, it converts each entry using the exchange rate for that entry's date. Unrated time remains visible as not billed.

The invoice dialog names the billing period from the Reports From/To range. Presets select This month, Last month, Last 7 days, or Last 30 days using the selected reporting date basis (local or UTC).

Picking a client narrows the invoice to that client's work without changing the report filters. Clockoli warns when an invoice also includes projects owned by another client.

A partial report can still produce an invoice preview when rated entries are available, even though timesheet exports are disabled. Check that all intended time repositories loaded before printing or saving an invoice.

## Additional lines

Add up to 20 additional lines for charges or discounts in the invoice currency. These amounts are included in the subtotal and taxed, without exchange-rate conversion. In an additional line's Description, **Shift+Enter** inserts a newline and **Enter** applies the text to the live invoice preview, showing **✓ Applied**; this is a preview change, not a saved invoice. Actual invoice output is created with **Print** or **Save as PDF**.

## Invoice numbers

Invoice numbers are reserved only on the first **Print** or **Save as PDF** action for a preview and are never committed to the time-data repository. The counter only ever moves forward: neither a settings save nor restoring an older settings backup can lower it below a number that has already been issued.

## Where invoices live

An invoice exists only as the on-screen preview and as a file you print or download. Clockoli does not archive invoices. CSV and JSON timesheets remain available on Reports when the report is complete. See [Invoice privacy](data-and-privacy.md#invoice-privacy).

## Limits

Version 1 does not support retainers, recurring invoices, reminders, payment links, tracked-time line editing, sent or paid status, an invoice archive, or emailing invoices.
