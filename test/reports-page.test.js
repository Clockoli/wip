import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const html = fs.readFileSync(new URL('../src/reports/reports.html', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../src/reports/reports.js', import.meta.url), 'utf8');
const reporting = fs.readFileSync(new URL('../src/domain/reporting.js', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../src/background/service-worker.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../src/reports/reports.css', import.meta.url), 'utf8');
const html2pdfBundle = fs.readFileSync(new URL('../src/vendor/html2pdf.bundle.min.js', import.meta.url));

test('vendored html2pdf bundle is the reviewed 0.14.0 artifact', () => {
  assert.equal(createHash('sha256').update(html2pdfBundle).digest('hex'), '2be8dd6f51226c102898621d20c355cf4da81d596846622ddb13b5b55709496e');
});

test('reports page exposes periods, independent chart axes, facets, and direct export links', () => {
  for (const value of ['this-week', 'last-week', 'this-month', 'last-month', 'this-quarter', 'last-quarter', 'this-year', 'last-year', 'today', 'yesterday', 'last-7-days', 'last-30-days']) assert.match(html, new RegExp(`id="preset-${value}"`));
  for (const id of ['metric', 'horizontal-axis', 'stack-by']) assert.match(html, new RegExp(`id="${id}"`));
  for (const value of ['total-time', 'avg-time', 'task-count']) assert.match(html, new RegExp(`value="${value}"`));
  for (const value of ['day', 'week', 'month', 'person', 'repository', 'time-repository', 'task']) {
    assert.match(html, new RegExp(`<option value="${value}"`));
  }
  for (const id of ['people-facet', 'projects-facet', 'repositories-facet', 'timeRepositories-facet', 'analytics-chart', 'download-csv', 'download-json', 'download-pdf', 'print-timesheet', 'print-brand', 'print-detail-table', 'print-task-table', 'loading-progress', 'loading-label']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /Time by day, person and task/);
  assert.match(html, /Total time by task/);
  assert.match(js, /buildPrintableTimesheet\(filtered\)/);
  assert.doesNotMatch(html, /Filter people|Filter repositories|id="export-format"|id="download-timesheet"|>Format</);
  assert.match(html, /aria-label="Search people"/);
  assert.match(html, /aria-label="Search projects"/);
  assert.match(html, /aria-label="Search sources"/);
  assert.match(html, /aria-label="Search time repositories"/);
  assert.match(html, /aria-label="Download CSV timesheet"/);
  assert.match(html, /aria-label="Download JSON timesheet"/);
  assert.match(html, /aria-label="Print report"/);
  assert.doesNotMatch(html, /aria-label="Print report or save as PDF"/);
  assert.doesNotMatch(html, /id="settings"|id="source"/);
  assert.match(js, /window\.print\(\)/);
  assert.match(js, /reportPdfTitle\(state\.range, state\.people\)/);
  assert.match(js, /type:\s*'GET_EXCHANGE_RATES'/);
  assert.match(js, /Loading exchange rates/);
  assert.match(js, /REPORT_PROGRESS/);
  assert.match(js, /state\.progressRequestId === requestId/);
  assert.match(js, /Unselect all/);
  assert.match(js, /state\.projects = new Set/);
  assert.match(js, /projectDefinitions/);
  assert.match(js, /tracked · \${option\.count}.*entries/);
  assert.match(js, /type:\s*'LOAD_REPORT'/);
  assert.match(js, /new Blob/);
  assert.match(js, /reportFilename/);
  assert.doesNotMatch(js, /innerHTML|outerHTML|eval\s*\(|new Function/);
  assert.match(js, /function render\(\) \{\s*if \(!state\.range\) return;/);
  assert.match(js, /requestId !== state\.requestId/);
  assert.match(worker, /\['LOAD_REPORT', 'LOAD_TASK_PARTICIPANTS', 'CANCEL_REPORT', 'GET_EXCHANGE_RATES'\]\.includes\(message\?\.type\)/);
  assert.match(worker, /previous\.controller\.abort\(\)/);
  assert.match(worker, /await previous\.promise\.catch/);
  assert.match(worker, /await Promise\.allSettled/);
  assert.match(worker, /async function loadReport[\s\S]*ensureDataVersion\(5\)/);
  assert.match(worker, /function syncPendingNow[\s\S]*syncPendingAll\(\{ store, trackerForDestination \}\)/);
  assert.match(js, /type:\s*'CANCEL_REPORT'/);
  assert.match(js, /Math\.max\(320, analytics\.buckets\.length \* 92 \+ 100\)/);
});

test('high-cardinality analytics stays sparse in aggregation and the collapsed details table', () => {
  assert.doesNotMatch(reporting, /seriesList\.filter\(/);
  assert.doesNotMatch(js, /analytics\.series\.map\(item => formatMetricValue/);
  assert.match(js, /if \(!\$\('analytics-details'\)\.open\) return;/);
  assert.match(js, /for \(const segment of bucket\.segments\)/);
});


test('reports use requested defaults, monotonic progress and task identity labels', () => {
  assert.match(html, /id="preset-last-week"[^>]*aria-current="true">Last week<\/button>/);
  assert.match(html, /<option value="day" selected>Day<\/option>/);
  assert.match(html, /<option value="person" selected>Person<\/option>/);
  assert.match(html, /<option value="total-time" selected>Total time<\/option>/);
  assert.doesNotMatch(html, /<option value="week" selected>/);
  assert.match(js, /const initial = \{ \.\.\.periodRange\('last-week'/);
  assert.match(js, /const currentUsers = result\.currentUsers \? Object\.values\(result\.currentUsers\) : \(result\.currentUser \? \[result\.currentUser\] : \[\]\)/);
  assert.match(js, /state\.people = new Set\(currentUsers\.filter\(Boolean\)\)/);
  assert.match(js, /state\.progressValue = Math\.max\(state\.progressValue/);
  assert.match(js, /Task URL \/ title/);
  assert.doesNotMatch(js, /['"`]Repositories:/);
});

test('recoverable queued entry-edit conflicts keep the background retry alarm alive', () => {
  assert.match(worker, /function hasRunnablePending\(queue\) \{[\s\S]*?\['editEntry', 'editEntries', 'deleteEntry'\]\.includes\(operation\) && first\.conflictReason !== 'queued_entry_missing'/);
  assert.match(worker, /function shouldContinuePendingSync\(\)[\s\S]*getPendingDestinationIds\(\)[\s\S]*destinationIds\.some\(destinationId => hasRunnablePending\(entries\[destinationId\]\?\.pendingWrites\)\)/);
  assert.match(worker, /if \(await shouldContinuePendingSync\(\)\) \{\s*chrome\.alarms\.create\('sync-pending-now', \{ when: Date\.now\(\) \+ 5_000 \}\)/);
  assert.match(worker, /if \(await shouldContinuePendingSync\(\)\.catch\(\(\) => false\)\) \{\s*chrome\.alarms\.create\('sync-pending-now', \{ when: Date\.now\(\) \+ 5_000 \}\)/);
});


test('reports mounts the shared running status directly below the tabs', () => {
  assert.match(html, /<\/nav>\s*<\/div>\s*<div id="running-status"/);
  assert.match(html, /href="\.\.\/styles\/running-status\.css"/);
  assert.match(js, /import \{ mountRunningStatus \} from '\.\.\/ui\/running-status\.js'/);
  assert.match(js, /mountRunningStatus\(\$\('running-status'\), \{ send \}\)/);
});

test('reports exposes local invoice preview, export, numbering and print contracts', () => {
  for (const id of [
    'create-invoice', 'invoice-dialog', 'invoice-client', 'invoice-currency', 'invoice-group-by',
    'invoice-issue-date', 'invoice-billing-period', 'invoice-preview', 'invoice-feedback', 'invoice-print', 'invoice-save-pdf',
    'invoice-extra-lines', 'invoice-add-line', 'invoice-close', 'print-invoice',
  ]) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(js, /buildInvoice\(/);
  assert.match(js, /type:\s*'RESERVE_INVOICE_NUMBER'/);
  assert.match(js, /function renderInvoiceDocument\(container, invoice\)/);
  assert.match(js, /invoice\.seller\?\.name/);
  assert.match(html, /<script src="\.\.\/vendor\/html2pdf\.bundle\.min\.js"><\/script>/);
  assert.match(html, /<link rel="license" href="\.\.\/vendor\/html2pdf\.LICENSE\.txt">/);
  assert.match(js, /globalThis\.html2pdf\(\)\.set\(/);
  assert.match(js, /html2canvas:\s*\{[^}]*scale:\s*2/);
  assert.match(js, /pagebreak:\s*\{[^}]*avoid:\s*\['tr'/);
  assert.doesNotMatch(js, /function buildInvoicePdf|function pdfLiteralText|new Blob\(\[buildInvoicePdf/);
  assert.match(js, /if \(saveAsPdf\) \{[\s\S]*await saveInvoicePdf\(invoice\)/);
  assert.match(js, /formatInvoiceDate/);
  assert.match(js, /invoiceTaskCell/);
  assert.doesNotMatch(js, /'Rate'/);
  assert.match(styles, /body\.printing-invoice \.print-timesheet\{display:none!important\}/);
  assert.match(styles, /body\.printing-invoice \.print-invoice\{display:block\}/);
  assert.match(styles, /dialog\{display:none!important\}/);
  const additional = html.slice(html.indexOf('class="invoice-additional-control"'), html.indexOf('id="invoice-feedback"'));
  assert.ok(additional.indexOf('Additional lines') < additional.indexOf('id="invoice-extra-lines"'));
  assert.ok(additional.indexOf('id="invoice-extra-lines"') < additional.indexOf('id="invoice-add-line"'));
  assert.match(html, /<section class="invoice-preview-region"[^>]*aria-labelledby="invoice-preview-title"[\s\S]*<h3 id="invoice-preview-title">Preview<\/h3>[\s\S]*id="invoice-preview"[\s\S]*Choose a client and currency to preview the invoice\./);
  assert.match(styles, /\.invoice-preview\{[^}]*padding:[^}]*border:1px solid var\(--borderColor-default\)/);
  assert.match(styles, /\.invoice-document\.invoice-pdf-export\{[^}]*width:718px!important/);
  assert.match(styles, /\.invoice-pdf-export \.invoice-table\{[^}]*table-layout:fixed!important/);
  assert.match(styles, /\.invoice-pdf-export tr,[^{]+\{break-inside:avoid;page-break-inside:avoid\}/);
  assert.match(styles, /\.invoice-pdf-export \.invoice-table-by-task th:nth-child\(4\)\{width:18%\}/);
});

test('invoice controls name the billing period and keep only print exports', () => {
  assert.match(html, /<label>Start <input id="start-date"/); assert.match(html, /<label>End <input id="end-date"/);
  for (const id of ['this-month', 'last-month', 'last-7-days', 'last-30-days']) assert.match(html, new RegExp(`id="preset-${id}"`));
  assert.doesNotMatch(html + js, /invoice-download-csv|invoice-download-json|invoice-due-days|invoiceCsv|invoiceJson|invoiceFilename/);
});

test('invoice print paper overrides the app theme even when later stylesheets load dark tokens', () => {
  assert.match(styles, /@media print\{[\s\S]*body\.printing-invoice,body\.printing-invoice main\{color-scheme:light;background:#fff;color:#000\}/);
  assert.match(styles, /\.invoice-dates,\.invoice-period,\.invoice-date-cell\{font-variant-numeric:tabular-nums\}/);
  assert.match(styles, /\.invoice-notes,\.invoice-terms\{max-width:68ch\}/);
});


test('date range picker replaces the old controls with one accessible trigger and dialog', () => {
  assert.match(html, /id="period-trigger"[^>]*aria-haspopup="dialog"[^>]*aria-expanded="false"/);
  assert.match(html, /id="period-popover"[^>]*role="dialog"[^>]*hidden/);
  for (const id of ['period', 'custom-period', 'apply-period', 'report-range']) assert.doesNotMatch(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(styles, /\.period-presets|\.period-select|\.custom-period|#report-range/);
  assert.match(html, /id="reporting-utc"[^>]*role="switch"/);
});
