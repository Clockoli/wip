import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/addons/clockify/detailed-report-button.js', import.meta.url), 'utf8');

test('Clockify Detailed Report adapter is route-scoped and anchors after native EXPORT', () => {
  assert.match(source, /location\.hostname === 'app\.clockify\.me'/);
  assert.match(source, /DETAILED_REPORT_PATH = '\/reports\/detailed'/);
  assert.match(source, /querySelectorAll\?\.\('button, \[role="button"\]'\)/);
  assert.match(source, /labelOf\(element\) === NATIVE_EXPORT_LABEL/);
  assert.match(source, /nativeExport\.after\(button, status\)/);
  assert.match(source, /MutationObserver/);
});

test('Clockify adapter arms a separate capture bridge without invoking native export', () => {
  assert.match(source, /BUTTON_ID = 'clockoli-clockify-detailed-export'/);
  assert.match(source, /chrome\.runtime\.getURL\('src\/assets\/clockoli-32\.png'\)/);
  assert.match(source, /button\.type = 'button'/);
  assert.match(source, /cursor: 'pointer'/);
  assert.match(source, /clockoli:clockify-detailed-report-arm/);
  assert.match(source, /const EVENT_TARGET = document;/);
  assert.doesNotMatch(source, /CAPTURE_EVENT/);
  assert.match(source, /CAPTURE_PAYLOAD_ATTRIBUTE = 'data-clockoli-clockify-capture-payload'/);
  assert.match(source, /function consumeCapturedPayload\(\)/);
  assert.doesNotMatch(source, /event\.data\?\.type !== CAPTURE_MESSAGE/);
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
  assert.match(source, /STATUS_ID = 'clockoli-clockify-detailed-capture-status'/);
  assert.match(source, /Clockoli is armed — refresh this report to capture it\./);
  assert.match(source, /clockoli:clockify-detailed-report-disarm/);
  assert.match(source, /PROGRESS_EVENT = 'clockoli:clockify-detailed-report-progress'/);
  assert.match(source, /Button click received — arming Clockoli capture bridge/);
  assert.match(source, /Clockoli preview failed in background\. Code:/);
  assert.match(source, /200 results per page/i);
  assert.match(source, /page_captured/);
  assert.match(source, /function requestNextPage\(button, deadline = Date\.now\(\) \+ 1500\)/);
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
  assert.match(source, /CLOCKIFY_ARM_CAPTURE/);
  assert.match(source, /CLOCKIFY_IS_CAPTURE_ARMED/);
  assert.match(source, /data-clockoli-clockify-capture-arm/);
  assert.match(source, /persisted_arm_restored/);
  assert.match(source, /page_size_native_select_scan/);
  assert.match(source, /page_size_custom_control_click_dispatched/);
  assert.match(source, /control\?\.closest\?\.\('\.cl-dropdown'\)/);
  assert.match(source, /dropdown\?\.querySelectorAll\?\.\('\.cl-dropdown-item'\)/);
  assert.doesNotMatch(source, /document\.querySelectorAll\?\.\('button, \[role="button"\], \[role="option"\], \[tabindex\], \.cl-dropdown-item'\)/);
  assert.doesNotMatch(source, /findNativeExport\(\)\?\.click\(\)/);
});

test('Clockify adapter only considers a validated captured page as the initial report response', () => {
  assert.match(source, /if \(code === 'page_captured' \|\| code === 'captured_sanitized'\) initialReportResponseObserved = true;/);
  assert.doesNotMatch(source, /if \(code === 'report_response_observed'\) initialReportResponseObserved = true;/);
});

test('Clockify adapter reloads a one-page report after the explicit capture gesture', () => {
  assert.match(source, /one_page_report_reload/);
  assert.match(source, /location\.reload\(\)/);
  assert.doesNotMatch(source, /findNativeExport\(\)\?\.click\(\)/);
});

test('Clockify adapter contains no provider/session collection or persistence APIs', () => {
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|connect|cookies|localStorage|sessionStorage|Authorization|X-Auth-Token|Socket-Connection-ID)\b/i);
});
