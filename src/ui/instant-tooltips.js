// One immediate, consistently styled tooltip for Clockoli's own UI.
(() => {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const attached = new WeakSet();
  const handledEvents = new WeakSet();
  let host = null;
  let bubble = null;
  let activeTarget = null;

  function normalizeTitle(element) {
    if (!element?.hasAttribute?.('title')) return;
    const value = element.getAttribute('title');
    if (value) element.setAttribute('data-clockoli-tooltip', value);
    else element.removeAttribute('data-clockoli-tooltip');
    element.removeAttribute('title'); // Suppress the browser's delayed native tooltip.
  }

  function normalizeSvgTitle(element) {
    if (element?.namespaceURI !== SVG_NS || element.localName !== 'title') return;
    const parent = element.parentElement;
    if (!parent) return;
    const value = element.textContent;
    if (value?.trim()) {
      parent.setAttribute('data-clockoli-tooltip', value);
      if (!parent.hasAttribute('aria-label')) parent.setAttribute('aria-label', value.replace(/\s+/g, ' ').trim());
    }
    element.remove(); // SVG <title> also opens a delayed browser tooltip.
  }

  function normalizeTree(node) {
    if (node.nodeType === 1) {
      normalizeTitle(node);
      normalizeSvgTitle(node);
    }
    if (!node.querySelectorAll) return;
    for (const element of node.querySelectorAll('[title]')) normalizeTitle(element);
    for (const element of node.querySelectorAll('svg title')) normalizeSvgTitle(element);
  }

  function ensureBubble() {
    if (host?.isConnected) return;
    host = document.createElement('div');
    host.id = 'clockoli-instant-tooltip';
    host.style.cssText = 'position:fixed!important;top:0!important;left:0!important;z-index:2147483647!important;pointer-events:none!important;display:none!important';
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      .tooltip {
        box-sizing: border-box;
        max-width: min(340px, calc(100vw - 16px));
        padding: 6px 8px;
        border: 1px solid #57606a;
        border-radius: 6px;
        background: #24292f;
        color: #fff;
        box-shadow: 0 3px 12px #0003;
        font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        text-align: left;
        white-space: pre-line;
        overflow-wrap: anywhere;
      }
    `;
    bubble = document.createElement('div');
    bubble.className = 'tooltip';
    bubble.setAttribute('role', 'tooltip');
    shadow.append(style, bubble);
    document.documentElement.append(host);
  }

  function hide() {
    activeTarget = null;
    if (host) host.style.setProperty('display', 'none', 'important');
  }

  function position(x, y) {
    const bounds = bubble.getBoundingClientRect();
    const margin = 8;
    const left = Math.max(margin, Math.min(x + 12, window.innerWidth - bounds.width - margin));
    const below = y + 18;
    const top = below + bounds.height <= window.innerHeight - margin
      ? below
      : Math.max(margin, y - bounds.height - 10);
    host.style.setProperty('left', Math.round(left) + 'px', 'important');
    host.style.setProperty('top', Math.round(top) + 'px', 'important');
  }

  function show(element, label, x, y) {
    ensureBubble();
    if (activeTarget !== element || bubble.textContent !== label) bubble.textContent = label;
    activeTarget = element;
    host.style.setProperty('display', 'block', 'important');
    position(x, y);
  }

  function findTooltip(event, root, selector) {
    for (const node of event.composedPath()) {
      if (node === root) break;
      if (!node?.getAttribute) continue;
      if (selector && !node.matches?.(selector)) continue;
      normalizeTitle(node); // Also handles hover before MutationObserver runs.
      const label = node.getAttribute('data-clockoli-tooltip');
      if (label?.trim()) return { node, label };
    }
    return null;
  }

  function attach(root, { selector = null } = {}) {
    if (!root || attached.has(root)) return;
    attached.add(root);
    if (!selector) {
      normalizeTree(root);
      const observer = new MutationObserver(records => {
        for (const record of records) {
          if (record.type === 'attributes') normalizeTitle(record.target);
          else for (const node of record.addedNodes) normalizeTree(node);
        }
      });
      observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] });
    }

    const claim = event => {
      if (handledEvents.has(event)) return false;
      if (root instanceof ShadowRoot) handledEvents.add(event);
      return true;
    };
    const hover = event => {
      if (!claim(event)) return;
      if (event.pointerType === 'touch' || event.buttons) { hide(); return; }
      const found = findTooltip(event, root, selector);
      if (!found) { if (!selector) hide(); return; }
      show(found.node, found.label, event.clientX, event.clientY);
    };
    root.addEventListener('pointerover', hover, true);
    root.addEventListener('pointermove', hover, true);
    root.addEventListener('pointerout', event => {
      if (!claim(event)) return;
      if (activeTarget && !activeTarget.contains(event.relatedTarget)) hide();
    }, true);
    root.addEventListener('focusin', event => {
      if (!claim(event)) return;
      const found = findTooltip(event, root, selector);
      if (!found) return;
      const bounds = found.node.getBoundingClientRect();
      show(found.node, found.label, bounds.left + bounds.width / 2, bounds.bottom);
    }, true);
    root.addEventListener('focusout', event => {
      if (claim(event) && activeTarget && !activeTarget.contains(event.relatedTarget)) hide();
    }, true);
    root.addEventListener('pointerdown', hide, true);
    root.addEventListener('scroll', hide, true);
  }

  window.addEventListener('blur', hide);
  globalThis.ClockoliInstantTooltips = Object.freeze({ attach });
  if (['chrome-extension:', 'moz-extension:', 'safari-web-extension:'].includes(location.protocol)) attach(document);
})();
