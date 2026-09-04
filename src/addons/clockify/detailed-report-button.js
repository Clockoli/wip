(() => {
  'use strict';

  const BUTTON_ID = 'clockoli-clockify-detailed-export';
  const DETAILED_REPORT_PATH = '/reports/detailed';
  const NATIVE_EXPORT_LABEL = 'EXPORT';
  const ARM_EVENT = 'clockoli:clockify-detailed-report-arm';
  const RECEIVER_READY_EVENT = 'clockoli:clockify-detailed-report-receiver-ready';
  const DISARM_EVENT = 'clockoli:clockify-detailed-report-disarm';

  const PROGRESS_EVENT = 'clockoli:clockify-detailed-report-progress';

  const PROGRESS_MESSAGE = 'clockoli:clockify-detailed-report-progress';
  const BRIDGE_ARM_ATTRIBUTE = 'data-clockoli-clockify-capture-arm';
  const RECEIVER_READY_ATTRIBUTE = 'data-clockoli-clockify-capture-receiver-ready';
  const CAPTURE_PAYLOAD_ATTRIBUTE = 'data-clockoli-clockify-capture-payload';
  const EVENT_TARGET = document;
  const STATUS_ID = 'clockoli-clockify-detailed-capture-status';
  const PAGE_SIZE = 200;
  let observer = null;
  let scheduled = false;
  let armedButton = null;
  let pendingCaptureText = null;
  let initialReportResponseObserved = false;
  let restoredCaptureArm = false;
  let armRequest = 0;

  function log(code, detail = '') {
    console.info('[Clockoli Clockify capture]', code, detail);
  }

  function armBridge() {
    document.documentElement?.setAttribute(BRIDGE_ARM_ATTRIBUTE, 'armed');
    EVENT_TARGET.dispatchEvent(new CustomEvent(ARM_EVENT));
  }

  function disarmBridge() {
    armRequest += 1;
    restoredCaptureArm = false;
    pendingCaptureText = null;
    document.documentElement?.removeAttribute(BRIDGE_ARM_ATTRIBUTE);
    EVENT_TARGET.dispatchEvent(new CustomEvent(DISARM_EVENT));
    chrome.runtime.sendMessage({ type: 'CLOCKIFY_DISARM_CAPTURE' }, () => void chrome.runtime.lastError);
  }

  function restoreCaptureArm() {
    chrome.runtime.sendMessage({ type: 'CLOCKIFY_IS_CAPTURE_ARMED' }, response => {
      if (chrome.runtime.lastError || !onDetailedReport() || !response?.ok || !response.data?.armed) return;
      restoredCaptureArm = true;
      armBridge();
      log('persisted_arm_restored');
      schedulePlacement();
    });
  }

  function onDetailedReport() {
    return location.protocol === 'https:'
      && location.hostname === 'app.clockify.me'
      && location.pathname.replace(/\/+$/, '') === DETAILED_REPORT_PATH;
  }

  function labelOf(element) {
    return String(element?.getAttribute?.('aria-label') || element?.textContent || '')
      .replace(/\s+/g, ' ').trim().toUpperCase();
  }

  function findNativeExport() {
    const candidates = document.querySelectorAll?.('button, [role="button"]') || [];
    return [...candidates].find(element => labelOf(element) === NATIVE_EXPORT_LABEL) || null;
  }

  function enabled(element) {
    return Boolean(element) && !element.disabled && element.getAttribute?.('aria-disabled') !== 'true';
  }

  function pageControl(labels) {
    const candidates = document.querySelectorAll?.('button, [role="button"]') || [];
    return [...candidates].find(element => enabled(element) && labels.includes(labelOf(element))) || null;
  }

  function paginationRange() {
    const elements = document.querySelectorAll?.('button, [role="button"], li, div, span') || [];
    return [...elements].find(element => /^\d+\s*[-–]\s*\d+\s+OF\s+\d+$/.test(labelOf(element))) || null;
  }

  function paginationButtons() {
    const range = paginationRange();
    for (let container = range?.parentElement, depth = 0; container && depth < 4; container = container.parentElement, depth += 1) {
      const buttons = [...(container.querySelectorAll?.('li.cl-page-item > button') || [])].filter(enabled);
      if (buttons.length) return buttons;
    }
    return [];
  }

  function customPageSizeControl() {
    const labels = document.querySelectorAll?.('button, [role="button"], div, span') || [];
    const itemsPerPage = [...labels].find(element => labelOf(element) === 'ITEMS PER PAGE');
    for (let container = itemsPerPage?.parentElement, depth = 0; container && depth < 4; container = container.parentElement, depth += 1) {
      const control = [...(container.querySelectorAll?.('button, [role="button"], [role="combobox"], [aria-haspopup="listbox"], [tabindex]') || [])]
        .find(element => enabled(element) && /^\d+$/.test(labelOf(element)));
      if (control) return control;
    }
    return null;
  }

  function waitForInitialReport(button, applyDispatched = false, deadline = Date.now() + 1500) {
    if (armedButton !== button || initialReportResponseObserved) return;
    if (Date.now() < deadline) {
      log('initial_report_response_waiting');
      setTimeout(() => waitForInitialReport(button, applyDispatched, deadline), 50);
      return;
    }
    if (!applyDispatched) {
      const apply = pageControl(['APPLY']);
      log('initial_report_apply_control_scan', `found=${Boolean(apply)}`);
      if (apply) {
        apply.click();
        log('initial_report_apply_click_dispatched');
        setCaptureState(button, true, '3/6 Requesting the first Clockify report page.');
        waitForInitialReport(button, true);
        return;
      }
    }
    log('initial_report_response_unavailable');
    disarmBridge();
    setCaptureState(button, false, 'Clockoli could not observe the first report page. Code: REPORT_RESPONSE_UNAVAILABLE.');
  }

  function confirmCustomPageSize(button, deadline = Date.now() + 1500) {
    const current = customPageSizeControl();
    const confirmed = labelOf(current) === String(PAGE_SIZE);
    log('page_size_confirmation_scan', `control_found=${Boolean(current)} confirmed=${confirmed}`);
    if (!confirmed && Date.now() < deadline) {
      log('page_size_confirmation_waiting');
      setTimeout(() => confirmCustomPageSize(button, deadline), 50);
      return;
    }
    if (!confirmed) {
      log('page_size_confirmation_unavailable');
      disarmBridge();
      setCaptureState(button, false, 'Clockoli could not confirm 200 results per page. Code: PAGINATION_UNAVAILABLE.');
      return;
    }
    log('page_size_confirmed');
    initialReportResponseObserved = false;
    setCaptureState(button, true, '2/6 200 results per page confirmed — waiting for Clockify.');
    waitForInitialReport(button);
  }

  function restoreTargetPageSize(button, refreshSize, deadline = Date.now() + 1500) {
    const control = customPageSizeControl();
    if (labelOf(control) !== refreshSize && Date.now() < deadline) {
      setTimeout(() => restoreTargetPageSize(button, refreshSize, deadline), 50);
      return;
    }
    if (labelOf(control) !== refreshSize) {
      log('page_size_refresh_unavailable');
      disarmBridge();
      setCaptureState(button, false, 'Clockoli could not refresh the Clockify report. Code: PAGINATION_UNAVAILABLE.');
      return;
    }
    armBridge();
    log('bridge_rearmed_after_page_size_refresh');
    control.click();
    chooseCustomPageSize(button, control);
  }

  function refreshAtCurrentPageSize(button, control, deadline = Date.now() + 1500) {
    const dropdown = control?.closest?.('.cl-dropdown');
    const candidates = dropdown?.querySelectorAll?.('.cl-dropdown-item') || [];
    const refresh = [...candidates].find(element => enabled(element) && /^\d+$/.test(labelOf(element)) && labelOf(element) !== String(PAGE_SIZE));
    if (refresh) {
      document.documentElement?.removeAttribute(BRIDGE_ARM_ATTRIBUTE);
      EVENT_TARGET.dispatchEvent(new CustomEvent(DISARM_EVENT));
      log('bridge_paused_for_page_size_refresh');
      refresh.click();
      log('page_size_refresh_option_click_dispatched');
      setCaptureState(button, true, '2/6 Refreshing the Clockify report before capturing 200 results per page.');
      restoreTargetPageSize(button, labelOf(refresh));
      return;
    }
    if (Date.now() < deadline) {
      setTimeout(() => refreshAtCurrentPageSize(button, control, deadline), 50);
      return;
    }
    log('page_size_refresh_unavailable');
    disarmBridge();
    setCaptureState(button, false, 'Clockoli could not refresh the Clockify report. Code: PAGINATION_UNAVAILABLE.');
  }

  function chooseCustomPageSize(button, control, deadline = Date.now() + 1500) {
    const dropdown = control?.closest?.('.cl-dropdown');
    const candidates = dropdown?.querySelectorAll?.('.cl-dropdown-item') || [];
    const pageSize = [...candidates].find(element => enabled(element) && labelOf(element) === String(PAGE_SIZE));
    log('page_size_option_scan', `dropdown_found=${Boolean(dropdown)} candidate_count=${candidates.length} match_found=${Boolean(pageSize)}`);
    if (pageSize) {
      if (labelOf(control) === String(PAGE_SIZE)) {
        refreshAtCurrentPageSize(button, control);
        return;
      }
      pageSize.click();
      log('page_size_option_click_dispatched');
      confirmCustomPageSize(button);
      return;
    }
    if (Date.now() < deadline) {
      log('page_size_option_waiting');
      setTimeout(() => chooseCustomPageSize(button, control, deadline), 50);
      return;
    }
    log('page_size_option_unavailable');
    disarmBridge();
    setCaptureState(button, false, 'Clockoli could not select 200 results per page. Code: PAGINATION_UNAVAILABLE.');
  }

  function configureFirstPage(button) {
    const selects = document.querySelectorAll?.('select') || [];
    const pageSizeLabel = new RegExp(`^${PAGE_SIZE}(?:\\s+(?:ROWS?|RESULTS?))?$`, 'i');
    const pageSize = [...selects].find(select => [...select.options || []].some(option => pageSizeLabel.test(String(option.textContent || option.value).trim())));
    const pageSizeOption = pageSize && [...pageSize.options].find(option => pageSizeLabel.test(String(option.textContent || option.value).trim()));
    log('page_size_native_select_scan', `select_count=${selects.length} control_found=${Boolean(pageSize)} option_found=${Boolean(pageSizeOption)}`);
    if (pageSize && pageSizeOption && pageSize.value !== pageSizeOption.value) {
      pageSize.value = pageSizeOption.value;
      pageSize.dispatchEvent(new Event('input', { bubbles: true }));
      pageSize.dispatchEvent(new Event('change', { bubbles: true }));
      log('page_size_native_select_change_dispatched');
      setCaptureState(button, true, '2/6 Requesting 200 results per page from Clockify.');
      return;
    }
    const customPageSize = customPageSizeControl();
    if (customPageSize) {
      log('page_size_custom_control_found');
      customPageSize.click();
      log('page_size_custom_control_click_dispatched');
      chooseCustomPageSize(button, customPageSize);
      setCaptureState(button, true, '2/6 Selecting 200 results per page from Clockify.');
      return;
    }
    log('page_size_custom_control_unavailable');
    const first = pageControl(['FIRST', 'FIRST PAGE']);
    const apply = pageControl(['APPLY']);
    const control = first || apply;
    if (control) {
      control.click();
      setCaptureState(button, true, '2/6 Requesting the first Clockify report page.');
      return;
    }
    if (!paginationRange()) {
      log('one_page_report_reload');
      setCaptureState(button, true, '2/6 Reloading the one-page Clockify report for capture.');
      location.reload();
      return;
    }
    disarmBridge();
    setCaptureState(button, false, 'Clockoli could not start pagination. Code: PAGINATION_UNAVAILABLE.');
  }

  function requestNextPage(button, deadline = Date.now() + 1500) {
    const next = pageControl(['NEXT', 'NEXT PAGE']) || paginationButtons().at(-1);
    log('next_page_control_scan', `found=${Boolean(next)}`);
    if (!next) {
      if (Date.now() < deadline) {
        log('next_page_control_waiting');
        setTimeout(() => requestNextPage(button, deadline), 50);
        return;
      }
      log('next_page_control_unavailable');
      disarmBridge();
      setCaptureState(button, false, 'Clockoli could not load the next report page. Code: PAGINATION_UNAVAILABLE.');
      return;
    }
    next.click();
    log('next_page_control_click_dispatched');
    setCaptureState(button, true, '3/6 Captured a page — requesting the next Clockify report page.');
  }

  function createButton() {
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.setAttribute('aria-label', 'Capture the next Clockify Detailed Report result');
    button.title = 'Capture the next Clockify Detailed Report result';
    button.setAttribute('data-clockoli-ui', 'clockify-detailed-report');
    Object.assign(button.style, {
      alignItems: 'center', background: 'transparent', border: '0', borderRadius: '4px',
      color: 'inherit', cursor: 'pointer', display: 'inline-flex', height: '32px',
      justifyContent: 'center', marginLeft: '8px', padding: '4px', width: '32px',
    });

    const logo = document.createElement('img');
    logo.alt = '';
    logo.setAttribute('aria-hidden', 'true');
    logo.width = 20;
    logo.height = 20;
    logo.src = chrome.runtime.getURL('src/assets/clockoli-32.png');
    logo.style.display = 'block';
    button.append(logo);

    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (armedButton === button) {
        disarmBridge();
        setCaptureState(button, false);
        return;
      }
      setCaptureState(button, true, '1/6 Button click received — arming Clockoli capture bridge.');
      log('button_clicked');
      initialReportResponseObserved = false;
      const request = ++armRequest;
      chrome.runtime.sendMessage({ type: 'CLOCKIFY_ARM_CAPTURE' }, response => {
        if (request !== armRequest) return;
        if (chrome.runtime.lastError || !response?.ok || !response.data?.armed) {
          log('capture_arm_unavailable');
          setCaptureState(button, false, 'Clockoli could not arm capture. Code: BACKGROUND_UNAVAILABLE.');
          return;
        }
        armBridge();
        configureFirstPage(button);
      });
    });


    return button;
  }

  function statusElement() {
    const existing = document.getElementById?.(STATUS_ID);
    if (existing) return existing;
    const status = document.createElement('span');
    status.id = STATUS_ID;
    status.setAttribute('aria-live', 'polite');
    Object.assign(status.style, { color: 'inherit', fontSize: '12px', marginLeft: '6px' });
    return status;
  }

  function setCaptureState(button, armed, message = '') {
    armedButton = armed ? button : null;
    const status = statusElement();
    if (armed) {
      button.setAttribute('aria-label', 'Clockoli is armed; refresh this Clockify report to capture it. Click again to cancel.');
      button.title = 'Clockoli is armed; refresh this Clockify report to capture it. Click again to cancel.';
      button.style.background = 'rgba(46, 160, 67, 0.18)';
      status.textContent = message || 'Clockoli is armed — refresh this report to capture it.';
    } else {
      button.setAttribute('aria-label', 'Capture the next Clockify Detailed Report result');
      button.title = 'Capture the next Clockify Detailed Report result';
      button.style.background = 'transparent';
      status.textContent = message;
    }
  }

  function forwardPendingCapture() {
    const button = armedButton;
    const text = pendingCaptureText;
    if (!button || typeof text !== 'string') return;
    pendingCaptureText = null;
    setCaptureState(button, true, '4/5 Safe report payload captured — opening Clockoli preview.');
    log('capture_forwarding_to_background');
    chrome.runtime.sendMessage({ type: 'CLOCKIFY_CAPTURED_REPORT', text }, response => {
      const error = chrome.runtime.lastError;
      if (error) {
        log('background_unavailable');
        setCaptureState(button, false, 'Clockoli could not contact the extension background. Code: BACKGROUND_UNAVAILABLE.');
      } else if (response?.ok && response.data?.captured) {
        log('preview_opened');
        setCaptureState(button, false, '5/5 Clockoli preview opened.');
      } else {
        const stage = typeof response?.data?.stage === 'string' ? response.data.stage : 'unknown';
        log(`background_failed:${stage}`);
        setCaptureState(button, false, `Clockoli preview failed in background. Code: ${stage.toUpperCase()}.`);
      }
    });
  }

  function receiveCaptureText(text) {
    if (typeof text !== 'string') return;
    pendingCaptureText = text;
    // A report response can complete before Clockify reconstructs the
    // toolbar. Treat receipt as an armed state until the button exists.
    restoredCaptureArm = true;
    forwardPendingCapture();
    // The MAIN-world bridge can finish while the isolated script is still
    // restoring its button after a page reload. Keep the sanitized payload in
    // memory and retry once the restored arm has installed that button.
    setTimeout(forwardPendingCapture, 100);
    setTimeout(forwardPendingCapture, 500);
  }

  function consumeCapturedPayload() {
    const root = document.documentElement;
    const text = root?.getAttribute(CAPTURE_PAYLOAD_ATTRIBUTE);
    if (typeof text !== 'string' || !text) return;
    root.removeAttribute(CAPTURE_PAYLOAD_ATTRIBUTE);
    log('capture_payload_received');
    receiveCaptureText(text);
  }


  document.documentElement?.setAttribute(RECEIVER_READY_ATTRIBUTE, '');
  EVENT_TARGET.dispatchEvent(new CustomEvent(RECEIVER_READY_EVENT));
  consumeCapturedPayload();

  window.addEventListener('message', event => {
    if ((event.source !== window && event.source !== null) || event.origin !== location.origin || event.data?.type !== PROGRESS_MESSAGE) return;
    const button = armedButton;
    const code = event.data.code;
    if (!button || typeof code !== 'string') return;
    log(`bridge:${code}`);
    if (code === 'page_captured' || code === 'captured_sanitized') initialReportResponseObserved = true;
    const messages = {
      bridge_armed: '2/6 Capture bridge armed — preparing the Clockify report.',
      report_response_observed: '3/6 Matching report response detected — validating it.',
      source_oversized: 'Capture rejected. Code: SOURCE_OVERSIZED.',
      response_not_json: 'Ignored a non-JSON report candidate — waiting for Clockify.',
      response_rejected: 'Capture rejected. Code: RESPONSE_REJECTED.',
      sanitized_oversized: 'Capture rejected. Code: SANITIZED_OVERSIZED.',
      report_response_not_success: 'Clockify report request did not complete. Code: RESPONSE_NOT_SUCCESS.',
      report_request_failed: 'Clockify report request failed. Code: REQUEST_FAILED.',
    };
    if (code === 'page_captured') requestNextPage(button);
    else if (Object.hasOwn(messages, code)) setCaptureState(button, true, messages[code]);
  });

  function placeButton() {
    if (!onDetailedReport()) {
      document.getElementById?.(BUTTON_ID)?.remove();
      document.getElementById?.(STATUS_ID)?.remove();
      armedButton = null;
      return;
    }
    const nativeExport = findNativeExport();
    const existing = document.getElementById?.(BUTTON_ID);
    if (!nativeExport) {
      existing?.remove();
      document.getElementById?.(STATUS_ID)?.remove();
      armedButton = null;
      return;
    }
    const button = existing || createButton();
    // Reinsert after the currently rendered native control. Clockify is a SPA
    // and may replace its toolbar during report refreshes or navigation.
    const status = statusElement();
    if (button.previousElementSibling !== nativeExport || button.nextElementSibling !== status) nativeExport.after(button, status);
    if (restoredCaptureArm && armedButton !== button) {
      setCaptureState(button, true, pendingCaptureText
        ? '4/5 Safe report payload captured — opening Clockoli preview.'
        : '2/6 Capture bridge restored after Clockify report refresh.');
    }
    forwardPendingCapture();
  }

  function schedulePlacement() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      placeButton();
    });
  }

  function start() {
    schedulePlacement();
    if (observer || typeof MutationObserver !== 'function') return;
    observer = new MutationObserver(mutations => {
      if (mutations.some(mutation => mutation.type === 'attributes' && mutation.attributeName === CAPTURE_PAYLOAD_ATTRIBUTE)) consumeCapturedPayload();
      schedulePlacement();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: [CAPTURE_PAYLOAD_ATTRIBUTE], childList: true, subtree: true });
  }

  restoreCaptureArm();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
