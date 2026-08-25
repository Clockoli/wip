import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../src/reports/reports.html', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../src/reports/reports.js', import.meta.url), 'utf8');
const reporting = fs.readFileSync(new URL('../src/domain/reporting.js', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../src/background/service-worker.js', import.meta.url), 'utf8');

test('reports page exposes periods, independent chart axes, facets, and direct export links', () => {
  for (const value of ['this-week', 'last-week', 'this-month', 'last-month', 'this-quarter', 'last-quarter', 'this-year', 'last-year', 'custom']) assert.match(html, new RegExp(`value="${value}"`));
  for (const id of ['metric', 'horizontal-axis', 'stack-by']) assert.match(html, new RegExp(`id="${id}"`));
  for (const value of ['total-time', 'avg-time', 'task-count']) assert.match(html, new RegExp(`value="${value}"`));
  for (const value of ['day', 'week', 'month', 'person', 'repository', 'task']) {
    assert.match(html, new RegExp(`<option value="${value}"`));
  }
  for (const id of ['people-facet', 'repositories-facet', 'analytics-chart', 'download-csv', 'download-json', 'download-pdf', 'print-timesheet', 'print-brand', 'print-detail-table', 'print-task-table', 'loading-progress', 'loading-label']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /Time by day, person and task/);
  assert.match(html, /Total time by task/);
  assert.match(js, /buildPrintableTimesheet\(filtered\)/);
  assert.doesNotMatch(html, /Filter people|Filter repositories|id="export-format"|id="download-timesheet"|>Format</);
  assert.match(html, /aria-label="Search people"/);
  assert.match(html, /aria-label="Search sources"/);
  assert.match(html, /aria-label="Download CSV timesheet"/);
  assert.match(html, /aria-label="Download JSON timesheet"/);
  assert.match(html, /aria-label="Print report or save as PDF"/);
  assert.doesNotMatch(html, /id="settings"|id="source"/);
  assert.match(js, /window\.print\(\)/);
  assert.match(js, /reportPdfTitle\(state\.range, state\.people\)/);
  assert.match(js, /type:\s*'GET_EXCHANGE_RATES'/);
  assert.match(js, /Loading exchange rates/);
  assert.match(js, /REPORT_PROGRESS/);
  assert.match(js, /state\.progressRequestId === requestId/);
  assert.match(js, /Unselect all/);
  assert.match(js, /tracked · \${option\.count}.*entries/);
  assert.match(js, /type:\s*'LOAD_REPORT'/);
  assert.match(js, /new Blob/);
  assert.match(js, /reportFilename/);
  assert.doesNotMatch(js, /innerHTML|outerHTML|eval\s*\(|new Function/);
  assert.match(js, /function render\(\) \{\s*if \(!state\.range\) return;/);
  assert.match(js, /requestId !== state\.requestId/);
  assert.match(worker, /\['LOAD_REPORT', 'CANCEL_REPORT', 'GET_EXCHANGE_RATES'\]\.includes\(message\?\.type\)/);
  assert.match(worker, /previous\.controller\.abort\(\)/);
  assert.match(worker, /await previous\.promise\.catch/);
  assert.match(worker, /await Promise\.allSettled/);
  assert.match(worker, /async function loadReport[\s\S]*ensureDataVersion\(3\)/);
  assert.match(worker, /function syncPendingNow[\s\S]*ensureDataVersion\(3\)/);
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
  assert.match(html, /<option value="last-week" selected>Last week<\/option>/);
  assert.match(html, /<option value="day" selected>Day<\/option>/);
  assert.match(html, /<option value="person" selected>Person<\/option>/);
  assert.match(html, /<option value="total-time" selected>Total time<\/option>/);
  assert.doesNotMatch(html, /<option value="week" selected>/);
  assert.match(js, /const initial = periodRange\('last-week'/);
  assert.match(js, /state\.people = new Set\(result\.currentUser \? \[result\.currentUser\] : \[\]\)/);
  assert.match(js, /state\.progressValue = Math\.max\(state\.progressValue/);
  assert.match(js, /Task URL \/ title/);
  assert.doesNotMatch(js, /Repositories:/);
});
