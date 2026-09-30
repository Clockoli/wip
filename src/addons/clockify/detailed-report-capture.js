(() => {
  'use strict';

  const ARM_EVENT = 'clockoli:clockify-detailed-report-arm';
  const RECEIVER_READY_EVENT = 'clockoli:clockify-detailed-report-receiver-ready';
  const CAPTURE_MESSAGE = 'clockoli:clockify-detailed-report-captured';
  const CSV_CAPTURE_MESSAGE = 'clockoli:clockify-detailed-report-csv-captured';
  const CSV_CAPTURE_INTENT_EVENT = 'clockoli:clockify-detailed-report-csv-capture-intent';
  const YEAR_OBSERVED_MESSAGE = 'clockoli:clockify-detailed-report-year-observed';
  const YEAR_REQUEST_EVENT = 'clockoli:clockify-detailed-report-request-year';
  const BRIDGE_ARM_ATTRIBUTE = 'data-clockoli-clockify-capture-arm';
  const RECEIVER_READY_ATTRIBUTE = 'data-clockoli-clockify-capture-receiver-ready';

  const PROGRESS_EVENT = 'clockoli:clockify-detailed-report-progress';

  const PROGRESS_MESSAGE = 'clockoli:clockify-detailed-report-progress';
  const EVENT_TARGET = globalThis.document || window;
  const MAX_BYTES = 16 * 1024 * 1024;
  const CSV_HEADER_PREFIX = '"Project","Client","Description","Task","User",';
  const ROOT_KEYS = new Set(['timeentries', 'totals']);
  const ENTRY_KEYS = new Set([
    '_id', 'approvalRequestId', 'billable', 'clientId', 'clientName', 'currency',
    'description', 'isLocked', 'projectColor', 'projectId', 'projectName',
    'tags', 'taskId', 'taskName', 'timeInterval', 'type', 'userEmail', 'userId', 'userName',
  ]);
  const INTERVAL_KEYS = new Set(['duration', 'end', 'offEnd', 'offStart', 'start', 'timeZone', 'zonedEnd', 'zonedStart']);
  const TAG_KEYS = new Set(['_id', 'name']);
  const TOTAL_KEYS = new Set(['_id', 'amounts', 'entriesCount', 'numOfCurrencies', 'totalAmount', 'totalAmountByCurrency', 'totalBillableTime', 'totalTime']);
  let armed = false;
  let captureMode = 'report';
  let expectedYear = null;
  let expectedReportTaskId = null;
  let armedAt = 0;
  let csvCaptured = false;
  let csvCaptureRequested = false;
  let aggregate = null;
  let receiverReady = false;
  let pendingCapture = null;
  const nativeFetch = globalThis.fetch;
  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;
  const nativeXhrResponseTextDescriptor = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseText');
  const nativeXhrResponseText = nativeXhrResponseTextDescriptor?.get;
  const nativeXhrResponseDescriptor = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'response');
  const nativeXhrResponse = nativeXhrResponseDescriptor?.get;
  const nativeResponseText = globalThis.Response?.prototype?.text;
  const nativeResponseJson = globalThis.Response?.prototype?.json;
  const nativeResponseBlob = globalThis.Response?.prototype?.blob;
  const nativeCreateObjectURL = globalThis.URL?.createObjectURL;
  const nativeAnchorClick = globalThis.HTMLAnchorElement?.prototype?.click;
  const nativeWindowOpen = globalThis.open;
  const nativeDispatchEvent = globalThis.EventTarget?.prototype?.dispatchEvent;
  let interceptorsInstalled = false;
  const csvObjectUrls = new Set();
  const observedResponses = new WeakSet();
  const observedCsvResponses = new WeakSet();
  const observedXhrResponseTexts = new WeakSet();
  const observingClones = new WeakSet();
  const observingBlobClones = new WeakSet();

  function progress(code) {
    window.postMessage({ type: PROGRESS_MESSAGE, code }, location.origin);
  }

  function byteLength(text) {
    return new TextEncoder().encode(text).length;
  }

  function reportEndpoint(rawUrl) {
    let url;
    try { url = new URL(rawUrl, location.href); } catch { return false; }
    const parts = url.pathname.split('/').filter(Boolean);
    return parts.length === 5
      && parts[0] === 'report'
      && parts[1] === 'workspaces'
      && parts[2] !== ''
      && parts[3] === 'reports'
      && parts[4] === 'detailed'
      || parts.length === 7
      && parts[0] === 'report'
      && parts[1] === 'workspaces'
      && parts[2] !== ''
      && parts[3] === 'async'
      && parts[4] === 'reports'
      && parts[5] === 'detailed'
      && parts[6] !== '';
  }

  function reportCreationEndpoint(rawUrl) {
    let url;
    try { url = new URL(rawUrl, location.href); } catch { return false; }
    const parts = url.pathname.split('/').filter(Boolean);
    return parts.length === 6 && parts[0] === 'report' && parts[1] === 'workspaces'
      && parts[2] !== '' && parts[3] === 'async' && parts[4] === 'reports' && parts[5] === 'detailed';
  }

  function reportTaskId(rawUrl) {
    let url;
    try { url = new URL(rawUrl, location.href); } catch { return null; }
    const parts = url.pathname.split('/').filter(Boolean);
    return reportEndpoint(url.href) && parts.length === 7 ? parts[6] : null;
  }

  function currentRouteMatchesExpectedYear() {
    if (!Number.isInteger(expectedYear)) return false;
    const currentRoute = new URL(location.href);
    return currentRoute.searchParams.get('start') === `${expectedYear}-01-01T00:00:00.000Z`
      && currentRoute.searchParams.get('end') === `${expectedYear}-12-31T23:59:59.999Z`;
  }

  function observeCreationResponse(url, body, text, requestStartedAt = null) {
    if (!armed || captureMode !== 'discover' || expectedReportTaskId || !reportCreationEndpoint(url)) return;
    try {
      const request = typeof body === 'string' ? JSON.parse(body) : null;
      const hasExpectedRequestBody = request?.dateRangeStart === `${expectedYear}-01-01T00:00:00.000Z`
        && request?.dateRangeEnd === `${expectedYear}-12-31T23:59:59.999Z`;
      const isExpectedRoute = currentRouteMatchesExpectedYear();
      if (!hasExpectedRequestBody && (!isExpectedRoute || !Number.isFinite(requestStartedAt) || requestStartedAt < armedAt)) return;
      const taskId = JSON.parse(text)?.reportTaskId;
      if (typeof taskId !== 'string' || taskId.length === 0) throw new TypeError('missing task id');
      expectedReportTaskId = taskId;
      progress('report_task_bound');
    } catch { progress('report_task_unavailable'); }
  }

  function primitive(value, depth = 0) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new TypeError('non-finite value');
      return value;
    }
    if (depth > 20 || !value || typeof value !== 'object') throw new TypeError('non-JSON value');
    if (Array.isArray(value)) return value.map(item => primitive(item, depth + 1));
    if (Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError('unsafe object');
    const copy = Object.create(null);
    for (const key of Object.keys(value)) copy[key] = primitive(value[key], depth + 1);
    return copy;
  }

  function copyAllowed(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError('malformed object');
    const copy = Object.create(null);
    for (const key of keys) {
      if (!Object.hasOwn(value, key)) continue;
      copy[key] = primitive(value[key]);
    }
    return copy;
  }

  function copyEntry(value) {
    const copy = copyAllowed(value, ENTRY_KEYS);
    if (Object.hasOwn(copy, 'timeInterval')) copy.timeInterval = copyAllowed(value.timeInterval, INTERVAL_KEYS);
    if (Object.hasOwn(copy, 'tags')) {
      if (!Array.isArray(value.tags)) throw new TypeError('malformed tags');
      copy.tags = value.tags.map(tag => copyAllowed(tag, TAG_KEYS));
    }
    return copy;
  }

  function sanitizeText(text) {
    if (!armed || typeof text !== 'string') return;
    if (byteLength(text) > MAX_BYTES) {
      progress('source_oversized');
      return;
    }
    let source;
    try { source = JSON.parse(text); } catch { progress('response_not_json'); return; }
    try {
      if (!source || typeof source !== 'object' || Array.isArray(source) || Object.getPrototypeOf(source) !== Object.prototype) throw new TypeError('malformed report');
      const output = Object.create(null);
      const emptyReport = source.timeentries === null || Array.isArray(source.timeentries) && source.timeentries.length === 0;
      if (emptyReport) {
        output.timeentries = [];
        output.totals = [Object.assign(Object.create(null), { entriesCount: 0 })];
      } else {
        if (!Array.isArray(source.timeentries)) throw new TypeError('incomplete report');
        output.timeentries = source.timeentries.map(copyEntry);
        if (!Array.isArray(source.totals)) throw new TypeError('incomplete report');
        output.totals = source.totals.map(total => copyAllowed(total, TOTAL_KEYS));
      }
      const json = JSON.stringify(output);
      if (byteLength(json) > MAX_BYTES) {
        progress('sanitized_oversized');
        return;
      }
      return { output, json };
    } catch { progress('response_rejected'); }
  }

  function reportStartedAfterArm(url) {
    const entries = globalThis.performance?.getEntriesByName?.(url) || [];
    return entries.some(entry => Number.isFinite(entry?.startTime) && entry.startTime >= armedAt);
  }

  function reportMatchesExpectedYear(output) {
    if (!Number.isInteger(expectedYear)) return false;
    const start = `${expectedYear}-01-01T00:00:00.000Z`;
    const end = `${expectedYear}-12-31T23:59:59.999Z`;
    return output.timeentries.every(entry => {
      const interval = entry.timeInterval;
      return typeof interval?.start === 'string' && typeof interval?.end === 'string'
        && interval.start <= end && interval.end >= start;
    });
  }

  function captureText(text) {
    const sanitized = sanitizeText(text);
    if (!sanitized) return;
    const { output } = sanitized;
    const total = output.totals[0]?.entriesCount;
    if (!Number.isSafeInteger(total) || total < 0) {
      progress('response_rejected');
      return;
    }
    if (output.timeentries.some(entry => typeof entry._id !== 'string' || entry._id.length === 0)) {
      progress('response_rejected');
      return;
    }
    if (Number.isInteger(expectedYear)) {
      if (!reportMatchesExpectedYear(output)) {
        progress('report_year_mismatch');
        return;
      }
      if (captureMode === 'discover') {
        window.postMessage({ type: YEAR_OBSERVED_MESSAGE, entryCount: total, year: expectedYear }, location.origin);
        stopCapture();
        return;
      }
    }
    pendingCapture = sanitized.json;
    progress('captured_sanitized');
    stopCapture();
    dispatchCapture();
  }

  function dispatchCapture() {
    if (!receiverReady || typeof pendingCapture !== 'string') return;
    const complete = pendingCapture;
    pendingCapture = null;
    window.postMessage({ type: CAPTURE_MESSAGE, text: complete }, location.origin);
  }

  function observeResponse(url, text, requestStartedAt = null) {
    if (armed && reportEndpoint(url)) {
      const taskId = reportTaskId(url);
      if (captureMode === 'discover' && taskId !== null && expectedReportTaskId !== null && taskId !== expectedReportTaskId) {
        progress('report_task_mismatch');
        return;
      }
      const startedAfterArm = Number.isFinite(requestStartedAt) && requestStartedAt >= armedAt;
      if (captureMode === 'discover' && !startedAfterArm && !reportStartedAfterArm(url)) {
        progress('report_response_precedes_arm');
        return;
      }
      if (captureMode === 'discover' && taskId !== null && expectedReportTaskId === null && !currentRouteMatchesExpectedYear()) {
        progress('report_task_mismatch');
        return;
      }
      progress('report_response_observed');
      captureText(text);
    }
  }

  function observeResponseBody(response) {
    if (!armed || !response || !reportEndpoint(response.url) || observedResponses.has(response) || typeof nativeResponseText !== 'function') return;
    observedResponses.add(response);
    let text;
    try {
      const clone = response.clone();
      observingClones.add(clone);
      text = clone.text();
    } catch { return; }
    Promise.resolve(text).then(value => observeResponse(response.url, value)).catch(() => {});
  }

  function observeCsvResponseBody(response) {
    if (!armed || captureMode !== 'csv' || !response || !reportEndpoint(response.url)
        || observedCsvResponses.has(response) || typeof nativeResponseBlob !== 'function') return;
    observedCsvResponses.add(response);
    let blob;
    try {
      const clone = response.clone();
      observingBlobClones.add(clone);
      blob = nativeResponseBlob.call(clone);
    } catch { return; }
    Promise.resolve(blob).then(captureCsvBlob).catch(() => {});
  }

  function armBridge(event) {
    const mode = event?.detail?.mode || 'report';
    if (!['discover', 'csv', 'report'].includes(mode)) return;
    const year = event?.detail?.year;
    if (mode === 'discover' && (!Number.isInteger(year) || year < 2016 || year > 9999)) return;
    armed = true;
    captureMode = mode;
    expectedYear = Number.isInteger(year) ? year : null;
    expectedReportTaskId = null;
    armedAt = typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : 0;
    csvCaptured = false;
    csvCaptureRequested = false;
    aggregate = null;
    pendingCapture = null;
    installInterceptors();
    progress('bridge_armed');
  }

  function stopInterceptors() {
    if (!interceptorsInstalled) return;
    if (globalThis.fetch === clockoliFetch) globalThis.fetch = nativeFetch;
    if (XMLHttpRequest.prototype.open === clockoliOpen) XMLHttpRequest.prototype.open = nativeOpen;
    if (XMLHttpRequest.prototype.send === clockoliSend) XMLHttpRequest.prototype.send = nativeSend;
    if (Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseText')?.get === clockoliXhrResponseText) {
      Object.defineProperty(XMLHttpRequest.prototype, 'responseText', nativeXhrResponseTextDescriptor);
    }
    if (Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'response')?.get === clockoliXhrResponse) {
      Object.defineProperty(XMLHttpRequest.prototype, 'response', nativeXhrResponseDescriptor);
    }
    if (globalThis.Response?.prototype?.text === clockoliResponseText) globalThis.Response.prototype.text = nativeResponseText;
    if (globalThis.Response?.prototype?.json === clockoliResponseJson) globalThis.Response.prototype.json = nativeResponseJson;
    if (globalThis.Response?.prototype?.blob === clockoliResponseBlob) globalThis.Response.prototype.blob = nativeResponseBlob;
    if (globalThis.URL?.createObjectURL === clockoliCreateObjectURL) globalThis.URL.createObjectURL = nativeCreateObjectURL;
    if (globalThis.HTMLAnchorElement?.prototype?.click === clockoliAnchorClick) globalThis.HTMLAnchorElement.prototype.click = nativeAnchorClick;
    if (globalThis.open === clockoliWindowOpen) globalThis.open = nativeWindowOpen;
    if (globalThis.EventTarget?.prototype?.dispatchEvent === clockoliDispatchEvent) globalThis.EventTarget.prototype.dispatchEvent = nativeDispatchEvent;
    csvObjectUrls.clear();
    interceptorsInstalled = false;
  }

  function stopCapture() {
    armed = false;
    csvCaptureRequested = false;
    expectedYear = null;
    expectedReportTaskId = null;
    aggregate = null;
    stopInterceptors();
  }

  function restoreBridgeArm() {
    const root = globalThis.document?.documentElement;
    if (root?.getAttribute(BRIDGE_ARM_ATTRIBUTE) === 'armed' && !armed) armBridge();
  }

  function restoreReceiverReady() {
    const root = globalThis.document?.documentElement;
    if (root?.hasAttribute(RECEIVER_READY_ATTRIBUTE)) {
      receiverReady = true;
      dispatchCapture();
    }
  }

  function requestReportYear(event) {
    const year = event?.detail?.year;
    if (!Number.isInteger(year) || year < 2016 || year > 9999) return;
    const mode = event?.detail?.mode;
    if (!['discover', 'csv', 'report'].includes(mode)) return;
    const url = new URL(location.href);
    if (url.protocol !== 'https:' || url.hostname !== 'app.clockify.me'
        || url.pathname.replace(/\/+$/, '') !== '/reports/detailed') return;
    url.searchParams.set('start', `${year}-01-01T00:00:00.000Z`);
    url.searchParams.set('end', `${year}-12-31T23:59:59.999Z`);
    url.searchParams.set('page', '1');
    // Discovery and native CSV exports use Clockify's observed 199-row route.
    // Switching the DOM fallback to 200 rows changes the already-discovered
    // annual URL, which makes Clockify request the first report page instead
    // of treating the same route as a no-op.
    url.searchParams.set('pageSize', mode === 'report' ? '200' : '199');
    history.pushState({}, '', url.href);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  EVENT_TARGET.addEventListener(ARM_EVENT, armBridge);
  EVENT_TARGET.addEventListener(CSV_CAPTURE_INTENT_EVENT, () => {
    if (armed && captureMode === 'csv') csvCaptureRequested = true;
  });
  EVENT_TARGET.addEventListener(RECEIVER_READY_EVENT, () => { receiverReady = true; dispatchCapture(); });
  EVENT_TARGET.addEventListener('clockoli:clockify-detailed-report-disarm', () => { stopCapture(); pendingCapture = null; });
  EVENT_TARGET.addEventListener(YEAR_REQUEST_EVENT, requestReportYear);
  EVENT_TARGET.addEventListener('click', suppressCsvNavigation, true);
  restoreBridgeArm();
  restoreReceiverReady();

  function observeFetchCreation(url, input, init, response) {
    const request = init || {};
    const source = globalThis.Request && input instanceof globalThis.Request ? input : null;
    const method = request.method || source?.method;
    if (!armed || !response?.ok || !reportCreationEndpoint(url) || method !== 'POST') return;
    const body = request.body === undefined && source ? source.clone().text() : request.body;
    Promise.all([Promise.resolve(body), response.clone().text()])
      .then(([requestBody, text]) => observeCreationResponse(url, requestBody, text)).catch(() => {});
  }

  function clockoliFetch(...args) {
    const result = nativeFetch.apply(this, args);
    return Promise.resolve(result).then(response => {
      const url = response?.url || args[0];
      const request = args[1] || {};
      if (armed && response?.ok && reportCreationEndpoint(url)) {
        observeFetchCreation(url, args[0], request, response);
      } else if (armed && response?.ok && reportEndpoint(url)) {
        if (captureMode === 'csv') observeCsvResponseBody(response);
        else observeResponseBody(response);
      } else if (armed && reportEndpoint(url)) {
        progress('report_response_not_success');
      }
      return response;
    }, error => {
      if (armed && reportEndpoint(args[0])) progress('report_request_failed');
      throw error;
    });
  }

  function observeXhrResponse(request) {
    const url = request.responseURL || request.__clockoliDetailedReportUrl;
    if (!armed) return;
    if (captureMode === 'discover' && request.__clockoliDetailedReportMethod === 'POST'
        && reportCreationEndpoint(url) && request.status >= 200 && request.status < 300) {
      observeCreationResponse(url, request.__clockoliDetailedReportBody, request.responseText,
        request.__clockoliDetailedReportStartedAt);
      return;
    }
    if (!reportEndpoint(url)) return;
    if (captureMode === 'csv' && request.status >= 200 && request.status < 300 && request.responseType === 'blob') {
      captureCsvBlob(request.response);
    } else if (captureMode !== 'csv' && request.status >= 200 && request.status < 300) {
      observeResponse(url, request.responseText, request.__clockoliDetailedReportStartedAt);
    } else if (request.status < 200 || request.status >= 300) {
      progress('report_response_not_success');
    }
  }

  function requestStartedAfterArm(url) {
    const entries = globalThis.performance?.getEntriesByName?.(url) || [];
    return entries.find(entry => Number.isFinite(entry?.startTime) && entry.startTime >= armedAt)?.startTime ?? null;
  }

  function observeXhrPayload(request, text) {
    if (!armed || observedXhrResponseTexts.has(request) || typeof text !== 'string') return text;
    observedXhrResponseTexts.add(request);
    const url = request.responseURL;
    const startedAt = requestStartedAfterArm(url);
    if (captureMode === 'discover' && request.status >= 200 && request.status < 300 && reportCreationEndpoint(url)) {
      observeCreationResponse(url, null, text, startedAt);
    } else if (request.status >= 200 && request.status < 300 && reportEndpoint(url)) {
      observeResponse(url, text, startedAt);
    }
  }

  function clockoliXhrResponseText() {
    const text = nativeXhrResponseText.call(this);
    observeXhrPayload(this, text);
    return text;
  }

  function clockoliXhrResponse() {
    const response = nativeXhrResponse.call(this);
    if (response && typeof response === 'object') {
      try { observeXhrPayload(this, JSON.stringify(response)); } catch {}
    }
    return response;
  }

  function clockoliOpen(method, url, ...rest) {
    this.__clockoliDetailedReportUrl = url;
    this.__clockoliDetailedReportMethod = String(method).toUpperCase();
    this.__clockoliDetailedReportStartedAt = typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : null;
    // Clockify can retain XMLHttpRequest#send before capture is armed. Hook at
    // open time so a native saved send still yields the completed response.
    this.addEventListener('loadend', () => observeXhrResponse(this), { once: true });
    return nativeOpen.call(this, method, url, ...rest);
  }

  function clockoliSend(...args) {
    this.__clockoliDetailedReportBody = args[0];
    return nativeSend.apply(this, args);
  }

  function clockoliResponseText(...args) {
    if (!observingClones.has(this)) observeResponseBody(this);
    return nativeResponseText.apply(this, args);
  }

  function clockoliResponseJson(...args) {
    if (!observingClones.has(this)) observeResponseBody(this);
    return nativeResponseJson.apply(this, args);
  }

  function clockoliResponseBlob(...args) {
    if (!observingBlobClones.has(this)) observeCsvResponseBody(this);
    return nativeResponseBlob.apply(this, args);
  }

  function captureCsvBlob(blob) {
    if (!armed || captureMode !== 'csv' || !csvCaptureRequested || csvCaptured || !blob || typeof blob.text !== 'function' || blob.size > MAX_BYTES) return;
    Promise.resolve(blob.text()).then(text => {
      if (!armed || captureMode !== 'csv' || !csvCaptureRequested || csvCaptured || typeof text !== 'string' || !text.replace(/^\uFEFF/, '').startsWith(CSV_HEADER_PREFIX)) return;
      csvCaptured = true;
      window.postMessage({ type: CSV_CAPTURE_MESSAGE, text }, location.origin);
    }).catch(() => {});
  }

  function clockoliCreateObjectURL(blob) {
    const url = nativeCreateObjectURL.call(this, blob);
    // Clockify currently serves its CSV Blob with a browser-dependent MIME
    // type and may open it in a new window instead of using download="".
    // This bridge is armed only for the immediately requested native CSV.
    if (armed && captureMode === 'csv' && csvCaptureRequested && typeof url === 'string') csvObjectUrls.add(url);
    captureCsvBlob(blob);
    return url;
  }

  function clockoliDispatchEvent(event) {
    if (armed && captureMode === 'csv' && csvCaptureRequested && this?.tagName === 'A' && csvObjectUrls.has(this.href) && event?.type === 'click') {
      event.preventDefault?.();
      event.stopImmediatePropagation?.();
      return false;
    }
    return nativeDispatchEvent.call(this, event);
  }

  function clockoliAnchorClick(...args) {
    if (armed && captureMode === 'csv' && csvCaptureRequested && csvObjectUrls.has(this?.href)) return;
    return nativeAnchorClick.apply(this, args);
  }

  function clockoliWindowOpen(url, ...args) {
    if (armed && captureMode === 'csv' && csvCaptureRequested && csvObjectUrls.has(url)) return null;
    return nativeWindowOpen?.call(this, url, ...args);
  }

  function suppressCsvNavigation(event) {
    if (!armed || captureMode !== 'csv' || !csvCaptureRequested || !event?.cancelable) return;
    const target = typeof event.composedPath === 'function'
      ? event.composedPath().find(node => node?.tagName === 'A')
      : event.target?.tagName === 'A' ? event.target : null;
    if (!target || !csvObjectUrls.has(target.href)) return;
    event.preventDefault();
    event.stopImmediatePropagation?.();
  }

  function installInterceptors() {
    if (interceptorsInstalled) return;
    if (typeof nativeFetch === 'function') {
      globalThis.fetch = clockoliFetch;
    }
    XMLHttpRequest.prototype.open = clockoliOpen;
    XMLHttpRequest.prototype.send = clockoliSend;
    if (typeof nativeXhrResponseText === 'function') {
      Object.defineProperty(XMLHttpRequest.prototype, 'responseText', { ...nativeXhrResponseTextDescriptor, get: clockoliXhrResponseText });
    }
    if (typeof nativeXhrResponse === 'function') {
      Object.defineProperty(XMLHttpRequest.prototype, 'response', { ...nativeXhrResponseDescriptor, get: clockoliXhrResponse });
    }
    if (typeof nativeResponseText === 'function') globalThis.Response.prototype.text = clockoliResponseText;
    if (typeof nativeResponseJson === 'function') globalThis.Response.prototype.json = clockoliResponseJson;
    if (typeof nativeResponseBlob === 'function') globalThis.Response.prototype.blob = clockoliResponseBlob;
    if (typeof nativeCreateObjectURL === 'function') globalThis.URL.createObjectURL = clockoliCreateObjectURL;
    if (typeof nativeAnchorClick === 'function') globalThis.HTMLAnchorElement.prototype.click = clockoliAnchorClick;
    if (typeof nativeWindowOpen === 'function') globalThis.open = clockoliWindowOpen;
    if (typeof nativeDispatchEvent === 'function') globalThis.EventTarget.prototype.dispatchEvent = clockoliDispatchEvent;
    interceptorsInstalled = true;
  }
})();
