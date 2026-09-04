(() => {
  'use strict';

  const ARM_EVENT = 'clockoli:clockify-detailed-report-arm';
  const RECEIVER_READY_EVENT = 'clockoli:clockify-detailed-report-receiver-ready';
  const BRIDGE_ARM_ATTRIBUTE = 'data-clockoli-clockify-capture-arm';
  const RECEIVER_READY_ATTRIBUTE = 'data-clockoli-clockify-capture-receiver-ready';
  const CAPTURE_PAYLOAD_ATTRIBUTE = 'data-clockoli-clockify-capture-payload';

  const PROGRESS_EVENT = 'clockoli:clockify-detailed-report-progress';

  const PROGRESS_MESSAGE = 'clockoli:clockify-detailed-report-progress';
  const EVENT_TARGET = globalThis.document || window;
  const MAX_BYTES = 16 * 1024 * 1024;
  const MAX_ENTRIES = 20_000;
  const ROOT_KEYS = new Set(['timeentries', 'totals']);
  const ENTRY_KEYS = new Set([
    '_id', 'approvalRequestId', 'billable', 'clientId', 'clientName', 'currency',
    'description', 'isLocked', 'projectColor', 'projectId', 'projectName', 'tagIds',
    'tags', 'taskId', 'taskName', 'timeInterval', 'type', 'userEmail', 'userId', 'userName',
  ]);
  const INTERVAL_KEYS = new Set(['duration', 'end', 'offEnd', 'offStart', 'start', 'timeZone', 'zonedEnd', 'zonedStart']);
  const TAG_KEYS = new Set(['_id', 'name']);
  const TOTAL_KEYS = new Set(['_id', 'amounts', 'entriesCount', 'numOfCurrencies', 'totalAmount', 'totalAmountByCurrency', 'totalBillableTime', 'totalTime']);
  let armed = false;
  let aggregate = null;
  let receiverReady = false;
  let pendingCapture = null;

  function progress(code) {
    console.info('[Clockoli Clockify capture bridge]', code);
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
      for (const key of ROOT_KEYS) {
        if (!Object.hasOwn(source, key) || !Array.isArray(source[key])) throw new TypeError('incomplete report');
      }
      output.timeentries = source.timeentries.map(copyEntry);
      output.totals = source.totals.map(total => copyAllowed(total, TOTAL_KEYS));
      const json = JSON.stringify(output);
      if (byteLength(json) > MAX_BYTES) {
        progress('sanitized_oversized');
        return;
      }
      return { output, json };
    } catch { progress('response_rejected'); }
  }

  function captureText(text) {
    const sanitized = sanitizeText(text);
    if (!sanitized) return;
    const { output } = sanitized;
    const total = output.totals[0]?.entriesCount;
    if (!Number.isSafeInteger(total) || total < 0 || total > MAX_ENTRIES) {
      progress('response_rejected');
      return;
    }
    if (!aggregate) aggregate = { entries: new Map(), total };
    if (aggregate.total !== total) {
      progress('response_rejected');
      return;
    }
    for (const entry of output.timeentries) {
      if (typeof entry._id !== 'string' || entry._id.length === 0) {
        progress('response_rejected');
        return;
      }
      const existing = aggregate.entries.get(entry._id);
      const serialized = JSON.stringify(entry);
      if (existing && existing.serialized !== serialized) {
        progress('response_rejected');
        return;
      }
      aggregate.entries.set(entry._id, { entry, serialized });
    }
    if (aggregate.entries.size < total) {
      progress('page_captured');
      return;
    }
    if (aggregate.entries.size !== total) {
      progress('response_rejected');
      return;
    }
    const complete = JSON.stringify({
      timeentries: [...aggregate.entries.values()].map(value => value.entry), totals: output.totals,
    });
    if (byteLength(complete) > MAX_BYTES) {
      progress('sanitized_oversized');
      return;
    }
    armed = false;
    aggregate = null;
    pendingCapture = complete;
    progress('captured_sanitized');
    dispatchCapture();
  }

  function dispatchCapture() {
    if (!receiverReady || typeof pendingCapture !== 'string') return;
    const complete = pendingCapture;
    pendingCapture = null;
    document.documentElement?.setAttribute(CAPTURE_PAYLOAD_ATTRIBUTE, complete);

  }

  function observeResponse(url, text) {
    if (armed && reportEndpoint(url)) {
      progress('report_response_observed');
      captureText(text);
    }
  }

  function armBridge() {
    armed = true;
    aggregate = null;
    pendingCapture = null;
    progress('bridge_armed');
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

  EVENT_TARGET.addEventListener(ARM_EVENT, armBridge);
  EVENT_TARGET.addEventListener(RECEIVER_READY_EVENT, () => { receiverReady = true; dispatchCapture(); });
  EVENT_TARGET.addEventListener('clockoli:clockify-detailed-report-disarm', () => { armed = false; aggregate = null; pendingCapture = null; });
  restoreBridgeArm();
  restoreReceiverReady();
  if (typeof MutationObserver === 'function' && globalThis.document?.documentElement) {
    new MutationObserver(() => { restoreBridgeArm(); restoreReceiverReady(); }).observe(document.documentElement, {
      attributes: true,
      attributeFilter: [BRIDGE_ARM_ATTRIBUTE, RECEIVER_READY_ATTRIBUTE],
    });
  }

  const nativeFetch = globalThis.fetch;
  if (typeof nativeFetch === 'function') {
    globalThis.fetch = function (...args) {
      const result = nativeFetch.apply(this, args);
      return Promise.resolve(result).then(response => {
        const url = response?.url || args[0];
        if (armed && response?.ok && reportEndpoint(url)) {
          Promise.resolve(response.clone().text()).then(text => observeResponse(url, text)).catch(() => {});
        } else if (armed && reportEndpoint(url)) {
          progress('report_response_not_success');
        }
        return response;
      }, error => {
        if (armed && reportEndpoint(args[0])) progress('report_request_failed');
        throw error;
      });
    };
  }

  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__clockoliDetailedReportUrl = url;
    return nativeOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('loadend', () => {
      const url = this.responseURL || this.__clockoliDetailedReportUrl;
      if (armed && reportEndpoint(url)) {
        if (this.status >= 200 && this.status < 300) observeResponse(url, this.responseText);
        else progress('report_response_not_success');
      }
    }, { once: true });
    return nativeSend.apply(this, args);
  };
})();
