# Invoicing

Create an invoice from a filtered report, then **Print** it or **Save as PDF**. Invoices are generated locally in your browser, not stored in your time repository.

## Set up clients and rates

1. In **Settings → Clients (invoice recipients)**, create and save a client.
2. Under **Billable rates**, add the hourly rates for the GitHub users you want to bill. Every rate belongs to a **specific client**.
3. In **Settings → Invoicing**, enter your business details, payment information, invoice numbering, payment terms, and tax defaults. Select **Save invoicing settings**.

![Invoicing settings with business and payment information](images/invoicing-settings.png)

A client can be used for Reports without completing its invoice details. Rates from another client are never substituted when billing the selected client.

### Bank details and payment terms

You can save up to **20 bank accounts**. Choose a default or select a different account, or **No bank details**, for each invoice. Only the chosen account's payment instructions appear on the output.

Payment terms can be **0–365 days**. Zero means the invoice is due on receipt. Footer notes can contain multiple lines.

If Settings rejects pasted text, correct the field named in the error; unsupported control characters are not silently removed.

## Create an invoice

1. Open **Reports** and choose the period, people, projects, and other filters for the work you want to bill.
2. Select **Create invoice**.
3. Choose the client, bank account if needed, currency, and how to group lines (**Task** or **Day and task**).
4. Review the preview, then select **Print** or **Save as PDF**.

![Invoice creation dialog](images/invoice.png)

The invoice uses the period selected in Reports. Change the reporting period first if you need another billing range.

Selecting a client narrows the invoice to that client's work and uses that client's rates. Clockoli warns if your selected work includes projects belonging to a different client.

A single invoice uses one currency. Clockoli converts records with other currencies using rates for their dates. Different effective hourly rates appear on separate lines. Unrated time remains visible but is not charged.

![Invoice preview with line items and total](images/invoice-preview.png)

## Add charges or discounts

Use **Additional lines** for up to **20** extra charges or discounts in the invoice currency. They are included in the subtotal and tax calculation.

Finish or remove every draft line before printing or saving. **Enter** applies a line description to the preview; **Shift+Enter** adds a newline. Applying a line changes the preview but does not save an invoice file.

## Invoice numbers and saved copies

Clockoli reserves an invoice number the first time you **Print** or **Save as PDF** for that preview. The counter cannot be moved backward by importing or saving settings.

Clockoli **does not archive invoices**. Keep the PDFs or printed copies yourself. It also does not send invoices, track payment status, or provide recurring invoices, retainers, reminders, or payment links.

Invoice details, rates, and bank accounts stay in the current browser unless you export a settings backup. Protect that backup because it can contain sensitive financial information.

## When output is unavailable

A partial report may still show an invoice preview, but **Print** and **Save as PDF** stay disabled if repositories are missing, records conflict, or local changes are waiting to sync. Resolve the issue and reload Reports before issuing an invoice.

See [Reports](reports.md), [Billable rates](billable-rates.md), and [Invoice privacy](data-and-privacy.md#invoice-privacy).
