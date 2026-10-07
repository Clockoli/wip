(() => {
  'use strict';

  const BUTTON_ID = 'clockoli-clockify-detailed-export';
  const PAGE_BUTTON_ID = 'clockoli-clockify-detailed-page-migration';
  const DETAILED_REPORT_PATH = '/reports/detailed';
  const NATIVE_EXPORT_LABEL = 'EXPORT';
  const ARM_EVENT = 'clockoli:clockify-detailed-report-arm';
  const RECEIVER_READY_EVENT = 'clockoli:clockify-detailed-report-receiver-ready';
  const CAPTURE_MESSAGE = 'clockoli:clockify-detailed-report-captured';
  const DISARM_EVENT = 'clockoli:clockify-detailed-report-disarm';
  const CSV_CAPTURE_INTENT_EVENT = 'clockoli:clockify-detailed-report-csv-capture-intent';
  const YEAR_REQUEST_EVENT = 'clockoli:clockify-detailed-report-request-year';

  const PROGRESS_EVENT = 'clockoli:clockify-detailed-report-progress';

  const PROGRESS_MESSAGE = 'clockoli:clockify-detailed-report-progress';
  const CAPTURE_PARSE_PROGRESS_MESSAGE = 'CLOCKIFY_CAPTURE_PARSE_PROGRESS';
  const CAPTURE_PHASE_MESSAGE = 'CLOCKIFY_CAPTURE_PHASE';
  const CAPTURE_PHASES = new Set([
    'saving_current_report', 'saving_preview', 'opening_preview',
  ]);
  const BRIDGE_ARM_ATTRIBUTE = 'data-clockoli-clockify-capture-arm';
  const RECEIVER_READY_ATTRIBUTE = 'data-clockoli-clockify-capture-receiver-ready';

  const EVENT_TARGET = document;
  const STATUS_ID = 'clockoli-clockify-detailed-capture-status';
  const BANNER_ID = 'clockoli-clockify-capture-banner';
  const PAGE_SIZE = 200;
  const CAPTURE_PARSING_MESSAGE = 'Parsing Clockify data.';
  let scheduled = false;
  let armedButton = null;
  let pendingCaptureText = null;
  let initialReportResponseObserved = false;
  let restoredCaptureArm = false;
  let restoredCaptureResumeRequested = false;
  let captureHistory = null;
  let captureParsingProgress = null;
  let capturePhase = null;
  let discoveryYear = null;
  let discoveryDeadline = null;
  let discoveryRetryTimer = null;
  let discoveryRetryCount = 0;
  let captureTransport = 'csv';
  let armRequest = 0;
  let csvExportRequest = 0;
  let csvExportYear = null;
  let csvRetryWait = null;

  function log() {}

  function armBridge(mode = 'report', year = null, retry = 0) {
    document.documentElement?.setAttribute(BRIDGE_ARM_ATTRIBUTE, 'armed');
    EVENT_TARGET.dispatchEvent(new CustomEvent(ARM_EVENT, { detail: { mode, year, retry } }));
  }

  function disarmBridge() {
    clearTimeout(discoveryRetryTimer);
    discoveryRetryTimer = null;
    discoveryDeadline = null;
    discoveryRetryCount = 0;
    armRequest += 1;
    restoredCaptureArm = false;
    pendingCaptureText = null;
    captureHistory = null;
    captureParsingProgress = null;
    capturePhase = null;
    discoveryYear = null;
    csvExportRequest += 1;
    csvExportYear = null;
    csvRetryWait = null;
    document.documentElement?.removeAttribute(BRIDGE_ARM_ATTRIBUTE);
    EVENT_TARGET.dispatchEvent(new CustomEvent(DISARM_EVENT));
    chrome.runtime.sendMessage({ type: 'CLOCKIFY_DISARM_CAPTURE' }, () => void chrome.runtime.lastError);
  }

  function restoreCaptureArm() {
    chrome.runtime.sendMessage({ type: 'CLOCKIFY_IS_CAPTURE_ARMED' }, response => {
      if (chrome.runtime.lastError || !onDetailedReport() || !response?.ok || !response.data?.armed) return;
      captureHistory = response.data.history?.phase === 'capturing' ? response.data.history.history : null;
      discoveryYear = response.data.history?.phase === 'discovering' && Number.isInteger(response.data.history.nextYear)
        ? response.data.history.nextYear : null;
      if (['csv', 'report'].includes(response.data.history?.transport)) captureTransport = response.data.history.transport;
      restoredCaptureArm = true;
      if (captureHistory) armBridge(captureTransport, captureHistory.yearsWithEntries?.[captureHistory.completedYears]);
      log('persisted_arm_restored');
      schedulePlacement();
    });
  }

  function onDetailedReport() {
    return location.protocol === 'https:'
      && location.hostname === 'app.clockify.me'
      && location.pathname.replace(/\/+$/, '') === DETAILED_REPORT_PATH;
  }

  function requestReportYear(year, mode, retry = 0) {
    armBridge(mode, year, retry);
    EVENT_TARGET.dispatchEvent(new CustomEvent(YEAR_REQUEST_EVENT, { detail: retry ? { year, mode, retry } : { year, mode } }));
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

  function arrowPageControl(direction) {
    const alt = `${direction} arrow symbol`;
    const candidates = document.querySelectorAll?.('button.cl-page-link') || [];
    return [...candidates].find(element => enabled(element) && element.querySelector?.(`img[alt="${alt}"]`)) || null;
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

  function waitForInitialReport(button, applyDispatched = false, deadline = Date.now() + 60_000) {
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
        setCaptureState(button, true, CAPTURE_PARSING_MESSAGE);
        waitForInitialReport(button, true);
        return;
      }
    }
    log('initial_report_response_unavailable');
    disarmBridge();
    setCaptureState(button, false, 'Clockoli could not observe the first report page. Code: REPORT_RESPONSE_UNAVAILABLE.');
  }

  function confirmCustomPageSize(button, deadline = Date.now() + 10_000) {
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
    setCaptureState(button, true, CAPTURE_PARSING_MESSAGE);
    waitForInitialReport(button);
  }

  function restoreTargetPageSize(button, refreshSize, deadline = Date.now() + 10_000) {
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
    armBridge('report', captureHistory?.yearsWithEntries?.[captureHistory.completedYears]);
    log('bridge_rearmed_after_page_size_refresh');
    control.click();
    chooseCustomPageSize(button, control);
  }

  function refreshAtCurrentPageSize(button, control, deadline = Date.now() + 10_000) {
    const dropdown = control?.closest?.('.cl-dropdown');
    const candidates = dropdown?.querySelectorAll?.('.cl-dropdown-item') || [];
    const refresh = [...candidates].find(element => enabled(element) && /^\d+$/.test(labelOf(element)) && labelOf(element) !== String(PAGE_SIZE));
    if (refresh) {
      document.documentElement?.removeAttribute(BRIDGE_ARM_ATTRIBUTE);
      EVENT_TARGET.dispatchEvent(new CustomEvent(DISARM_EVENT));
      log('bridge_paused_for_page_size_refresh');
      refresh.click();
      log('page_size_refresh_option_click_dispatched');
      setCaptureState(button, true, CAPTURE_PARSING_MESSAGE);
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

  function chooseCustomPageSize(button, control, deadline = Date.now() + 10_000) {
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
      setCaptureState(button, true, CAPTURE_PARSING_MESSAGE);
      return;
    }
    const customPageSize = customPageSizeControl();
    if (customPageSize) {
      log('page_size_custom_control_found');
      customPageSize.click();
      log('page_size_custom_control_click_dispatched');
      chooseCustomPageSize(button, customPageSize);
      setCaptureState(button, true, CAPTURE_PARSING_MESSAGE);
      return;
    }
    log('page_size_custom_control_unavailable');
    const first = pageControl(['FIRST', 'FIRST PAGE']);
    const apply = pageControl(['APPLY']);
    const control = first || apply;
    if (control) {
      control.click();
      setCaptureState(button, true, CAPTURE_PARSING_MESSAGE);
      return;
    }
    if (!paginationRange()) {
      log('one_page_report_reload');
      setCaptureState(button, true, CAPTURE_PARSING_MESSAGE);
      location.reload();
      return;
    }
    disarmBridge();
    setCaptureState(button, false, 'Clockoli could not start pagination. Code: PAGINATION_UNAVAILABLE.');
  }

  // Large Clockify reports can render their pagination controls after the
  // report response has already been delivered to the capture bridge.
  function requestNextPage(button, deadline = Date.now() + 60_000) {
    const next = pageControl(['NEXT', 'NEXT PAGE']) || arrowPageControl('Right') || paginationButtons().at(-1);
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
    armBridge('report', captureHistory?.yearsWithEntries?.[captureHistory.completedYears]);
    next.click();
    log('next_page_control_click_dispatched');
    setCaptureState(button, true, CAPTURE_PARSING_MESSAGE);
  }

  function resumeCaptureAfterReload(button, deadline = Date.now() + 10_000) {
    const previous = pageControl(['PREVIOUS', 'PREVIOUS PAGE']) || arrowPageControl('Left');
    if (previous) {
      armBridge('report', captureHistory?.yearsWithEntries?.[captureHistory.completedYears]);
      previous.click();
      setCaptureState(button, true, CAPTURE_PARSING_MESSAGE);
      return;
    }
    if (Date.now() < deadline) {
      setTimeout(() => resumeCaptureAfterReload(button, deadline), 50);
      return;
    }
    configureFirstPage(button);
  }

  function exportCurrentYearCsv(button, deadline = Date.now() + 60_000) {
    const nativeExport = findNativeExport();
    if (!enabled(nativeExport)) {
      if (Date.now() < deadline) { setTimeout(() => exportCurrentYearCsv(button, deadline), 100); return; }
      disarmBridge();
      setCaptureState(button, false, 'Clockoli could not find Clockify Export. Code: EXPORT_UNAVAILABLE.');
      return;
    }
    nativeExport.click();
    const selectCsv = () => {
      const csv = [...(document.querySelectorAll?.('button, [role="button"]') || [])]
        .find(element => enabled(element) && labelOf(element) === 'SAVE AS CSV');
      if (csv) {
        EVENT_TARGET.dispatchEvent(new CustomEvent(CSV_CAPTURE_INTENT_EVENT));
        csv.click();
        const request = armRequest;
        const exportRequest = csvExportRequest;
        const year = csvExportYear;
        const emailDeadline = Date.now() + 10_000;
        const checkEmailOffer = () => {
          if (armedButton !== button || armRequest !== request || csvExportRequest !== exportRequest || csvExportYear !== year) return;
          if (!/report will be sent to your email/i.test(String(document.body?.innerText || ''))) {
            if (Date.now() < emailDeadline) setTimeout(checkEmailOffer, 250);
            return;
          }
          csvExportRequest += 1;
          chrome.runtime.sendMessage({ type: 'CLOCKIFY_CSV_EMAIL_OFFER' }, response => {
            if (armedButton !== button || armRequest !== request || csvExportYear !== year) return;
            if (chrome.runtime.lastError || !response?.ok || !Number.isInteger(response.data?.attempts)
                || response.data.attempts < 1 || response.data.attempts > 3) {
              disarmBridge();
              setCaptureState(button, false, 'Clockoli could not record the Clockify email-only export. Code: CSV_EMAIL_RETRY_UNAVAILABLE. Try Page to page migration.');
              return;
            }
            const attempts = response.data.attempts;
            if (attempts === 3 && response.data.cancelled === true) {
              pageControl(['CLOSE', 'CANCEL'])?.click();
              disarmBridge();
              setCaptureState(button, false, `Clockify offered email delivery three times for ${year}. CSV migration cancelled. Code: CSV_EMAIL_EXPORT_UNAVAILABLE. Try Page to page migration.`);
              return;
            }
            if (attempts >= 3 || response.data.cancelled !== false) {
              disarmBridge();
              setCaptureState(button, false, 'Clockoli could not confirm the CSV retry. Code: CSV_EMAIL_RETRY_UNAVAILABLE. Try Page to page migration.');
              return;
            }
            const close = pageControl(['CLOSE', 'CANCEL']);
            if (!close) {
              disarmBridge();
              setCaptureState(button, false, 'Clockoli could not close the Clockify email prompt. Code: CSV_EMAIL_RETRY_UNAVAILABLE. Try Page to page migration.');
              return;
            }
            close.click();
            setCaptureState(button, true, `Clockify offered email delivery for ${year}. Re-requesting this report (${attempts} of 3).`);
            setTimeout(() => {
              if (armedButton !== button || armRequest !== request || csvExportYear !== year) return;
              requestYearCsv(button, year, attempts);
            }, 500);
          });
        };
        setTimeout(checkEmailOffer, 250);
        return;
      }
      if (Date.now() < deadline) { setTimeout(selectCsv, 100); return; }
      disarmBridge();
      setCaptureState(button, false, 'Clockoli could not select Clockify CSV export. Code: CSV_EXPORT_UNAVAILABLE.');
    };
    selectCsv();
  }

  function retryCsvReportReady() {
    const pending = csvRetryWait;
    if (!pending || armedButton !== pending.button || armRequest !== pending.arm || csvExportRequest !== pending.exportRequest) return;
    csvRetryWait = null;
    exportCurrentYearCsv(pending.button);
  }

  function requestYearCsv(button, year, retry = 0) {
    csvExportYear = year;
    const exportRequest = ++csvExportRequest;
    csvRetryWait = { button, arm: armRequest, exportRequest };
    captureParsingProgress = null;
    capturePhase = null;
    setCaptureState(button, true, CAPTURE_PARSING_MESSAGE);
    requestReportYear(year, 'csv', retry);
    const request = armRequest;
    setTimeout(() => {
      if (!csvRetryWait || csvRetryWait.exportRequest !== exportRequest || armedButton !== button || armRequest !== request) return;
      disarmBridge();
      setCaptureState(button, false, 'Clockify did not finish refreshing this report. Code: CSV_REPORT_REFRESH_UNAVAILABLE. Try Page to page migration.');
    }, retry ? 30_000 : 180_000);
  }

  function requestYearPages(button, year) {
    captureParsingProgress = null;
    capturePhase = null;
    setCaptureState(button, true, CAPTURE_PARSING_MESSAGE);
    requestReportYear(year, 'report');
  }

  function requestCaptureYear(button, year) {
    if (captureTransport === 'report') requestYearPages(button, year);
    else requestYearCsv(button, year);
  }

  function requestDiscoveryYear(button, year, deadline = Date.now() + 180_000) {
    if (discoveryDeadline === null || discoveryYear !== year) {
      clearTimeout(discoveryRetryTimer);
      discoveryRetryTimer = null;
      discoveryDeadline = deadline;
      discoveryRetryCount = 0;
    }
    const requestDeadline = discoveryDeadline;
    requestReportYear(year, 'discover');
    setCaptureState(button, true, `Checking Clockify year ${year}. No export is requested.`);
    const request = armRequest;
    setTimeout(() => {
      if (armedButton !== button || discoveryYear !== year || armRequest !== request) return;
      setCaptureState(button, true, `Clockify is still preparing year ${year}. Continuing to wait.`);
    }, 60_000);
    setTimeout(() => {
      if (armedButton !== button || discoveryYear !== year || armRequest !== request) return;
      disarmBridge();
      setCaptureState(button, false, 'Clockoli could not check this report year.');
    }, Math.max(0, requestDeadline - Date.now()));
  }

  function retryDiscoveryReport(button) {
    if (discoveryRetryTimer !== null || !Number.isInteger(discoveryYear)
        || !Number.isFinite(discoveryDeadline) || Date.now() >= discoveryDeadline) return;
    if (discoveryRetryCount >= 4) {
      disarmBridge();
      setCaptureState(button, false, 'Clockoli could not check this report year after retrying.');
      return;
    }
    const year = discoveryYear;
    const deadline = discoveryDeadline;
    const request = armRequest;
    const delay = [1_000, 3_000, 8_000, 15_000][discoveryRetryCount];
    discoveryRetryCount += 1;
    setCaptureState(button, true, `Retrying Clockify year ${year}.`);
    discoveryRetryTimer = setTimeout(() => {
      discoveryRetryTimer = null;
      if (armedButton !== button || discoveryYear !== year || armRequest !== request || Date.now() >= deadline) return;
      requestDiscoveryYear(button, year, deadline);
    }, delay);
  }


  function createButton() {
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.setAttribute('aria-label', 'Migrate Clockify history into Clockoli');
    button.title = 'Migrate Clockify history into Clockoli';
    button.setAttribute('data-clockoli-ui', 'clockify-detailed-report');
    Object.assign(button.style, {
      alignItems: 'center', background: '#fff', border: '1px solid rgba(255, 255, 255, 0.82)', borderRadius: '10px',
      boxShadow: '0 8px 18px rgba(4, 46, 25, 0.28)', color: '#0f6b3a', cursor: 'pointer', display: 'inline-flex', flex: '0 0 auto', gap: '7px', height: '42px',
      justifyContent: 'center', marginLeft: '0', padding: '8px 12px', width: 'auto',
    });

    const logo = document.createElement('img');
    logo.alt = '';
    logo.setAttribute('aria-hidden', 'true');
    logo.width = 18;
    logo.height = 18;
    logo.src = chrome.runtime.getURL('src/assets/clockoli-32.png');
    logo.style.display = 'block';
    const actionLabel = document.createElement('span');
    actionLabel.className = 'clockoli-capture-action-label';
    actionLabel.textContent = 'CSV migration';
    Object.assign(actionLabel.style, { fontSize: '13px', fontWeight: '700', lineHeight: '18px', whiteSpace: 'nowrap' });
    button.append(logo, actionLabel);

    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (armedButton === button) {
        disarmBridge();
        setCaptureState(button, false);
        return;
      }
      startCapture(button, 'csv');
    });


    return button;
  }

  function createPageButton() {
    const button = document.createElement('button');
    button.id = PAGE_BUTTON_ID;
    button.type = 'button';
    button.setAttribute('aria-label', 'Migrate Clockify history page by page into Clockoli');
    button.title = 'Migrate Clockify history page by page without downloading CSV files';
    button.setAttribute('data-clockoli-ui', 'clockify-detailed-report');
    button.textContent = 'Page to page migration';
    Object.assign(button.style, {
      alignItems: 'center', background: 'transparent', border: '1px solid rgba(255, 255, 255, 0.82)', borderRadius: '10px', color: '#fff',
      cursor: 'pointer', display: 'inline-flex', flex: '0 0 auto', fontSize: '13px', fontWeight: '700', height: '42px', justifyContent: 'center',
      marginLeft: '0', padding: '8px 12px', whiteSpace: 'nowrap', width: 'auto',
    });
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (armedButton === button) {
        disarmBridge();
        setCaptureState(button, false);
        return;
      }
      if (armedButton) return;
      startCapture(button, 'report');
    });
    return button;
  }

  function startCapture(button, transport) {
    const request = ++armRequest;
    captureTransport = transport;
    setCaptureState(button, true, 'Checking Clockify years. No exports are downloaded during this step.');
    log('button_clicked');
    const type = transport === 'report' ? 'CLOCKIFY_ARM_CAPTURE' : 'CLOCKIFY_ARM_CSV_CAPTURE';
    chrome.runtime.sendMessage({ type, startedAt: Date.now() }, response => {
      if (armRequest !== request || armedButton !== button) return;
      if (chrome.runtime.lastError || !response?.ok || !response.data?.armed || !Number.isInteger(response.data.discovery?.nextYear)) {
        disarmBridge();
        setCaptureState(button, false, 'Clockoli could not start the history scan. Code: BACKGROUND_UNAVAILABLE.');
        return;
      }
      discoveryYear = response.data.discovery.nextYear;
      requestDiscoveryYear(button, discoveryYear);
    });
  }

  function statusElement() {
    const existing = document.getElementById?.(STATUS_ID);
    if (existing) return existing;
    const status = document.createElement('div');
    status.id = STATUS_ID;
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    Object.assign(status.style, {
      alignItems: 'center', color: '#fff', display: 'flex', flex: '1 1 260px', flexWrap: 'wrap', fontSize: '14px', gap: '6px 10px',
      lineHeight: '20px', minWidth: '0',
    });
    const stage = document.createElement('span');
    stage.className = 'clockoli-capture-stage';
    Object.assign(stage.style, {
      background: 'rgba(0, 46, 26, 0.42)', border: '1px solid rgba(255, 255, 255, 0.22)', borderRadius: '999px', color: '#fff',
      flex: '0 0 auto', fontSize: '10px', fontWeight: '700', letterSpacing: '0.06em', padding: '3px 7px', whiteSpace: 'nowrap',
    });
    const detail = document.createElement('span');
    detail.className = 'clockoli-capture-detail';
    Object.assign(detail.style, { minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
    status.append(stage, detail);
    return status;
  }

  function captureBanner() {
    const existing = document.getElementById?.(BANNER_ID);
    if (existing) return existing;
    const banner = document.createElement('section');
    banner.id = BANNER_ID;
    banner.setAttribute('aria-label', 'Clockoli migration capture');
    Object.assign(banner.style, {
      alignItems: 'center', background: 'linear-gradient(135deg, #0f6b3a, #18864a)', border: '1px solid rgba(129, 255, 181, 0.28)',
      borderRadius: '12px', boxShadow: '0 12px 30px rgba(4, 46, 25, 0.24)', boxSizing: 'border-box', display: 'flex',
      gap: '16px', margin: '0 0 14px', minHeight: '72px', padding: '14px 18px', width: '100%',
    });
    const brand = document.createElement('div');
    Object.assign(brand.style, { alignItems: 'center', display: 'flex', flex: '0 0 auto', gap: '10px' });
    const logo = document.createElement('img');
    logo.alt = 'Clockoli';
    logo.width = 30;
    logo.height = 30;
    logo.src = chrome.runtime.getURL('src/assets/clockoli-32.png');
    Object.assign(logo.style, { background: 'rgba(255, 255, 255, 0.94)', borderRadius: '8px', display: 'block', padding: '3px' });
    const label = document.createElement('div');
    label.textContent = 'Clockoli migration';
    Object.assign(label.style, { color: '#fff', fontSize: '15px', fontWeight: '700', letterSpacing: '-0.01em', whiteSpace: 'nowrap' });
    brand.append(logo, label);
    banner.append(brand);
    return banner;
  }

  function renderCaptureStatus(status, message, armed) {
    const stageMatch = /^(\d+\/\d+)\s+(.+)$/.exec(message);
    const stage = stageMatch?.[1] || (armed ? 'LIVE' : 'READY');
    const detail = stageMatch?.[2] || message || 'Ready to capture this Clockify report.';
    status.querySelector('.clockoli-capture-stage').textContent = `CAPTURE ${stage}`;
    status.querySelector('.clockoli-capture-detail').textContent = detail;
  }

  function renderCaptureProgress(status, armed, history = captureHistory) {
    let container = status.querySelector('.clockoli-capture-progress-container');
    if (!armed) {
      container?.remove();
      return;
    }
    if (!container) {
      container = document.createElement('div');
      container.className = 'clockoli-capture-progress-container';
      Object.assign(container.style, { display: 'grid', flex: '1 0 100%', gap: '7px', minWidth: '0' });
      status.append(container);
    }
    const progressRow = className => {
      let row = container.querySelector(`.${className}-row`);
      if (row) return row;
      row = document.createElement('div');
      row.className = `${className}-row`;
      Object.assign(row.style, { alignItems: 'center', display: 'flex', gap: '8px', minWidth: '0' });
      const label = document.createElement('span');
      label.className = 'clockoli-capture-progress-label';
      Object.assign(label.style, { color: 'rgba(255, 255, 255, 0.9)', flex: '0 0 auto', fontSize: '11px', fontWeight: '700' });
      const progress = document.createElement('progress');
      progress.className = className;
      Object.assign(progress.style, { accentColor: '#d7ffe4', display: 'block', flex: '1 1 auto', height: '8px', maxWidth: '100%', minWidth: '80px', width: '100%' });
      row.append(label, progress);
      container.append(row);
      return row;
    };
    const activeYear = history?.yearsWithEntries?.[history.completedYears];
    const parsing = captureParsingProgress;
    if (Number.isSafeInteger(parsing?.totalRows) && parsing.totalRows > 0 && Number.isSafeInteger(parsing.completedRows)
        && parsing.completedRows >= 0 && parsing.completedRows <= parsing.totalRows) {
      const row = progressRow('clockoli-capture-parsing-progress');
      const progress = row.querySelector('.clockoli-capture-parsing-progress');
      const label = row.querySelector('.clockoli-capture-progress-label');
      const activeYearLabel = Number.isInteger(activeYear) ? ` · ${activeYear}` : '';
      progress.max = parsing.totalRows;
      progress.value = parsing.completedRows;
      progress.setAttribute('aria-label', `Clockify report parsing: ${parsing.completedRows} of ${parsing.totalRows} rows${activeYearLabel}`);
      label.textContent = `Parsing current report · ${parsing.completedRows} of ${parsing.totalRows} rows${activeYearLabel}`;
    } else container.querySelector('.clockoli-capture-parsing-progress-row')?.remove();
    if (capturePhase) {
      const row = progressRow('clockoli-capture-phase-progress');
      const progress = row.querySelector('.clockoli-capture-phase-progress');
      const label = row.querySelector('.clockoli-capture-progress-label');
      const detail = capturePhaseDetail(capturePhase.phase, capturePhase.entryCount, capturePhase.year);
      progress.removeAttribute('value');
      progress.removeAttribute('max');
      progress.setAttribute('aria-label', detail);
      label.textContent = detail;
    } else container.querySelector('.clockoli-capture-phase-progress-row')?.remove();
    const totalYears = history?.totalYears;
    const completedYears = history?.completedYears;
    if (Number.isInteger(totalYears) && totalYears > 0 && Number.isInteger(completedYears) && completedYears >= 0 && completedYears <= totalYears) {
      const row = progressRow('clockoli-capture-history-progress');
      const progress = row.querySelector('.clockoli-capture-history-progress');
      const label = row.querySelector('.clockoli-capture-progress-label');
      const historyYear = history?.yearsWithEntries?.[completedYears];
      const activeYearLabel = Number.isInteger(historyYear) ? ` · ${historyYear}` : '';
      progress.max = totalYears;
      progress.value = completedYears;
      progress.setAttribute('aria-label', `Clockify history capture: ${completedYears} of ${totalYears} years complete${activeYearLabel}`);
      label.textContent = `History capture · ${completedYears} of ${totalYears} years${activeYearLabel}`;
      return;
    }
    container.querySelector('.clockoli-capture-history-progress-row')?.remove();
    if (captureParsingProgress) return;
    const row = progressRow('clockoli-capture-history-progress');
    const progress = row.querySelector('.clockoli-capture-history-progress');
    const label = row.querySelector('.clockoli-capture-progress-label');
    const scanningYear = Number.isInteger(discoveryYear) ? ` year ${discoveryYear}` : ' years';
    progress.removeAttribute('value');
    progress.removeAttribute('max');
    progress.setAttribute('aria-label', `Scanning Clockify${scanningYear}`);
    label.textContent = `Scanning Clockify${scanningYear}`;
  }

  function capturePhaseDetail(phase, entryCount, year) {
    const entries = `${entryCount.toLocaleString()} entries`;
    const yearLabel = Number.isInteger(year) ? ` · ${year}` : '';
    if (phase === 'saving_current_report') return `Saving parsed Clockify report · ${entries}${yearLabel}`;

    if (phase === 'saving_preview') return `Saving the migration preview · ${entries}`;
    return `Opening the migration preview · ${entries}`;
  }

  function setCaptureButtonLabel(button, label) {
    const actionLabel = button.querySelector('.clockoli-capture-action-label');
    if (actionLabel) actionLabel.textContent = label;
  }

  function setCaptureState(button, armed, message = '') {
    armedButton = armed ? button : null;
    const pageButton = document.getElementById?.(PAGE_BUTTON_ID);
    if (pageButton) {
      const pageCaptureActive = armed && armedButton === pageButton;
      pageButton.disabled = armed && !pageCaptureActive;
      pageButton.style.cursor = armed && !pageCaptureActive ? 'not-allowed' : 'pointer';
      pageButton.style.opacity = armed && !pageCaptureActive ? '0.6' : '1';
      pageButton.textContent = pageCaptureActive ? 'Cancel page to page migration' : 'Page to page migration';
      pageButton.style.background = pageCaptureActive ? '#0f6b3a' : 'transparent';
      pageButton.style.color = '#fff';
      pageButton.style.boxShadow = pageCaptureActive
        ? '0 0 0 2px rgba(255, 255, 255, 0.36), 0 6px 16px rgba(4, 46, 25, 0.28)'
        : 'none';
    }
    const status = statusElement();
    if (armed) {
      button.setAttribute('aria-label', 'Clockoli migration capture is armed. Click to cancel.');
      button.title = 'Clockoli migration capture is armed. Click to cancel.';
      setCaptureButtonLabel(button, 'Cancel CSV migration');
      button.style.background = '#0f6b3a';
      button.style.color = '#fff';
      button.style.boxShadow = '0 0 0 2px rgba(255, 255, 255, 0.36), 0 6px 16px rgba(4, 46, 25, 0.28)';
      renderCaptureStatus(status, message || CAPTURE_PARSING_MESSAGE, true);
      renderCaptureProgress(status, true, captureHistory);
    } else {
      button.setAttribute('aria-label', 'Migrate Clockify history into Clockoli');
      button.title = 'Migrate Clockify history into Clockoli';
      setCaptureButtonLabel(button, 'CSV migration');
      button.style.background = '#fff';
      button.style.color = '#0f6b3a';
      button.style.boxShadow = '0 8px 18px rgba(4, 46, 25, 0.28)';
      renderCaptureStatus(status, message, false);
      renderCaptureProgress(status, false);
    }
  }

  function forwardPendingCapture() {
    const button = armedButton;
    const text = pendingCaptureText;
    if (!button || typeof text !== 'string') return;
    pendingCaptureText = null;
    setCaptureState(button, true, CAPTURE_PARSING_MESSAGE);
    log('capture_forwarding_to_background');
    const request = armRequest;
    chrome.runtime.sendMessage({ type: 'CLOCKIFY_CAPTURED_REPORT', text }, response => {
      if (armRequest !== request || armedButton !== button) return;
      const error = chrome.runtime.lastError;
      if (error) {
        log('background_unavailable');
        setCaptureState(button, false, 'Clockoli could not contact the extension background. Code: BACKGROUND_UNAVAILABLE.');
      } else if (response?.ok && response.data?.nextPage) {
        setCaptureState(button, true, CAPTURE_PARSING_MESSAGE);
        requestNextPage(button);
      } else if (response?.ok && response.data?.discovering && Number.isInteger(response.data.nextYear)) {
        discoveryYear = response.data.nextYear;
        setCaptureState(button, true, CAPTURE_PARSING_MESSAGE);
        requestDiscoveryYear(button, response.data.nextYear);
      } else if (response?.ok && response.data?.capturing && Number.isInteger(response.data.nextYear)) {
        discoveryYear = null;
        captureHistory = response.data.history;
        setCaptureState(button, true, CAPTURE_PARSING_MESSAGE);
        requestCaptureYear(button, response.data.nextYear);
      } else if (response?.ok && response.data?.continuing && Number.isInteger(response.data.nextYear)) {
        captureHistory = response.data.history;
        setCaptureState(button, true, CAPTURE_PARSING_MESSAGE);
        requestCaptureYear(button, response.data.nextYear);
      } else if (response?.ok && response.data?.captured) {
        log('preview_opened');
        const history = response.data.history;
        const count = Number.isSafeInteger(history?.completedYears) && Number.isSafeInteger(history?.totalYears)
          ? `${history.completedYears}/${history.totalYears} ` : '';
        setCaptureState(button, false, `${count}Clockoli preview opened.`);
      } else {
        const stage = typeof response?.data?.stage === 'string' ? response.data.stage
          : typeof response?.error?.code === 'string' ? response.error.code : 'unknown';
        const reasonText = typeof response?.data?.reason === 'string' ? response.data.reason
          : typeof response?.error?.message === 'string' ? response.error.message : '';
        const reason = reasonText ? ` ${reasonText}` : '';
        const diagnostic = response?.data?.diagnostic;
        const page = Number.parseInt(new URL(location.href).searchParams.get('page') || '', 10);
        const detail = diagnostic && typeof diagnostic === 'object'
          && Number.isSafeInteger(diagnostic.entryIndex) && typeof diagnostic.entryId === 'string'
          && typeof diagnostic.user === 'string' && typeof diagnostic.project === 'string'
          && typeof diagnostic.task === 'string' && typeof diagnostic.start === 'string'
          && typeof diagnostic.end === 'string' && Number.isSafeInteger(diagnostic.duration)
          && typeof diagnostic.timezone === 'string'
          ? ` Page ${Number.isSafeInteger(page) && page > 0 ? page : '?'}, row ${diagnostic.entryIndex + 1}: entry ${diagnostic.entryId}; user ${diagnostic.user}; project ${diagnostic.project}; task ${diagnostic.task || '(none)'}; ${diagnostic.start} → ${diagnostic.end}; duration ${diagnostic.duration}s; timezone ${diagnostic.timezone}.`
          : '';
        log(`background_failed:${stage}`);
        setCaptureState(button, false, `Clockoli preview failed in background. Code: ${stage.toUpperCase()}.${reason}${detail}`);
      }
    });
  }

  function receiveCaptureText(text) {
    if (typeof text !== 'string') return;
    initialReportResponseObserved = true;
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

  document.documentElement?.setAttribute(RECEIVER_READY_ATTRIBUTE, '');
  EVENT_TARGET.dispatchEvent(new CustomEvent(RECEIVER_READY_EVENT));

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender?.id !== chrome.runtime.id || !message || typeof message !== 'object' || Array.isArray(message)
        || Object.keys(message).length !== 3 || message.type !== CAPTURE_PARSE_PROGRESS_MESSAGE
        || !Number.isSafeInteger(message.completedRows) || !Number.isSafeInteger(message.totalRows)
        || message.completedRows < 0 || message.totalRows < message.completedRows) return;
    if (!armedButton) return;
    capturePhase = null;
    captureParsingProgress = { completedRows: message.completedRows, totalRows: message.totalRows };
    setCaptureState(armedButton, true, CAPTURE_PARSING_MESSAGE);
  });

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender?.id !== chrome.runtime.id || !message || typeof message !== 'object' || Array.isArray(message)
        || Object.keys(message).length !== 4 || message.type !== CAPTURE_PHASE_MESSAGE || !CAPTURE_PHASES.has(message.phase)
        || !Number.isSafeInteger(message.entryCount) || message.entryCount < 0
        || (message.year !== null && (!Number.isInteger(message.year) || message.year < 2000 || message.year > 2100))) return;
    if (!armedButton) return;
    captureParsingProgress = null;
    capturePhase = { phase: message.phase, entryCount: message.entryCount, year: message.year };
    setCaptureState(armedButton, true, capturePhaseDetail(message.phase, message.entryCount, message.year));
  });

  window.addEventListener('message', event => {
    if ((event.source !== window && event.source !== null) || event.origin !== location.origin) return;
    if (event.data?.type === CAPTURE_MESSAGE && typeof event.data.text === 'string') {
      log('capture_payload_received');
      receiveCaptureText(event.data.text);
      return;
    }
    if (event.data?.type === 'clockoli:clockify-detailed-report-year-observed'
        && Number.isSafeInteger(event.data.entryCount) && Number.isInteger(event.data.year)) {
      const button = armedButton;
      if (!button) return;
      const request = armRequest;
      chrome.runtime.sendMessage({ type: 'CLOCKIFY_YEAR_OBSERVED', entryCount: event.data.entryCount, year: event.data.year }, response => {
        if (armRequest !== request || armedButton !== button) return;
        if (chrome.runtime.lastError || !response?.ok) {
          setCaptureState(button, false, 'Clockoli could not check this report year.');
        } else if (response.data?.discovering && Number.isInteger(response.data.nextYear)) {
          discoveryDeadline = null;
          discoveryRetryCount = 0;
          discoveryYear = response.data.nextYear;
          requestDiscoveryYear(button, discoveryYear);
        } else if (response.data?.capturing && Number.isInteger(response.data.nextYear)) {
          discoveryYear = null;
          captureHistory = response.data.history;
          setCaptureState(button, true, 'Found Clockify years with records. Capturing those years without downloading files.');
          requestCaptureYear(button, response.data.nextYear);
        } else {
          setCaptureState(button, false, 'Clockoli could not finish checking report years.');
        }
      });
      return;
    }
    if (event.data?.type === 'clockoli:clockify-detailed-report-csv-captured' && typeof event.data.text === 'string') {
      const button = armedButton;
      if (!button) return;
      const request = armRequest;
      chrome.runtime.sendMessage({ type: 'CLOCKIFY_CAPTURED_CSV', text: event.data.text }, response => {
        if (armRequest !== request || armedButton !== button) return;
        if (chrome.runtime.lastError) {
          setCaptureState(button, false, 'Clockoli could not contact the extension background. Code: BACKGROUND_UNAVAILABLE.');
        } else if (!response?.ok) {
          const code = typeof response?.error?.code === 'string' ? response.error.code : 'error';
          setCaptureState(button, false, `Clockoli preview failed in background. Code: ${code.toUpperCase()}.`);
        } else if (response.data?.discovering && Number.isInteger(response.data.nextYear)) {
          discoveryYear = response.data.nextYear;
          setCaptureState(button, true, CAPTURE_PARSING_MESSAGE);
          requestYearCsv(button, discoveryYear);
        } else if (response.data?.capturing && Number.isInteger(response.data.nextYear)) {
          discoveryYear = null;
          captureHistory = response.data.history;
          setCaptureState(button, true, CAPTURE_PARSING_MESSAGE);
          requestYearCsv(button, response.data.nextYear);
        } else if (response.data?.continuing && Number.isInteger(response.data.nextYear)) {
          captureHistory = response.data.history;
          setCaptureState(button, true, CAPTURE_PARSING_MESSAGE);
          requestYearCsv(button, response.data.nextYear);
        } else if (response.data?.captured) {
          setCaptureState(button, false, 'Clockoli preview opened.');
        } else {
          setCaptureState(button, false, 'Clockoli preview failed in background. Code: INVALID_RESPONSE.');
        }
      });
      return;
    }
    if (event.data?.type !== PROGRESS_MESSAGE) return;
    const button = armedButton;
    const code = event.data.code;
    if (!button || typeof code !== 'string') return;
    log(`bridge:${code}`);
    if (code === 'csv_report_ready') {
      retryCsvReportReady();
      return;
    }
    if (code === 'page_captured' || code === 'captured_sanitized') initialReportResponseObserved = true;
    const messages = {
      bridge_armed: CAPTURE_PARSING_MESSAGE,
      report_response_observed: CAPTURE_PARSING_MESSAGE,
      report_response_precedes_arm: CAPTURE_PARSING_MESSAGE,
      report_year_mismatch: 'Clockify returned a completed report for a different year; waiting for the requested year.',
      response_not_json: 'Clockify is still preparing the requested report.',
      source_oversized: 'Capture rejected. Code: SOURCE_OVERSIZED.',
      response_rejected: 'Capture rejected. Code: RESPONSE_REJECTED.',
      sanitized_oversized: 'Capture rejected. Code: SANITIZED_OVERSIZED.',
      report_response_not_success: 'Clockify report request did not complete. Code: RESPONSE_NOT_SUCCESS.',
      report_request_failed: 'Clockify report request failed. Code: REQUEST_FAILED.',
    };
    if (Object.hasOwn(messages, code)) setCaptureState(button, true, messages[code]);
    if (['report_response_not_success', 'report_request_failed'].includes(code) && Number.isInteger(discoveryYear)) {
      retryDiscoveryReport(button);
    }
  });

  function reportToolbarContainer(nativeExport) {
    for (let element = nativeExport.parentElement, depth = 0; element && depth < 6; element = element.parentElement, depth += 1) {
      const bounds = element.getBoundingClientRect?.();
      if (bounds && bounds.width >= window.innerWidth * 0.6 && bounds.height >= 32 && bounds.height <= 150) return element;
    }
    return nativeExport.parentElement;
  }

  function placeButton() {
    if (!onDetailedReport()) {
      document.getElementById?.(BUTTON_ID)?.remove();
      document.getElementById?.(PAGE_BUTTON_ID)?.remove();
      document.getElementById?.(STATUS_ID)?.remove();
      document.getElementById?.(BANNER_ID)?.remove();
      armedButton = null;
      return;
    }
    const nativeExport = findNativeExport();
    const existing = document.getElementById?.(BUTTON_ID);
    const existingPageButton = document.getElementById?.(PAGE_BUTTON_ID);
    if (!nativeExport) {
      existing?.remove();
      existingPageButton?.remove();
      document.getElementById?.(STATUS_ID)?.remove();
      document.getElementById?.(BANNER_ID)?.remove();
      armedButton = null;
      return;
    }
    const button = existing || createButton();
    const pageButton = existingPageButton || createPageButton();
    const status = statusElement();
    const banner = captureBanner();
    const toolbar = reportToolbarContainer(nativeExport);
    if (!toolbar?.parentElement) return;
    if (banner.nextElementSibling !== toolbar) toolbar.before(banner);
    if (status.parentElement !== banner || button.parentElement !== banner || pageButton.parentElement !== banner) banner.append(status, button, pageButton);
    if (!status.textContent.trim()) renderCaptureStatus(status, '', false);
    if (restoredCaptureArm) {
      setCaptureState(button, true, CAPTURE_PARSING_MESSAGE);
      if (!pendingCaptureText && !restoredCaptureResumeRequested) {
        restoredCaptureResumeRequested = true;
        if (Number.isInteger(discoveryYear)) setTimeout(() => requestDiscoveryYear(button, discoveryYear), 1_000);
        else if (Number.isInteger(captureHistory?.yearsWithEntries?.[captureHistory.completedYears])) {
          setTimeout(() => requestCaptureYear(button, captureHistory.yearsWithEntries[captureHistory.completedYears]), 1_000);
        }
      }
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
    const waitForToolbar = () => {
      if (!onDetailedReport() || document.getElementById(BUTTON_ID)) return;
      schedulePlacement();
      setTimeout(waitForToolbar, 250);
    };
    setTimeout(waitForToolbar, 250);
  }

  restoreCaptureArm();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
