import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/addons/clockify/detailed-report-button.js', import.meta.url), 'utf8');

test('Clockify Detailed Report adapter is route-scoped and places its banner above the native report toolbar', () => {
  assert.match(source, /location\.hostname === 'app\.clockify\.me'/);
  assert.match(source, /DETAILED_REPORT_PATH = '\/reports\/detailed'/);
  assert.match(source, /querySelectorAll\?\.\('button, \[role="button"\]'\)/);
  assert.match(source, /labelOf\(element\) === NATIVE_EXPORT_LABEL/);
  assert.match(source, /const toolbar = reportToolbarContainer\(nativeExport\)/);
  assert.match(source, /toolbar\.before\(banner\)/);
  assert.match(source, /const waitForToolbar = \(\) =>/);
  assert.doesNotMatch(source, /MutationObserver/);
});

test('Clockify adapter arms a separate capture bridge without invoking native export', () => {
  assert.match(source, /BUTTON_ID = 'clockoli-clockify-detailed-export'/);
  assert.match(source, /chrome\.runtime\.getURL\('src\/assets\/clockoli-32\.png'\)/);
  assert.match(source, /button\.type = 'button'/);
  assert.match(source, /cursor: 'pointer'/);
  assert.match(source, /clockoli:clockify-detailed-report-arm/);
  assert.match(source, /const EVENT_TARGET = document;/);
  assert.match(source, /CAPTURE_MESSAGE = 'clockoli:clockify-detailed-report-captured'/);
  assert.match(source, /event\.data\?\.type === CAPTURE_MESSAGE/);
  assert.doesNotMatch(source, /CAPTURE_PAYLOAD_ATTRIBUTE/);
  assert.match(source, /event\.data\?\.type !== PROGRESS_MESSAGE/);
  assert.match(source, /let pendingCaptureText = null;/);
  assert.match(source, /setTimeout\(forwardPendingCapture, 100\)/);
  assert.match(source, /function forwardPendingCapture\(\)/);
  assert.match(source, /pendingCaptureText = text;/);
  assert.match(source, /restoredCaptureArm = true;/);
  assert.match(source, /forwardPendingCapture\(\);/);
  assert.match(source, /event\.preventDefault\(\)/);
  assert.match(source, /event\.stopImmediatePropagation\(\)/);
  assert.match(source, /type: 'CLOCKIFY_CAPTURED_REPORT'/);
  assert.match(source, /const YEAR_REQUEST_EVENT = 'clockoli:clockify-detailed-report-request-year'/);
  assert.match(source, /function requestReportYear\(year, mode\) \{\n\s*armBridge\(mode, year\);\n\s*EVENT_TARGET\.dispatchEvent/);
  assert.match(source, /type: 'CLOCKIFY_YEAR_OBSERVED', entryCount: event\.data\.entryCount, year: event\.data\.year/);
  assert.match(source, /function requestYearCsv\(button, year\) \{[\s\S]*if \(armedButton !== button \|\| armRequest !== request\) return;/);
  assert.match(source, /function requestDiscoveryYear\(button, year, deadline = Date\.now\(\) \+ 180_000\) \{[\s\S]{0,700}requestReportYear\(year, 'discover'\);/);
  assert.doesNotMatch(source, /table\.cl-detailed-reports-table tbody tr/);
  assert.match(source, /No export is requested\./);
  assert.match(source, /EVENT_TARGET\.dispatchEvent\(new CustomEvent\(YEAR_REQUEST_EVENT, \{ detail: \{ year, mode \} \}\)/);
  assert.match(source, /'CLOCKIFY_ARM_CSV_CAPTURE'/);
  assert.match(source, /response\.data\?\.discovering/);
  assert.match(source, /response\.data\?\.capturing/);
  assert.match(source, /response\.data\?\.continuing/);
  assert.match(source, /captureHistory = response\.data\.history/);
  assert.doesNotMatch(source, /location\.assign\(/);
  assert.match(source, /STATUS_ID = 'clockoli-clockify-detailed-capture-status'/);
  assert.match(source, /CAPTURE_PARSING_MESSAGE = 'Parsing Clockify data\.'/);
  assert.match(source, /clockoli:clockify-detailed-report-disarm/);
  assert.match(source, /PROGRESS_EVENT = 'clockoli:clockify-detailed-report-progress'/);
  assert.match(source, /setCaptureState\(button, true, CAPTURE_PARSING_MESSAGE\)/);
  assert.match(source, /Clockoli preview failed in background\. Code:/);
  assert.match(source, /200 results per page/i);
  assert.match(source, /page_captured/);
  assert.match(source, /function requestNextPage\(button, deadline = Date\.now\(\) \+ 60_000\)/);
  assert.match(source, /function resumeCaptureAfterReload\(button, deadline = Date\.now\(\) \+ 10_000\)/);
  assert.doesNotMatch(source, /deadline = Date\.now\(\) \+ (?:[0-9]{1,3}|[1-9]_[0-9]{1,3})\)/);
  assert.match(source, /function waitForInitialReport\(button, applyDispatched = false, deadline = Date\.now\(\) \+ 60_000\)/);
  assert.match(source, /armBridge\(\);\n\s*previous\.click\(\);/);
  assert.match(source, /function arrowPageControl\(direction\)/);
  assert.match(source, /button\.cl-page-link/);
  assert.match(source, /setTimeout\(\(\) => requestNextPage\(button, deadline\), 50\)/);
  assert.match(source, /ITEMS PER PAGE/);
  assert.match(source, /paginationRange/);
  assert.match(source, /chooseCustomPageSize/);
  assert.match(source, /\.cl-dropdown-item/);
  assert.match(source, /li, div, span/);
  assert.match(source, /\\d\+\\s\*\[-–\]\\s\*\\d\+/);
  assert.match(source, /li\.cl-page-item > button/);
  assert.match(source, /if \(buttons\.length\) return buttons;/);
  assert.match(source, /page_size_custom_control_found/);
  assert.match(source, /page_size_option_scan/);
  assert.match(source, /page_size_option_click_dispatched/);
  assert.match(source, /page_size_option_waiting/);
  assert.match(source, /page_size_confirmation_scan/);
  assert.match(source, /page_size_confirmed/);
  assert.match(source, /function refreshAtCurrentPageSize\(button, control/);
  assert.match(source, /bridge_paused_for_page_size_refresh/);
  assert.match(source, /page_size_refresh_option_click_dispatched/);
  assert.match(source, /initial_report_response_waiting/);
  assert.match(source, /initial_report_apply_click_dispatched/);
  assert.match(source, /REPORT_RESPONSE_UNAVAILABLE/);
  assert.match(source, /CLOCKIFY_ARM_CSV_CAPTURE/);
  assert.match(source, /CLOCKIFY_IS_CAPTURE_ARMED/);
  assert.match(source, /data-clockoli-clockify-capture-arm/);
  assert.match(source, /persisted_arm_restored/);
  assert.match(source, /page_size_native_select_scan/);
  assert.match(source, /page_size_custom_control_click_dispatched/);
  assert.match(source, /control\?\.closest\?\.\('\.cl-dropdown'\)/);
  assert.match(source, /dropdown\?\.querySelectorAll\?\.\('\.cl-dropdown-item'\)/);
  assert.doesNotMatch(source, /document\.querySelectorAll\?\.\('button, \[role="button"\], \[role="option"\], \[tabindex\], \.cl-dropdown-item'\)/);
  assert.match(source, /nativeExport\.click\(\)/);
  assert.match(source, /labelOf\(element\) === 'SAVE AS CSV'/);
  assert.match(source, /'CLOCKIFY_ARM_CSV_CAPTURE'/);
  assert.match(source, /type: 'CLOCKIFY_CAPTURED_CSV'/);
});

test('Migrate is a high-contrast primary action within the green banner', () => {
  assert.match(source, /background: '#fff'/);
  assert.match(source, /border: '1px solid rgba\(255, 255, 255, 0\.82\)'/);
  assert.match(source, /color: '#0f6b3a'/);
  assert.match(source, /boxShadow: '0 8px 18px rgba\(4, 46, 25, 0\.28\)'/);
});

test('the right-side Clockoli action is a labelled Migrate button and preserves an explicit cancel state', () => {
  assert.match(source, /button\.setAttribute\('aria-label', 'Migrate Clockify history into Clockoli'\)/);
  assert.match(source, /actionLabel\.textContent = 'Migrate'/);
  assert.match(source, /function setCaptureButtonLabel\(button, label\)/);
  assert.match(source, /setCaptureButtonLabel\(button, 'Cancel capture'\)/);
  assert.match(source, /setCaptureButtonLabel\(button, 'Migrate'\)/);
});

test('Clockify offers a secondary page-by-page migration action that arms the report capture transport', () => {
  assert.match(source, /PAGE_BUTTON_ID = 'clockoli-clockify-detailed-page-migration'/);
  assert.match(source, /Migrate page by page/);
  assert.match(source, /startCapture\(button, 'report'\)/);
  assert.match(source, /transport === 'report' \? 'CLOCKIFY_ARM_CAPTURE' : 'CLOCKIFY_ARM_CSV_CAPTURE'/);
  assert.match(source, /function requestYearPages\(button, year\) \{[\s\S]*requestReportYear\(year, 'report'\);/);
  assert.match(source, /button\.addEventListener\('click', event => \{[\s\S]*if \(armedButton === button\) \{[\s\S]*disarmBridge\(\);/);
  assert.match(source, /pageButton\.disabled = armed && !pageCaptureActive;/);
});

test('Clockify capture progress is a green, Clockoli-branded banner above the native report toolbar', () => {
  assert.match(source, /BANNER_ID = 'clockoli-clockify-capture-banner'/);
  assert.match(source, /function reportToolbarContainer\(nativeExport\)/);
  assert.match(source, /toolbar\.before\(banner\)/);
  assert.match(source, /className = 'clockoli-capture-stage'/);
  assert.match(source, /className = 'clockoli-capture-detail'/);
  assert.match(source, /chrome\.runtime\.getURL\('src\/assets\/clockoli-32\.png'\)/);
  assert.match(source, /background: 'linear-gradient\(135deg, #0f6b3a, #18864a\)'/);
  assert.match(source, /button\.style\.background = '#0f6b3a'/);
  assert.match(source, /Clockoli migration/);
  assert.match(source, /button\.style\.boxShadow/);
});

test('Clockify capture keeps transport details out of the user-facing status', () => {
  assert.match(source, /Parsing Clockify data/);
  assert.doesNotMatch(source, /Ignored a non-JSON report candidate/);
  assert.doesNotMatch(source, /Safe report payload captured/);
  assert.doesNotMatch(source, /Capture bridge (?:armed|restored)/);
  assert.doesNotMatch(source, /Captured a page — requesting the next Clockify report page/);
});

test('capture scans years before rendering a determinate annual progress bar', () => {
  assert.match(source, /function renderCaptureProgress\(status, armed, history = captureHistory\)/);
  assert.match(source, /className = 'clockoli-capture-progress-container'/);
  assert.match(source, /className = 'clockoli-capture-progress-label'/);
  assert.match(source, /progress\.max = totalYears/);
  assert.match(source, /progress\.value = completedYears/);
  assert.match(source, /Clockify history capture: \$\{completedYears\} of \$\{totalYears\} years complete/);
  assert.match(source, /History capture · \$\{completedYears\} of \$\{totalYears\} years\$\{activeYearLabel\}/);
  assert.match(source, /Scanning Clockify\$\{scanningYear\}/);
  assert.match(source, /nativeExport\.click\(\)/);
  assert.match(source, /labelOf\(element\) === 'SAVE AS CSV'/);
  assert.match(source, /const historyYear = history\?\.yearsWithEntries\?\.\[completedYears\]/);
  assert.match(source, /response\.data\?\.capturing/);
  assert.match(source, /captureHistory = response\.data\.history/);
});

test('Clockify capture fills its determinate bar only from the background-confirmed annual history plan', () => {
  assert.match(source, /response\.data\?\.continuing/);
  assert.match(source, /captureHistory = response\.data\.history/);
  assert.match(source, /renderCaptureProgress\(status, true, captureHistory\)/);
  assert.doesNotMatch(source, /%\s*(?:complete|imported|captured)/i);
});

test('Clockify capture names real post-parse preparation phases without exposing report data', () => {
  assert.match(source, /CAPTURE_PHASE_MESSAGE = 'CLOCKIFY_CAPTURE_PHASE'/);
  assert.match(source, /Saving parsed Clockify report/);
  assert.match(source, /Checking available task projects/);
  assert.match(source, /Preparing task suggestions for preview/);
  assert.match(source, /Saving the migration preview/);
  assert.match(source, /Opening the migration preview/);
  assert.match(source, /captureParsingProgress = null;/);
  assert.doesNotMatch(source, /entry\.description|entry\.task|entry\.project/);
});

test('Clockify adapter only considers a validated captured page as the initial report response', () => {
  assert.match(source, /if \(code === 'page_captured' \|\| code === 'captured_sanitized'\) initialReportResponseObserved = true;/);
  assert.match(source, /function receiveCaptureText\(text\) \{\n    if \(typeof text !== 'string'\) return;\n    initialReportResponseObserved = true;/);
  assert.doesNotMatch(source, /if \(code === 'report_response_observed'\) initialReportResponseObserved = true;/);
  assert.match(source, /report_year_mismatch: 'Clockify returned a completed report for a different year; waiting for the requested year\.'/);
  assert.match(source, /response_not_json: 'Clockify is still preparing the requested report\.'/);
});

test('Clockify discovery retries a transient native report failure within its existing deadline', () => {
  assert.match(source, /let discoveryDeadline = null;/);
  assert.match(source, /let discoveryRetryTimer = null;/);
  assert.match(source, /function retryDiscoveryReport\(button\) \{/);
  assert.match(source, /setTimeout\(\(\) => \{[\s\S]*requestDiscoveryYear\(button, year, deadline\);/);
  assert.match(source, /\['report_response_not_success', 'report_request_failed'\]\.includes\(code\) && Number\.isInteger\(discoveryYear\)/);
  assert.match(source, /clearTimeout\(discoveryRetryTimer\);/);
});

test('Clockify adapter reloads a one-page report after the explicit capture gesture', () => {
  assert.match(source, /one_page_report_reload/);
  assert.match(source, /location\.reload\(\)/);
  assert.match(source, /nativeExport\.click\(\)/);
  assert.match(source, /labelOf\(element\) === 'SAVE AS CSV'/);
  assert.match(source, /'CLOCKIFY_ARM_CSV_CAPTURE'/);
  assert.match(source, /type: 'CLOCKIFY_CAPTURED_CSV'/);
});

test('Clockify adapter contains no provider/session collection or persistence APIs', () => {
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|connect|cookies|localStorage|sessionStorage|Authorization|X-Auth-Token|Socket-Connection-ID)\b/i);
});

test('a cancelled arm request cannot start a late capture after its background response arrives', () => {
  assert.match(source, /const request = \+\+armRequest;/);
  assert.match(source, /sendMessage\(\{ type, startedAt: Date\.now\(\) \}, response => \{\n\s*if \(armRequest !== request \|\| armedButton !== button\) return;/);
  assert.match(source, /const request = armRequest;\n\s*chrome\.runtime\.sendMessage\(\{ type: 'CLOCKIFY_YEAR_OBSERVED'[\s\S]*?response => \{\n\s*if \(armRequest !== request \|\| armedButton !== button\) return;/);
  assert.match(source, /const request = armRequest;\n\s*chrome\.runtime\.sendMessage\(\{ type: 'CLOCKIFY_CAPTURED_CSV'[\s\S]*?response => \{\n\s*if \(armRequest !== request \|\| armedButton !== button\) return;/);
  assert.match(source, /const request = armRequest;\n\s*chrome\.runtime\.sendMessage\(\{ type: 'CLOCKIFY_CAPTURED_REPORT'[\s\S]*?response => \{\n\s*if \(armRequest !== request \|\| armedButton !== button\) return;/);
});
