import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { formatClockDuration } from '../src/domain/reporting.js';
import { normalizeTaskUrl, localDateParts, entryDateValue } from '../src/domain/values.js';

const source = await readFile(new URL('../src/content/github.js', import.meta.url), 'utf8');
const trackingCardSource = await readFile(new URL('../src/ui/tracking-card.js', import.meta.url), 'utf8');
const recoverySource = await readFile(new URL('../src/domain/recovery-actions.js', import.meta.url), 'utf8');
// The fake DOM does not mount the real timeline adapter. Render the shared panel's
// non-timeline body so its tracker controls remain covered by these component tests.
const domHarnessSource = trackingCardSource + '\n' + source.replace(
  'renderMenu({ compact: true, onClose: closeFullWidthPopup })',
  'renderMenu({ onClose: closeFullWidthPopup })',
);
assert.notEqual(domHarnessSource, source);

test('calendar tracking uses the stored identity in both the GitHub panel and Activity', () => {
  const begin = source.indexOf('  function trackableTaskIdentityOf(value) {');
  const end = source.indexOf('\n  function taskTitleOf(', begin);
  assert.ok(begin >= 0 && end > begin);
  const snippet = source.slice(begin, end);
  for (const timesMode of [false, true]) {
    const context = vm.createContext({ timesMode, popupMode: false, normalizeTaskUrl, storedTaskIdentityOf: entry => /^(https?:\/\/|[\w-]+\/[\w-]+\/[\w-]+$)/.test(entry.taskUrl) ? entry.taskUrl : null, taskUrlOf: entry => normalizeTaskUrl(entry.taskUrl) });
    vm.runInContext(`${snippet}\nthis.trackable = trackableTaskIdentityOf;`, context);
    assert.equal(context.trackable({ taskUrl: 'manticoresoftware/Routines/1-dev-call' }), 'manticoresoftware/Routines/1-dev-call');
    assert.equal(context.trackable({ taskUrl: 'https://github.com/acme/repo/issues/7' }), 'https://github.com/acme/repo/issues/7');
    assert.equal(context.trackable({ taskUrl: 'not a task identity' }), null);
  }
});

test('extension-context interruption stops stale content timers without rendering an error', () => {
  assert.match(source, /function deactivateExtensionContext\(\) \{[\s\S]*?clearInterval\(tick\)/);
  assert.match(source, /function setError\(error = ''\) \{ if \(isExtensionContextInvalidated\(error\)\) \{ deactivateExtensionContext\(\); return; \}/);
  assert.match(source, /function send\(message\) \{[\s\S]*?catch \(cause\) \{[\s\S]*?isExtensionContextInvalidated\(error\)[\s\S]*?deactivateExtensionContext\(\)/);
  assert.match(source, /function extensionResourceUrl\(path\) \{[\s\S]*?globalThis\.chrome\?\.runtime\?\.getURL\?\.\(path\)[\s\S]*?isExtensionContextInvalidated\(error\)[\s\S]*?deactivateExtensionContext\(\)/);
  assert.doesNotMatch(source, /timelineEditorStylesheet|elastic-timeline-editor\.css/);
  assert.match(source, /const markUrl = extensionResourceUrl\('src\/assets\/clockoli-32\.png'\)/);
});

test('GitHub content-script messaging fails closed after an extension-context reload', () => {
  assert.match(source, /const runtime = globalThis\.chrome\?\.runtime;/);
  assert.match(source, /if \(typeof runtime\?\.sendMessage !== 'function'\)/);
  assert.match(source, /error\.code = 'extension_context_interrupted'/);
});

const createdNodes = [];

class FakeNode {
  constructor(tag = '') {
    createdNodes.push(this);
    this.tag = tag;
    this.id = '';
    this.textContent = '';
    this.className = '';
    this.isConnected = false;
    this.shadowRoot = null;
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.style = {};
    this.classList = {
      add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
      remove: (...names) => { const removed = new Set(names); this.className = this.className.split(/\s+/).filter(name => name && !removed.has(name)).join(' '); },
      contains: name => this.className.split(/\s+/).includes(name),
      toggle: (name, force) => {
        const enabled = force === undefined ? !this.className.split(/\s+/).includes(name) : Boolean(force);
        if (enabled) this.classList.add(name); else this.classList.remove(name); return enabled;
      },
    };
  }
  get nextElementSibling() {
    if (!this.parentElement) return null;
    const index = this.parentElement.children.indexOf(this);
    return this.parentElement.children[index + 1] ?? null;
  }
  get previousElementSibling() {
    if (!this.parentElement) return null;
    const index = this.parentElement.children.indexOf(this);
    return index > 0 ? this.parentElement.children[index - 1] : null;
  }
  append(...nodes) {
    for (const node of nodes) {
      if (node && typeof node === 'object') {
        this.children.push(node); node.parentElement = this; node.isConnected = true;
        if (node.id) documentNodes.set(node.id, node);
      }
    }
  }
  prepend(...nodes) {
    for (const node of [...nodes].reverse()) {
      if (node && typeof node === 'object') { this.children.unshift(node); node.parentElement = this; node.isConnected = true; }
    }
  }
  insertBefore(node, anchor) {
    const index = this.children.indexOf(anchor); if (index < 0) throw new Error('anchor not found');
    if (node.parentElement) node.parentElement.children = node.parentElement.children.filter(child => child !== node);
    this.children.splice(index, 0, node); node.parentElement = this; node.isConnected = true;
    if (node.id) documentNodes.set(node.id, node);
  }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    this.parentElement = null; this.isConnected = false; if (this.id) documentNodes.delete(this.id);
  }
  addEventListener(type, listener, options) { this[`on${type}`] = listener; this[`${type}Options`] = options; }
  setPointerCapture(pointerId) { this.capturedPointer = pointerId; }
  releasePointerCapture(pointerId) { if (this.capturedPointer === pointerId) this.capturedPointer = null; }
  getBoundingClientRect() { return { left: 0, right: 300, width: 300, top: 0, bottom: 32, height: 32 }; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === 'class') this.className = String(value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  querySelector(selector) {
    if (selector === 'relative-time, time-ago') return this.walk().find(node => ['relative-time', 'time-ago'].includes(node.tag)) ?? null;
    if (selector === '.clockoli-commit-timestamp') return this.walk().find(node => node.classList?.contains('clockoli-commit-timestamp')) ?? null;
    if (selector === '.clockoli-timeline-range-start') return this.walk().find(node => node.classList?.contains('clockoli-timeline-range-start')) ?? null;
    if (selector === '.TimelineItem-badge') return this.walk().find(node => node.classList?.contains('TimelineItem-badge')) ?? null;
    if (selector === '[class*="TimelineBadgeWrapper"]') return this.walk().find(node => String(node.className || '').includes('TimelineBadgeWrapper')) ?? null;
    if (selector === '[data-clockoli-time-summary]') return this.walk().find(node => node.getAttribute?.('data-clockoli-time-summary') !== null) ?? null;
    if (selector === 'img.avatar') return this.walk().find(node => node.tag === 'img' && node.className.split(/\s+/).includes('avatar')) ?? null;
    if (selector === 'img[data-testid="github-avatar"]') return this.walk().find(node => node.tag === 'img' && node.getAttribute('data-testid') === 'github-avatar') ?? null;
    if (selector === '.clockoli-participant-time') return this.walk().find(node => node.classList?.contains('clockoli-participant-time')) ?? null;
    if (selector === '.participation-avatars') return this.walk().find(node => node.classList?.contains('participation-avatars')) ?? null;
    return null;
  }
  walk() { return [this, ...this.children.flatMap(child => typeof child.walk === 'function' ? child.walk() : [])]; }
  contains(node) { return this.walk().includes(node); }
  cloneNode(deep = false) {
    const copy = new FakeNode(this.tag);
    copy.id = this.id; copy.textContent = this.textContent; copy.className = this.className;
    copy.attributes = new Map(this.attributes); copy.style = { ...this.style };
    if (deep) copy.append(...this.children.map(child => typeof child.cloneNode === 'function' ? child.cloneNode(true) : { ...child }));
    return copy;
  }
  attachShadow({ mode }) {
    const shadow = new FakeNode('shadow');
    if (mode === 'open') this.shadowRoot = shadow;
    return shadow;
  }
}

function makeHeader() {
  const actions = new FakeNode('div'); actions.className = 'AppHeader-actions'; actions.isConnected = true;
  const avatarSlot = new FakeNode('div'); const avatar = new FakeNode('img'); avatar.className = 'avatar';
  avatarSlot.append(avatar); actions.append(avatarSlot);
  return { actions, avatarSlot };
}

function makeModernHeader() {
  const right = new FakeNode('div'); right.setAttribute('data-testid', 'top-nav-right'); right.isConnected = true;
  const topBarActions = new FakeNode('div'); topBarActions.setAttribute('data-testid', 'top-bar-actions');
  const avatarSlot = new FakeNode('div');
  const avatarButton = new FakeNode('button'); avatarButton.setAttribute('data-login', 'alice');
  const avatar = new FakeNode('img'); avatar.setAttribute('data-testid', 'github-avatar');
  avatarButton.append(avatar); avatarSlot.append(avatarButton); right.append(topBarActions, avatarSlot);
  return { right, topBarActions, avatarSlot };
}

class TimelineNode extends FakeNode {
  matches(selector) {
    if (selector === 'a[href*="/commit/"]') return this.tag === 'a' && String(this.href || '').includes('/commit/');
    if (selector === '.TimelineItem') return this.classList.contains('TimelineItem');
    if (selector === '.TimelineItem-body') return this.classList.contains('TimelineItem-body');
    if (selector === '.Timeline-Item') return this.classList.contains('Timeline-Item');
    if (selector === '.TimelineBody') return this.classList.contains('TimelineBody');
    if (selector === '.TimelineItem-badge') return this.classList.contains('TimelineItem-badge');
    if (selector === '[data-testid="timeline-item"]') return this.getAttribute('data-testid') === 'timeline-item';
    if (selector === '[data-clockoli-time-summary]') return this.getAttribute('data-clockoli-time-summary') !== null;
    if (selector === '.js-timeline-item') return this.classList.contains('js-timeline-item');
    if (selector === '.participant-avatar') return this.classList.contains('participant-avatar');
    if (selector === '.participant-avatar, a[data-hovercard-type="user"][data-hovercard-url^="/users/"]') {
      return this.classList.contains('participant-avatar')
        || (this.tag === 'a' && this.getAttribute('data-hovercard-type') === 'user'
          && String(this.getAttribute('data-hovercard-url') || '').startsWith('/users/'));
    }
    if (selector === '.clockoli-participant-time') return this.classList.contains('clockoli-participant-time');
    return false;
  }
  closest(selector) {
    const selectors = selector.split(',').map(value => value.trim());
    let node = this;
    while (node) {
      if (selectors.some(value => node.matches?.(value))) return node;
      node = node.parentElement;
    }
    return null;
  }
  querySelectorAll(selector) { return this.walk().filter(node => node !== this && node.matches?.(selector)); }
}


const documentNodes = new Map();

test('Clockoli commit cross-references render with seconds and merge adjacent records using the first and latest timestamps', async () => {
  const exposedSource = source.replace(
    'function watchClockoliTimeline() {',
    'globalThis.__beautifyClockoliTimeline = beautifyClockoliTimeline;\n\n  function watchClockoliTimeline() {',
  );
  assert.notEqual(exposedSource, source, 'timeline beautifier is exposed only inside this renderer contract test');
  const location = {
    protocol: 'https:', hostname: 'github.com', pathname: '/manticoresoftware/manticoresearch/issues/4860',
    href: 'https://github.com/manticoresoftware/manticoresearch/issues/4860',
  };
  const { actions } = makeHeader();
  const timeline = new TimelineNode('div');
  const progressiveItem = new TimelineNode('div'); progressiveItem.className = 'js-timeline-item';
  const firstItem = new TimelineNode('div'); firstItem.className = 'TimelineItem';
  const firstBadge = new TimelineNode('span'); firstBadge.className = 'TimelineItem-badge';
  const firstCrossReference = new TimelineNode('svg'); firstCrossReference.className = 'octicon octicon-cross-reference';
  firstBadge.append(firstCrossReference);
  const body = new TimelineNode('div'); body.className = 'TimelineItem-body';
  const commit = new TimelineNode('a');
  commit.href = 'https://github.com/sanikolaev/clockoli-data-synth/commit/fe64c7167890abcdef';
  commit.title = 'time: sanikolaev tracked 45s on manticoresoftware/manticoresearch#4860';
  commit.textContent = 'time: sanikolaev tracked 45s on';
  const firstTime = new TimelineNode('relative-time'); firstTime.textContent = '34 minutes ago';
  body.append(commit, firstTime); firstItem.append(firstBadge, body);

  const latestItem = new TimelineNode('div'); latestItem.className = 'TimelineItem';
  const latestBadge = new TimelineNode('span'); latestBadge.className = 'TimelineItem-badge';
  const latestCrossReference = new TimelineNode('svg'); latestCrossReference.className = 'octicon octicon-cross-reference';
  latestBadge.append(latestCrossReference);
  const latestBody = new TimelineNode('div'); latestBody.className = 'TimelineItem-body';
  const latestCommit = new TimelineNode('a');
  latestCommit.href = 'https://github.com/sanikolaev/clockoli-data-synth/commit/1234567890abcdef';
  latestCommit.title = 'time: sanikolaev tracked 1m 32s on manticoresoftware/manticoresearch#4860';
  latestCommit.textContent = 'time: sanikolaev tracked 1m 32s on';
  const latestTime = new TimelineNode('relative-time'); latestTime.textContent = '33 minutes ago';
  latestBody.append(latestCommit, latestTime); latestItem.append(latestBadge, latestBody);
  const unrelatedBody = new TimelineNode('div'); unrelatedBody.className = 'TimelineItem-body';
  const unrelatedCommit = new TimelineNode('a');
  unrelatedCommit.href = 'https://github.com/sanikolaev/clockoli-data-synth/commit/abcdef1234567890';
  unrelatedCommit.textContent = 'time: sanikolaev tracked 7m on manticoresoftware/manticoresearch#9999 abcdef1';
  unrelatedBody.append(unrelatedCommit); progressiveItem.append(firstItem, latestItem); timeline.append(progressiveItem, unrelatedBody);
  let observer = null;
  const document = {
    documentElement: new FakeNode('html'), body: timeline, activeElement: null,
    createElement: tag => new TimelineNode(tag), createElementNS: (namespace, tag) => new FakeNode(tag),
    createTextNode: value => ({ textContent: value }), getElementById: id => documentNodes.get(id) ?? null,
    querySelector: selector => selector === '.AppHeader-actions' ? actions : null,
    querySelectorAll: selector => timeline.querySelectorAll(selector), addEventListener() {},
  };
  const context = vm.createContext({
    location, document, URL,
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observer = this; }
      observe(root, options) { this.root = root; this.options = options; }
    },
    chrome: { runtime: { lastError: null, getManifest: () => ({ permissions: ['favicon'] }), getURL: path => `chrome-extension://clockoli/${path}`, sendMessage(message, callback) {
      callback({ ok: true, data: message.type === 'GET_PAGE_STATE' ? { configured: true, active: null, pendingCount: 0, pendingWrites: [] } : {} });
    } } },
    setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console,
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(exposedSource, { filename: 'src/content/github.js' }).runInContext(context);

  assert.equal(observer.root, timeline);
  assert.equal(observer.options.childList, true);
  assert.equal(observer.options.subtree, true);
  context.__beautifyClockoliTimeline(timeline);
  assert.equal(body.getAttribute('data-clockoli-time-actor'), 'sanikolaev');
  assert.equal(body.getAttribute('data-clockoli-time-seconds'), '45');
  assert.equal(latestBody.getAttribute('data-clockoli-time-seconds'), '137');
  assert.equal(progressiveItem.children.includes(firstItem), false, 'the older adjacent Clockoli timeline item is merged away');
  assert.equal(latestBody.getAttribute('data-clockoli-time-summary'), 'true');
  const summary = latestBody.children[0];
  assert.equal(summary.className, 'clockoli-timeline-summary');
  assert.equal(latestBadge.children[0].tag, 'img', 'Clockoli replaces the cross-reference icon in the timeline badge');
  assert.equal(latestBadge.children[0].src, 'chrome-extension://clockoli/src/assets/clockoli-32.png');
  assert.equal(latestBadge.children[0].style.width, '16px', 'the 2x timeline asset keeps the native CSS width');
  assert.equal(latestBadge.children[0].style.height, '16px', 'the 2x timeline asset keeps the native CSS height');
  assert.equal(summary.children[0].className, 'd-inline-block');
  assert.equal(summary.children[0].children[0].className, 'avatar avatar-user');
  assert.equal(summary.children[0].children[0].width, 20);
  assert.equal(summary.children[0].children[0].height, 20);
  assert.equal(summary.children[0].children[0].alt, '@sanikolaev');
  assert.equal(summary.children[1].className, 'author Link--primary text-bold');
  assert.equal(summary.children[1].textContent, 'sanikolaev');
  assert.equal(summary.children[1].href, 'https://github.com/sanikolaev');
  assert.equal(summary.children[3].textContent, '2m 17s');
  assert.equal(summary.children[3].tag, 'span', 'tracked duration is not a commit link');
  assert.equal(summary.children[4].textContent, ' from ');
  assert.equal(summary.children[5].children[0], firstTime);
  assert.equal(summary.children[5].href, commit.href);
  assert.equal(firstTime.textContent, '34 minutes ago');
  assert.equal(summary.children[6].textContent, ' to ');
  assert.equal(summary.children[7].children[0], latestTime);
  assert.equal(summary.children[7].href, latestCommit.href);
  assert.equal(latestTime.textContent, '33 minutes ago');
  assert.equal(latestBody.walk().some(node => node.textContent?.includes('clockoli-data-synth')), false);
  assert.equal(latestBody.walk().some(node => node.textContent?.includes('fe64c71')), false);
  assert.equal(unrelatedBody.getAttribute('data-clockoli-time-summary'), null);
  assert.equal(unrelatedBody.children[0], unrelatedCommit);

  const thirdItem = new TimelineNode('div'); thirdItem.className = 'TimelineItem';
  const thirdBadge = new TimelineNode('span'); thirdBadge.className = 'TimelineItem-badge';
  const thirdBody = new TimelineNode('div'); thirdBody.className = 'TimelineItem-body';
  const thirdCommit = new TimelineNode('a');
  thirdCommit.href = 'https://github.com/sanikolaev/clockoli-data-synth/commit/234567890abcdef1';
  thirdCommit.title = 'time: sanikolaev tracked 23s on manticoresoftware/manticoresearch#4860';
  const thirdTime = new TimelineNode('relative-time'); thirdTime.textContent = '2 minutes ago';
  thirdBody.append(thirdCommit, thirdTime); thirdItem.append(thirdBadge, thirdBody); progressiveItem.append(thirdItem);
  observer.callback([{ target: thirdBody }]);
  assert.equal(progressiveItem.children.includes(latestItem), false, 'an already aggregated adjacent item is merged away');
  const thirdSummary = thirdBody.children[0];
  assert.equal(thirdSummary.children[3].textContent, '2m 40s');
  assert.equal(thirdSummary.children[5].children[0], firstTime, 'the earliest timestamp survives repeated observer merges');
  assert.equal(thirdSummary.children[7].children[0], thirdTime);
  assert.equal(thirdSummary.children[7].href, thirdCommit.href);

  const lazyBody = new TimelineNode('div'); lazyBody.className = 'TimelineItem-body';
  const lazyCommit = new TimelineNode('a');
  lazyCommit.href = 'https://github.com/alice/time-data/commit/1234567890abcdef';
  lazyCommit.title = 'time: alice tracked 1h 5m 7s on manticoresoftware/manticoresearch#4860';
  lazyCommit.textContent = 'time: alice tracked 1h 5m 7s on';
  lazyBody.append(lazyCommit); timeline.append(lazyBody);
  observer.callback([{ target: lazyBody }]);
  assert.equal(lazyBody.getAttribute('data-clockoli-time-summary'), 'true');
  assert.equal(lazyBody.children[0].children[1].textContent, 'alice');
  assert.equal(lazyBody.children[0].children[3].textContent, '1h 5m 7s');

  const truncatedBody = new TimelineNode('div'); truncatedBody.className = 'TimelineItem-body';
  const truncatedCommit = new TimelineNode('a');
  truncatedCommit.href = 'https://github.com/sanikolaev/clockoli-data-synth/commit/3f97e77aec8fae26c7e8fc40e4e9d37bbd52644c';
  truncatedCommit.title = 'time: sanikolaev tracked 1m 33s on manticoresoftware/manticoresearch#…';
  truncatedCommit.textContent = 'time: sanikolaev tracked 1m 33s on manticoresoftware/manticoresearch#…';
  truncatedBody.append(truncatedCommit); timeline.append(truncatedBody);
  observer.callback([{ target: truncatedBody }]);
  assert.equal(truncatedBody.getAttribute('data-clockoli-time-summary'), 'true', 'GitHub-truncated Clockoli headlines still render on their referenced issue');
  assert.equal(truncatedBody.children[0].children[1].textContent, 'sanikolaev');
  assert.equal(truncatedBody.children[0].children[3].textContent, '1m 33s');

  const foreignTruncatedBody = new TimelineNode('div'); foreignTruncatedBody.className = 'TimelineItem-body';
  const foreignTruncatedCommit = new TimelineNode('a');
  foreignTruncatedCommit.href = 'https://github.com/sanikolaev/clockoli-data-synth/commit/abcdef1234567890';
  foreignTruncatedCommit.title = 'time: sanikolaev tracked 1m 33s on another/repository#…';
  foreignTruncatedBody.append(foreignTruncatedCommit); timeline.append(foreignTruncatedBody);
  observer.callback([{ target: foreignTruncatedBody }]);
  assert.equal(foreignTruncatedBody.getAttribute('data-clockoli-time-summary'), null, 'a truncated headline for another repository is not rewritten');
  assert.equal(foreignTruncatedBody.children[0], foreignTruncatedCommit);

  const reactItem = new TimelineNode('div'); reactItem.className = 'TimelineRow-module__Timeline_Item__CWsyY Timeline-Item prc-Timeline-TimelineItem-QwDVH';
  const reactBadge = new TimelineNode('div'); reactBadge.className = 'prc-Timeline-TimelineBadgeWrapper-SZw4k';
  const reactBadgeInner = new TimelineNode('div'); reactBadgeInner.className = 'prc-Timeline-TimelineBadge-u0qSm'; reactBadge.append(reactBadgeInner);
  const reactBody = new TimelineNode('div'); reactBody.className = 'TimelineBody row-module__body__qLUpe prc-Timeline-TimelineBody-tjOtb';
  const reactCommit = new TimelineNode('a');
  reactCommit.href = 'https://github.com/sanikolaev/clockoli-data-synth/commit/17383f333f0eb924245c8f33ef6fbc5ceb0ab153';
  reactCommit.textContent = 'time: sanikolaev tracked 2s on manticoresoftware/manticoresearch#4860';
  const reactTime = new TimelineNode('relative-time'); reactTime.textContent = '1 minute ago';
  reactBody.append(reactCommit, reactTime); reactItem.append(reactBadge, reactBody); timeline.append(reactItem);
  observer.callback([{ target: reactBody }]);
  assert.equal(reactBody.getAttribute('data-clockoli-time-summary'), 'true', 'GitHub React TimelineBody entries are rewritten');
  assert.equal(reactBody.children[0].children[1].textContent, 'sanikolaev');
  assert.equal(reactBody.children[0].children[3].textContent, '2s');
  assert.equal(reactBadge.children[0], reactBadgeInner, 'the current React timeline wrapper keeps GitHub geometry');
  assert.equal(reactBadgeInner.children[0].tag, 'img', 'the centered React timeline badge receives the Clockoli mark');
  await new Promise(resolve => setTimeout(resolve, 0));
});

test('participant tracked totals render during idle time and refresh after lazy timeline mutations', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const location = {
    protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/7', href: 'https://github.com/acme/app/issues/7',
  };
  const { actions } = makeHeader();
  const page = new TimelineNode('div');
  const exactAliceA = new TimelineNode('div');
  exactAliceA.setAttribute('data-clockoli-time-summary', 'true');
  exactAliceA.setAttribute('data-clockoli-time-actor', 'Alice');
  exactAliceA.setAttribute('data-clockoli-time-seconds', '75');
  const exactAliceB = new TimelineNode('div');
  exactAliceB.setAttribute('data-clockoli-time-summary', 'true');
  exactAliceB.setAttribute('data-clockoli-time-actor', 'alice');
  exactAliceB.setAttribute('data-clockoli-time-seconds', '45');
  const legacyAlice = new TimelineNode('div');
  legacyAlice.setAttribute('data-clockoli-time-summary', 'true');
  legacyAlice.setAttribute('data-clockoli-time-actor', 'ALICE');
  const legacyBob = new TimelineNode('div');
  legacyBob.setAttribute('data-clockoli-time-summary', 'true');
  legacyBob.setAttribute('data-clockoli-time-actor', 'bob');
  const participants = new TimelineNode('div'); participants.id = 'partial-users-participants';
  const avatars = new TimelineNode('div'); avatars.className = 'participation-avatars d-flex flex-wrap';
  const participant = login => {
    const link = new TimelineNode('a'); link.className = 'participant-avatar';
    link.setAttribute('data-hovercard-url', `/users/${login}/hovercard`); link.href = `/${login}`;
    const image = new TimelineNode('img'); image.className = 'avatar avatar-user'; image.alt = `@${login}`;
    link.append(image); return link;
  };
  const alice = participant('alice'), bob = participant('bob'), carol = participant('carol');
  avatars.append(alice, bob, carol); participants.append(avatars);
  let currentParticipants = participants, currentReactParticipants = null;
  let sidebarAssignees = null, sidebarLabels = null;
  page.append(exactAliceA, exactAliceB, legacyAlice, legacyBob, participants);
  let observer = null;
  const idleCallbacks = [], participantRetryCallbacks = [], participantWarnings = [];
  let participantFailure = false, participantSeconds = 120;
  const document = {
    documentElement: new FakeNode('html'), body: page, activeElement: null,
    createElement: tag => new TimelineNode(tag), createElementNS: (namespace, tag) => new FakeNode(tag),
    createTextNode: value => ({ textContent: value }), getElementById: id => documentNodes.get(id) ?? null,
    querySelector(selector) {
      if (selector === '.AppHeader-actions') return actions;
      if (selector === '#partial-users-participants') return currentParticipants;
      if (selector === '[data-testid="sidebar-participants-section"]') return currentReactParticipants;
      if (selector === '[data-testid="sidebar-assignees-section"]') return sidebarAssignees;
      if (selector === '[data-testid="sidebar-labels-section"]') return sidebarLabels;
      if (selector === '[data-clockoli-participants-section="true"]') {
        return page.walk().find(node => node.getAttribute?.('data-clockoli-participants-section') === 'true') ?? null;
      }
      return null;
    },
    querySelectorAll: selector => page.querySelectorAll(selector), addEventListener() {},
  };
  const context = vm.createContext({
    location, document, URL,
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observer = this; }
      observe(root, options) { this.root = root; this.options = options; }
    },
    requestIdleCallback(callback) { idleCallbacks.push(callback); return idleCallbacks.length; },
    chrome: { runtime: { lastError: null, getManifest: () => ({ permissions: ['favicon'] }), getURL: path => `chrome-extension://clockoli/${path}`, sendMessage(message, callback) {
      if (participantFailure === 'channel_closed' && message.type === 'LOAD_TASK_PARTICIPANTS') {
        this.lastError = { message: 'A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received' };
        callback();
        this.lastError = null;
        return;
      }
      const data = message.type === 'GET_PAGE_STATE'
        ? { configured: true, active: null, pendingCount: 0, pendingWrites: [] }
        : message.type === 'LOAD_TASK_PARTICIPANTS'
          ? participantFailure ? null : {
              configured: true, complete: true, taskUrl: location.href,
              participants: [{ login: 'Alice', totalSeconds: participantSeconds }, { login: 'dave', totalSeconds: 7 }],
            }
          : {};
      callback(participantFailure && message.type === 'LOAD_TASK_PARTICIPANTS'
        ? { ok: false, error: participantFailure === 'abort'
            ? { code: 'aborted', message: 'The operation was aborted' }
            : { code: 'rate_limit', message: 'GitHub rate limit exceeded' } }
        : { ok: true, data });
    } } },
    setInterval() { return 1; }, clearInterval() {},
    setTimeout(callback, delay) {
      if (delay === 60_000) { participantRetryCallbacks.push(callback); return participantRetryCallbacks.length; }
      return setTimeout(callback, delay);
    },
    clearTimeout() {}, Promise, Date, console: { ...console, warn(...args) { participantWarnings.push(args); } },
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  const exposedSource = source.replace('  function scheduleClockoliParticipantAugmentation() {',
    '  globalThis.__refreshClockoliParticipants = refreshClockoliParticipants;\n\n  function scheduleClockoliParticipantAugmentation() {');
  new vm.Script(exposedSource, { filename: 'src/content/github.js' }).runInContext(context);

  assert.equal(alice.querySelector('.clockoli-participant-time'), null, 'participant labels never block initial page rendering');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(idleCallbacks.length, 1, 'initial participant augmentation is deferred to idle time');
  idleCallbacks.shift()();
  const aliceTotal = alice.querySelector('.clockoli-participant-time');
  assert.equal(aliceTotal?.textContent, '2m');
  assert.equal(aliceTotal?.title, 'Alice tracked 2m');
  assert.equal(alice.style.display, 'inline-flex');
  assert.equal(bob.querySelector('.clockoli-participant-time'), null, 'timeline-only actors are not presented as complete totals');
  assert.equal(carol.querySelector('.clockoli-participant-time'), null, 'participants without tracked time remain unchanged');
  const dave = avatars.children.find(node => node.getAttribute?.('data-clockoli-created-participant') === 'true');
  assert.equal(dave?.getAttribute('data-hovercard-url'), '/users/dave/hovercard', 'Clockoli actors missing from GitHub Participants are added');
  assert.equal(dave?.querySelector('.clockoli-participant-time')?.textContent, '7s');

  const exactBob = new TimelineNode('div');
  exactBob.setAttribute('data-clockoli-time-summary', 'true');
  exactBob.setAttribute('data-clockoli-time-actor', 'Bob');
  exactBob.setAttribute('data-clockoli-time-seconds', '7');
  page.append(exactBob);
  observer.callback([{ target: exactBob }]);
  assert.equal(bob.querySelector('.clockoli-participant-time'), null, 'lazy timeline mutations remain non-blocking');
  assert.equal(idleCallbacks.length, 1, 'lazy updates are coalesced into another idle pass');
  idleCallbacks.shift()();
  assert.equal(bob.querySelector('.clockoli-participant-time'), null, 'lazy timeline records cannot override canonical participant totals');
  assert.equal(alice.querySelectorAll('.clockoli-participant-time').length, 1, 'refreshes update participant labels without duplicating them');

  exactBob.remove(); observer.callback([{ target: page }]); idleCallbacks.shift()();
  assert.equal(bob.querySelector('.clockoli-participant-time'), null, 'stale participant totals are removed after timeline refresh');
  assert.equal(bob.style.display, undefined, 'timeline-only actors keep the original GitHub participant layout untouched');

  const replacement = new TimelineNode('div'); replacement.id = 'partial-users-participants';
  const replacementAvatars = new TimelineNode('div'); replacementAvatars.className = 'participation-avatars d-flex flex-wrap';
  const replacementAlice = participant('alice'); replacementAvatars.append(replacementAlice); replacement.append(replacementAvatars);
  participants.remove(); currentParticipants = replacement; page.append(replacement);
  observer.callback([{ target: replacement }]);
  assert.equal(replacementAlice.querySelector('.clockoli-participant-time'), null, 'socket-rendered participant sidebars stay non-blocking');
  idleCallbacks.shift()();
  assert.equal(replacementAlice.querySelector('.clockoli-participant-time')?.textContent, '2m', 'a replaced GitHub participant sidebar is augmented on the next idle pass');

  replacement.remove(); currentParticipants = null;
  const reactParticipants = new TimelineNode('div'); reactParticipants.setAttribute('data-testid', 'sidebar-participants-section');
  const reactAvatars = new TimelineNode('div'); reactAvatars.className = 'ParticipantsSection-module__participantsListContainer__GGvRf';
  const reactAlice = new TimelineNode('a'); reactAlice.setAttribute('data-hovercard-type', 'user'); reactAlice.setAttribute('data-hovercard-url', '/users/Alice/hovercard');
  reactAlice.append(new TimelineNode('img')); reactAvatars.append(reactAlice); reactParticipants.append(reactAvatars);
  currentReactParticipants = reactParticipants; page.append(reactParticipants);
  observer.callback([{ target: reactParticipants }]); idleCallbacks.shift()();
  assert.equal(reactAlice.querySelector('.clockoli-participant-time')?.textContent, '2m',
    'the current GitHub Participants block is augmented without creating another section');
  assert.equal(document.querySelector('[data-clockoli-participants-section="true"]'), null);

  participantFailure = 'abort';
  await context.__refreshClockoliParticipants();
  while (idleCallbacks.length) idleCallbacks.shift()();
  assert.equal(reactAlice.querySelector('.clockoli-participant-time')?.textContent, '2m',
    'a cancelled same-route refresh preserves the last exact successful total');
  assert.equal(participantRetryCallbacks.length, 0, 'cancellation does not schedule a retry');

  participantFailure = 'channel_closed';
  await context.__refreshClockoliParticipants();
  while (idleCallbacks.length) idleCallbacks.shift()();
  assert.equal(reactAlice.querySelector('.clockoli-participant-time')?.textContent, '2m',
    'an extension reload channel interruption preserves the last exact successful total');
  assert.equal(participantRetryCallbacks.length, 0, 'an invalidated extension context does not schedule an unusable retry');
  assert.equal(participantWarnings.length, 0, 'an expected extension reload interruption is not reported as an extension error');

  participantFailure = true;
  await context.__refreshClockoliParticipants();
  while (idleCallbacks.length) idleCallbacks.shift()();
  assert.equal(reactAlice.querySelector('.clockoli-participant-time')?.textContent, '2m',
    'a transient participant refresh failure preserves the last exact successful total');
  assert.equal(participantRetryCallbacks.length, 1, 'a transient failure schedules one bounded retry');

  participantFailure = false; participantSeconds = 180;
  participantRetryCallbacks.shift()();
  await new Promise(resolve => setTimeout(resolve, 0));
  while (idleCallbacks.length) idleCallbacks.shift()();
  assert.equal(reactAlice.querySelector('.clockoli-participant-time')?.textContent, '3m',
    'the retry replaces the preserved value after a successful canonical reload');

  reactParticipants.remove(); currentReactParticipants = null;
  const metadata = new TimelineNode('div');
  sidebarAssignees = new TimelineNode('div'); sidebarAssignees.setAttribute('data-testid', 'sidebar-assignees-section'); sidebarAssignees.className = 'native-section';
  sidebarAssignees.append(new TimelineNode('div'), new TimelineNode('div'));
  sidebarLabels = new TimelineNode('div'); sidebarLabels.setAttribute('data-testid', 'sidebar-labels-section'); sidebarLabels.className = 'native-section';
  sidebarLabels.append(new TimelineNode('div'), new TimelineNode('div'));
  metadata.append(sidebarAssignees, sidebarLabels); page.append(metadata);
  observer.callback([{ target: metadata }]); idleCallbacks.shift()();
  assert.equal(document.querySelector('[data-clockoli-participants-section="true"]'), null,
    'Clockoli never creates a second Participants block when GitHub has not rendered its native block');
  await new Promise(resolve => setTimeout(resolve, 0));
});

test('stale participant responses cannot cross SPA routes and active time stays live', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const location = {
    protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/1', href: 'https://github.com/acme/app/issues/1',
  };
  const { actions } = makeHeader();
  const page = new TimelineNode('div');
  const participants = new TimelineNode('div'); participants.id = 'partial-users-participants';
  const avatars = new TimelineNode('div'); avatars.className = 'participation-avatars d-flex flex-wrap';
  const participant = login => {
    const link = new TimelineNode('a'); link.className = 'participant-avatar';
    link.setAttribute('data-hovercard-url', `/users/${login}/hovercard`);
    const image = new TimelineNode('img'); image.className = 'avatar avatar-user'; link.append(image); return link;
  };
  const alice = participant('alice'), bob = participant('bob');
  avatars.append(alice, bob); participants.append(avatars); page.append(participants);
  const intervals = [], idleCallbacks = [], participantCallbacks = new Map();
  const document = {
    documentElement: new FakeNode('html'), body: page, activeElement: null,
    createElement: tag => new TimelineNode(tag), createElementNS: (_namespace, tag) => new FakeNode(tag),
    createTextNode: value => ({ textContent: value }), getElementById: id => documentNodes.get(id) ?? null,
    querySelector(selector) {
      if (selector === '.AppHeader-actions') return actions;
      if (selector === '#partial-users-participants') return participants;
      return null;
    },
    querySelectorAll: selector => page.querySelectorAll(selector), addEventListener() {},
  };
  const context = vm.createContext({
    location, document, URL,
    MutationObserver: class { constructor(callback) { this.callback = callback; } observe() {} },
    requestIdleCallback(callback) { idleCallbacks.push(callback); return idleCallbacks.length; },
    chrome: { runtime: { lastError: null, getManifest: () => ({ permissions: ['favicon'] }), getURL: path => `chrome-extension://clockoli/${path}`, sendMessage(message, callback) {
      if (message.type === 'LOAD_TASK_PARTICIPANTS') {
        participantCallbacks.set(message.taskUrl, callback); return;
      }
      callback({ ok: true, data: message.type === 'GET_PAGE_STATE'
        ? { configured: true, active: null, pendingCount: 0, pendingWrites: [] } : {} });
    } } },
    setInterval(callback) { intervals.push(callback); return intervals.length; }, clearInterval() {}, setTimeout, Promise, Date, console,
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(domHarnessSource, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));
  const firstUrl = 'https://github.com/acme/app/issues/1';
  assert.ok(participantCallbacks.has(firstUrl));

  location.pathname = '/acme/app/issues/2'; location.href = 'https://github.com/acme/app/issues/2';
  intervals.at(-1)(); await new Promise(resolve => setTimeout(resolve, 0));
  const secondUrl = location.href;
  assert.ok(participantCallbacks.has(secondUrl));
  const activeStartedAt = new Date(Date.now() - 60_000).toISOString();
  participantCallbacks.get(secondUrl)({ ok: true, data: {
    configured: true, complete: true, taskUrl: secondUrl,
    participants: [{ login: 'bob', totalSeconds: 120, activeStartedAt }],
  } });
  await new Promise(resolve => setTimeout(resolve, 0));
  while (idleCallbacks.length) idleCallbacks.shift()();
  assert.equal(bob.querySelector('.clockoli-participant-time')?.textContent, '3m');
  assert.match(bob.querySelector('.clockoli-participant-time')?.title || '', /including the active timer/);

  participantCallbacks.get(firstUrl)({ ok: true, data: {
    configured: true, complete: true, taskUrl: firstUrl,
    participants: [{ login: 'alice', totalSeconds: 999 }],
  } });
  await new Promise(resolve => setTimeout(resolve, 0));
  while (idleCallbacks.length) idleCallbacks.shift()();
  assert.equal(alice.querySelector('.clockoli-participant-time'), null, 'the delayed old-route result is ignored');
  assert.equal(bob.querySelector('.clockoli-participant-time')?.textContent, '3m');
});

test('GitHub SPA route changes reset saved panel scroll before the next reopen', () => {
  assert.match(source, /lastRoute = route; recent = \[\]; recentLoaded = false; recentFresh = false; recentFreshAfterPendingId = null; cancelActiveInlineDraft\(\); menuOpen = false; menuScrollTop = 0/);
  assert.match(source, /if \(\(menuOpen \|\| fullWidthPopupOpen\) && pageState\.configured\) \{\s*try \{ await refreshRecent\(\); \}/,
    'an open shared panel reloads route-specific entries after GitHub SPA navigation');
});

test('tracking-panel rerenders preserve the current user scroll position', () => {
  assert.match(source, /if \(event\?\.isTrusted\) menuScrollTop = menu\.scrollTop/);
  assert.match(source, /const preservedMenuScrollTop = menuScrollTop/);
  assert.match(source, /restoreMenuScroll\(preservedMenuScrollTop\)/);
});

test('pending queue polling does not rebuild the panel when its visible state is unchanged', () => {
  assert.match(source, /function visiblePanelStateKey\(state = pageState\)/);
  assert.match(source, /const before = visiblePanelStateKey\(\);/);
  assert.match(source, /if \(before !== visiblePanelStateKey\(\) \|\| beforeRecent !== visibleRecentKey\(\)\) renderUi\(\);/);
});

test('task result rendering clamps maximum untitled URLs and titles without losing their full values', async () => {
  const exposedSource = source.replace("function taskResult(value, className = '') {", "globalThis.__taskResult = function taskResult(value, className = '') {");
  assert.notEqual(exposedSource, source, 'taskResult is exposed only inside this renderer contract test');
  const location = { protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/1', href: 'https://github.com/acme/app/issues/1' };
  const { actions } = makeHeader();
  const document = {
    documentElement: new FakeNode('html'), activeElement: null,
    createElement: tag => new FakeNode(tag), createElementNS: (namespace, tag) => new FakeNode(tag),
    createTextNode: value => ({ textContent: value }), getElementById: id => documentNodes.get(id) ?? null,
    querySelector: selector => selector === '.AppHeader-actions' ? actions : null, addEventListener() {},
  };
  const context = vm.createContext({
    location, document, URL,
    chrome: { runtime: { lastError: null, getManifest: () => ({ permissions: ['favicon'] }), getURL: path => `chrome-extension://clockoli/${path}`, sendMessage(message, callback) {
      callback({ ok: true, data: message.type === 'GET_PAGE_STATE' ? { configured: true, active: null, pendingCount: 0, pendingWrites: [] } : {} });
    } } },
    setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console,
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(exposedSource, { filename: 'src/content/github.js' }).runInContext(context);

  const maximumUrl = `https://example.com/${'a'.repeat(2028)}`;
  assert.equal(maximumUrl.length, 2048);
  const untitled = context.__taskResult({ taskUrl: maximumUrl, taskTitle: '' });
  assert.equal(untitled.classList.contains('task-result-untitled'), true);
  assert.equal(untitled.children.length, 1);
  assert.equal(untitled.children[0].tag, 'a');
  assert.equal(untitled.children[0].textContent, maximumUrl);
  assert.equal(untitled.children[0].title, maximumUrl);
  assert.equal(untitled.children[0].href, maximumUrl);

  const maximumTitle = 'T'.repeat(300);
  const titled = context.__taskResult({ taskUrl: 'https://example.com/task', taskTitle: maximumTitle });
  assert.equal(titled.children.length, 2);
  assert.equal(titled.children[1].textContent, maximumTitle);
  assert.equal(titled.children[1].title, maximumTitle);
  await new Promise(resolve => setTimeout(resolve, 0));
});

test('query/hash churn cannot trigger authenticated GitHub refreshes', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const intervals = [];
  const messages = [];
  const location = {
    protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/1', href: 'https://github.com/acme/app/issues/1',
  };
  const { actions, avatarSlot } = makeHeader();
  const document = {
    documentElement: new FakeNode('html'),
    createElement: tag => new FakeNode(tag),
    createElementNS: (namespace, tag) => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }),
    getElementById: id => documentNodes.get(id) ?? null,
    querySelector: selector => selector === '.AppHeader-actions' ? actions : null,
    addEventListener() {},
  };
  const context = vm.createContext({
    location,
    document,
    chrome: {
      runtime: {
        lastError: null,
        getManifest: () => ({ permissions: ['favicon'] }), getURL: path => `chrome-extension://clockoli/${path}`,
        sendMessage(message, callback) {
          messages.push(structuredClone(message));
          callback({ ok: true, data: message.type === 'GET_PAGE_STATE'
            ? { configured: true, active: null, pendingCount: 0 }
            : {} });
        },
      },
    },
    setInterval(callback) { intervals.push(callback); return intervals.length; },
    clearInterval() {},
    setTimeout,
    Promise,
    Date,
    console,
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(domHarnessSource, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));
  const navigationCheck = intervals.at(-1);
  assert.deepEqual(messages, [
    { type: 'GET_PAGE_STATE', refresh: false },
    { type: 'LOAD_TASK_PARTICIPANTS', taskUrl: 'https://github.com/acme/app/issues/1' },
    { type: 'SET_ACTION_ICON_FRAME', frame: null },
    { type: 'GET_PAGE_STATE', refresh: true },
  ]);

  for (let index = 0; index < 100; index += 1) {
    location.href = `https://github.com/acme/app/issues/1?noise=${index}#${index}`;
    navigationCheck();
  }
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(messages.length, 4);

  location.pathname = '/acme/app/issues/2';
  location.href = 'https://github.com/acme/app/issues/2';
  navigationCheck();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(messages.length, 6);
  assert.equal(messages[4].refresh, false);
  assert.deepEqual(messages[5], { type: 'LOAD_TASK_PARTICIPANTS', taskUrl: 'https://github.com/acme/app/issues/2' });

  location.pathname = '/acme/app/pull/2';
  location.href = 'https://github.com/acme/app/pull/2';
  navigationCheck();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(messages.length, 8);
  const trigger = createdNodes.filter(node => node.tag === 'button' && node.getAttribute('aria-haspopup') === 'dialog').at(-1);
  assert.equal(actions.children.at(-2)?.id, 'clockoli-root');
  assert.equal(actions.children.at(-1), avatarSlot);
  await trigger.onclick({ isTrusted: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(document.getElementById('clockoli-full-width-popup-root'), 'the GitHub icon opens the same full-width action panel as the browser action');
  assert.equal(messages.some(message => message.type === 'START'), false, 'opening the shared panel does not mutate tracking state');
});


test('stopping renders local stopped state without a stale remote refresh', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const messages = [];
  const startedAt = new Date(Date.now() - 60_000).toISOString();
  const location = {
    protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/1', href: 'https://github.com/acme/app/issues/1',
  };
  const { actions, avatarSlot } = makeHeader();
  const document = {
    documentElement: new FakeNode('html'),
    createElement: tag => new FakeNode(tag),
    createElementNS: (namespace, tag) => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }),
    getElementById: id => documentNodes.get(id) ?? null,
    querySelector: selector => selector === '.AppHeader-actions' ? actions : null,
    addEventListener() {},
  };
  const active = {
    issue: { type: 'issue', owner: 'acme', repo: 'app', number: 1, url: 'https://github.com/acme/app/issues/1' },
    startedAt, description: '',
  };
  const stopped = {
    _path: 'times/2026-08/alice.jsonl', _sha: 'saved-sha', _index: 0, id: '01K3P9VPJ2X4R6T8W0Y2Z4A6BC',
    issue: active.issue, taskUrl: active.issue.url, taskTitle: 'Current task', description: 'done', entryDate: '2026-08-27',
    startedAt, endedAt: '2026-08-27T00:05:00Z', durationSeconds: 300, timezone: 'UTC',
  };
  const pendingStopped = { ...stopped, _sha: null, _index: -1, _pending: true };
  const pendingTimers = [], nativeSetTimeout = setTimeout;
  let pageRequests = 0, stopAccepted = false, pageRequestsWhenStopAccepted = 0;
  const context = vm.createContext({
    location, document,
    chrome: { runtime: { lastError: null, getManifest: () => ({ permissions: ['favicon'] }), getURL: path => `chrome-extension://clockoli/${path}`, sendMessage(message, callback) {
      messages.push(structuredClone(message));
      if (message.type === 'GET_PAGE_STATE') {
        pageRequests += 1;
        const syncingStop = stopAccepted && pageRequests === pageRequestsWhenStopAccepted + 1;
        callback({ ok: true, data: {
          configured: true, active: stopAccepted ? null : active, pendingCount: syncingStop ? 1 : 0,
          pendingWrites: syncingStop ? [{ id: 'pending-1', status: 'pending' }] : [],
          recent: stopAccepted ? [syncingStop ? pendingStopped : stopped] : [],
        } });
      } else if (message.type === 'STOP') { stopAccepted = true; pageRequestsWhenStopAccepted = pageRequests; callback({ ok: true, data: { entry: stopped, pending: true } }); }
      else if (message.type === 'LOAD_RECENT' && stopAccepted) return;
      else callback({ ok: true, data: {} });
    } } },
    setInterval() { return 1; }, clearInterval() {},
    setTimeout(callback, delay, ...args) {
      if (delay === 500) { const timer = { unref() {} }; pendingTimers.push(() => callback(...args)); return timer; }
      return nativeSetTimeout(callback, delay, ...args);
    },
    Promise, Date, console,
    prompt: () => 'done', confirm: () => true, alert() {},
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(domHarnessSource, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));
  const activeTrigger = createdNodes.filter(node => node.tag === 'button' && node.getAttribute('aria-haspopup') === 'dialog').at(-1);
  assert.match(activeTrigger.className, /running/, 'active timer colors the header icon');
  assert.match(activeTrigger.className, /running-current/, 'only the matching page rotates the GitHub mark');
  assert.deepEqual(messages.find(message => message.type === 'SET_ACTION_ICON_FRAME'), { type: 'SET_ACTION_ICON_FRAME', frame: 0 });
  const trigger = activeTrigger;
  await trigger.onclick({ isTrusted: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  const stop = createdNodes.filter(node => node.tag === 'button' && node.textContent === 'Stop and save').at(-1);
  assert.ok(stop?.onclick, 'Stop handler was rendered in the header menu');
  const recentBeforeStop = messages.filter(message => message.type === 'LOAD_RECENT').length;
  const pageStateBeforeStop = messages.filter(message => message.type === 'GET_PAGE_STATE').length;
  const completed = await Promise.race([stop.onclick({ isTrusted: true }).then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 50))]);
  assert.equal(completed, true, 'accepted Stop renders without waiting for a remote recent-entry load');
  await new Promise(resolve => setTimeout(resolve, 0));
  let pageStateMessages = messages.filter(message => message.type === 'GET_PAGE_STATE');
  assert.equal(pageStateMessages.length, pageStateBeforeStop + 1, 'Stop first reconciles from the accepted local pending snapshot');
  assert.equal(pendingTimers.length, 1, 'pending Stop schedules local state reconciliation');
  await pendingTimers.shift()();
  await new Promise(resolve => nativeSetTimeout(resolve, 0));
  pageStateMessages = messages.filter(message => message.type === 'GET_PAGE_STATE');
  assert.equal(pageStateMessages.length, pageStateBeforeStop + 2, 'background sync completion is observed from local page state');
  assert.equal(messages.filter(message => message.type === 'LOAD_RECENT').length, recentBeforeStop, 'Stop does not start a remote recent-entry load');
  assert.equal(pageStateMessages.at(-1)?.type, 'GET_PAGE_STATE');
});


test('a delayed Stop response cannot unlock recent entries after GitHub SPA navigation', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const messages = [], intervals = [];
  const location = {
    protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/1', href: 'https://github.com/acme/app/issues/1',
  };
  const { actions } = makeHeader();
  const document = {
    documentElement: new FakeNode('html'),
    createElement: tag => new FakeNode(tag),
    createElementNS: (namespace, tag) => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }),
    getElementById: id => documentNodes.get(id) ?? null,
    querySelector: selector => selector === '.AppHeader-actions' ? actions : null,
    addEventListener() {},
  };
  const startedAt = '2026-08-27T00:00:00Z';
  const active = {
    issue: { type: 'issue', owner: 'acme', repo: 'app', number: 1, url: 'https://github.com/acme/app/issues/1' },
    startedAt, description: '',
  };
  const stopped = {
    _path: 'times/2026-08/alice.jsonl', _sha: 'saved-sha', _index: 0, id: '01K3P9VPJ2X4R6T8W0Y2Z4A6BC',
    issue: active.issue, taskUrl: active.issue.url, taskTitle: 'Previous task', description: 'done', entryDate: '2026-08-27',
    startedAt, endedAt: '2026-08-27T00:05:00Z', durationSeconds: 300, timezone: 'UTC',
  };
  let pageRequests = 0, stopCallback, stopRequested = false;
  const context = vm.createContext({
    location, document,
    chrome: { runtime: { lastError: null, getManifest: () => ({ permissions: ['favicon'] }), getURL: path => `chrome-extension://clockoli/${path}`, sendMessage(message, callback) {
      messages.push(structuredClone(message));
      if (message.type === 'GET_PAGE_STATE') {
        pageRequests += 1;
        callback({ ok: true, data: {
          configured: true, active: stopRequested ? null : active, pendingCount: 0, pendingWrites: [],
          recent: stopRequested ? [stopped] : [],
        } });
      } else if (message.type === 'STOP') { stopRequested = true; stopCallback = callback; }
      else if (message.type === 'LOAD_RECENT') callback({ ok: true, data: { entries: stopRequested ? [stopped] : [], recent: stopRequested ? [stopped] : [] } });
      else callback({ ok: true, data: {} });
    } } },
    setInterval(callback, delay) { intervals.push({ callback, delay }); return intervals.length; }, clearInterval() {}, setTimeout, Promise, Date, console,
    confirm: () => true, alert() {},
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(domHarnessSource, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));
  const trigger = createdNodes.filter(node => node.tag === 'button' && node.getAttribute('aria-haspopup') === 'dialog').at(-1);
  await trigger.onclick({ isTrusted: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  const stop = createdNodes.filter(node => node.tag === 'button' && node.textContent === 'Stop and save').at(-1);
  const stopping = stop.onclick({ isTrusted: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(typeof stopCallback, 'function', 'Stop remains pending while navigation starts');

  location.pathname = '/acme/app/issues/2'; location.href = 'https://github.com/acme/app/issues/2';
  intervals.find(item => item.delay === 750).callback();
  await new Promise(resolve => setTimeout(resolve, 0));
  const readsBeforeDelayedStop = messages.filter(message => ['GET_PAGE_STATE', 'LOAD_RECENT'].includes(message.type)).length;
  stopCallback({ ok: true, data: { entry: stopped, pending: true } });
  await stopping;
  const readsAfterDelayedStop = messages.filter(message => ['GET_PAGE_STATE', 'LOAD_RECENT'].includes(message.type)).length;
  assert.equal(readsAfterDelayedStop, readsBeforeDelayedStop, 'the delayed Stop response cannot refresh or unlock data on the new route');
});


test('header control mounts when GitHub renders the authenticated header after the content script', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const intervals = [];
  const messages = [];
  const location = {
    protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/7', href: 'https://github.com/acme/app/issues/7',
  };
  const { actions, avatarSlot } = makeHeader();
  let headerReady = false;
  const document = {
    documentElement: new FakeNode('html'),
    createElement: tag => new FakeNode(tag),
    createElementNS: (namespace, tag) => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }),
    getElementById: id => documentNodes.get(id) ?? null,
    querySelector: selector => selector === '.AppHeader-actions' && headerReady ? actions : null,
    addEventListener() {},
  };
  const context = vm.createContext({
    location, document,
    chrome: { runtime: { lastError: null, getManifest: () => ({ permissions: ['favicon'] }), getURL: path => `chrome-extension://clockoli/${path}`, sendMessage(message, callback) {
      messages.push(structuredClone(message));
      callback({ ok: true, data: { configured: true, active: null, pendingCount: 0 } });
    } } },
    setInterval(fn) { intervals.push(fn); return intervals.length; }, clearInterval() {}, setTimeout, Promise, Date, console,
    confirm: () => true, alert() {},
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(domHarnessSource, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(document.getElementById('clockoli-root'), null);
  assert.deepEqual(messages, [
    { type: 'LOAD_TASK_PARTICIPANTS', taskUrl: 'https://github.com/acme/app/issues/7' },
  ]);

  headerReady = true;
  intervals.at(-1)();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(actions.children.at(-2)?.id, 'clockoli-root');
  assert.equal(actions.children.at(-1), avatarSlot);
  assert.deepEqual(messages, [
    { type: 'LOAD_TASK_PARTICIPANTS', taskUrl: 'https://github.com/acme/app/issues/7' },
    { type: 'GET_PAGE_STATE', refresh: false },
    { type: 'SET_ACTION_ICON_FRAME', frame: null },
  ]);
});


test('header menu blocks Start and resolves a pending entry conflict', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const messages = [];
  const location = {
    protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/7', href: 'https://github.com/acme/app/issues/7',
  };
  const { actions } = makeHeader();
  let resolved = false;
  const document = {
    documentElement: new FakeNode('html'),
    createElement: tag => new FakeNode(tag),
    createElementNS: (namespace, tag) => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }),
    getElementById: id => documentNodes.get(id) ?? null,
    querySelector: selector => selector === '.AppHeader-actions' ? actions : null,
    addEventListener() {},
  };
  const pending = { id: 'pending-1', status: 'conflict', stage: 'createEntry' };
  const context = vm.createContext({
    location, document,
    chrome: { runtime: { lastError: null, getManifest: () => ({ permissions: ['favicon'] }), getURL: path => `chrome-extension://clockoli/${path}`, sendMessage(message, callback) {
      messages.push(structuredClone(message));
      if (message.type === 'GET_PAGE_STATE') callback({ ok: true, data: { configured: true, active: null, pendingCount: resolved ? 0 : 1, pendingWrites: resolved ? [] : [pending] } });
      else if (message.type === 'LOAD_RECENT') callback({ ok: true, data: [] });
      else if (message.type === 'RESOLVE_PENDING') { resolved = true; callback({ ok: true, data: true }); }
      else callback({ ok: true, data: {} });
    } } },
    setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console,
    confirm: () => true, alert() {},
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(domHarnessSource, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));
  const trigger = createdNodes.filter(node => node.tag === 'button' && node.getAttribute('aria-haspopup') === 'dialog').at(-1);
  await trigger.onclick({ isTrusted: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  const start = createdNodes.filter(node => node.tag === 'button' && node.textContent === 'Start tracking this task').at(-1);
  const retry = createdNodes.filter(node => node.tag === 'button' && node.textContent === 'Retry entry sync').at(-1);
  assert.equal(start.disabled, true, 'pending entry prevents another timer');
  assert.ok(retry?.onclick, 'entry conflict exposes its recovery action');
  await retry.onclick({ isTrusted: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(messages.find(message => message.type === 'RESOLVE_PENDING'), { type: 'RESOLVE_PENDING', id: 'pending-1' });
  assert.equal(resolved, true);
});


test('missing-active conflicts explicitly warn before discarding an unsaved completion', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const messages = []; let confirmed = false;
  const location = { protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/7', href: 'https://github.com/acme/app/issues/7' };
  const { actions } = makeHeader();
  const pending = { id: 'pending-1', status: 'conflict', stage: 'verifyActive', conflictReason: 'active_missing_no_completion' };
  const document = {
    documentElement: new FakeNode('html'), createElement: tag => new FakeNode(tag), createElementNS: (namespace, tag) => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }), getElementById: id => documentNodes.get(id) ?? null,
    querySelector: selector => selector === '.AppHeader-actions' ? actions : null, addEventListener() {},
  };
  const context = vm.createContext({
    location, document, chrome: { runtime: { lastError: null, getManifest: () => ({ permissions: ['favicon'] }), getURL: path => `chrome-extension://clockoli/${path}`, sendMessage(message, callback) {
      messages.push(structuredClone(message));
      if (message.type === 'GET_PAGE_STATE') callback({ ok: true, data: { configured: true, active: null, pendingCount: 1, pendingWrites: [pending] } });
      else if (message.type === 'LOAD_RECENT') callback({ ok: true, data: [] });
      else callback({ ok: true, data: {} });
    } } },
    setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console,
    confirm(message) { confirmed = /discard this unsaved completion/i.test(message); return true; }, alert() {},
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(domHarnessSource, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));
  const trigger = createdNodes.filter(node => node.tag === 'button' && node.getAttribute('aria-haspopup') === 'dialog').at(-1);
  await trigger.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(createdNodes.some(node => node.textContent === 'Completion was not saved'));
  assert.ok(createdNodes.some(node => /no matching completion exists/i.test(node.textContent)));
  const discard = createdNodes.filter(node => node.tag === 'button' && node.textContent === 'Discard unsaved completion').at(-1);
  await discard.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(confirmed, true);
  assert.deepEqual(messages.find(message => message.type === 'RESOLVE_PENDING'),
    { type: 'RESOLVE_PENDING', id: 'pending-1', action: 'discard_unsaved_completion' });
});

test('header control mounts before the avatar in GitHub current top-nav-right header', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const messages = [];
  const location = {
    protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/4822', href: 'https://github.com/acme/app/issues/4822',
  };
  const { right, topBarActions, avatarSlot } = makeModernHeader();
  const document = {
    documentElement: new FakeNode('html'),
    createElement: tag => new FakeNode(tag),
    createElementNS: (namespace, tag) => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }),
    getElementById: id => documentNodes.get(id) ?? null,
    querySelector: selector => selector === '[data-testid="top-nav-right"]' ? right : null,
    addEventListener() {},
  };
  const context = vm.createContext({
    location, document,
    chrome: { runtime: { lastError: null, getManifest: () => ({ permissions: ['favicon'] }), getURL: path => `chrome-extension://clockoli/${path}`, sendMessage(message, callback) {
      messages.push(structuredClone(message));
      callback({ ok: true, data: { configured: true, active: null, pendingCount: 0, pendingWrites: [] } });
    } } },
    setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console,
    confirm: () => true, alert() {},
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(domHarnessSource, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(right.children[0], topBarActions);
  assert.equal(right.children.at(-2)?.id, 'clockoli-root');
  assert.equal(right.children.at(-1), avatarSlot);
  assert.deepEqual(messages, [
    { type: 'GET_PAGE_STATE', refresh: false },
    { type: 'LOAD_TASK_PARTICIPANTS', taskUrl: 'https://github.com/acme/app/issues/4822' },
    { type: 'SET_ACTION_ICON_FRAME', frame: null },
    { type: 'GET_PAGE_STATE', refresh: true },
  ]);
});


test('recent rows expose durable titles and unified time-and-metadata editing triggers', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const messages = [];
  const location = { protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/7', href: 'https://github.com/acme/app/issues/7' };
  const { actions } = makeHeader();
  const entry = {
    schemaVersion: 1, id: '01K31P0G000000000000000001', user: 'alice',
    issue: { type: 'issue', owner: 'acme', repo: 'app', number: 7, url: 'https://github.com/acme/app/issues/7' },
    issueTitle: 'Make ranking deterministic', entryDate: '2026-11-01', timezone: 'America/Los_Angeles',
    startedAt: '2026-11-01T09:00:11.3Z', endedAt: '2026-11-01T09:58:27.12Z', durationSeconds: 3495,
    description: 'Original note', createdAt: '2026-11-01T09:00:11.3Z', updatedAt: '2026-11-01T09:58:27.12Z',
    _path: 'times/2026-08/alice.jsonl', _sha: 'one', _index: 0,
  };
  const issueTitleNode = new FakeNode('bdi'); issueTitleNode.textContent = 'Make ranking deterministic';
  const document = {
    documentElement: new FakeNode('html'), activeElement: null,
    createElement: tag => new FakeNode(tag), createElementNS: (_namespace, tag) => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }), getElementById: id => documentNodes.get(id) ?? null,
    querySelector: selector => selector === '.AppHeader-actions' ? actions : selector.includes('issue-title') ? issueTitleNode : null, addEventListener() {},
  };
  const context = vm.createContext({
    location, document, chrome: { runtime: { lastError: null, getManifest: () => ({ permissions: ['favicon'] }), getURL: path => `chrome-extension://clockoli/${path}`, sendMessage(message, callback) {
      messages.push(structuredClone(message));
      if (message.type === 'GET_PAGE_STATE') callback({ ok: true, data: { configured: true, active: null, pendingCount: 0, pendingWrites: [] } });
      else if (message.type === 'LOAD_RECENT') callback({ ok: true, data: [entry] });
      else callback({ ok: true, data: {} });
    } } },
    setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console, confirm: () => true, alert() {},
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(domHarnessSource, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));
  const trigger = createdNodes.filter(node => node.tag === 'button' && node.getAttribute('aria-haspopup') === 'dialog').at(-1);
  await trigger.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(createdNodes.findLast(node => node.className.includes('task-title')).textContent, 'Make ranking deterministic');
  const descriptionControl = createdNodes.findLast(node => node.className.includes('entry-description-editable'));
  assert.equal(descriptionControl.textContent, 'Original note');
  await descriptionControl.onclick({ isTrusted: true });
  const urlDraft = createdNodes.findLast(node => node.className.includes('inline-task-url'));
  const titleDraft = createdNodes.findLast(node => node.className.includes('inline-task-title'));
  const descriptionDraft = createdNodes.findLast(node => node.className.includes('inline-description'));
  assert.equal(urlDraft.value, entry.issue.url); assert.equal(titleDraft.value, entry.issueTitle); assert.equal(descriptionDraft.value, 'Original note');
  assert.equal(createdNodes.filter(node => node.className.includes('inline-time-value')).slice(-4).length, 4,
    'a description click also exposes the direct time fields');
  assert.match(source, /function beginRecordEdit\(entry\) \{ beginMetadataEdit\(entry, \{ focusTime: true \}\); \}/);
  assert.match(source, /button\('Edit time', 'link-button entry-edit', async \(\) => revealTimeEditor\(\)\)/);
});

test('Activity hydrates durable IndexedDB records before requesting remote history', () => {
  const start = source.indexOf('  async function loadSelectedTimes(onFailure = null) {');
  const end = source.indexOf('\n  function renderTimesPage(', start);
  assert.ok(start >= 0 && end > start);
  const loader = source.slice(start, end);
  const cache = loader.indexOf("send({ type: 'GET_PAGE_STATE', refresh: false })");
  const remote = loader.indexOf('await refreshRecent(true');
  assert.ok(cache >= 0 && remote > cache, 'local Activity records must render before any remote request');
  assert.match(loader, /recent = mergeActivityRecords\(cached\.recent, timesRange\(\), true\)/);
  assert.match(loader, /recentLoaded = true; recentFresh = false;\s*renderUi\(\)/);
});

test('opening before remote state refresh renders cache immediately and keeps stale rows locked until retry succeeds', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const messages = [];
  const location = { protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/7', href: 'https://github.com/acme/app/issues/7' };
  const { actions } = makeHeader();
  const cached = {
    schemaVersion: 1, id: '20260818000000000000000000', user: 'alice',
    taskUrl: 'https://github.com/acme/app/issues/7', taskTitle: 'Cached entry',
    issue: { type: 'issue', owner: 'acme', repo: 'app', number: 7, url: 'https://github.com/acme/app/issues/7' }, issueTitle: 'Cached entry',
    entryDate: '2026-08-18', startedAt: '2026-08-18T08:00:00+00:00', endedAt: '2026-08-18T09:00:00+00:00',
    durationSeconds: 3600, description: '', createdAt: '2026-08-18T09:00:00+00:00', updatedAt: '2026-08-18T09:00:00+00:00',
    _path: 'times/2026-08/alice.jsonl', _sha: 'cached', _index: 0,
  };
  const refreshed = { ...cached, taskTitle: 'Refreshed entry', issueTitle: 'Refreshed entry', _sha: 'fresh' };
  const cachedStateReplies = [];
  const remoteStateReplies = [], recentReplies = [];
  const document = {
    documentElement: new FakeNode('html'), createElement: tag => new FakeNode(tag), createElementNS: (_namespace, tag) => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }), getElementById: id => documentNodes.get(id) ?? null,
    querySelector: selector => selector === '.AppHeader-actions' ? actions : null, addEventListener() {},
  };
  const context = vm.createContext({
    location, document, chrome: { runtime: { lastError: null, getManifest: () => ({ permissions: ['favicon'] }), getURL: path => `chrome-extension://clockoli/${path}`, sendMessage(message, callback) {
      messages.push(structuredClone(message));
      if (message.type === 'GET_PAGE_STATE') {
        if (message.refresh) remoteStateReplies.push(callback);
        else cachedStateReplies.push(callback);
      } else if (message.type === 'LOAD_RECENT') recentReplies.push(callback);
      else callback({ ok: true, data: {} });
    } } },
    setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console, confirm: () => true, alert() {},
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(domHarnessSource, { filename: 'src/content/github.js' }).runInContext(context);

  assert.deepEqual(messages[0], { type: 'GET_PAGE_STATE', refresh: false }, 'initial rendering reads local cache before remote active state');
  const trigger = createdNodes.filter(node => node.tag === 'button' && node.getAttribute('aria-haspopup') === 'dialog').at(-1);
  const opening = trigger.onclick({ isTrusted: true });
  assert.equal(cachedStateReplies.length, 2, 'opening unknown configuration also requests local state');
  assert.equal(messages.some(message => message.type === 'LOAD_RECENT'), false, 'the panel waits only for the local configured snapshot');

  for (const reply of cachedStateReplies) reply({ ok: true, data: { configured: true, active: null, pendingCount: 0, pendingWrites: [], recent: [cached] } });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(remoteStateReplies.length >= 1, true, 'the shared action panel refreshes active state after reading the local cache');
  for (const reply of remoteStateReplies.splice(0)) reply({ ok: true, data: { configured: true, active: null, pendingCount: 0, pendingWrites: [], recent: [cached] } });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(recentReplies.length >= 1, true, 'the open panel automatically starts a recent refresh');
  assert.ok(createdNodes.findLast(node => node.tag === 'a' && node.textContent.includes('Cached entry')),
    'cached entries are visible before either remote request finishes');
  assert.equal(createdNodes.findLast(node => node.className.includes('entry-delete')).disabled, true,
    'cached mutation controls stay locked until their current SHA is refreshed');
  assert.equal(createdNodes.some(node => node.textContent === 'Open the menu again to load entries.'), false);

  for (const reply of recentReplies.splice(0)) reply({ ok: false, error: { message: 'GitHub is offline', code: 'network' } });
  await opening;
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(createdNodes.findLast(node => node.className.includes('entry-delete')).disabled, true,
    'a failed automatic refresh keeps stale cached mutation controls locked');
  assert.equal(messages.filter(message => message.type === 'GET_PAGE_STATE' && message.refresh).length >= 1, true);

  const retry = createdNodes.filter(node => node.getAttribute('aria-label') === 'Refresh').at(-1);
  const retrying = retry.onclick({ isTrusted: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(recentReplies.length, 1, 'Retry starts one new fresh load');
  recentReplies.shift()({ ok: true, data: { recent: [refreshed], reportDate: '2026-08-18', todaySeconds: 3600, active: null, pendingCount: 0, pendingWrites: [] } });
  await retrying;
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(createdNodes.findLast(node => node.tag === 'a' && node.textContent.includes('Refreshed entry')));
  assert.equal(createdNodes.findLast(node => node.className.includes('entry-delete')).disabled, false,
    'fresh entries become editable only after a successful retry');
});


test('each recent record keeps task identity inside its highlighted time row', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const location = { protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/7', href: 'https://github.com/acme/app/issues/7' };
  const { actions } = makeHeader();
  const issue = number => ({ type: 'issue', owner: 'acme', repo: 'app', number, url: `https://github.com/acme/app/issues/${number}` });
  const entry = (id, number, start, end, description) => ({
    schemaVersion: 1, id, user: 'alice', issue: issue(number), issueTitle: `Issue ${number}`,
    entryDate: '2026-08-18', startedAt: start, endedAt: end,
    durationSeconds: (new Date(end) - new Date(start)) / 1000, description,
    createdAt: end, updatedAt: end, timeRepository: 'acme/time', _path: 'times/2026-08/alice.jsonl', _sha: 'same', _index: Number(id.at(-1)),
  });
  const entries = [
    entry('record0', 7, '2026-08-18T12:00:00+00:00', '2026-08-18T12:30:00+00:00', 'Newest pass'),
    entry('record1', 7, '2026-08-18T11:00:00+00:00', '2026-08-18T11:20:00+00:00', 'Earlier pass'),
    entry('record2', 8, '2026-08-18T10:00:00+00:00', '2026-08-18T10:15:00+00:00', 'Other task'),
    entry('record3', 7, '2026-08-18T09:00:00+00:00', '2026-08-18T09:10:00+00:00', 'Nonconsecutive pass'),
  ];
  const document = {
    documentElement: new FakeNode('html'), activeElement: null,
    createElement: tag => new FakeNode(tag), createElementNS: (namespace, tag) => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }), getElementById: id => documentNodes.get(id) ?? null,
    querySelector: selector => selector === '.AppHeader-actions' ? actions : null, addEventListener() {},
  };
  const context = vm.createContext({
    location, document, chrome: { runtime: { lastError: null, getManifest: () => ({ permissions: ['favicon'] }), getURL: path => `chrome-extension://clockoli/${path}`, sendMessage(message, callback) {
      if (message.type === 'GET_PAGE_STATE') callback({ ok: true, data: { configured: true, active: null, pendingCount: 0, pendingWrites: [] } });
      else if (message.type === 'LOAD_RECENT') callback({ ok: true, data: entries });
      else callback({ ok: true, data: {} });
    } } },
    setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console, confirm: () => true, alert() {},
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(domHarnessSource, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));
  const trigger = createdNodes.filter(node => node.tag === 'button' && node.getAttribute('aria-haspopup') === 'dialog').at(-1);
  await trigger.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));

  const taskLinks = createdNodes.filter(node => node.tag === 'a' && [issue(7).url, issue(8).url].includes(node.href)).slice(-4);
  assert.equal(taskLinks.length, 4, 'every highlighted time row renders its task title');
  assert.deepEqual(taskLinks.map(node => node.textContent), ['Issue 7', 'Issue 7', 'Issue 8', 'Issue 7']);
  assert.deepEqual(createdNodes.filter(node => node.className.includes('task-url') && [issue(7).url, issue(8).url].includes(node.textContent)).slice(-4).map(node => node.textContent),
    [issue(7).url, issue(7).url, issue(8).url, issue(7).url], 'each highlighted row retains its canonical URL source line');
  assert.equal(createdNodes.some(node => node.className.includes('time-repository-label')), false,
    'Activity keeps repository provenance out of individual time rows');
  assert.equal(createdNodes.filter(node => node.className.includes('entry-record')).slice(-4).length, 4,
    'each record retains a separate time-detail row');
  assert.equal(createdNodes.filter(node => node.className.includes('entry-meta')).slice(-4).length, 4);
  assert.equal(createdNodes.filter(node => node.className.includes('entry-description-editable')).slice(-4).length, 4,
    'each time record exposes its inline metadata editor affordance');
  assert.equal(createdNodes.filter(node => node.className.includes('entry-delete')).slice(-4).length, 4,
    'each time record remains independently deletable');
});

test('main-panel times are directly editable, relative-day labeled, and overlapping records are highlighted', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const messages = [];
  const location = { protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/7', href: 'https://github.com/acme/app/issues/7' };
  const { actions } = makeHeader();
  const issue = number => ({ type: 'issue', owner: 'acme', repo: 'app', number, url: `https://github.com/acme/app/issues/${number}` });
  const entry = (id, number, start, end, index) => ({
    schemaVersion: 1, id, user: 'alice', issue: issue(number), issueTitle: `Issue ${number}`,
    entryDate: start.slice(0, 10), startedAt: start, endedAt: end,
    durationSeconds: (new Date(end) - new Date(start)) / 1000, description: '',
    createdAt: end, updatedAt: end, _path: 'times/2026-08/alice.jsonl', _sha: 'same', _index: index,
  });
  const entries = [
    entry('today-a', 7, '2026-08-21T14:00:00+00:00', '2026-08-21T15:00:00+00:00', 0),
    entry('today-b', 8, '2026-08-21T14:30:00+00:00', '2026-08-21T16:00:00+00:00', 1),
    entry('yesterday', 9, '2026-08-20T12:00:00+00:00', '2026-08-20T12:30:00+00:00', 2),
    entry('weekday', 10, '2026-08-19T09:00:00+00:00', '2026-08-19T09:15:00+00:00', 3),
  ];
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-08-21T12:00:00'])); }
    static now() { return new Date('2026-08-21T12:00:00').getTime(); }
  }
  const document = {
    documentElement: new FakeNode('html'), activeElement: null,
    createElement: tag => new FakeNode(tag), createElementNS: (namespace, tag) => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }), getElementById: id => documentNodes.get(id) ?? null,
    querySelector: selector => selector === '.AppHeader-actions' ? actions : null, addEventListener() {},
  };
  const context = vm.createContext({
    location, document, chrome: { runtime: { lastError: null, getManifest: () => ({ permissions: ['favicon'] }), getURL: path => `chrome-extension://clockoli/${path}`, sendMessage(message, callback) {
      messages.push(structuredClone(message));
      if (message.type === 'GET_PAGE_STATE') callback({ ok: true, data: { configured: true, active: null, pendingCount: 0, pendingWrites: [] } });
      else if (message.type === 'LOAD_RECENT') callback({ ok: true, data: entries });
      else if (message.type === 'QUEUE_ENTRIES_EDIT') {
        assert.equal(createdNodes.filter(node => node.className.includes('inline-time-value')).slice(-16).every(node => node.disabled), false,
          'inline editors stay usable after a durable queue accepts the edit');
        for (const request of message.payload.entries) {
          const position = entries.findIndex(entry => entry.id === request.original.id);
          entries[position] = { ...entries[position], ...request.edits };
        }
        callback({ ok: true, data: { operationId: `queued-${messages.length}` } });
      }
      else callback({ ok: true, data: {} });
    } } },
    setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date: FixedDate, console, confirm: () => true, alert() {},
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(domHarnessSource, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));
  const trigger = createdNodes.filter(node => node.tag === 'button' && node.getAttribute('aria-haspopup') === 'dialog').at(-1);
  await trigger.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));

  assert.deepEqual(createdNodes.filter(node => node.className === 'entry-day').slice(-4).map(node => node.textContent),
    ['Today', 'Today', 'Yesterday', 'Wed']);
  assert.equal(createdNodes.filter(node => node.className.includes('entry-overlap')).slice(-2).length, 2);
  assert.equal(createdNodes.filter(node => node.className.includes('overlap-warning')).slice(-2).length, 2);
  const inlineValues = createdNodes.filter(node => node.className.includes('inline-time-value')).slice(-16);
  assert.equal(inlineValues.length, 16, 'every main-panel record exposes Start and Stop hour/minute spinbuttons');
  assert.equal(createdNodes.filter(node => node.className.includes('inline-save')).slice(-4).every(node => node.hidden), true);

  let firstStopMinute = inlineValues[7];
  assert.equal(firstStopMinute.onwheel, undefined, 'inline time fields leave wheel scrolling untouched');
  firstStopMinute.value = ''; firstStopMinute.oninput({});
  let save = createdNodes.filter(node => node.className.includes('inline-save')).at(-3);
  await save.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(messages.some(message => message.type === 'QUEUE_ENTRIES_EDIT'), false, 'an incomplete direct-input draft is never sent');
  assert.ok(createdNodes.findLast(node => node.className.includes('error') && node.walk().some(child => child.textContent.includes('valid date and time'))));
  const preservedValues = createdNodes.filter(node => node.className.includes('inline-time-value')).slice(-16);
  assert.equal(preservedValues[7].value, '', 'validation rerender preserves the incomplete direct-input draft');
  firstStopMinute = preservedValues[7]; firstStopMinute.value = '01'; firstStopMinute.oninput({});
  save = createdNodes.filter(node => node.className.includes('inline-save')).at(-3);
  assert.equal(save.hidden, false, 'typing a main-panel value reveals an explicit Save action');
  await save.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  const edit = messages.findLast(message => message.type === 'QUEUE_ENTRIES_EDIT');
  assert.equal(edit.payload.entries.length, 2, 'the crossed neighboring Start is saved in the same atomic group');
  assert.equal(edit.payload.entries[0].originalSha, 'same');
  assert.equal(edit.payload.entries[0].edits.endedAt, '2026-08-21T15:01:00+00:00');
  assert.equal(edit.payload.entries[1].edits.startedAt, '2026-08-21T15:01:00+00:00');

  const refreshedInlineValues = createdNodes.filter(node => node.className.includes('inline-time-value')).slice(-16);
  const secondStartMinute = refreshedInlineValues[1];
  assert.equal(secondStartMinute.onwheel, undefined);
  secondStartMinute.value = '29'; secondStartMinute.oninput({});
  const mirroredSave = createdNodes.filter(node => node.className.includes('inline-save')).slice(-4)[0];
  assert.equal(mirroredSave.hidden, false, 'crossing Start reveals Save on the edited record');
  await mirroredSave.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  const mirroredEdit = messages.findLast(message => message.type === 'QUEUE_ENTRIES_EDIT');
  assert.equal(mirroredEdit.payload.entries.length, 1, 'the new delta is merged with its earlier durable queued group');
  assert.equal(mirroredEdit.payload.entries[0].edits.startedAt, '2026-08-21T15:29:00+00:00');
});

test('directly typed newer Start and previous Stop save as touching intervals without an overlap warning', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const messages = [];
  const location = { protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/7', href: 'https://github.com/acme/app/issues/7' };
  const { actions } = makeHeader();
  const issue = number => ({ type: 'issue', owner: 'acme', repo: 'app', number, url: `https://github.com/acme/app/issues/${number}` });
  const makeEntry = (id, number, start, end, index) => ({
    schemaVersion: 1, id, user: 'alice', issue: issue(number), issueTitle: `Issue ${number}`,
    entryDate: start.slice(0, 10), startedAt: start, endedAt: end,
    durationSeconds: (new Date(end) - new Date(start)) / 1000, description: '',
    createdAt: end, updatedAt: end, _path: 'times/2026-08/alice.jsonl', _sha: 'same', _index: index,
  });
  let entries = [
    makeEntry('older', 7, '2026-08-21T14:00:00.111+00:00', '2026-08-21T15:00:43.324+00:00', 0),
    makeEntry('newer', 8, '2026-08-21T15:00:06.768+00:00', '2026-08-21T16:00:00.999+00:00', 1),
    makeEntry('oldest', 6, '2026-08-21T13:00:00.222+00:00', '2026-08-21T14:00:00.000+00:00', 2),
  ];
  const document = {
    documentElement: new FakeNode('html'), activeElement: null,
    createElement: tag => new FakeNode(tag), createElementNS: (namespace, tag) => new FakeNode(tag),
    createTextNode: value => ({ textContent: value }), getElementById: id => documentNodes.get(id) ?? null,
    querySelector: selector => selector === '.AppHeader-actions' ? actions : null, addEventListener() {},
  };
  const context = vm.createContext({
    location, document, chrome: { runtime: { lastError: null, getManifest: () => ({ permissions: ['favicon'] }), getURL: path => `chrome-extension://clockoli/${path}`, sendMessage(message, callback) {
      messages.push(structuredClone(message));
      if (message.type === 'GET_PAGE_STATE') callback({ ok: true, data: { configured: true, active: null, pendingCount: 0, pendingWrites: [] } });
      else if (message.type === 'LOAD_RECENT') callback({ ok: true, data: entries });
      else if (message.type === 'QUEUE_ENTRIES_EDIT') {
        for (const request of message.payload.entries) {
          const position = entries.findIndex(entry => entry._index === request.index);
          entries[position] = { ...entries[position], ...request.edits,
            entryDate: request.edits.startedAt.slice(0, 10),
            durationSeconds: (new Date(request.edits.endedAt) - new Date(request.edits.startedAt)) / 1000,
            _sha: 'saved' };
        }
        callback({ ok: true, data: entries });
      } else callback({ ok: true, data: {} });
    } } },
    setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console, confirm: () => true, alert() {},
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(domHarnessSource, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));
  const trigger = createdNodes.filter(node => node.tag === 'button' && node.getAttribute('aria-haspopup') === 'dialog').at(-1);
  await trigger.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  const visibleOverlapWarnings = () => createdNodes.filter(node => node.tag === 'shadow').at(-1).walk()
    .filter(node => node.className?.includes('overlap-warning'));
  assert.equal(visibleOverlapWarnings().length, 2, 'a seconds-only overlap is initially visible even though both boundaries display 15:00');

  const values = createdNodes.filter(node => node.className.includes('inline-time-value')).slice(-12);
  const newerStartHour = values[0], newerStartMinute = values[1];
  assert.equal(newerStartMinute.onwheel, undefined);
  newerStartHour.value = '14'; newerStartHour.oninput({});
  newerStartMinute.value = '59'; newerStartMinute.oninput({});
  assert.equal(values[6].value, '14');
  assert.equal(values[7].value, '59', 'the older Stop mirrors the newer Start immediately');
  assert.equal(visibleOverlapWarnings().length, 0, 'linked direct-input drafts clear the stale overlap warning before Save');

  newerStartHour.value = '15'; newerStartHour.oninput({});
  newerStartMinute.value = '01'; newerStartMinute.oninput({});
  assert.deepEqual([values[6].value, values[7].value], ['15', '00'],
    'backing out of the crossing restores the older Stop baseline');
  let save = createdNodes.filter(node => node.className.includes('inline-save')).slice(-2)[0];
  await save.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  let request = messages.findLast(message => message.type === 'QUEUE_ENTRIES_EDIT');
  assert.equal(request.payload.entries.length, 1, 'a restored no-op neighbor is excluded from the grouped mutation');
  assert.equal(request.payload.entries[0].edits.startedAt, '2026-08-21T15:01:06.768+00:00');
  assert.equal(entries[0].endedAt, '2026-08-21T15:00:43.324+00:00', 'the older Stop remains exact after the non-crossing save');

  const refreshedValues = createdNodes.filter(node => node.className.includes('inline-time-value')).slice(-12);
  const refreshedStartHour = refreshedValues[0], refreshedStartMinute = refreshedValues[1];
  refreshedStartHour.value = '14'; refreshedStartHour.oninput({});
  refreshedStartMinute.value = '59'; refreshedStartMinute.oninput({});
  assert.deepEqual([refreshedValues[6].value, refreshedValues[7].value], ['14', '59']);
  save = createdNodes.filter(node => node.className.includes('inline-save')).slice(-2)[0];
  await save.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  request = messages.findLast(message => message.type === 'QUEUE_ENTRIES_EDIT');
  assert.deepEqual(request.payload.entries.map(item => [item.edits.startedAt, item.edits.endedAt]), [
    ['2026-08-21T14:59:06.768+00:00', '2026-08-21T16:00:00.999+00:00'],
    ['2026-08-21T14:00:00.111+00:00', '2026-08-21T14:59:06.768+00:00'],
  ]);
  assert.equal(visibleOverlapWarnings().length, 0,
    'the refreshed linked result remains endpoint-touching, not overlapping');

  const cascadeValues = createdNodes.filter(node => node.className.includes('inline-time-value')).slice(-12);
  cascadeValues[0].value = '13'; cascadeValues[0].oninput({});
  cascadeValues[1].value = '30'; cascadeValues[1].oninput({});
  assert.deepEqual(cascadeValues.slice(4, 12).map(node => node.value),
    ['13', '30', '13', '30', '13', '00', '13', '30'],
    'continuing past an existing link discovers and updates every newly crossed boundary');
  save = createdNodes.filter(node => node.className.includes('inline-save')).slice(-3)[0];
  await save.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  request = messages.findLast(message => message.type === 'QUEUE_ENTRIES_EDIT');
  assert.deepEqual(request.payload.entries.map(item => [item.edits.startedAt, item.edits.endedAt]), [
    ['2026-08-21T13:30:06.768+00:00', '2026-08-21T16:00:00.999+00:00'],
    ['2026-08-21T13:30:06.768+00:00', '2026-08-21T13:30:06.768+00:00'],
    ['2026-08-21T13:00:00.222+00:00', '2026-08-21T13:30:06.768+00:00'],
  ]);
  assert.equal(visibleOverlapWarnings().length, 0, 'the cascaded linked save remains non-overlapping');
});

test('typing in the main-panel description cannot reach GitHub keyboard shortcuts', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const location = { protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/7', href: 'https://github.com/acme/app/issues/7' };
  const { actions } = makeHeader();
  const document = { documentElement: new FakeNode('html'), createElement: tag => new FakeNode(tag), createElementNS: (namespace, tag) => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }), getElementById: id => documentNodes.get(id) ?? null,
    querySelector: selector => selector === '.AppHeader-actions' ? actions : null, addEventListener() {} };
  const active = { issue: { type: 'issue', owner: 'acme', repo: 'app', number: 7, url: 'https://github.com/acme/app/issues/7' }, startedAt: '2026-08-18T08:00:00.000Z', description: '' };
  const context = vm.createContext({ location, document, chrome: { runtime: { lastError: null, getManifest: () => ({ permissions: ['favicon'] }), getURL: path => `chrome-extension://clockoli/${path}`, sendMessage(message, callback) {
    callback({ ok: true, data: message.type === 'GET_PAGE_STATE' ? { configured: true, active, pendingCount: 0, pendingWrites: [] } : [] });
  } } }, setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console, confirm: () => true, alert() {} });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(domHarnessSource, { filename: 'src/content/github.js' }).runInContext(context); await new Promise(resolve => setTimeout(resolve, 0));
  const trigger = createdNodes.filter(node => node.tag === 'button' && node.getAttribute('aria-haspopup') === 'dialog').at(-1);
  await trigger.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  const description = createdNodes.findLast(node => node.tag === 'input' && node.placeholder === 'Optional');
  let stopped = false;
  description.onkeydown({ target: description, key: 'a', stopPropagation() { stopped = true; } });
  assert.equal(stopped, true);
});

test('recent entry deletion remains conflict-safe without between-row drag controls', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const messages = [];
  const location = { protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/7', href: 'https://github.com/acme/app/issues/7' };
  const { actions } = makeHeader();
  const entry = (id, number, startedAt, endedAt, sha, index = number - 1) => ({
    schemaVersion: 1, id, entryId: id, user: 'alice',
    actor: { kind: 'human', id: 'github:1', name: 'alice' },
    producer: { kind: 'browser_extension', name: 'clockoli-chrome', version: '0.1.29' },
    taskUrl: `https://github.com/acme/app/issues/${number}`, taskTitle: `Issue ${number}`,
    issue: { type: 'issue', owner: 'acme', repo: 'app', number, url: `https://github.com/acme/app/issues/${number}` },
    issueTitle: `Issue ${number}`, entryDate: '2026-08-18', timezone: 'Europe/Moscow', startedAt, endedAt,
    durationSeconds: (new Date(endedAt) - new Date(startedAt)) / 1000, description: '', metadata: {}, metrics: {},
    createdAt: startedAt, updatedAt: endedAt, _path: 'times/2026-08/alice.jsonl', _sha: sha, _index: index,
  });
  const older = entry('01K31P0G000000000000000001', 1, '2026-08-18T06:00:00.000Z', '2026-08-18T07:00:00.000Z', 'daily', 1);
  const newer = entry('01K31SE6000000000000000002', 2, '2026-08-18T07:00:00.000Z', '2026-08-18T08:00:00.000Z', 'daily', 0);
  const hidden = entry('01K31WWM000000000000000003', 3, '2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z', 'post-delete', 1);
  const rewrittenOlder = { ...older, _sha: 'post-delete', _index: 0 };
  const now = new Date(), reportDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  let loadedRecent = [newer, older], releaseDelete, deleteCalls = 0;
  const document = {
    documentElement: new FakeNode('html'), createElement: tag => new FakeNode(tag), createElementNS: (namespace, tag) => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }), getElementById: id => documentNodes.get(id) ?? null,
    querySelector: selector => selector === '.AppHeader-actions' ? actions : null, addEventListener() {},
  };
  const context = vm.createContext({
    location, document, chrome: { runtime: { lastError: null, getManifest: () => ({ permissions: ['favicon'] }), getURL: path => `chrome-extension://clockoli/${path}`, sendMessage(message, callback) {
      messages.push(structuredClone(message));
      if (message.type === 'GET_PAGE_STATE') callback({ ok: true, data: { configured: true, active: null, pendingCount: 0, pendingWrites: [] } });
      else if (message.type === 'LOAD_RECENT') callback({ ok: true, data: {
        recent: loadedRecent, reportDate, todaySeconds: 7200,
        summaries: [{ key: 'review-window', label: 'Review window', seconds: 7200, startDate: '2026-08-01', endDate: '2026-08-31', displayMs: 2000 }],
        active: null, pendingCount: 0, pendingWrites: [],
      } });
      else if (message.type === 'DELETE_ENTRY') {
        deleteCalls += 1;
        const respond = () => callback({ ok: true, data: { deleted: true, entries: deleteCalls === 1 ? [rewrittenOlder, hidden] : [hidden] } });
        if (deleteCalls === 1) releaseDelete = respond; else respond();
      } else callback({ ok: true, data: {} });
    } } },
    setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console, confirm: () => confirmDelete, alert() {},
  });
  let confirmDelete = true;
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(domHarnessSource, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));
  const trigger = createdNodes.filter(node => node.tag === 'button' && node.getAttribute('aria-haspopup') === 'dialog').at(-1);
  await trigger.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  const recentLinks = createdNodes.filter(node => node.tag === 'a' && [newer.issue.url, older.issue.url].includes(node.href));
  assert.deepEqual(recentLinks.slice(-2).map(node => node.href), [newer.issue.url, older.issue.url], 'recent entries render by Start descending');
  assert.equal(createdNodes.some(node => node.className.includes('time-boundary')), false, 'between-row drag controls are removed');
  const rowDeletes = createdNodes.filter(node => node.tag === 'button' && node.className.includes('entry-delete')).slice(-2);
  assert.equal(rowDeletes.length, 2, 'each editable recent entry has a direct Delete action');
  confirmDelete = false;
  await rowDeletes[0].onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(messages.some(message => message.type === 'DELETE_ENTRY'), false, 'cancelling the confirmation preserves the entry');
  confirmDelete = true;
  const deletePromise = rowDeletes[0].onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(rowDeletes[0].disabled, true); assert.equal(rowDeletes[0].parentElement.children[0].disabled, true,
    'an in-flight direct deletion disables its sibling Edit action');
  const deleteRenderStart = createdNodes.length;
  releaseDelete(); await deletePromise; await new Promise(resolve => setTimeout(resolve, 0));
  const postDeleteLinks = createdNodes.slice(deleteRenderStart).filter(node => node.tag === 'a' && [older.issue.url, hidden.issue.url].includes(node.href));
  assert.deepEqual(postDeleteLinks.map(node => node.href), [older.issue.url], 'deletion keeps only the previously visible stable-ID survivor when indexes shift');
  assert.equal(createdNodes.slice(deleteRenderStart).filter(node => node.className === 'today-total-value').at(-1)?.textContent, '…',
    'a direct deletion invalidates totals until the authoritative projection refreshes');
  const deletion = messages.find(message => message.type === 'DELETE_ENTRY');
  assert.equal(deletion.payload.path, newer._path);
  assert.equal(deletion.payload.index, newer._index);
  assert.deepEqual(deletion.payload.original, {
    id: newer.id, taskUrl: newer.taskUrl, taskTitle: newer.taskTitle, issueUrl: newer.issue.url, issueTitle: newer.issueTitle,
    startedAt: newer.startedAt, endedAt: newer.endedAt, description: '',
  });
  const survivingDelete = createdNodes.filter(node => node.tag === 'button' && node.className.includes('entry-delete')).at(-1);
  await survivingDelete.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  const secondDeletion = messages.filter(message => message.type === 'DELETE_ENTRY')[1];
  assert.equal(secondDeletion.payload.path, older._path);
  assert.equal(secondDeletion.payload.originalSha, 'post-delete', 'surviving rows use the rewritten monthly-file SHA');
  assert.equal(secondDeletion.payload.index, 0, 'surviving rows use their rewritten monthly-file index');
  loadedRecent = [{ ...newer, _pending: true }, older];
  const sync = createdNodes.filter(node => node.getAttribute('aria-label') === 'Refresh').at(-1);
  await sync.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  const pending = createdNodes.filter(node => node.tag === 'button' && node.textContent === 'Pending').at(-1);
  assert.equal(pending.disabled, true, 'a queued row renders a visible disabled Pending indicator');
  const pendingRow = pending.parentElement.parentElement;
  assert.equal(pendingRow.walk().some(node => node.className.includes('entry-edit') || node.className.includes('entry-delete')), false,
    'a queued row exposes neither Edit nor Delete');
  assert.equal(createdNodes.some(node => node.className.includes('time-boundary')), false);
});


test('projected totals tick only in their stored local date range and unknown totals stay unknown', () => {
  const now = Date.parse('2026-08-19T02:00:00.000Z');
  const harness = dailyPanelHarness({ now });
  const state = { configured: true, active: { taskUrl: 'https://example.com/task', entryDate: '2026-08-18', timezone: 'America/Adak', startedAt: '2026-08-19T01:00:00.000Z' }, todayTrackedMs: 0, weekTrackedMs: 3600000, pendingWrites: [] };
  harness.applyPageState(state);
  harness.advance(60000);
  assert.equal(harness.trackedTotalText('todayTrackedMs'), '0m');
  assert.equal(harness.trackedTotalText('weekTrackedMs'), '1h 1m');
  harness.applyPageState({ ...state, todayTrackedMs: null, weekTrackedMs: null });
  harness.advance(60000);
  assert.equal(harness.trackedTotalText('todayTrackedMs'), '…');
  assert.equal(harness.trackedTotalText('weekTrackedMs'), '…');
  harness.applyPageState({ ...state, summaryError: { code: 'error' } });
  assert.equal(harness.trackedTotalText('weekTrackedMs'), '…');
});


test('successful Delete responses accept exact empty output and reject malformed parser-shaped entries safely', async t => {
  const recentEntry = {
    schemaVersion: 1, id: '01K31SE6000000000000000002', entryId: '01K31SE6000000000000000002', user: 'alice',
    actor: { kind: 'human', id: 'github:1', name: 'alice' },
    producer: { kind: 'browser_extension', name: 'clockoli-chrome', version: '0.1.29' },
    timezone: 'UTC', metadata: {}, metrics: {},
    taskUrl: 'https://github.com/acme/app/issues/7', taskTitle: 'Ranking regression',
    issue: { type: 'issue', owner: 'acme', repo: 'app', number: 7, url: 'https://github.com/acme/app/issues/7' }, issueTitle: 'Ranking regression',
    entryDate: '2026-08-18', startedAt: '2026-08-18T08:00:00+00:00', endedAt: '2026-08-18T09:00:00+00:00',
    durationSeconds: 3600, description: '', createdAt: '2026-08-18T09:00:00+00:00', updatedAt: '2026-08-18T09:00:00+00:00',
    _path: 'times/2026-08/alice.jsonl', _sha: 'rewritten', _index: 0,
  };
  const secondEntry = {
    ...recentEntry, id: '01K31WWM000000000000000003', entryId: '01K31WWM000000000000000003', taskUrl: 'https://github.com/acme/app/issues/8',
    issue: { ...recentEntry.issue, number: 8, url: 'https://github.com/acme/app/issues/8' },
    startedAt: '2026-08-18T10:00:00+00:00', endedAt: '2026-08-18T11:00:00+00:00',
    createdAt: '2026-08-18T11:00:00+00:00', updatedAt: '2026-08-18T11:00:00+00:00', _index: 1,
  };
  const omit = (entry, key) => { const copy = structuredClone(entry); delete copy[key]; return copy; };
  const malformed = [
    ['null member', [null]],
    ['primitive member', [7]],
    ['wrong index', [{ ...recentEntry, _index: 1 }]],
    ['wrong path', [{ ...recentEntry, _path: 'times/2026-08/bob.jsonl' }]],
    ['empty SHA', [{ ...recentEntry, _sha: '' }]],
    ['inconsistent SHA', [recentEntry, { ...secondEntry, _sha: 'other' }]],
    ['missing ID', [omit(recentEntry, 'id')]],
    ['empty ID', [{ ...recentEntry, id: '' }]],
    ['extra metadata', [{ ...recentEntry, unexpected: true }]],
    ['wrong schema', [{ ...recentEntry, schemaVersion: 2 }]],
    ['wrong user', [{ ...recentEntry, user: 'bob' }]],
    ['missing actor', [omit(recentEntry, 'actor')]],
    ['missing issue title', [omit(recentEntry, 'issueTitle')]],
    ['unnormalized issue title', [{ ...recentEntry, issueTitle: ' two  spaces ' }]],
    ['empty issue URL', [{ ...recentEntry, issue: { ...recentEntry.issue, url: '' } }]],
    ['noncanonical issue URL', [{ ...recentEntry, issue: { ...recentEntry.issue, url: 'not-a-github-url' } }]],
    ['malformed issue identity', [{ ...recentEntry, issue: { ...recentEntry.issue, owner: 'bad--owner' } }]],
    ['empty Start', [{ ...recentEntry, startedAt: '' }]],
    ['malformed Start', [{ ...recentEntry, startedAt: 'not-a-time' }]],
    ['empty End', [{ ...recentEntry, endedAt: '' }]],
    ['malformed End', [{ ...recentEntry, endedAt: 'not-a-time' }]],
    ['wrong entry date', [{ ...recentEntry, entryDate: '2026-02-31' }]],
    ['entry date disagrees with Start in timezone', [{ ...recentEntry, entryDate: '2026-08-19' }]],
    ['mismatched entry ID', [{ ...recentEntry, entryId: '01K31WWM000000000000000003' }]],
    ['wrong duration', [{ ...recentEntry, durationSeconds: 1 }]],
    ['wrong createdAt', [{ ...recentEntry, createdAt: '2026-08-18T10:00:00+00:00' }]],
    ['wrong updatedAt', [{ ...recentEntry, updatedAt: recentEntry.startedAt }]],
    ['overlong description', [{ ...recentEntry, description: 'x'.repeat(2001) }]],
  ];

  async function exercise(entries, expectFallback, initialRecent = [recentEntry]) {
    documentNodes.clear(); createdNodes.length = 0;
    const location = { protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/7', href: 'https://github.com/acme/app/issues/7' };
    const { actions } = makeHeader();
    let deleted = false, loadCalls = 0;
    const document = {
      documentElement: new FakeNode('html'), createElement: tag => new FakeNode(tag), createElementNS: (_namespace, tag) => new FakeNode(tag),
      createTextNode: text => ({ textContent: text }), getElementById: id => documentNodes.get(id) ?? null,
      querySelector: selector => selector === '.AppHeader-actions' ? actions : null, addEventListener() {},
    };
    const context = vm.createContext({
      location, document, chrome: { runtime: { lastError: null, getManifest: () => ({ permissions: ['favicon'] }), getURL: path => `chrome-extension://clockoli/${path}`, sendMessage(message, callback) {
        if (message.type === 'GET_PAGE_STATE') callback({ ok: true, data: { configured: true, active: null, pendingCount: 0, pendingWrites: [] } });
        else if (message.type === 'LOAD_RECENT') {
          loadCalls += 1;
          callback(deleted ? { ok: false, error: { code: 'error', message: 'Refresh failed' } } : { ok: true, data: initialRecent });
        } else if (message.type === 'DELETE_ENTRY') { deleted = true; callback({ ok: true, data: { deleted: true, entries } }); }
        else callback({ ok: true, data: {} });
      } } },
      setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console, confirm: () => true, alert() {},
    });
    new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
    new vm.Script(domHarnessSource, { filename: 'src/content/github.js' }).runInContext(context);
    await new Promise(resolve => setTimeout(resolve, 0));
    const trigger = createdNodes.filter(node => node.tag === 'button' && node.getAttribute('aria-haspopup') === 'dialog').at(-1);
    await trigger.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
    const remove = createdNodes.filter(node => node.tag === 'button' && node.className.includes('entry-delete')).at(-1);
    const rerenderStart = createdNodes.length;
    await remove.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
    const rerendered = createdNodes.slice(rerenderStart);
    assert.equal(loadCalls, expectFallback ? 2 : 1, expectFallback ? 'malformed response triggers one compatibility reload' : 'empty exact response needs no compatibility reload');
    assert.equal(rerendered.some(node => node.className.includes('entry-edit') || node.className.includes('entry-delete')), false,
      'successful deletion never restores actionable stale row controls');
    assert.equal(rerendered.some(node => node.className === 'error' && node.walk().some(child => child.textContent === 'Refresh failed')), expectFallback);
  }

  await t.test('empty exact response after deleting the last record', () => exercise([], false));
  const fractionalEntry = {
    ...secondEntry, _index: 0,
    startedAt: '2026-08-18T10:00:00.3Z', endedAt: '2026-08-18T11:00:00.3Z',
    createdAt: '2026-08-18T11:00:00.3Z', updatedAt: '2026-08-18T11:00:00.3Z',
  };
  await t.test('valid one-digit fractional timestamps need no fallback reload', () => exercise([fractionalEntry], false));
  const changedSurvivorId = '01K31WWM000000000000000004';
  await t.test('changed stable ID', () => exercise(
    [{ ...secondEntry, id: changedSurvivorId, entryId: changedSurvivorId, _index: 0 }], true, [secondEntry, recentEntry],
  ));
  for (const [label, entries] of malformed) await t.test(label, () => exercise(entries, true));
});



test('main panel shows today total and opens Reports before Settings', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const messages = [], intervals = [];
  const location = { protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/7', href: 'https://github.com/acme/app/issues/7' };
  const { actions } = makeHeader();
  const today = new Date(), pad = value => String(value).padStart(2, '0');
  const date = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const recentEntry = { user: 'alice', entryDate: date, durationSeconds: 5400, issue: { type: 'issue', owner: 'acme', repo: 'app', number: 7, url: 'https://github.com/acme/app/issues/7' }, startedAt: `${date}T08:00:00+00:00`, endedAt: `${date}T09:30:00+00:00`, description: '', _path: `times/${date.slice(0, 7)}/alice.jsonl`, _sha: 'x', _index: 0 };
  const document = { documentElement: new FakeNode('html'), createElement: tag => new FakeNode(tag), createElementNS: (namespace, tag) => new FakeNode(tag), createTextNode: text => ({ textContent: text }), getElementById: id => documentNodes.get(id) ?? null, querySelector: selector => selector === '.AppHeader-actions' ? actions : null, addEventListener() {} };
  const context = vm.createContext({ location, document, chrome: { runtime: { lastError: null, getManifest: () => ({ permissions: ['favicon'] }), getURL: path => `chrome-extension://clockoli/${path}`, sendMessage(message, callback) {
    messages.push(structuredClone(message));
    if (message.type === 'GET_PAGE_STATE') callback({ ok: true, data: { configured: true, active: { ...recentEntry, endedAt: undefined, startedAt: `${date}T08:00:00+00:00` }, pendingCount: 0, pendingWrites: [] } });
    else if (message.type === 'LOAD_RECENT') callback({ ok: true, data: { recent: [recentEntry], todayTrackedMs: 5400000, weekTrackedMs: 7200000, reportDate: date,
      active: null, pendingCount: 0, pendingWrites: [] } });
    else callback({ ok: true, data: {} });
  } } }, setInterval(callback) { intervals.push(callback); return intervals.length; }, clearInterval() {}, setTimeout, Promise, Date, console, confirm: () => true, alert() {} });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(domHarnessSource, { filename: 'src/content/github.js' }).runInContext(context); await new Promise(resolve => setTimeout(resolve, 0));
  const trigger = createdNodes.filter(node => node.tag === 'button' && node.getAttribute('aria-haspopup') === 'dialog').at(-1);
  await trigger.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  const [total, week] = createdNodes.filter(node => node.className === 'today-total').slice(-2);
  assert.equal(total.children[0].textContent, 'Today:');
  assert.equal(total.children[1].textContent, '1h 30m');
  const tick = intervals.at(-1);
  for (let index = 0; index < 10; index += 1) tick();
  assert.equal(total.children[0].textContent, 'Today:');
  assert.equal(week.children[0].textContent, 'This week:');
  assert.equal(week.children[1].textContent, '2h 0m');
  const day = createdNodes.findLast(node => node.className === 'entry-day');
  const inlineValues = createdNodes.filter(node => node.className.includes('inline-time-value')).slice(-4);
  const duration = createdNodes.findLast(node => node.className === 'inline-duration');
  assert.equal(day.textContent, 'Today');
  assert.deepEqual(inlineValues.map(node => node.value), ['08', '00', '09', '30']);
  assert.equal(duration.textContent, '1h 30m');
  assert.doesNotMatch(day.textContent, /acme|\d{1,2}\/\d{1,2}\/\d{4}/);
  await trigger.onclick({ isTrusted: true });
  await trigger.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(messages.filter(message => message.type === 'LOAD_RECENT').length, 2, 'each menu opening refreshes its atomic today snapshot');
  const reports = createdNodes.findLast(node => node.tag === 'button' && node.textContent === 'Reports');
  const settings = createdNodes.findLast(node => node.tag === 'button' && node.textContent === 'Settings');
  assert.ok(reports?.onclick); assert.ok(settings);
  assert.ok(reports.parentElement.children.indexOf(reports) < reports.parentElement.children.indexOf(settings));
  await reports.onclick({ isTrusted: true });
  assert.deepEqual(messages.findLast(message => message.type === 'OPEN_REPORTS'), { type: 'OPEN_REPORTS' });
});

test('single GitHub header icon opens the shared panel and its Top tasks action', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const messages = [];
  const location = { protocol: 'https:', hostname: 'github.com', pathname: '/issues/assigned', href: 'https://github.com/issues/assigned' };
  const { actions, avatarSlot } = makeHeader();
  const document = {
    documentElement: new FakeNode('html'), createElement: tag => new FakeNode(tag), createElementNS: (namespace, tag) => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }), getElementById: id => documentNodes.get(id) ?? null,
    querySelector: selector => selector === '.AppHeader-actions' ? actions : null, addEventListener() {},
  };
  const context = vm.createContext({
    location, document, chrome: { runtime: { lastError: null, getManifest: () => ({ permissions: ['favicon'] }), getURL: path => `chrome-extension://clockoli/${path}`, sendMessage(message, callback) {
      messages.push(structuredClone(message));
      callback({ ok: true, data: message.type === 'GET_PAGE_STATE' ? { configured: true, active: null, pendingCount: 0, pendingWrites: [] } : {} });
    } } },
    setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console, confirm: () => true, alert() {},
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(domHarnessSource, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(actions.children.at(-2)?.id, 'clockoli-root');
  assert.equal(actions.children.at(-1), avatarSlot);
  const main = createdNodes.findLast(node => node.tag === 'button' && node.className.includes('trigger-main'));
  const arrow = createdNodes.findLast(node => node.tag === 'button' && node.className.includes('trigger-menu'));
  assert.ok(main?.onclick); assert.equal(arrow, undefined);
  assert.equal(main.getAttribute('aria-haspopup'), 'dialog');
  await main.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  const tasks = createdNodes.findLast(node => node.tag === 'button' && node.textContent === 'Top tasks');
  assert.ok(tasks?.onclick);
  await tasks.onclick({ isTrusted: true });
  assert.deepEqual(messages.findLast(message => message.type === 'OPEN_TASKS'), { type: 'OPEN_TASKS' });
  assert.equal(messages.some(message => message.type === 'LOAD_RECENT'), true);
});

test('split main segment resolves a generic GitHub URL to an issue URL at activation time', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const messages = [], location = { protocol: 'https:', hostname: 'github.com', pathname: '/issues/assigned', href: 'https://github.com/issues/assigned' };
  const { actions } = makeHeader();
  const document = { documentElement: new FakeNode('html'), createElement: tag => new FakeNode(tag), createElementNS: (namespace, tag) => new FakeNode(tag), createTextNode: text => ({ textContent: text }), getElementById: id => documentNodes.get(id) ?? null, querySelector: selector => selector === '.AppHeader-actions' ? actions : null, addEventListener() {} };
  const context = vm.createContext({ location, document, chrome: { runtime: { lastError: null, getManifest: () => ({ permissions: ['favicon'] }), getURL: path => `chrome-extension://clockoli/${path}`, sendMessage(message, callback) {
    messages.push(structuredClone(message));
    if (message.type === 'GET_PAGE_STATE') callback({ ok: true, data: { configured: true, active: null, pendingCount: 0, pendingWrites: [] } });
    else if (message.type === 'LOAD_RECENT') callback({ ok: true, data: { recent: [], todaySeconds: 0, reportDate: '2026-08-20', active: null, pendingCount: 0, pendingWrites: [] } });
    else callback({ ok: true, data: {} });
  } } }, setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console, confirm: () => true, alert() {} });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(domHarnessSource, { filename: 'src/content/github.js' }).runInContext(context); await new Promise(resolve => setTimeout(resolve, 0));
  const main = createdNodes.findLast(node => node.tag === 'button' && node.className.includes('trigger-main'));
  location.pathname = '/acme/app/issues/7'; location.href = 'https://github.com/acme/app/issues/7';
  await main.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(messages.some(message => message.type === 'LOAD_RECENT'), true);
  assert.ok(createdNodes.findLast(node => node.tag === 'button' && node.textContent === 'Start tracking this task'));
});

test('split main segment resolves an issue URL to another generic GitHub URL at activation time', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const messages = [], location = { protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/7', href: 'https://github.com/acme/app/issues/7' };
  const { actions } = makeHeader();
  const document = { documentElement: new FakeNode('html'), createElement: tag => new FakeNode(tag), createElementNS: (namespace, tag) => new FakeNode(tag), createTextNode: text => ({ textContent: text }), getElementById: id => documentNodes.get(id) ?? null, querySelector: selector => selector === '.AppHeader-actions' ? actions : null, addEventListener() {} };
  const context = vm.createContext({ location, document, chrome: { runtime: { lastError: null, getManifest: () => ({ permissions: ['favicon'] }), getURL: path => `chrome-extension://clockoli/${path}`, sendMessage(message, callback) { messages.push(structuredClone(message)); callback({ ok: true, data: message.type === 'GET_PAGE_STATE' ? { configured: true, active: null, pendingCount: 0, pendingWrites: [] } : {} }); } } }, setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console, confirm: () => true, alert() {} });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(domHarnessSource, { filename: 'src/content/github.js' }).runInContext(context); await new Promise(resolve => setTimeout(resolve, 0));
  const main = createdNodes.findLast(node => node.tag === 'button' && node.className.includes('trigger-main'));
  location.pathname = '/issues/assigned'; location.href = 'https://github.com/issues/assigned';
  await main.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(messages.some(message => message.type === 'LOAD_RECENT'), true);
  assert.ok(createdNodes.findLast(node => node.tag === 'button' && node.textContent === 'Start tracking this task'));
});

test('header mounting falls back to a complete legacy header when the modern container has no avatar', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const modern = new FakeNode('div'); modern.setAttribute('data-testid', 'top-nav-right'); modern.isConnected = true;
  const { actions, avatarSlot } = makeHeader();
  const location = { protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/1', href: 'https://github.com/acme/app/issues/1' };
  const document = {
    documentElement: new FakeNode('html'), createElement: tag => new FakeNode(tag), createElementNS: (namespace, tag) => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }), getElementById: id => documentNodes.get(id) ?? null,
    querySelector: selector => selector === '[data-testid="top-nav-right"]' ? modern : selector === '.AppHeader-actions' ? actions : null,
    addEventListener() {},
  };
  const context = vm.createContext({
    location, document, chrome: { runtime: { lastError: null, getManifest: () => ({ permissions: ['favicon'] }), getURL: path => `chrome-extension://clockoli/${path}`, sendMessage(message, callback) {
      callback({ ok: true, data: { configured: true, active: null, pendingCount: 0, pendingWrites: [] } });
    } } }, setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console, confirm: () => true, alert() {},
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(domHarnessSource, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(actions.children.at(-2)?.id, 'clockoli-root');
  assert.equal(actions.children.at(-1), avatarSlot);
  assert.equal(modern.children.length, 0);
});


test('GitHub tracking menu exposes a safe Retry action for transient operation failures', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const messages = [];
  const location = { protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/7', href: 'https://github.com/acme/app/issues/7' };
  const { actions } = makeHeader();
  const document = {
    documentElement: new FakeNode('html'), createElement: tag => new FakeNode(tag), createElementNS: (_namespace, tag) => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }), getElementById: id => documentNodes.get(id) ?? null,
    querySelector: selector => selector === '.AppHeader-actions' ? actions : null, addEventListener() {},
  };
  let loadCalls = 0;
  const context = vm.createContext({
    location, document, chrome: { runtime: { lastError: null, getManifest: () => ({ permissions: ['favicon'] }), getURL: path => `chrome-extension://clockoli/${path}`, sendMessage(message, callback) {
      messages.push(structuredClone(message));
      if (message.type === 'GET_PAGE_STATE') callback({ ok: true, data: { configured: true, active: null, pendingCount: 0, pendingWrites: [] } });
      else if (message.type === 'LOAD_RECENT') { loadCalls += 1; callback({ ok: true, data: [] }); }
      else if (message.type === 'START') callback({ ok: false, error: { code: 'error', message: 'Network unavailable' } });
      else callback({ ok: true, data: {} });
    } } },
    setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console, confirm: () => true, alert() {},
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(domHarnessSource, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));
  const trigger = createdNodes.filter(node => node.tag === 'button' && node.getAttribute('aria-haspopup') === 'dialog').at(-1);
  await trigger.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  const start = createdNodes.filter(node => node.tag === 'button' && node.textContent === 'Start tracking this task').at(-1);
  await start.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  const retry = createdNodes.filter(node => node.tag === 'button' && node.textContent === 'Retry').at(-1);
  assert.ok(retry?.onclick, 'transient error exposes Retry');
  const before = loadCalls;
  await retry.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(loadCalls > before, 'Retry performs a safe tracker refresh');
  assert.equal(messages.some(message => message.type === 'OPEN_OPTIONS'), false);
});


test('Times bulk import preserves its draft and remains single-flight across rerenders and failure', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const root = new FakeNode('div'); root.id = 'clockoli-times-root'; root.isConnected = true; documentNodes.set(root.id, root);
  const location = { protocol: 'chrome-extension:', hostname: 'clockoli', pathname: '/src/times/times.html', href: 'chrome-extension://clockoli/src/times/times.html' };
  const document = {
    documentElement: new FakeNode('html'), activeElement: null,
    createElement: tag => new FakeNode(tag), createElementNS: (_namespace, tag) => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }), getElementById: id => documentNodes.get(id) ?? null,
    querySelector: () => null, addEventListener() {},
  };
  let bulkCallback = null, bulkCalls = 0;
  const context = vm.createContext({
    location, document, chrome: { runtime: { lastError: null, getManifest: () => ({ permissions: ['favicon'] }), getURL: path => `chrome-extension://clockoli/${path}`, sendMessage(message, callback) {
      if (message.type === 'LOAD_TIMES') callback({ ok: true, data: { configured: true, recent: [] } });
      else if (message.type === 'BULK_ADD_TIMES') { bulkCalls += 1; bulkCallback = callback; }
      else callback({ ok: true, data: { configured: true, active: null, recent: [], pendingWrites: [] } });
    } } },
    setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console, confirm: () => true, alert() {},
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(domHarnessSource, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));

  const draft = '2026-08-23 https://example.com/task Preserve this draft 1';
  const input = createdNodes.findLast(node => node.className.includes('bulk-time-input'));
  input.value = draft; input.oninput({});
  const firstAdd = createdNodes.findLast(node => node.tag === 'button' && node.textContent === 'Add time');
  const firstSubmission = firstAdd.onclick({ isTrusted: true });
  await new Promise(resolve => setTimeout(resolve, 0));

  const replacementInput = createdNodes.findLast(node => node.className.includes('bulk-time-input'));
  const replacementAdd = createdNodes.findLast(node => node.tag === 'button' && node.textContent === 'Add time');
  assert.notEqual(replacementInput, input);
  assert.equal(replacementInput.value, draft);
  assert.equal(replacementInput.disabled, true);
  assert.equal(replacementAdd.disabled, true);
  await replacementAdd.onclick({ isTrusted: true });
  assert.equal(bulkCalls, 1);

  bulkCallback({ ok: false, error: { code: 'conflict', message: 'The monthly file changed.' } });
  await firstSubmission; await new Promise(resolve => setTimeout(resolve, 0));
  const failedInput = createdNodes.findLast(node => node.className.includes('bulk-time-input'));
  const failedAdd = createdNodes.findLast(node => node.tag === 'button' && node.textContent === 'Add time');
  assert.equal(failedInput.value, draft);
  assert.equal(failedInput.disabled, false);
  assert.equal(failedAdd.disabled, false);
  assert.equal(createdNodes.some(node => node.textContent === 'The monthly file changed.'), true);
});

test('Activity surfaces repository read failures and conflict omissions', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const root = new FakeNode('div'); root.id = 'clockoli-times-root'; root.isConnected = true; documentNodes.set(root.id, root);
  const location = { protocol: 'chrome-extension:', hostname: 'clockoli', pathname: '/src/times/times.html', href: 'chrome-extension://clockoli/src/times/times.html' };
  const document = {
    documentElement: new FakeNode('html'), activeElement: null,
    createElement: tag => new FakeNode(tag), createElementNS: (_namespace, tag) => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }), getElementById: id => documentNodes.get(id) ?? null,
    querySelector: () => null, addEventListener() {},
  };
  const context = vm.createContext({
    location, document, chrome: { runtime: { lastError: null, getManifest: () => ({ permissions: ['favicon'] }), getURL: path => `chrome-extension://clockoli/${path}`, sendMessage(message, callback) {
      if (message.type === 'LOAD_TIMES') callback({ ok: true, data: {
        configured: true, recent: [], partial: true,
        readStatus: [{ status: 'error' }], conflicts: [{ code: 'record_id_conflict' }],
      } });
      else callback({ ok: true, data: {} });
    } } },
    setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console, confirm: () => true, alert() {},
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(domHarnessSource, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));
  const warning = createdNodes.findLast(node => node.className.includes('partial-read-warning'));
  assert.ok(warning);
  assert.match(warning.textContent, /1 time repository could not be loaded/i);
  assert.match(warning.textContent, /1 conflicting record was omitted/i);
});


test('Times ignores a rejected initial load after navigating to another week', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const root = new FakeNode('div'); root.id = 'clockoli-times-root'; root.isConnected = true; documentNodes.set(root.id, root);
  const location = { protocol: 'chrome-extension:', hostname: 'clockoli', pathname: '/src/times/times.html', href: 'chrome-extension://clockoli/src/times/times.html' };
  const document = {
    documentElement: new FakeNode('html'), activeElement: null,
    createElement: tag => new FakeNode(tag), createElementNS: (_namespace, tag) => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }), getElementById: id => documentNodes.get(id) ?? null,
    querySelector: () => null, addEventListener() {},
  };
  const loads = [];
  const context = vm.createContext({
    location, document, chrome: { runtime: { lastError: null, getManifest: () => ({ permissions: ['favicon'] }), getURL: path => `chrome-extension://clockoli/${path}`, sendMessage(message, callback) {
      if (message.type === 'LOAD_TIMES' && message.payload.startDate === '0001-01-01') callback({ ok: true, data: { configured: true, recent: [] } });
      else if (message.type === 'LOAD_TIMES') loads.push({ message: structuredClone(message), callback });
      else callback({ ok: true, data: {} });
    } } },
    setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console, confirm: () => true, alert() {},
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(domHarnessSource, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(loads.length, 1);

  const previous = createdNodes.findLast(node => node.getAttribute('aria-label') === 'Previous week');
  const navigation = previous.onclick({ isTrusted: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(loads.length, 2);
  loads[1].callback({ ok: true, data: { configured: true, recent: [] } });
  await new Promise(resolve => setTimeout(resolve, 0));
  loads[0].callback({ ok: false, error: { code: 'superseded', message: 'Time load was superseded by a configuration change.' } });
  await navigation;

  assert.equal(createdNodes.some(node => node.textContent === 'Time load was superseded by a configuration change.'), false);
  assert.ok(createdNodes.some(node => node.className === 'week-navigation-label' && node.textContent === `${loads[1].message.payload.startDate} – ${loads[1].message.payload.endDate}`));
});


test('Times keeps every linked draft row mounted while filtering and saves the full group', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const root = new FakeNode('div'); root.id = 'clockoli-times-root'; root.isConnected = true; documentNodes.set(root.id, root);
  const location = { protocol: 'chrome-extension:', hostname: 'clockoli', pathname: '/src/times/times.html', href: 'chrome-extension://clockoli/src/times/times.html' };
  const makeEntry = (id, url, title, start, end, index) => ({
    schemaVersion: 1, id, user: 'alice', taskUrl: url, taskTitle: title,
    entryDate: start.slice(0, 10), startedAt: start, endedAt: end,
    durationSeconds: (new Date(end) - new Date(start)) / 1000, description: '',
    createdAt: end, updatedAt: end, _path: 'times/2026-08/alice.jsonl', _sha: 'same', _index: index,
  });
  const entries = [
    makeEntry('x', 'https://example.com/x', 'X', '2026-08-21T10:00:00+00:00', '2026-08-21T11:00:00+00:00', 0),
    makeEntry('y', 'https://example.com/y', 'Y', '2026-08-21T11:00:00+00:00', '2026-08-21T12:00:00+00:00', 1),
  ];
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-08-21T12:00:00Z'])); } static now() { return new Date('2026-08-21T12:00:00Z').getTime(); } }
  const messages = [];
  const document = {
    documentElement: new FakeNode('html'), activeElement: null,
    createElement: tag => new FakeNode(tag), createElementNS: (_namespace, tag) => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }), getElementById: id => documentNodes.get(id) ?? null,
    querySelector: () => null, addEventListener() {},
  };
  const context = vm.createContext({
    location, document, chrome: { runtime: { lastError: null, getManifest: () => ({ permissions: ['favicon'] }), getURL: path => `chrome-extension://clockoli/${path}`, sendMessage(message, callback) {
      messages.push(structuredClone(message));
      if (message.type === 'LOAD_TIMES') callback({ ok: true, data: { configured: true, recent: entries } });
      else if (message.type === 'QUEUE_ENTRIES_EDIT') callback({ ok: true, data: [] });
      else callback({ ok: true, data: {} });
    } } },
    setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date: FixedDate, console, confirm: () => true, alert() {},
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(domHarnessSource, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));

  const values = createdNodes.filter(node => node.className.includes('inline-time-value')).slice(-8);
  values[7].value = '15'; values[7].oninput({});
  assert.deepEqual(values.slice(0, 2).map(node => node.value), ['11', '15'], 'Y Start mirrors X Stop');
  const filter = createdNodes.findLast(node => node.placeholder === 'URL or title');
  filter.value = '/x'; filter.oninput({});
  const filteredValues = createdNodes.filter(node => node.className.includes('inline-time-value')).slice(-8);
  assert.equal(filteredValues.length, 8, 'the linked Y row remains mounted even though it does not match the filter');
  const save = createdNodes.filter(node => node.className.includes('inline-save')).at(-1);
  await save.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  const edit = messages.findLast(message => message.type === 'QUEUE_ENTRIES_EDIT');
  assert.equal(edit.payload.entries.length, 2);
  assert.deepEqual(edit.payload.entries.map(item => [item.edits.startedAt, item.edits.endedAt]), [
    ['2026-08-21T10:00:00+00:00', '2026-08-21T11:15:00+00:00'],
    ['2026-08-21T11:15:00+00:00', '2026-08-21T12:00:00+00:00'],
  ]);
});


test('each highlighted recent-entry block includes a titled task identity and canonical URL', () => {
  assert.match(source, /function recentRecord\(entry, overlaps\)[\s\S]*taskIdentity = taskResult\(entry, 'entry-record-task-result'\)[\s\S]*taskIdentity\.classList\.add\('activity-task-result'\)[\s\S]*identity\.append\(siteFavicon\(entry, 'entry-record-favicon'\), taskIdentity\)[\s\S]*record\.append\(identity\)/);
  assert.match(source, /\.activity-task-result \.task-title \{ order:-1/,
    'Activity presents task title before its muted canonical URL');
  assert.doesNotMatch(source, /group\.append\(taskResult\(first, 'entry-task-result'\)\)/);
});


test('main tracking panel switches to the current page through the durable background command', () => {
  assert.match(source, /switchToCurrent \? 'Save and switch to this task' : 'Stop and save'/);
  assert.match(source, /type: 'SWITCH_TASK'[\s\S]*type: 'STOP'/);
  assert.doesNotMatch(source, /stop\.disabled = pageState\.pendingCount > 0/);
});


test('ordinary Start and Stop use the same durable background acceptance path as switching', async () => {
  const worker = await readFile(new URL('../src/background/service-worker.js', import.meta.url), 'utf8');
  assert.match(worker, /case 'START':[\s\S]*background: true[\s\S]*syncPendingNow/);
  assert.match(worker, /case 'STOP':[\s\S]*background: true[\s\S]*syncPendingNow/);
  assert.match(worker, /const localStateRead = \['GET_STATE', 'GET_PAGE_STATE'\]\.includes\(message\?\.type\) && !message\?\.refresh/);
  assert.match(worker, /const readOnly = reportReadOnly \|\| localStateRead \|\|/,
    'local state reconciliation must not wait behind the remote mutation executor');
});

test('tracking panel observes background sync completion without manual Sync', () => {
  assert.match(source, /function schedulePendingRefresh\(\)/);
  assert.match(source, /send\(\{ type: 'GET_PAGE_STATE' \}\)/);
  assert.match(source, /if \(Array\.isArray\(data\?\.recent\)\) applyMenuData\(data\.recent, recentFresh\)/);
  assert.match(source, /function hasRunnablePending\(queue = pageState\.pendingWrites\) \{[\s\S]*?const retryableConflict = !String\(first\.conflictReason \|\| ''\)\.startsWith\('queued_write_'\)[\s\S]*?\['editEntry', 'editEntries', 'deleteEntry'\]\.includes\(operation\) && first\.conflictReason !== 'queued_entry_missing'/);
  assert.match(source, /if \(!hasRunnablePending\(\)\) return/,
    'the 500 ms UI polling loop stops only for a missing record or an unsafe conflict, not a safely rebased edit');
  assert.doesNotMatch(source, /Task switch is syncing with GitHub\./);
  assert.doesNotMatch(source, /Sync or resolve the pending entry before starting\./);
});

function dailyPanelHarness({ state, records = [], participants = null, now = Date.now(), confirmResult = true, pageUrl = 'https://github.com/acme/app/issues/7', header = false, actionSurface = false, timelineEnabled = false, notifyViewModeChange = false, respond = null, localStorage, runtimeManifest = { permissions: ['favicon'] }, runtimeGetURL = path => `chrome-extension://clockoli/${String(path).replace(/^\//, '')}` } = {}) {
  const messages = [], frames = [], intervals = [], confirmations = [], timelineMounts = [], timelineModes = [], timelineUpdates = [], timelineDates = [], timelineRanges = [], timelineScrolls = [];
  const documentListeners = new Map(), windowListeners = new Map(), runtimeListeners = [];
  const timeouts = new Map();
  let timeoutId = 0;
  class PanelNode extends FakeNode {
    matches(selector) {
      if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
      if (selector === 'img.avatar') return this.tag === 'img' && this.classList.contains('avatar');
      const attribute = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
      if (attribute) return attribute[2] === undefined ? this.getAttribute(attribute[1]) !== null : this.getAttribute(attribute[1]) === attribute[2];
      return this.tag === selector;
    }
    querySelectorAll(selector) { return this.walk().filter(node => node !== this && selector.split(',').some(value => node.matches?.(value.trim()))); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    focus() { this.ownerDocument.activeElement = this; if (this.ownerDocument.panelShadow) this.ownerDocument.panelShadow.activeElement = this; }
    cloneNode() { const node = this.ownerDocument.createElement(this.tag); node.textContent = this.textContent; return node; }
    attachShadow() { const node = this.ownerDocument.createElement('shadow'); this.ownerDocument.panelShadow = node; return node; }
  }
  const document = { activeElement: null, panelShadow: null, createElement(tag) { const node = new PanelNode(tag); node.ownerDocument = this; return node; }, createElementNS(_ns, tag) { return this.createElement(tag); }, createTextNode: text => ({ textContent: text }), querySelector: () => null, addEventListener: (type, listener) => documentListeners.set(type, listener) };
  document.body = document.createElement('body');
  if (header) {
    const actions = document.createElement('div'), avatar = document.createElement('img');
    avatar.className = 'avatar'; actions.append(avatar); document.body.append(actions);
    document.documentElement = document.body;
    document.querySelector = selector => selector === '.AppHeader-actions' ? actions : null;
    document.getElementById = id => document.body.walk().find(node => node.id === id) || null;
  }
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const context = vm.createContext({ document, Date: FixedDate, URL, console, location: new URL(pageUrl), localStorage, __CLOCKOLI_ACTION_SURFACE__: actionSurface,
    addEventListener: (type, listener) => windowListeners.set(type, listener),
    requestAnimationFrame: callback => frames.push(callback), setInterval: callback => { intervals.push(callback); return intervals.length; }, clearInterval() {},
    setTimeout: (callback, delay) => { const id = ++timeoutId; timeouts.set(id, { callback, delay }); return id; }, clearTimeout: id => timeouts.delete(id),
    confirm: message => { confirmations.push(message); return confirmResult; }, chrome: { runtime: { getManifest: () => runtimeManifest, getURL: runtimeGetURL, onMessage: { addListener: listener => runtimeListeners.push(listener) }, sendMessage(message, callback) { messages.push(message); if (respond) respond(message, callback); else callback({ ok: true, data: state || {} }); } } },
    ClockoliTaskTimeline: { createColorResolver: () => item => item.url === 'https://example.com/today' ? '#123456' : '#654321', createTimeline: timelineEnabled ? (_host, options) => {
      timelineMounts.push(options);
      let selectedDate = now, selectedRange = options.weeklyCalendar ? { start: options.view.start, end: options.view.end } : null;
      if (selectedRange) timelineRanges.push(selectedRange);
      return { update(value) { timelineUpdates.push(value); }, destroy() {}, scrollToEnd() { timelineScrolls.push(true); }, setViewMode(mode) { timelineModes.push(mode); if (notifyViewModeChange) options.onViewModeChange(mode); }, setCalendarDate(value) { selectedDate = value; selectedRange = null; timelineDates.push(value); }, setCalendarRange(range) { selectedRange = range; timelineRanges.push(range); }, getCalendarRange() {
        if (selectedRange) return { ...selectedRange, days: Math.round((selectedRange.end - selectedRange.start) / 86_400_000) };
        const day = new Date(selectedDate); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() - (day.getDay() + 6) % 7);
        const start = day.getTime(); day.setDate(day.getDate() + 7);
        return { start, end: day.getTime(), days: 7 };
      } };
    } : undefined },
  });
  vm.runInContext(recoverySource, context);
  vm.runInContext(trackingCardSource, context);
  const end = source.lastIndexOf('\n  if (timesMode) {');
  vm.runInContext(header ? source : source.slice(0, end) + `
    globalThis.panel = { renderMenu, restoreActivityViewMode, loadSelectedTimes, refreshActivityState: (...args) => refreshActivityState(...args), applyPageState, trackCurrentTimelineTask, refreshMountedTimeline, restartTimelineEntry, stopTimelineEntry, queueCalendarEntry, queueActiveStartEdit, acceptTimelineStartImmediately, rollbackTimelineStart, closeFullWidthPopup, toggleFullWidthPopup, refreshTimelineOverlaps, updatePanelClocks, refreshCompactSurface, setTimelineViewMode,
      renderActivity() { root ||= document.createElement('div'); root.isConnected = true; shadow ||= document.createElement('shadow'); renderUi(); return shadow; },
      set(value, entries, participants) { pageState = value; recent = entries; recentLoaded = true; participantData = participants; },
      trackedTotalText: key => trackedTotalText(key),
      debugWeek: () => ({ errorText, selectedWeekStart, recentLoaded, recentLoadId, timesLoadId }),
      mount(instance, view = null) { timelineInstance = instance; timelineWindow = { historyStart: 0, now: 1 }; if (view) timelineView = view; },
      surface() { return compactSurface; },
      popupRoot() { return fullWidthPopupShadow; },
      attach(menu) { fullWidthPopupShadow = document.createElement('shadow'); document.panelShadow = fullWidthPopupShadow; fullWidthPopupShadow.append(menu); },
      attachCompact(menu) { shadow = document.createElement('shadow'); shadow.append(menu); },
      overlapHost(host, entries) { compactSurface.host = host; timelineEntriesById = new Map(entries); },
      optimisticEdit(id) { return timelineOptimisticEdits.get(id); },
      optimisticCompletion(id) { return timelineOptimisticCompletions.get(id); },
      recentEntry(id) { return recent.find(entry => entry.id === id); },
      descriptionDraftValue() { return descriptionDraft?.value; },
      clearDescriptionDraft() { descriptionDraft = null; },
      rememberTimelineDescription(entry, value) { return rememberTimelineDescription(entry, value); },
      timelineItems(historyStart, currentNow) { return popupTimelineItems(historyStart, currentNow).items; },
      timelineRows(historyStart, currentNow) { return popupTimelineItems(historyStart, currentNow).rows; },
    };
  })();`, context);
  if (state && !header) context.panel.set(state, records, participants);
  return { ...context.panel, set(value, entries, participants) { state = value; context.panel?.set(value, entries, participants); }, document, documentListeners, windowListeners, runtimeListeners, messages, frames, intervals, confirmations, timelineMounts, timelineModes, timelineUpdates, timelineDates, timelineRanges, timelineScrolls, timeouts, advance(ms) { now += ms; } };
}

test('tracking from a Projects issue pane sends the direct issue URL and recognizes its running timer', async () => {
  const pane = 'https://github.com/orgs/manticoresoftware/projects/3/views/16?pane=issue&itemId=239268027&issue=manticoresoftware%7Cclockoli-issues%7C6';
  const issue = 'https://github.com/manticoresoftware/clockoli-issues/issues/6';
  const state = { configured: true, active: null, pendingWrites: [] };
  const harness = dailyPanelHarness({ state, pageUrl: pane });
  const start = harness.renderMenu({ compact: false }).walk().find(node => node.textContent === 'Start tracking this task');
  await start.onclick({ isTrusted: true });
  assert.equal(harness.messages.find(message => message.type === 'START')?.taskUrl, issue);
  harness.set({ ...state, active: { id: 'running', taskUrl: issue, startedAt: new Date().toISOString() } }, []);
  assert.ok(harness.renderMenu({ compact: false }).walk().some(node => node.textContent === 'Stop and save'));
  assert.ok(!harness.renderMenu({ compact: false }).walk().some(node => node.textContent === 'Save and switch to this task'));
});

test('header totals-only polling preserves the description draft and updates existing clocks', async () => {
  const now = new Date(2026, 8, 5, 14).getTime();
  const active = { id: 'running', taskUrl: 'https://github.com/acme/app/issues/7', startedAt: new Date(now - 60_000).toISOString(), entryDate: '2026-09-05', description: 'Saved description' };
  const state = { configured: true, active, pendingCount: 1, pendingWrites: [{ id: 'start', operation: 'startTimer', status: 'pending' }], recent: [], todayTrackedMs: 59_000, weekTrackedMs: 59_000 };
  const h = dailyPanelHarness({ header: true, state, now });
  await new Promise(resolve => setTimeout(resolve, 0));
  const headerRoot = h.document.panelShadow;
  await headerRoot.querySelector('.trigger-main').onclick({ isTrusted: true });
  const root = h.document.panelShadow;
  const menu = root.querySelector('.menu'), input = menu.querySelector('input');
  const total = menu.querySelector('[data-tracked-total="todayTrackedMs"]');
  const week = menu.querySelector('[data-tracked-total="weekTrackedMs"]');
  const elapsed = menu.querySelector('.running-elapsed');
  input.value = 'Unsaved draft'; input.oninput?.({ target: input }); input.focus();
  for (const ms of [60_000, 60_500]) {
    h.set({ ...state, todayTrackedMs: ms, weekTrackedMs: ms }); h.advance(500);
    const [id, poll] = [...h.timeouts].find(([, timer]) => timer.delay === 500);
    h.timeouts.delete(id); await poll.callback();
    assert.equal(root.querySelector('input').value, 'Unsaved draft');
    assert.equal(root.querySelector('.menu'), menu, 'totals-only reads keep the dialog mounted');
    assert.equal(root.querySelector('input'), input);
    assert.equal(h.document.activeElement, input);
    assert.equal(root.querySelector('[data-tracked-total="todayTrackedMs"]'), total);
    assert.equal(root.querySelector('[data-tracked-total="weekTrackedMs"]'), week);
    assert.equal(total.textContent, '1m'); assert.equal(week.textContent, '1m');
  }
  assert.equal(root.querySelector('.running-elapsed'), elapsed);
  assert.equal(elapsed.textContent, '00:01');
});

test('header description draft survives a required rerender without leaking to a new timer', async () => {
  const active = { id: 'running', taskUrl: 'https://github.com/acme/app/issues/7', startedAt: new Date().toISOString(), description: 'Saved description' };
  const state = { configured: true, active, pendingCount: 1, pendingWrites: [{ id: 'start', operation: 'startTimer', status: 'pending' }], recent: [] };
  const h = dailyPanelHarness({ header: true, state });
  await new Promise(resolve => setTimeout(resolve, 0));
  const headerRoot = h.document.panelShadow;
  await headerRoot.querySelector('.trigger-main').onclick({ isTrusted: true });
  const root = h.document.panelShadow;
  const input = root.querySelector('input');
  input.value = ''; input.oninput?.({ target: input });
  h.set({ ...state, active: { ...active, taskTitle: 'Updated title' } });
  await [...h.timeouts.values()].find(timer => timer.delay === 500).callback();
  assert.notEqual(root.querySelector('input'), input, 'metadata changes require a new input');
  assert.equal(root.querySelector('input').value, '', 'an intentionally cleared draft survives');
  h.set({ ...state, active: { ...active, id: 'new-timer', description: 'New timer description' } });
  await [...h.timeouts.values()].find(timer => timer.delay === 500).callback();
  assert.equal(root.querySelector('input').value, 'New timer description');
});

test('header opening retries failed initial reads and retains Retry until recovery succeeds', async () => {
  const reads = [];
  const state = { configured: true, active: null, pendingCount: 0, pendingWrites: [], recent: [] };
  const h = dailyPanelHarness({ header: true, respond(message, callback) {
    if (message.type === 'GET_PAGE_STATE') reads.push({ message, callback });
    else callback({ ok: true, data: state });
  } });
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  const reject = read => read.callback({ ok: false, error: { code: 'error', message: 'Worker unavailable' } });
  reject(reads[0]); await settle(); reject(reads[1]); await settle();
  assert.equal(reads.length, 2);
  const headerRoot = h.document.panelShadow;
  const opening = headerRoot.querySelector('.trigger-main').onclick({ isTrusted: true });
  const root = h.document.panelShadow;
  assert.equal(reads.length, 3, 'opening unknown configuration starts a replacement read');
  assert.equal(reads[2].message.refresh, false, 'opening reads local state first');
  const retry = () => root.walk().find(node => node.tag === 'button' && node.textContent === 'Retry');
  assert.ok(retry(), 'initial error stays actionable while the replacement read is pending');
  reject(reads[2]); await opening;
  assert.ok(root.walk().some(node => node.textContent === "Couldn't reach GitHub"));
  assert.ok(!root.walk().some(node => node.textContent === 'Loading…'));
  assert.ok(retry());
  const recovering = retry().onclick({ isTrusted: true });
  assert.equal(reads.length, 4);
  assert.ok(retry(), 'Retry retains the error until its read succeeds');
  reads[3].callback({ ok: true, data: state }); await recovering;
  assert.ok(root.walk().some(node => String(node.className || '').includes('full-width-popup')));
  assert.equal(retry(), undefined);
  assert.ok(!root.walk().some(node => node.textContent === 'Loading…'));
});

test('daily strip omits idle branding and panel List keeps its week navigation', () => {
  const now = Date.now(), date = new Date(now), today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const record = { id: 'today', taskUrl: 'https://example.com/today', taskTitle: 'Today task', entryDate: today, timezone: 'UTC', startedAt: new Date(now - 3600000).toISOString(), endedAt: new Date(now - 1800000).toISOString(), durationSeconds: 1800, _pending: true, _path: 'times/example' };
  const harness = dailyPanelHarness({ state: { configured: true, active: null, pendingWrites: [] }, timelineEnabled: true, records: [record, { ...record, id: 'yesterday', taskTitle: 'Yesterday task', entryDate: '2000-01-01', startedAt: '2000-01-01T08:00:00Z', endedAt: '2000-01-01T08:30:00Z' }] });
  const menu = harness.renderMenu({ compact: true, onClose: () => {} });
  harness.attach(menu);
  let nodes = menu.walk();
  assert.ok(!nodes.some(node => node.textContent === 'Not tracking'));
  assert.equal(menu.querySelector('.active-task-strip').querySelectorAll('.clockoli-mark').length, 0);
  assert.ok(nodes.some(node => node.textContent === 'Track this task'));
  assert.ok(nodes.some(node => node.textContent === 'Today task' && node.style.color === '#123456'));
  assert.ok(!nodes.some(node => node.textContent === 'Yesterday task'));
  assert.ok(nodes.some(node => node.classList?.contains('entry-pending')));
  assert.ok(menu.querySelector('.today-list').querySelector('.entry-date-header'));
  assert.equal(menu.querySelector('.today-list').hidden, true);
  assert.equal(menu.querySelector('.popup-timeline-section').hidden, false);
  harness.setTimelineViewMode('list');
  assert.equal(menu.querySelector('.today-list').hidden, false);
  assert.equal(menu.querySelector('.popup-timeline-section').hidden, false);
  assert.equal(menu.querySelector('.timeline-shell').hidden, true);
  assert.equal(menu.querySelector('.popup-list-total').hidden, false);
  assert.ok(menu.querySelector('.week-navigation'));
  assert.equal(menu.querySelector('[data-timeline-view-mode="list"]').getAttribute('aria-pressed'), 'true');
  harness.setTimelineViewMode('timeline');
  assert.equal(menu.querySelector('.today-list').hidden, true);
  assert.equal(menu.querySelector('.popup-timeline-section').hidden, false);
  assert.equal(menu.querySelector('.timeline-shell').hidden, false);
  harness.set({ configured: true, active: { ...record, startedAt: new Date(now).toISOString() }, pendingWrites: [] }, []);
  nodes = harness.renderMenu({ compact: true }).walk();
  assert.ok(nodes.some(node => node.textContent === 'Stop and save'));
  assert.ok(nodes.some(node => node.textContent === 'Switch to this task'));
  const header = harness.renderMenu({ compact: false }).walk();
  assert.ok(header.some(node => node.textContent === 'Stop and save' && node.className.includes('danger')));
  assert.ok(header.some(node => node.textContent === 'Save and switch to this task' && node.className.includes('primary')));
});

test('hostile site CSS cannot supply panel tokens or style the internal shadow surface', () => {
  assert.match(source, /:where\(:host > :not\(style\)\) \{ all:revert;/);
  assert.match(source, /:host, :where\(:host > :not\(style\)\) \{[\s\S]*--fgColor-default:#1f2328/);
  assert.match(source, /node\.style\?\.setProperty\?\.\(property, value, 'important'\)/);
  assert.match(source, /set\('all', 'initial'\)/);
});

test('active strip uses a favicon and saves its editable description with Stop', async () => {
  const now = Date.now();
  const active = { id: 'active', taskUrl: 'https://vc.ru/story', taskTitle: 'VC story', startedAt: new Date(now - 60_000).toISOString(), description: '' };
  const state = { configured: true, active, pendingWrites: [] };
  const harness = dailyPanelHarness({ state, now, respond(message, callback) {
    if (message.type === 'STOP') return callback({ ok: true, data: { entry: { ...active, id: 'saved', endedAt: new Date(now).toISOString(), durationSeconds: 60 }, pending: true } });
    callback({ ok: true, data: state });
  } });
  const menu = harness.renderMenu({ compact: true });
  const strip = menu.querySelector('.active-task-strip');
  assert.ok(strip.classList.contains('is-active'));
  assert.equal(strip.querySelector('.running-status-live').textContent, 'Tracking now');
  assert.equal(strip.querySelector('.running-status-elapsed').getAttribute('role'), 'timer');
  assert.equal(strip.querySelector('[data-tracked-total="todayTrackedMs"]').textContent, '…');
  assert.match(menu.querySelector('.strip-favicon').src, /^chrome-extension:\/\/clockoli\/_favicon\//);
  const description = menu.querySelector('.strip-description');
  description.value = 'Published launch story'; description.oninput();
  await menu.walk().find(node => node.textContent === 'Stop and save').onclick({ isTrusted: true });
  assert.equal(harness.messages.find(message => message.type === 'STOP').description, 'Published launch story');
});

test('active strip shows a green check and saves its description when clicked', async () => {
  const now = Date.now();
  const active = { id: 'active', taskUrl: 'https://example.com/running', taskTitle: 'Running', startedAt: new Date(now - 60_000).toISOString(), description: 'Before' };
  const state = { configured: true, active, pendingWrites: [] };
  const harness = dailyPanelHarness({ state, now, respond(message, callback) {
    if (message.type === 'QUEUE_ACTIVE_START_EDIT') return callback({ ok: true, data: { operationId: 'active-edit' } });
    callback({ ok: true, data: state });
  } });
  const menu = harness.renderMenu({ compact: true });
  const description = menu.querySelector('.strip-description');
  description.value = '  Saved   on blur  '; description.oninput();
  const save = menu.walk().find(node => node.className === 'save-check' && node.getAttribute('aria-label') === 'Save description');
  assert.equal(save.hidden, false); assert.equal(save.textContent, '✓');
  await save.onclick({ isTrusted: true });
  const edit = harness.messages.find(message => message.type === 'QUEUE_ACTIVE_START_EDIT');
  assert.equal(edit.payload.description, 'Saved on blur');
  assert.equal(edit.payload.startedAt, undefined);

  const remoteActive = { ...active, description: 'Updated on another device' };
  harness.set({ ...state, active: remoteActive, pendingWrites: [] }, [], []);
  assert.equal(harness.renderMenu({ compact: true }).querySelector('.strip-description').value, 'Updated on another device', 'accepted drafts must not hide later authoritative updates');
});

test('active strip keeps a newer draft and visible check while an older save finishes', async () => {
  const now = Date.now();
  const active = { id: 'active', taskUrl: 'https://example.com/running', startedAt: new Date(now - 60_000).toISOString(), description: 'Before' };
  let editCallback;
  const harness = dailyPanelHarness({ state: { configured: true, active, pendingWrites: [] }, now, respond(message, callback) {
    if (message.type === 'QUEUE_ACTIVE_START_EDIT') { editCallback = callback; return; }
    callback({ ok: true, data: {} });
  } });
  const menu = harness.renderMenu({ compact: true });
  const description = menu.querySelector('.strip-description');
  const save = menu.walk().find(node => node.className === 'save-check' && node.getAttribute('aria-label') === 'Save description');
  description.value = 'First'; description.oninput();
  const saving = save.onclick({ isTrusted: true });
  description.value = 'Second'; description.oninput();
  editCallback({ ok: true, data: { operationId: 'active-edit' } });
  await saving;
  assert.equal(description.value, 'Second');
  assert.equal(save.hidden, false, 'the newer draft remains explicitly saveable');
  assert.equal(harness.descriptionDraftValue(), 'Second');
});

test('active strip keeps its draft and save check after a rejected click save', async () => {
  const now = Date.now();
  const active = { id: 'active', taskUrl: 'https://example.com/running', startedAt: new Date(now - 60_000).toISOString(), description: 'Before' };
  const harness = dailyPanelHarness({ state: { configured: true, active, pendingWrites: [] }, now, respond(message, callback) {
    if (message.type === 'QUEUE_ACTIVE_START_EDIT') { callback({ ok: false, error: { message: 'Save rejected' } }); return; }
    callback({ ok: true, data: {} });
  } });
  const menu = harness.renderMenu({ compact: true });
  const description = menu.querySelector('.strip-description');
  description.value = 'Unsaved'; description.oninput();
  await menu.walk().find(node => node.getAttribute?.('aria-label') === 'Save description').onclick({ isTrusted: true });
  const strip = harness.surface().strip;
  assert.equal(strip.querySelector('.strip-description').value, 'Unsaved');
  const check = strip.walk().find(node => node.getAttribute?.('aria-label') === 'Save description');
  assert.equal(check.hidden, false);
  assert.equal(check.disabled, false);
});

test('a repeated active-description blur retains the draft if local acceptance later rejects', async () => {
  const now = Date.now();
  const active = { id: 'active', taskUrl: 'https://example.com/running', startedAt: new Date(now - 60_000).toISOString(), description: 'Before' };
  let editCallback;
  const harness = dailyPanelHarness({ state: { configured: true, active, pendingWrites: [] }, now, respond(message, callback) {
    if (message.type === 'QUEUE_ACTIVE_START_EDIT') { editCallback = callback; return; }
    callback({ ok: true, data: {} });
  } });
  const description = harness.renderMenu({ compact: true }).querySelector('.strip-description');
  description.value = 'Unsaved draft'; description.oninput();
  const firstBlur = description.onblur();
  assert.equal(typeof editCallback, 'function');
  await description.onblur();
  editCallback({ ok: false, error: { message: 'Local enqueue failed' } });
  await firstBlur;
  const refreshed = harness.renderMenu({ compact: true });
  assert.equal(refreshed.querySelector('.strip-description').value, 'Unsaved draft');
  const check = refreshed.querySelectorAll('.save-check').find(node => node.getAttribute('aria-label') === 'Save description');
  assert.equal(Boolean(check.hidden), false);
  assert.equal(Boolean(check.disabled), false);
});

test('tracking panel exposes its page actions as labeled navigation and matches the Reports dark wordmark', () => {
  const harness = dailyPanelHarness({ state: { configured: true, active: null, pendingWrites: [] } });
  const menu = harness.renderMenu({ compact: true });
  const navigation = menu.querySelector('.header-navigation');
  assert.match(source, /const pageNavigation = el\('nav', undefined, 'header-navigation'\)/);
  assert.equal(navigation.getAttribute('aria-label'), 'Clockoli pages');
  assert.deepEqual(navigation.children.map(child => child.textContent), ['Top tasks', 'Reports', 'Activity', 'Settings']);
  assert.match(source, /@media \(prefers-color-scheme: dark\)[\s\S]*:host\(\.full-width-popup-surface\) \.clockoli-wordmark \{ filter:saturate\(1\.4\) brightness\(2\.1\) \}/);
  assert.match(source, /@media\(max-width:520px\)[\s\S]*\.header-navigation \{ display:grid;[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)[^}]*overflow:visible \}/);
});

test('Activity records show site favicons beside task identity', () => {
  const now = Date.now(), date = new Date(now), today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const entry = { id: 'entry', taskUrl: 'https://example.com/activity', taskTitle: 'Activity task', description: '', entryDate: today, timezone: 'UTC', startedAt: new Date(now - 60_000).toISOString(), endedAt: new Date(now).toISOString(), durationSeconds: 60, _path: 'times/entry.jsonl', _sha: 'sha', _index: 0 };
  const harness = dailyPanelHarness({ state: { configured: true, active: null, pendingWrites: [] }, records: [entry], now, pageUrl: 'chrome-extension://clockoli/src/times/times.html' });
  const activity = harness.renderActivity();
  const favicon = activity.querySelector('.entry-record-favicon');
  assert.match(favicon.src, /^chrome-extension:\/\/clockoli\/_favicon\//);
  assert.equal(favicon.parentElement.className, 'entry-record-task-identity');
});

test('Activity mounts the popup timeline and calendar over its loaded records without remounting on view changes', () => {
  const now = new Date('2026-09-05T12:00:00Z').getTime();
  const entry = activityEntry('older-activity', '2026-09-03', '08');
  const harness = dailyPanelHarness({
    state: { configured: true, active: null, pendingWrites: [] }, records: [entry], now,
    pageUrl: 'chrome-extension://clockoli/src/times/times.html', timelineEnabled: true,
  });
  const activity = harness.renderActivity();
  assert.ok(activity.querySelector('.popup-timeline-section'));
  assert.equal(activity.querySelector('.times-filter').hidden, true);
  harness.frames.splice(0).forEach(frame => frame());
  assert.equal(harness.timelineMounts.length, 1);
  assert.equal(harness.timelineMounts[0].viewMode, 'timeline');
  assert.equal(harness.timelineMounts[0].weeklyCalendar, true);
  assert.ok(harness.timelineMounts[0].items.some(item => item.id === `entry:${entry.id}`));
  const calendar = activity.walk().find(node => node.tag === 'button' && node.textContent === 'Calendar');
  calendar.onclick({ isTrusted: true });
  assert.deepEqual(harness.timelineModes, ['calendar']);
  assert.equal(harness.timelineMounts.length, 1, 'Calendar uses the mounted popup widget');
  assert.equal(activity.querySelector('.times-results').hidden, true);
  const section = activity.querySelector('.popup-timeline-section');
  const refreshed = harness.renderActivity();
  assert.equal(refreshed.querySelector('.popup-timeline-section'), section, 'state refresh preserves the widget and its navigation');
  const list = refreshed.walk().find(node => node.tag === 'button' && node.textContent === 'List');
  list.onclick({ isTrusted: true });
  assert.equal(refreshed.querySelector('.times-results').hidden, false);
  assert.equal(refreshed.querySelector('.times-filter').hidden, false);
  assert.equal(harness.timelineMounts.length, 1);
});

test('Activity remembers the selected view when reopened and falls back to Timeline before popup preference loads', () => {
  const values = new Map();
  const localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const options = { state: { configured: true, active: null, pendingWrites: [] },
    pageUrl: 'chrome-extension://clockoli/src/times/times.html', timelineEnabled: true, localStorage };
  const selected = surface => surface.querySelector('.times-view-modes').walk()
    .find(node => node.tag === 'button' && node.getAttribute('aria-pressed') === 'true');
  const first = dailyPanelHarness(options);
  const firstSurface = first.renderActivity();
  assert.equal(selected(firstSurface).textContent, 'Timeline');
  firstSurface.querySelector('.times-view-modes').walk().find(node => node.textContent === 'List').onclick({ isTrusted: true });
  assert.equal(selected(firstSurface).textContent, 'List');
  const reopened = dailyPanelHarness(options);
  const secondSurface = reopened.renderActivity();
  assert.equal(selected(secondSurface).textContent, 'List');
  assert.equal(secondSurface.querySelector('.times-results').hidden, false);
  secondSurface.querySelector('.times-view-modes').walk().find(node => node.textContent === 'Calendar').onclick({ isTrusted: true });
  const calendar = dailyPanelHarness(options);
  const thirdSurface = calendar.renderActivity();
  calendar.frames.splice(0).forEach(frame => frame());
  assert.equal(selected(thirdSurface).textContent, 'Calendar');
  assert.equal(calendar.timelineMounts[0].viewMode, 'calendar');
  const popup = dailyPanelHarness({ ...options, pageUrl: 'chrome-extension://clockoli/src/popup/popup.html' });
  popup.renderMenu({ compact: true, onClose() {} });
  popup.frames.splice(0).forEach(frame => frame());
  assert.equal(popup.timelineMounts[0].viewMode, 'timeline');
  values.set('clockoli:activity-view', 'invalid');
  assert.equal(selected(dailyPanelHarness(options).renderActivity()).textContent, 'Timeline');
});

test('popup and GitHub action panel restore the Activity view and save changes for the next opening', async () => {
  let persisted = 'calendar';
  const state = { configured: true, active: null, pendingWrites: [] };
  const respond = (message, callback) => {
    if (message.type === 'GET_ACTIVITY_VIEW_MODE') callback({ ok: true, data: { mode: persisted } });
    else if (message.type === 'SET_ACTIVITY_VIEW_MODE') { persisted = message.mode; callback({ ok: true, data: { mode: persisted } }); }
    else callback({ ok: true, data: state });
  };
  const popup = dailyPanelHarness({ state, timelineEnabled: true, pageUrl: 'chrome-extension://clockoli/src/popup/popup.html', respond });
  await popup.restoreActivityViewMode();
  const popupMenu = popup.renderMenu({ compact: true, onClose() {} });
  assert.equal(popupMenu.querySelector('[data-timeline-view-mode="calendar"]').getAttribute('aria-pressed'), 'true');
  popupMenu.querySelector('[data-timeline-view-mode="list"]').onclick({ isTrusted: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(persisted, 'list');
  const action = dailyPanelHarness({ state, timelineEnabled: true, actionSurface: true, respond });
  await action.restoreActivityViewMode();
  const panel = action.renderMenu({ compact: true, onClose() {} });
  assert.equal(panel.querySelector('[data-timeline-view-mode="list"]').getAttribute('aria-pressed'), 'true');
  assert.equal(panel.querySelector('.today-list').hidden, false);
});

test('rapid Activity view switches persist the last selection in order', async () => {
  const pending = [];
  let persisted = 'timeline';
  const state = { configured: true, active: null, pendingWrites: [] };
  const h = dailyPanelHarness({ state, pageUrl: 'chrome-extension://clockoli/src/popup/popup.html', respond(message, callback) {
    if (message.type === 'SET_ACTIVITY_VIEW_MODE') pending.push({ mode: message.mode, callback });
    else if (message.type === 'GET_ACTIVITY_VIEW_MODE') callback({ ok: true, data: { mode: persisted } });
    else callback({ ok: true, data: { ...state, recent: [] } });
  } });
  h.setTimelineViewMode('calendar');
  h.setTimelineViewMode('list');
  assert.equal(pending.length, 1, 'the newer write waits until the older write finishes');
  persisted = pending[0].mode;
  pending[0].callback({ ok: true, data: { mode: persisted } });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(pending.length, 2);
  persisted = pending[1].mode;
  pending[1].callback({ ok: true, data: { mode: persisted } });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(persisted, 'list');
  const reopened = dailyPanelHarness({ state, pageUrl: 'chrome-extension://clockoli/src/popup/popup.html', respond(message, callback) {
    callback({ ok: true, data: message.type === 'GET_ACTIVITY_VIEW_MODE' ? { mode: persisted } : { ...state, recent: [] } });
  } });
  await reopened.restoreActivityViewMode();
  assert.equal(reopened.renderMenu({ compact: true }).querySelector('[data-timeline-view-mode="list"]').getAttribute('aria-pressed'), 'true');
});

test('Activity selection restores in the compact toolbar popup, where view controls remain available', async () => {
  let persisted = null;
  const state = { configured: true, active: null, pendingWrites: [] };
  const respond = (message, callback) => {
    if (message.type === 'GET_ACTIVITY_VIEW_MODE') callback({ ok: true, data: { mode: persisted } });
    else if (message.type === 'SET_ACTIVITY_VIEW_MODE') { persisted = message.mode; callback({ ok: true, data: { mode: persisted } }); }
    else callback({ ok: true, data: state });
  };
  const activity = dailyPanelHarness({ state, pageUrl: 'chrome-extension://clockoli/src/times/times.html', timelineEnabled: true, respond });
  const view = activity.renderActivity();
  view.querySelector('.times-view-modes').walk().find(node => node.textContent === 'Calendar').onclick({ isTrusted: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(persisted, 'calendar');
  const popup = dailyPanelHarness({ state, pageUrl: 'chrome-extension://clockoli/src/popup/popup.html', timelineEnabled: true, respond });
  await popup.restoreActivityViewMode();
  const menu = popup.renderMenu({ compact: true });
  popup.attachCompact(menu);
  assert.equal(menu.querySelector('[data-timeline-view-mode="calendar"]').getAttribute('aria-pressed'), 'true');
  assert.equal(menu.querySelector('.popup-timeline-section').hidden, false);
  menu.querySelector('[data-timeline-view-mode="list"]').onclick({ isTrusted: true });
  assert.equal(menu.querySelector('[data-timeline-view-mode="list"]').getAttribute('aria-pressed'), 'true');
  assert.equal(menu.querySelector('[data-timeline-view-mode="calendar"]').getAttribute('aria-pressed'), 'false');
});

test('Activity opens in Timeline if saved-view storage is unavailable', () => {
  const h = dailyPanelHarness({ state: { configured: true }, pageUrl: 'chrome-extension://clockoli/src/times/times.html',
    localStorage: { getItem() { throw new Error('disabled'); }, setItem() { throw new Error('disabled'); } } });
  const surface = h.renderActivity();
  surface.querySelector('.times-view-modes').walk().find(node => node.textContent === 'List').onclick({ isTrusted: true });
  assert.equal(surface.querySelector('.times-results').hidden, false);
});

test('Activity and popup mount the same seven-day Timeline and Calendar with week arrows instead of a period selector', async () => {
  const now = new Date(2026, 9, 14, 12).getTime();
  const state = { configured: true, active: null, pendingWrites: [] };
  for (const pageUrl of ['chrome-extension://clockoli/src/times/times.html', 'chrome-extension://clockoli/src/popup/popup.html']) {
    const h = dailyPanelHarness({ state, now, timelineEnabled: true, pageUrl,
      respond(message, callback) { callback({ ok: true, data: ['LOAD_TIMES', 'LOAD_WEEK'].includes(message.type) ? { ...state, recent: [] } : state }); },
    });
    const surface = pageUrl.includes('/times/') ? h.renderActivity() : h.renderMenu({ compact: true, onClose() {} });
    h.frames.splice(0).forEach(frame => frame());
    assert.equal(surface.walk().some(node => node.tag === 'select' && node.getAttribute('aria-label') === 'Time period'), false);
    assert.equal(h.timelineMounts.length, 1);
    assert.equal(h.timelineMounts[0].weeklyCalendar, true);
    assert.equal(h.timelineMounts[0].view.start, new Date(2026, 9, 12).getTime());
    assert.equal(h.timelineMounts[0].totalRange.end, new Date(2026, 9, 19).getTime());
    const previous = surface.walk().find(node => node.getAttribute('aria-label') === 'Previous week');
    assert.ok(previous);
    await previous.onclick({ isTrusted: true });
    assert.ok(h.messages.some(message => message.type === (pageUrl.includes('/times/') ? 'LOAD_TIMES' : 'LOAD_WEEK')
      && message.payload.startDate === '2026-10-05' && message.payload.endDate === '2026-10-11'));
    assert.equal(h.timelineMounts.length, 1);
    assert.ok(h.timelineUpdates.some(update => update.view?.start === new Date(2026, 9, 5).getTime()));
  }
});

test('Timeline rows include only projects visible in the selected week', () => {
  // activityEntry times are UTC, so `now` must be a UTC instant too.
  const now = new Date('2026-10-14T12:00:00Z').getTime();
  const state = { configured: true, active: null, pendingWrites: [],
    projects: [{ name: 'One', substrings: ['/one'] }, { name: 'Two', substrings: ['/two'] }] };
  const one = activityEntry('one', '2026-10-14', '08');
  const previous = activityEntry('two', '2026-10-07', '08');
  const h = dailyPanelHarness({ state, records: [one, previous], now });
  assert.deepEqual(JSON.parse(JSON.stringify(h.timelineRows(0, now))), [{ id: 'project:one', title: 'One' }]);
  const two = activityEntry('two', '2026-10-14', '09');
  h.set(state, [one, two, previous]);
  assert.deepEqual(JSON.parse(JSON.stringify(h.timelineRows(0, now))), [
    { id: 'project:one', title: 'One' }, { id: 'project:two', title: 'Two' },
  ]);
});

test('Activity List and Timeline retain the Monday part of a prior-Saturday interval', async () => {
  const monday = new Date(2026, 5, 1).getTime();
  const now = new Date(2026, 5, 3, 12).getTime();
  const entry = { ...activityEntry('cross-week', '2026-05-30', '23'),
    startedAt: new Date(monday - 25 * 3_600_000).toISOString(), endedAt: new Date(monday + 3_600_000).toISOString() };
  const state = { configured: true, active: null, pendingWrites: [] };
  const h = dailyPanelHarness({ state, records: [entry], now, timelineEnabled: true,
    pageUrl: 'chrome-extension://clockoli/src/times/times.html',
    respond(message, callback) { callback({ ok: true, data: message.type === 'LOAD_TIMES' ? { ...state, recent: [entry] } : state }); },
  });
  const activity = h.renderActivity();
  h.frames.splice(0).forEach(frame => frame());
  assert.equal(h.timelineItems(0, now)[0].startedAt, monday);
  await activity.querySelector('.times-view-modes').walk().find(node => node.textContent === 'List').onclick({ isTrusted: true });
  assert.ok(activity.querySelector('.times-results').walk().some(node => node.textContent === 'Task cross-week'));
  assert.equal(activity.querySelector('.times-list-total').textContent, 'Total: 1h');
});

test('Activity full week reload removes a deleted Sunday record that crossed into Monday', async () => {
  const now = new Date(2026, 9, 14, 12).getTime();
  const monday = new Date(2026, 9, 12).getTime();
  const crossing = { ...activityEntry('crossing', '2026-10-11', '23'),
    startedAt: new Date(monday - 3_600_000).toISOString(), endedAt: new Date(monday + 3_600_000).toISOString() };
  const neighbor = activityEntry('neighbor', '2026-10-13', '08');
  const state = { configured: true, active: null, recent: [], pendingWrites: [] };
  let response = { ...state, recent: [crossing, neighbor] };
  const h = dailyPanelHarness({ state, now, timelineEnabled: true,
    pageUrl: 'chrome-extension://clockoli/src/times/times.html',
    respond(message, callback) { callback({ ok: true, data: message.type === 'LOAD_TIMES' ? response : state }); },
  });
  h.renderActivity();
  await h.loadSelectedTimes();
  assert.ok(h.recentEntry('crossing'));

  response = { ...state, recent: [neighbor], partial: true };
  await h.loadSelectedTimes();
  assert.ok(h.recentEntry('crossing'), 'a partial response cannot prove the older record was deleted');

  response = { ...state, recent: [neighbor] };
  await h.loadSelectedTimes();
  assert.equal(h.recentEntry('crossing'), undefined, 'a complete week response removes the deleted overlapping record');
  assert.ok(h.recentEntry('neighbor'), 'records still present in the week must survive');
});

test('Activity view switches return from a historical Calendar week to the current List and Timeline week', async () => {
  const now = new Date(2026, 9, 14, 12).getTime();
  const state = { configured: true, active: null, pendingWrites: [] };
  const h = dailyPanelHarness({ state, now, timelineEnabled: true, notifyViewModeChange: true,
    pageUrl: 'chrome-extension://clockoli/src/times/times.html',
    respond(message, callback) { callback({ ok: true, data: message.type === 'LOAD_TIMES' ? { ...state, recent: [] } : state }); },
  });
  const activity = h.renderActivity();
  h.frames.splice(0).forEach(frame => frame());
  const select = mode => activity.querySelector('.times-view-modes').walk()
    .find(node => node.tag === 'button' && node.textContent === mode).onclick({ isTrusted: true });
  await select('Calendar');
  await activity.querySelector('.week-navigation').querySelector('[aria-label="Previous week"]').onclick({ isTrusted: true });
  assert.equal(h.debugWeek().selectedWeekStart, new Date(2026, 9, 5).getTime());
  await select('Calendar');
  assert.equal(h.debugWeek().selectedWeekStart, new Date(2026, 9, 5).getTime(), 'reselecting the same view preserves its week');
  await select('List');
  assert.equal(new Date(h.debugWeek().selectedWeekStart ?? now).getDate(), 14);
  assert.equal(activity.querySelector('.times-results').hidden, false, 'List remains selected when the widget reports its view mode');
  assert.ok(h.messages.some(message => message.type === 'LOAD_TIMES' && message.payload.startDate === '2026-10-12'));
  await activity.querySelector('.week-navigation').querySelector('[aria-label="Previous week"]').onclick({ isTrusted: true });
  await select('Timeline');
  assert.equal(new Date(h.debugWeek().selectedWeekStart ?? now).getDate(), 14);
});

test('toolbar panel view switch returns a historical Calendar to the current List week', async () => {
  const now = new Date(2026, 9, 14, 12).getTime();
  const state = { configured: true, active: null, pendingWrites: [] };
  const h = dailyPanelHarness({ state, now, timelineEnabled: true,
    respond(message, callback) { callback({ ok: true, data: ['LOAD_WEEK', 'LOAD_TIMES'].includes(message.type) ? { ...state, recent: [] } : state }); },
  });
  const menu = h.renderMenu({ compact: true }); h.attachCompact(menu);
  h.frames.splice(0).forEach(frame => frame());
  h.setTimelineViewMode('calendar');
  await menu.querySelector('.week-navigation').querySelector('[aria-label="Previous week"]').onclick({ isTrusted: true });
  assert.equal(h.debugWeek().selectedWeekStart, new Date(2026, 9, 5).getTime());
  h.setTimelineViewMode('calendar');
  assert.equal(h.debugWeek().selectedWeekStart, new Date(2026, 9, 5).getTime(), 'reselecting the same view preserves its week');
  h.setTimelineViewMode('list');
  assert.equal(h.debugWeek().selectedWeekStart, new Date(2026, 9, 12).getTime());
  assert.ok(h.messages.some(message => message.type === 'LOAD_WEEK' && message.payload.startDate === '2026-10-12'));
});

test('Activity Timeline includes the running task from local state without replacing its loaded history', async () => {
  const now = new Date('2026-09-05T12:00:00Z').getTime();
  const entry = activityEntry('completed', '2026-09-05', '08');
  const active = { id: 'running', taskUrl: 'https://example.com/running', taskTitle: 'Running', startedAt: new Date(now - 60_000).toISOString() };
  const h = dailyPanelHarness({ now, timelineEnabled: true, pageUrl: 'chrome-extension://clockoli/src/times/times.html',
    respond(message, callback) { callback({ ok: true, data: message.type === 'LOAD_TIMES'
      ? { configured: true, recent: [entry], pendingWrites: [] }
      : { configured: true, active, recent: [], pendingWrites: [] } }); },
  });
  h.renderActivity();
  await h.loadSelectedTimes();
  h.frames.splice(0).forEach(frame => frame());
  assert.ok(h.messages.some(message => message.type === 'GET_PAGE_STATE' && !message.refresh));
  const items = h.timelineUpdates.at(-1)?.items ?? h.timelineMounts.at(-1).items;
  assert.ok(items.some(item => item.id === `entry:${entry.id}`));
  assert.ok(items.some(item => item.id === 'active:running' && item.isRunning && item.endedAt === null));
});

test('selected completion of the active task stops the active timer rather than its old record', async () => {
  const now = new Date('2026-09-05T12:00:00Z').getTime();
  const entry = activityEntry('completed', '2026-09-05', '08', 'https://example.com/running');
  const active = { id: 'running', taskUrl: entry.taskUrl, taskTitle: entry.taskTitle, startedAt: new Date(now - 60_000).toISOString() };
  const state = { configured: true, active, pendingWrites: [] };
  const h = dailyPanelHarness({ state, records: [entry], now, timelineEnabled: true, pageUrl: 'chrome-extension://clockoli/src/times/times.html',
    respond(message, callback) {
      if (message.type === 'STOP') {
        state.active = null;
        callback({ ok: true, data: { entry: { ...entry, id: 'stopped', endedAt: new Date(now).toISOString() } } });
      } else callback({ ok: true, data: state });
    },
  });
  h.renderActivity();
  h.frames.splice(0).forEach(frame => frame());
  const item = h.timelineItems(0, now).find(value => value.id === `entry:${entry.id}`);
  assert.equal(item.isCurrentTask, true);
  assert.equal(item.isStartDisabled, true);
  await h.timelineMounts.at(-1).onStop(item);
  assert.equal(h.messages.some(message => message.type === 'STOP'), true);
  assert.equal(h.messages.some(message => message.type === 'SWITCH_TASK'), false);
});

test('Activity Timeline updates a timer started or stopped elsewhere without discarding completed records', async () => {
  const now = new Date('2026-09-05T12:00:00Z').getTime();
  const entry = activityEntry('completed', '2026-09-05', '08');
  const active = { id: 'running', taskUrl: 'https://example.com/running', taskTitle: 'Running', startedAt: new Date(now - 60_000).toISOString() };
  let current = null;
  const h = dailyPanelHarness({ now, timelineEnabled: true, pageUrl: 'chrome-extension://clockoli/src/times/times.html',
    respond(message, callback) { callback({ ok: true, data: message.type === 'LOAD_TIMES'
      ? { configured: true, recent: [entry], pendingWrites: [] }
      : { configured: true, active: current, recent: [], pendingWrites: [] } }); },
  });
  h.renderActivity();
  await h.loadSelectedTimes();
  h.frames.splice(0).forEach(frame => frame());
  const initialMounts = h.timelineMounts.length;
  current = active;
  await h.refreshActivityState();
  assert.ok(h.timelineUpdates.at(-1).items.some(item => item.id === 'active:running' && item.isRunning));
  current = null;
  await h.refreshActivityState();
  assert.ok(h.timelineUpdates.at(-1).items.some(item => item.id === `entry:${entry.id}`));
  assert.equal(h.timelineUpdates.at(-1).items.some(item => item.isRunning), false);
  assert.equal(h.timelineMounts.length, initialMounts, 'state changes keep the existing timeline mounted');
});

test('GitHub Calendar keeps the selected week when a bounded recent-state response arrives on reopen', async () => {
  const now = new Date(2026, 9, 14, 12).getTime();
  const early = activityEntry('early', '2026-10-06', '08');
  const late = activityEntry('late', '2026-10-09', '08');
  const state = { configured: true, active: null, pendingWrites: [] };
  let weekEntries = [early, late];
  const h = dailyPanelHarness({ state, records: [early, late], now, timelineEnabled: true,
    respond(message, callback) { callback({ ok: true, data: message.type === 'LOAD_WEEK'
      ? { ...state, recent: message.payload.startDate === '2026-10-05' ? weekEntries : [] }
      : { ...state, recent: [late] } }); },
  });
  const menu = h.renderMenu({ compact: true });
  await menu.querySelector('.week-navigation').querySelector('[aria-label="Previous week"]').onclick({ isTrusted: true });
  assert.ok(h.recentEntry('early'), 'the full week has been loaded');
  h.applyPageState({ ...state, recent: [late] });
  assert.ok(h.recentEntry('early'), 'a bounded recent response must not erase earlier entries in the week');
  assert.ok(h.timelineItems(new Date(2026, 9, 5).getTime(), now).some(item => item.id === 'entry:early'), 'the calendar projection stays intact');
  weekEntries = [late];
  await menu.querySelector('.week-navigation').querySelector('[aria-label="Next week"]').onclick({ isTrusted: true });
  await menu.querySelector('.week-navigation').querySelector('[aria-label="Previous week"]').onclick({ isTrusted: true });
  assert.equal(h.recentEntry('early'), undefined, 'an authoritative week reload can remove a deleted entry');
});

test('Activity Timeline starts on Monday and refocuses after a week change', async () => {
  const now = new Date(2026, 9, 12, 19).getTime();
  const state = { configured: true, active: null, pendingWrites: [] };
  const h = dailyPanelHarness({ state, now, timelineEnabled: true,
    pageUrl: 'chrome-extension://clockoli/src/times/times.html',
    respond(message, callback) { callback({ ok: true, data: message.type === 'LOAD_TIMES' ? { ...state, recent: [] } : state }); },
  });
  const activity = h.renderActivity();
  await h.loadSelectedTimes();
  h.frames.splice(0).forEach(frame => frame());
  const monday = new Date(2026, 9, 12).getTime();
  assert.equal(h.timelineMounts.at(-1).domainStart, monday);
  assert.equal(h.timelineMounts.at(-1).view.start, monday);
  assert.equal(h.timelineScrolls.length, 0, 'initial Activity mount must not scroll past the week');
  await activity.querySelector('.week-navigation').querySelector('[aria-label="Previous week"]').onclick({ isTrusted: true });
  h.frames.splice(0).forEach(frame => frame());
  assert.ok(h.timelineUpdates.length, JSON.stringify({ mounts: h.timelineMounts.length, frames: h.frames.length, messages: h.messages.filter(item => item.type === 'LOAD_TIMES').map(item => item.payload), debug: h.debugWeek() }));
  assert.equal(h.timelineUpdates.at(-1).domainStart, new Date(2026, 9, 5).getTime());
  assert.ok(h.timelineUpdates.some(update => update.view?.start === new Date(2026, 9, 5).getTime()));
});

test('opening Activity Calendar shares the current Monday–Sunday week with Timeline', async () => {
  const now = new Date(2026, 9, 8, 12).getTime();
  const tuesday = activityEntry('tuesday', '2026-10-06', '08');
  const state = { configured: true, active: null, pendingWrites: [] };
  const h = dailyPanelHarness({ state, now, timelineEnabled: true,
    pageUrl: 'chrome-extension://clockoli/src/times/times.html',
    respond(message, callback) { callback({ ok: true, data: message.type === 'LOAD_TIMES'
      ? { ...state, recent: message.payload.startDate === '2026-10-05' ? [tuesday] : [] }
      : state }); },
  });
  const activity = h.renderActivity();
  h.frames.splice(0).forEach(frame => frame());
  const calendar = activity.querySelector('.times-view-modes').walk().find(node => node.tag === 'button' && node.textContent === 'Calendar');
  await calendar.onclick({ isTrusted: true });
  assert.equal(activity.querySelector('.times-toolbar').querySelector('select'), null);
  const range = h.timelineRanges.at(-1);
  assert.equal(new Date(range?.start).getDate(), 5, 'Calendar starts Monday');
  assert.equal(new Date(range?.end).getDate(), 12, 'Calendar ends after Sunday');
  assert.ok(h.messages.some(message => message.type === 'LOAD_TIMES'
    && message.payload.startDate === '2026-10-05' && message.payload.endDate === '2026-10-11'));
  assert.ok(h.timelineUpdates.some(update => update.items?.some(item => item.id === `entry:${tuesday.id}`)), 'the selected days reach the rendered widget');
  const rangeCount = h.timelineRanges.length;
  await activity.querySelector('.times-view-modes').walk().find(node => node.tag === 'button' && node.textContent === 'List').onclick({ isTrusted: true });
  await calendar.onclick({ isTrusted: true });
  assert.ok(h.timelineRanges.length > rangeCount, 'switching views refocuses the current week');
  assert.equal(h.timelineRanges.at(-1).start, new Date(2026, 9, 5).getTime());
  assert.equal(h.timelineMounts.length, 1, 'switching views keeps the widget mounted');
});

test('Activity Calendar returns to the current week in List without remounting', async () => {
  const now = new Date(2026, 8, 5, 12).getTime();
  const lastWeek = activityEntry('last-week-activity', '2026-08-26', '08');
  const state = { configured: true, active: null, pendingWrites: [] };
  const harness = dailyPanelHarness({ state, now, timelineEnabled: true,
    pageUrl: 'chrome-extension://clockoli/src/times/times.html',
    respond(message, callback) {
      callback({ ok: true, data: message.type === 'LOAD_TIMES'
        ? { ...state, recent: message.payload.startDate === '2026-08-24' ? [lastWeek] : [] }
        : state });
    },
  });
  const activity = harness.renderActivity();
  harness.frames.splice(0).forEach(frame => frame());
  const calendar = activity.walk().find(node => node.tag === 'button' && node.textContent === 'Calendar');
  await calendar.onclick({ isTrusted: true });
  assert.ok(harness.messages.some(message => message.type === 'LOAD_TIMES'
    && message.payload.startDate === '2026-08-31' && message.payload.endDate === '2026-09-06'), 'opening Calendar loads the current week');
  const monday = new Date(2026, 7, 24).getTime(), followingMonday = new Date(2026, 7, 31).getTime();
  await harness.timelineMounts[0].onCalendarNavigate({ start: monday, end: followingMonday });
  assert.ok(harness.messages.some(message => message.type === 'LOAD_TIMES'
    && message.payload.startDate === '2026-08-24' && message.payload.endDate === '2026-08-30'), 'navigation loads the previous week');
  assert.ok(harness.timelineUpdates.some(update => update.items?.some(item => item.id === `entry:${lastWeek.id}`)), 'loaded entry reaches the mounted calendar');
  assert.equal(harness.timelineMounts.length, 1);
  const list = activity.walk().find(node => node.tag === 'button' && node.textContent === 'List');
  await list.onclick({ isTrusted: true });
  assert.equal(activity.querySelector('.times-results').walk().some(node => node.textContent === lastWeek.taskTitle), false, 'List does not inherit the Calendar week');
  assert.ok(harness.messages.some(message => message.type === 'LOAD_TIMES' && message.payload.startDate === '2026-08-31'));
});

test('opening Activity Calendar before its first widget frame still applies the week', async () => {
  const now = new Date(2026, 9, 8, 12).getTime();
  const state = { configured: true, active: null, pendingWrites: [] };
  const h = dailyPanelHarness({ state, now, timelineEnabled: true,
    pageUrl: 'chrome-extension://clockoli/src/times/times.html',
    respond(message, callback) { callback({ ok: true, data: message.type === 'LOAD_TIMES' ? { ...state, recent: [] } : state }); },
  });
  const activity = h.renderActivity();
  await activity.querySelector('.times-view-modes').walk()
    .find(node => node.tag === 'button' && node.textContent === 'Calendar').onclick({ isTrusted: true });
  h.frames.splice(0).forEach(frame => frame());
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(new Date(h.timelineRanges.at(-1)?.start).getDate(), 5);
  assert.ok(h.messages.some(message => message.type === 'LOAD_TIMES'
    && message.payload.startDate === '2026-10-05' && message.payload.endDate === '2026-10-11'));
});

test('Calendar shows all seven days of the current week without a period selector', async () => {
  const now = new Date(2026, 9, 14, 12).getTime();
  const state = { configured: true, active: null, pendingWrites: [] };
  const h = dailyPanelHarness({ state, now, timelineEnabled: true,
    pageUrl: 'chrome-extension://clockoli/src/times/times.html',
    respond(message, callback) { callback({ ok: true, data: message.type === 'LOAD_TIMES' ? { ...state, recent: [] } : state }); },
  });
  const activity = h.renderActivity();
  h.frames.splice(0).forEach(frame => frame());
  assert.equal(activity.querySelector('.times-toolbar').querySelector('select'), null);
  await activity.querySelector('.times-view-modes').walk()
    .find(node => node.tag === 'button' && node.textContent === 'Calendar').onclick({ isTrusted: true });
  assert.equal(h.timelineRanges.at(-1).start, new Date(2026, 9, 12).getTime());
  assert.equal(h.timelineRanges.at(-1).end, new Date(2026, 9, 19).getTime(), 'Calendar includes every day through Sunday');
  assert.ok(h.messages.some(message => message.type === 'LOAD_TIMES'
    && message.payload.startDate === '2026-10-12' && message.payload.endDate === '2026-10-18'), 'the displayed week is requested');
});

test('switching to Calendar resets an earlier week, while arrows within Calendar still navigate', async () => {
  for (const order of ['navigate-first', 'calendar-first']) {
    const now = new Date(2026, 8, 5, 12).getTime();
    const current = activityEntry('current', '2026-09-03', '08');
    const previous = activityEntry('previous', '2026-08-26', '08');
    const state = { configured: true, active: null, pendingWrites: [] };
    const h = dailyPanelHarness({ state, records: [current], now, timelineEnabled: true,
      pageUrl: 'chrome-extension://clockoli/src/times/times.html',
      respond(message, callback) { callback({ ok: true, data: message.type === 'LOAD_TIMES'
        ? { ...state, recent: message.payload.startDate === '2026-08-24' ? [previous] : [current] }
        : state }); },
    });
    const activity = h.renderActivity();
    h.frames.splice(0).forEach(frame => frame());
    const openCalendar = async () => activity.querySelector('.times-view-modes').walk()
      .find(node => node.tag === 'button' && node.textContent === 'Calendar').onclick({ isTrusted: true });
    if (order === 'calendar-first') await openCalendar();
    await activity.querySelector('.week-navigation').querySelector('[aria-label="Previous week"]').onclick({ isTrusted: true });
    if (order === 'navigate-first') await openCalendar();
    const selected = h.timelineRanges.at(-1);
    assert.equal(new Date(selected.start).getDate(), order === 'navigate-first' ? 31 : 24);
    assert.equal(new Date(selected.end).getDate(), order === 'navigate-first' ? 7 : 31);
    assert.equal(h.timelineMounts.length, 1, `${order}: the widget stays mounted`);
  }
});

test('Activity Calendar stays on seven days after repeated week navigation', async () => {
  const now = new Date(2026, 9, 8, 12).getTime();
  const state = { configured: true, active: null, pendingWrites: [] };
  const h = dailyPanelHarness({ state, now, timelineEnabled: true,
    pageUrl: 'chrome-extension://clockoli/src/times/times.html',
    respond(message, callback) { callback({ ok: true, data: message.type === 'LOAD_TIMES' ? { ...state, recent: [] } : state }); },
  });
  const activity = h.renderActivity();
  h.frames.splice(0).forEach(frame => frame());
  const openCalendar = async () => activity.querySelector('.times-view-modes').walk()
    .find(node => node.tag === 'button' && node.textContent === 'Calendar').onclick({ isTrusted: true });
  await openCalendar();
  for (const [direction, startDate, endDate] of [
    ['Previous week', '2026-09-28', '2026-10-04'],
    ['Previous week', '2026-09-21', '2026-09-27'],
    ['Next week', '2026-09-28', '2026-10-04'],
  ]) {
    await activity.querySelector('.week-navigation').querySelector(`[aria-label="${direction}"]`).onclick({ isTrusted: true });
    const range = h.timelineRanges.at(-1);
    assert.equal(range.end - range.start, 7 * 86_400_000);
    assert.ok(h.messages.some(message => message.type === 'LOAD_TIMES'
      && message.payload.startDate === startDate && message.payload.endDate === endDate));
  }
  assert.equal(h.timelineMounts.length, 1);
});

test('Activity Calendar ignores an older week response after navigating again', async () => {
  const now = new Date(2026, 8, 5, 12).getTime();
  const loads = [];
  const harness = dailyPanelHarness({ state: { configured: true, active: null, pendingWrites: [] }, now,
    timelineEnabled: true, pageUrl: 'chrome-extension://clockoli/src/times/times.html',
    respond(message, callback) {
      if (message.type === 'LOAD_TIMES') loads.push({ message, callback });
      else callback({ ok: true, data: { configured: true, active: null, pendingWrites: [] } });
    },
  });
  const activity = harness.renderActivity();
  harness.frames.splice(0).forEach(frame => frame());
  const calendar = activity.walk().find(node => node.tag === 'button' && node.textContent === 'Calendar');
  const first = calendar.onclick({ isTrusted: true });
  for (let attempt = 0; attempt < 5 && !loads.length; attempt++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(loads.length, 1, 'the current week starts loading on a view switch');
  const older = activityEntry('older-response', '2026-08-26', '08');
  const newest = activityEntry('newest-response', '2026-08-19', '08');
  const second = harness.timelineMounts[0].onCalendarNavigate({ start: new Date(2026, 7, 24).getTime(), end: new Date(2026, 7, 31).getTime() });
  const third = harness.timelineMounts[0].onCalendarNavigate({ start: new Date(2026, 7, 17).getTime(), end: new Date(2026, 7, 24).getTime() });
  assert.equal(loads.length, 3);
  const overlay = activity.querySelector('.calendar-week-loading');
  assert.ok(overlay, 'Calendar has a large in-place loading indicator');
  assert.equal(overlay.hidden, false);
  assert.equal(overlay.getAttribute('role'), 'status');
  loads[1].callback({ ok: true, data: { configured: true, recent: [older] } }); await second;
  assert.equal(overlay.hidden, false, 'a superseded response does not dismiss the current load');
  loads[2].callback({ ok: true, data: { configured: true, recent: [newest] } }); await third;
  assert.equal(overlay.hidden, true, 'the canceled initial read cannot keep the selected week loading');
  loads[0].callback({ ok: false, error: { message: 'Superseded read' } }); await first;
  assert.equal(overlay.hidden, true, 'a canceled read cannot restore the spinner');
  assert.ok(harness.timelineUpdates.at(-1).items.some(item => item.id === `entry:${newest.id}`));
  assert.equal(harness.timelineUpdates.at(-1).items.some(item => item.id === `entry:${older.id}`), false);
  assert.equal(harness.debugWeek().errorText, '', 'an obsolete initial load does not report an error');
  assert.equal(harness.timelineMounts.length, 1);
});

test('Activity Calendar navigation dismisses a pending initial page-state load', async () => {
  const now = new Date(2026, 8, 5, 12).getTime();
  const pageStates = [], weeks = [];
  const state = { configured: true, active: null, pendingWrites: [] };
  const harness = dailyPanelHarness({ state, now, timelineEnabled: true,
    pageUrl: 'chrome-extension://clockoli/src/times/times.html',
    respond(message, callback) {
      if (message.type === 'GET_PAGE_STATE') pageStates.push(callback);
      else if (message.type === 'LOAD_TIMES') weeks.push(callback);
      else callback({ ok: true, data: state });
    },
  });
  const activity = harness.renderActivity();
  harness.frames.splice(0).forEach(frame => frame());
  const first = activity.walk().find(node => node.tag === 'button' && node.textContent === 'Calendar').onclick({ isTrusted: true });
  assert.equal(pageStates.length, 1);
  const overlay = activity.querySelector('.calendar-week-loading');
  assert.equal(overlay.hidden, false);
  const next = harness.timelineMounts[0].onCalendarNavigate({ start: new Date(2026, 7, 24).getTime(), end: new Date(2026, 7, 31).getTime() });
  assert.equal(weeks.length, 1);
  weeks[0]({ ok: true, data: { ...state, recent: [] } }); await next;
  assert.equal(overlay.hidden, true, 'the pending page-state read must not retain the week spinner');
  pageStates[0]({ ok: true, data: { ...state, recent: [] } }); await first;
  assert.equal(weeks.length, 1, 'a canceled initial load does not start another week read');
  assert.equal(overlay.hidden, true);
});

test('Activity Calendar leaves the mounted week intact and reports a failed historical read', async () => {
  const now = new Date(2026, 8, 5, 12).getTime();
  const entry = activityEntry('current-week', '2026-09-03', '08');
  const harness = dailyPanelHarness({ state: { configured: true, active: null, pendingWrites: [] }, records: [entry], now,
    timelineEnabled: true, pageUrl: 'chrome-extension://clockoli/src/times/times.html',
    respond(message, callback) {
      if (message.type === 'LOAD_TIMES' && message.payload.startDate === '2026-08-24') callback({ ok: false, error: { message: 'Week unavailable' } });
      else callback({ ok: true, data: { configured: true, recent: [entry] } });
    },
  });
  const activity = harness.renderActivity();
  harness.frames.splice(0).forEach(frame => frame());
  await activity.walk().find(node => node.tag === 'button' && node.textContent === 'Calendar').onclick({ isTrusted: true });
  const displayedWeek = activity.querySelector('.week-navigation-label').textContent;
  await harness.timelineMounts[0].onCalendarNavigate({ start: new Date(2026, 7, 24).getTime(), end: new Date(2026, 7, 31).getTime() });
  assert.equal(activity.querySelector('.calendar-week-loading').hidden, true, 'failed reads dismiss the spinner');
  assert.equal(harness.timelineMounts.length, 1);
  assert.equal(activity.querySelector('.week-navigation-label').textContent, displayedWeek);
  assert.equal(harness.timelineUpdates.at(-1).totalRange.start, new Date(2026, 7, 31).getTime());
  assert.ok(harness.timelineUpdates.at(-1).items.some(item => item.id === `entry:${entry.id}`));
  assert.equal(activity.querySelector('.times-calendar-status').textContent, 'Could not load this week.');
});

test('pending-write polling does not replace a loaded Calendar week with bounded recent cache', async () => {
  const now = new Date(2026, 9, 8, 12).getTime();
  const records = ['05', '06', '07', '08', '09'].map(day => activityEntry(day, `2026-10-${day}`, '10'));
  const cached = records.slice(3);
  const pending = { id: 'edit-first-monday', operation: 'editEntry', status: 'pending' };
  const anotherPending = { id: 'other-write', operation: 'editEntry', status: 'pending' };
  let pollingPending = true;
  const h = dailyPanelHarness({ state: { configured: true, active: null, pendingWrites: [] }, records, now,
    timelineEnabled: true, pageUrl: 'chrome-extension://clockoli/src/times/times.html',
    respond(message, callback) { callback({ ok: true, data: message.type === 'GET_PAGE_STATE'
      ? { configured: true, active: null, recent: cached, pendingWrites: pollingPending ? [pending, anotherPending] : [anotherPending], pendingCount: pollingPending ? 2 : 1 }
      : { configured: true, active: null, recent: records, pendingWrites: [] } }); },
  });
  h.renderActivity();
  h.applyPageState({ configured: true, active: null, pendingWrites: [pending, anotherPending], pendingCount: 2 });
  const poll = [...h.timeouts.values()].find(timer => timer.delay === 500);
  assert.ok(poll, 'an accepted boundary edit schedules a page-state poll');
  await poll.callback();
  for (const record of records) assert.ok(h.recentEntry(record.id), `${record.entryDate} must survive while the edit is pending`);
  pollingPending = false;
  await [...h.timeouts.values()].find(timer => timer.delay === 500).callback();
  assert.ok(h.messages.some(message => message.type === 'LOAD_TIMES'), 'a completed edit reloads the whole week while another write remains pending');
  for (const record of records) assert.ok(h.recentEntry(record.id), `${record.entryDate} must survive after synchronization`);
});

test('popup Calendar shows the week spinner until the complete week response arrives', async () => {
  const now = new Date(2026, 8, 5, 12).getTime();
  const state = { configured: true, active: null, pendingWrites: [] };
  const loads = [];
  const h = dailyPanelHarness({ state, now, timelineEnabled: true, pageUrl: 'chrome-extension://clockoli/src/popup/popup.html',
    respond(message, callback) {
      if (message.type === 'LOAD_WEEK') loads.push(callback);
      else callback({ ok: true, data: state });
    },
  });
  const menu = h.renderMenu({ compact: true }); h.attachCompact(menu);
  h.frames.splice(0).forEach(frame => frame());
  h.setTimelineViewMode('calendar');
  assert.equal(loads.length, 1);
  const overlay = menu.querySelector('.calendar-week-loading');
  assert.ok(overlay);
  assert.equal(overlay.hidden, false);
  loads[0]({ ok: true, data: { ...state, recent: [], partial: true } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(overlay.hidden, true, 'partial data is reported as an error, not an endless spinner');
});

test('Activity List restores its week and entries when an arrow read fails', async () => {
  const now = new Date(2026, 8, 5, 12).getTime();
  const entry = activityEntry('current-week', '2026-09-03', '08');
  const state = { configured: true, active: null, pendingWrites: [] };
  const h = dailyPanelHarness({ state, records: [entry], now,
    timelineEnabled: true, pageUrl: 'chrome-extension://clockoli/src/times/times.html',
    respond(message, callback) {
      if (message.type === 'LOAD_TIMES' && message.payload.startDate === '2026-08-24') callback({ ok: false, error: { message: 'Week unavailable' } });
      else callback({ ok: true, data: message.type === 'LOAD_TIMES' ? { ...state, recent: [entry] } : state });
    },
  });
  const activity = h.renderActivity(); h.frames.splice(0).forEach(frame => frame());
  await activity.querySelector('.times-view-modes').walk().find(node => node.textContent === 'List').onclick({ isTrusted: true });
  const displayedWeek = activity.querySelector('.week-navigation-label').textContent;
  await activity.querySelector('.week-navigation').querySelector('[aria-label="Previous week"]').onclick({ isTrusted: true });
  assert.equal(activity.querySelector('.week-navigation-label').textContent, displayedWeek);
  assert.equal(activity.querySelector('.times-results').walk().some(node => node.textContent === 'Task current-week'), true);
  assert.equal(h.debugWeek().errorText, 'Week unavailable');
});

test('popup List uses the Activity record controls, task identity and description editor', () => {
  const now = Date.now(), date = new Date(now), today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const entry = { id: 'entry', taskUrl: 'https://example.com/work', taskTitle: 'External work', description: 'Initial note', entryDate: today, timezone: 'UTC', startedAt: new Date(now - 3_600_000).toISOString(), endedAt: new Date(now - 1_800_000).toISOString(), _path: 'times/entry.jsonl', _sha: 'sha', _index: 0 };
  const state = { configured: true, active: null, pendingWrites: [] };
  const harness = dailyPanelHarness({ state, records: [entry], now, pageUrl: 'chrome-extension://clockoli/src/popup/popup.html', respond(message, callback) { callback({ ok: true, data: state }); } });
  const menu = harness.renderMenu({ compact: true });
  assert.match(menu.querySelector('.entry-record-favicon').src, /^chrome-extension:\/\/clockoli\/_favicon\//);
  assert.equal(menu.querySelector('.entry-description-link').textContent, 'Initial note');
  assert.ok(menu.querySelector('.entry-track-control'));
  assert.ok(menu.querySelector('.entry-edit'));
  assert.ok(menu.querySelector('.entry-delete'));
});

test('popup List uses the same grouped entry and time controls as Activity', () => {
  const now = Date.now(), date = new Date(now), today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const entry = { id: 'entry', taskUrl: 'https://example.com/work', description: 'Initial', entryDate: today, timezone: 'UTC', startedAt: new Date(now - 3_600_000).toISOString(), endedAt: new Date(now - 1_800_000).toISOString(), _path: 'times/entry.jsonl', _sha: 'sha', _index: 0 };
  const harness = dailyPanelHarness({ state: { configured: true, active: null, pendingWrites: [] }, records: [entry], now, pageUrl: 'chrome-extension://clockoli/src/popup/popup.html' });
  const menu = harness.renderMenu({ compact: true });
  const list = menu.querySelector('.today-list');
  assert.ok(list.classList.contains('activity-list'));
  for (const selector of ['.entry-date-header', '.entry-record-task-identity', '.entry-time-row', '.entry-edit', '.entry-delete']) assert.ok(list.querySelector(selector));
});

test('Timeline details stops projecting a reverted draft over later authoritative descriptions', () => {
  const now = new Date('2026-09-05T12:00:00Z').getTime();
  const entry = activityEntry('timeline-draft', '2026-09-05', '08');
  entry.description = 'Saved';
  const state = { configured: true, active: null, pendingWrites: [] };
  const harness = dailyPanelHarness({ state, records: [entry], now });
  harness.rememberTimelineDescription(entry, 'Changed');
  assert.equal(JSON.stringify(harness.timelineItems(0, now).map(item => [item.description, item.savedDescription])), JSON.stringify([['Changed', 'Saved']]));
  harness.rememberTimelineDescription(entry, 'Saved');
  const refreshed = { ...entry, description: 'Remote update' };
  harness.set(state, [refreshed]);
  assert.equal(JSON.stringify(harness.timelineItems(0, now).map(item => [item.description, item.savedDescription])), JSON.stringify([['Remote update', 'Remote update']]));
});

for (const permissions of [[], ['favicon']]) {
  test(`task favicon surfaces use ${permissions.length ? 'images' : 'monograms'} from the running manifest`, () => {
    const now = Date.parse('2026-09-05T12:00:00Z');
    const entry = activityEntry('site-icon', '2026-09-05', '08', 'https://www.example.com/work');
    const active = { ...entry, id: 'active-icon', endedAt: null };
    const resources = [];
    const options = {
      state: { configured: true, active, pendingWrites: [] }, records: [entry], now,
      runtimeManifest: { permissions },
      runtimeGetURL: path => { resources.push(path); return `chrome-extension://clockoli/${String(path).replace(/^\//, '')}`; },
    };
    const harness = dailyPanelHarness(options);
    const menu = harness.renderMenu({ compact: true });
    const activity = dailyPanelHarness({ ...options, pageUrl: 'chrome-extension://clockoli/src/times/times.html' }).renderActivity();
    for (const icon of [menu.querySelector('.strip-favicon'), menu.querySelector('.entry-record-favicon'), activity.querySelector('.entry-record-favicon')]) {
      assert.ok(icon);
      if (permissions.length) {
        assert.equal(icon.tag, 'img');
        assert.equal(icon.src, 'chrome-extension://clockoli/_favicon/?pageUrl=https%3A%2F%2Fwww.example.com%2Fwork&size=32');
      } else {
        assert.equal(icon.tag, 'span');
        assert.equal(icon.textContent, 'E');
        assert.equal(icon.getAttribute('aria-hidden'), 'true');
        assert.equal(icon.src, undefined);
      }
    }
    const items = harness.timelineItems(0, now);
    assert.ok(items.length);
    assert.ok(items.every(item => item.faviconUrl === (permissions.length
      ? 'chrome-extension://clockoli/_favicon/?pageUrl=https%3A%2F%2Fwww.example.com%2Fwork&size=32' : null)));
    assert.equal(resources.includes('/_favicon/'), Boolean(permissions.length));
  });

  test(`imported task favicons stay hidden with permissions ${JSON.stringify(permissions)}`, () => {
    const now = Date.parse('2026-09-05T12:00:00Z');
    const entry = activityEntry('imported-icon', '2026-09-05', '08', 'owner/repo/slug');
    const harness = dailyPanelHarness({ state: { configured: true, active: null, pendingWrites: [] }, records: [entry], now,
      pageUrl: 'chrome-extension://clockoli/src/times/times.html', runtimeManifest: { permissions } });
    const icon = harness.renderActivity().querySelector('.entry-record-favicon');
    assert.equal(icon.tag, 'img');
    assert.equal(icon.hidden, true);
    assert.equal(harness.timelineItems(0, now)[0].faviconUrl, '');
  });
}

test('Timeline favicon projection survives an unavailable extension resource URL', () => {
  const now = new Date('2026-09-05T12:00:00Z').getTime();
  const entry = activityEntry('favicon-unavailable', '2026-09-05', '08');
  let resourcesAvailable = true;
  const harness = dailyPanelHarness({
    state: { configured: true, active: null, pendingWrites: [] },
    records: [entry], now, runtimeGetURL: path => resourcesAvailable ? `chrome-extension://clockoli/${path}` : undefined,
  });
  resourcesAvailable = false;
  assert.doesNotThrow(() => harness.timelineItems(0, now));
  assert.equal(harness.timelineItems(0, now)[0].faviconUrl, '');
});

test('compact task switches preserve the edited active description in the completion', async () => {
  const now = Date.parse('2026-09-05T14:00:00Z');
  const active = { id: 'active', taskUrl: 'https://example.com/old', taskTitle: 'Old task', description: 'Old note', startedAt: new Date(now - 60_000).toISOString() };
  const nextActive = { id: 'next', taskUrl: 'https://github.com/acme/app/issues/7', taskTitle: 'Issue 7', startedAt: new Date(now).toISOString() };
  const state = { configured: true, active, pendingWrites: [] };
  const makeHarness = () => {
    let localState = state;
    return dailyPanelHarness({ state, now, respond(message, callback) {
      if (message.type === 'SWITCH_TASK') {
        localState = { ...state, active: nextActive };
        callback({ ok: true, data: { active: nextActive } });
      } else callback({ ok: true, data: localState });
    } });
  };

  const current = makeHarness();
  const currentMenu = current.renderMenu({ compact: true });
  current.mount({ update() {}, scrollToEnd() {} }, { start: now - 3_600_000, end: now, focusedAt: now });
  const currentDescription = currentMenu.querySelector('.strip-description');
  currentDescription.value = 'Draft for current switch'; currentDescription.oninput();
  await currentMenu.walk().find(node => node.textContent === 'Switch to this task').onclick({ isTrusted: true });
  const currentSwitch = current.messages.find(message => message.type === 'SWITCH_TASK');
  assert.equal(currentSwitch.description, 'Draft for current switch');
  assert.equal(current.optimisticCompletion('active').description, 'Draft for current switch');
  assert.equal(current.surface().strip.querySelector('.strip-description').value, '', 'the previous draft does not leak into the new active task');

  const listed = makeHarness();
  const listedMenu = listed.renderMenu({ compact: true });
  listed.mount({ update() {}, scrollToEnd() {} }, { start: now - 3_600_000, end: now, focusedAt: now });
  const listedDescription = listedMenu.querySelector('.strip-description');
  listedDescription.value = 'Draft for List switch'; listedDescription.oninput();
  await listed.restartTimelineEntry({ id: 'listed', taskUrl: 'https://example.com/listed', taskTitle: 'Listed task' });
  const listedSwitch = listed.messages.find(message => message.type === 'SWITCH_TASK');
  assert.equal(listedSwitch.description, 'Draft for List switch');
  assert.equal(listed.optimisticCompletion('active').description, 'Draft for List switch');
  assert.equal(listed.surface().strip.querySelector('.strip-description').value, '', 'the previous draft does not leak after Continue');
});

test('a rejected compact switch restores the active task and its unsaved description draft', async () => {
  const now = Date.parse('2026-09-05T14:00:00Z');
  const active = { id: 'active', taskUrl: 'https://example.com/old', description: 'Old note', startedAt: new Date(now - 60_000).toISOString() };
  const state = { configured: true, active, pendingWrites: [] };
  const harness = dailyPanelHarness({ state, now, respond(message, callback) {
    if (message.type === 'SWITCH_TASK') callback({ ok: false, error: { message: 'Switch enqueue failed' } });
    else callback({ ok: true, data: state });
  } });
  const menu = harness.renderMenu({ compact: true });
  harness.mount({ update() {}, scrollToEnd() {} }, { start: now - 3_600_000, end: now, focusedAt: now });
  const description = menu.querySelector('.strip-description');
  description.value = 'Unsaved draft'; description.oninput();

  await assert.rejects(harness.trackCurrentTimelineTask(), /Switch enqueue failed/);
  assert.equal(harness.optimisticCompletion('active'), undefined);
  assert.equal(harness.surface().strip.querySelector('.strip-description').value, 'Unsaved draft');

  const context = harness.acceptTimelineStartImmediately({ taskUrl: 'https://example.com/new' }, { completePrevious: true, previousDescription: 'Unsaved draft' });
  harness.clearDescriptionDraft();
  harness.rollbackTimelineStart(context);
  assert.equal(harness.descriptionDraftValue(), 'Unsaved draft', 'rollback restores the draft snapshot even after an intervening rerender clears it');
});

test('Timeline details Stop uses the edited active description from the strip', async () => {
  const now = Date.parse('2026-09-05T14:00:00Z');
  const active = { id: 'active', taskUrl: 'https://example.com/active', description: 'Old note', startedAt: new Date(now - 60_000).toISOString() };
  const state = { configured: true, active, pendingWrites: [] };
  const harness = dailyPanelHarness({ state, now, respond(message, callback) {
    if (message.type === 'STOP') callback({ ok: true, data: { entry: { ...active, id: 'completed', endedAt: new Date(now).toISOString() }, pending: true } });
    else callback({ ok: true, data: state });
  } });
  const menu = harness.renderMenu({ compact: true });
  const description = menu.querySelector('.strip-description');
  description.value = 'Edited note'; description.oninput();
  await harness.stopTimelineEntry(active);
  assert.equal(harness.messages.find(message => message.type === 'STOP').description, 'Edited note');
});

test('rejected completed and active edits restore the exact pre-enqueue optimistic state', async () => {
  const now = Date.parse('2026-09-05T14:00:00Z');
  const completed = { id: 'entry', taskUrl: 'https://example.com/work', entryDate: '2026-09-05', timezone: 'UTC', startedAt: '2026-09-05T12:00:00Z', endedAt: '2026-09-05T13:00:00Z', _path: 'times/entry.jsonl', _sha: 'sha', _index: 0 };
  const active = { id: 'active', taskUrl: 'https://example.com/active', startedAt: '2026-09-05T13:30:00Z' };
  const harness = dailyPanelHarness({ state: { configured: true, active, pendingWrites: [] }, records: [completed], now, respond(message, callback) {
    if (['QUEUE_ENTRY_EDIT', 'QUEUE_ACTIVE_START_EDIT'].includes(message.type)) callback({ ok: false, error: { message: 'Local enqueue failed' } });
    else callback({ ok: true, data: {} });
  } });

  await assert.rejects(harness.queueCalendarEntry(completed, { startedAt: '2026-09-05T12:15:00Z' }), /Local enqueue failed/);
  assert.equal(harness.optimisticEdit('entry'), undefined);
  assert.equal(harness.recentEntry('entry').startedAt, completed.startedAt);

  await assert.rejects(harness.queueActiveStartEdit(active, '2026-09-05T13:45:00Z'), /Local enqueue failed/);
  assert.equal(harness.optimisticEdit('active'), undefined);
});

test('timeline items keep saving state through optimistic edits and pending GitHub writes', async () => {
  const now = Date.parse('2026-09-05T14:00:00Z');
  const entry = { id: 'entry', taskUrl: 'https://example.com/work', entryDate: '2026-09-05', timezone: 'UTC', startedAt: '2026-09-05T12:00:00Z', endedAt: '2026-09-05T13:00:00Z', _path: 'times/entry.jsonl', _sha: 'sha', _index: 0 };
  let state = { configured: true, active: null, pendingWrites: [] };
  const harness = dailyPanelHarness({ state, records: [entry], now, respond(message, callback) {
    if (message.type === 'QUEUE_ENTRY_EDIT') {
      state = { ...state, pendingCount: 1, pendingWrites: [{ id: 'edit-op', status: 'pending', operation: 'editEntry' }] };
      callback({ ok: true, data: { operationId: 'edit-op' } });
    }
    else callback({ ok: true, data: state });
  } });
  const item = () => harness.timelineItems(0, now).find(value => value.id === 'entry:entry');
  assert.equal(item().isPending, false);
  await harness.queueCalendarEntry(entry, { startedAt: '2026-09-05T12:05:00Z' });
  assert.equal(item().isPending, true, 'accepted edit remains marked while its GitHub operation is outstanding');
  harness.set({ ...state, pendingCount: 1, pendingWrites: [{ id: 'edit-op', status: 'pending', operation: 'editEntry' }] }, [{ ...entry, _pending: true }]);
  assert.equal(item().isPending, true, 'server-projected pending state remains visible');
  harness.applyPageState({ ...state, pendingCount: 0, pendingWrites: [], recent: [entry] });
  assert.equal(item().isPending, false, 'confirmed save removes entry-level feedback');
});

test('a rejected replacement edit preserves an earlier accepted optimistic edit', async () => {
  const now = Date.parse('2026-09-05T14:00:00Z');
  const completed = { id: 'entry', taskUrl: 'https://example.com/work', entryDate: '2026-09-05', timezone: 'UTC', startedAt: '2026-09-05T12:00:00Z', endedAt: '2026-09-05T13:00:00Z', _path: 'times/entry.jsonl', _sha: 'sha', _index: 0 };
  const active = { id: 'active', taskUrl: 'https://example.com/active', startedAt: '2026-09-05T13:30:00Z' };
  let completedAttempts = 0, activeAttempts = 0;
  const harness = dailyPanelHarness({ state: { configured: true, active, pendingWrites: [] }, records: [completed], now, respond(message, callback) {
    if (message.type === 'QUEUE_ENTRY_EDIT') {
      completedAttempts += 1;
      callback(completedAttempts === 1 ? { ok: true, data: {} } : { ok: false, error: { message: 'Replacement rejected' } });
    } else if (message.type === 'QUEUE_ACTIVE_START_EDIT') {
      activeAttempts += 1;
      callback(activeAttempts === 1 ? { ok: true, data: {} } : { ok: false, error: { message: 'Replacement rejected' } });
    } else callback({ ok: true, data: {} });
  } });

  const firstCompleted = { startedAt: '2026-09-05T12:05:00Z' };
  await harness.queueCalendarEntry(completed, firstCompleted);
  await assert.rejects(harness.queueCalendarEntry(harness.recentEntry('entry'), { startedAt: '2026-09-05T12:15:00Z' }), /Replacement rejected/);
  assert.deepEqual(harness.optimisticEdit('entry'), firstCompleted);
  assert.equal(harness.recentEntry('entry').startedAt, firstCompleted.startedAt);

  await harness.queueActiveStartEdit(active, '2026-09-05T13:35:00Z');
  await assert.rejects(harness.queueActiveStartEdit(active, '2026-09-05T13:45:00Z'), /Replacement rejected/);
  assert.equal(harness.optimisticEdit('active').startedAt, '2026-09-05T13:35:00.000Z');
});

test('a late rejection cannot roll back a newer concurrently accepted edit', async () => {
  const now = Date.parse('2026-09-05T14:00:00Z');
  const completed = { id: 'entry', taskUrl: 'https://example.com/work', entryDate: '2026-09-05', timezone: 'UTC', startedAt: '2026-09-05T12:00:00Z', endedAt: '2026-09-05T13:00:00Z', _path: 'times/entry.jsonl', _sha: 'sha', _index: 0 };
  const active = { id: 'active', taskUrl: 'https://example.com/active', startedAt: '2026-09-05T13:30:00Z' };
  const pending = { completed: [], active: [] };
  const harness = dailyPanelHarness({ state: { configured: true, active, pendingWrites: [] }, records: [completed], now, respond(message, callback) {
    if (message.type === 'QUEUE_ENTRY_EDIT') pending.completed.push(callback);
    else if (message.type === 'QUEUE_ACTIVE_START_EDIT') pending.active.push(callback);
    else callback({ ok: true, data: {} });
  } });

  const firstCompleted = harness.queueCalendarEntry(completed, { startedAt: '2026-09-05T12:05:00Z' });
  const secondCompleted = harness.queueCalendarEntry(harness.recentEntry('entry'), { startedAt: '2026-09-05T12:15:00Z' });
  pending.completed[1]({ ok: true, data: {} }); await secondCompleted;
  pending.completed[0]({ ok: false, error: { message: 'Older edit rejected late' } }); await assert.rejects(firstCompleted, /Older edit rejected late/);
  assert.equal(harness.optimisticEdit('entry').startedAt, '2026-09-05T12:15:00Z');
  assert.equal(harness.recentEntry('entry').startedAt, '2026-09-05T12:15:00Z');

  const firstActive = harness.queueActiveStartEdit(active, '2026-09-05T13:35:00Z');
  const secondActive = harness.queueActiveStartEdit(active, '2026-09-05T13:45:00Z');
  pending.active[1]({ ok: true, data: {} }); await secondActive;
  pending.active[0]({ ok: false, error: { message: 'Older edit rejected late' } }); await assert.rejects(firstActive, /Older edit rejected late/);
  assert.equal(harness.optimisticEdit('active').startedAt, '2026-09-05T13:45:00.000Z');
});

test('two concurrent rejections unwind past an already-rejected predecessor', async () => {
  const now = Date.parse('2026-09-05T14:00:00Z');
  const completed = { id: 'entry', taskUrl: 'https://example.com/work', entryDate: '2026-09-05', timezone: 'UTC', startedAt: '2026-09-05T12:00:00Z', endedAt: '2026-09-05T13:00:00Z', _path: 'times/entry.jsonl', _sha: 'sha', _index: 0 };
  const active = { id: 'active', taskUrl: 'https://example.com/active', startedAt: '2026-09-05T13:30:00Z' };
  const pending = { completed: [], active: [] };
  const harness = dailyPanelHarness({ state: { configured: true, active, pendingWrites: [] }, records: [completed], now, respond(message, callback) {
    if (message.type === 'QUEUE_ENTRY_EDIT') pending.completed.push(callback);
    else if (message.type === 'QUEUE_ACTIVE_START_EDIT') pending.active.push(callback);
    else callback({ ok: true, data: {} });
  } });

  const firstCompleted = harness.queueCalendarEntry(completed, { startedAt: '2026-09-05T12:05:00Z' });
  const secondCompleted = harness.queueCalendarEntry(harness.recentEntry('entry'), { startedAt: '2026-09-05T12:15:00Z' });
  const firstCompletedRejected = assert.rejects(firstCompleted, /First rejected/);
  pending.completed[0]({ ok: false, error: { message: 'First rejected' } }); await firstCompletedRejected;
  const secondCompletedRejected = assert.rejects(secondCompleted, /Second rejected/);
  pending.completed[1]({ ok: false, error: { message: 'Second rejected' } }); await secondCompletedRejected;
  assert.equal(harness.optimisticEdit('entry'), undefined);
  assert.equal(harness.recentEntry('entry').startedAt, completed.startedAt);

  const firstActive = harness.queueActiveStartEdit(active, '2026-09-05T13:35:00Z');
  const secondActive = harness.queueActiveStartEdit(active, '2026-09-05T13:45:00Z');
  const firstActiveRejected = assert.rejects(firstActive, /First rejected/);
  pending.active[0]({ ok: false, error: { message: 'First rejected' } }); await firstActiveRejected;
  const secondActiveRejected = assert.rejects(secondActive, /Second rejected/);
  pending.active[1]({ ok: false, error: { message: 'Second rejected' } }); await secondActiveRejected;
  assert.equal(harness.optimisticEdit('active'), undefined);
});

test('concurrent rejections also unwind when the newer edit rejects first', async () => {
  const now = Date.parse('2026-09-05T14:00:00Z');
  const completed = { id: 'entry', taskUrl: 'https://example.com/work', entryDate: '2026-09-05', timezone: 'UTC', startedAt: '2026-09-05T12:00:00Z', endedAt: '2026-09-05T13:00:00Z', _path: 'times/entry.jsonl', _sha: 'sha', _index: 0 };
  const active = { id: 'active', taskUrl: 'https://example.com/active', startedAt: '2026-09-05T13:30:00Z' };
  const pending = { completed: [], active: [] };
  const harness = dailyPanelHarness({ state: { configured: true, active, pendingWrites: [] }, records: [completed], now, respond(message, callback) {
    if (message.type === 'QUEUE_ENTRY_EDIT') pending.completed.push(callback);
    else if (message.type === 'QUEUE_ACTIVE_START_EDIT') pending.active.push(callback);
    else callback({ ok: true, data: {} });
  } });

  const firstCompleted = harness.queueCalendarEntry(completed, { startedAt: '2026-09-05T12:05:00Z' });
  const secondCompleted = harness.queueCalendarEntry(harness.recentEntry('entry'), { startedAt: '2026-09-05T12:15:00Z' });
  const secondCompletedRejected = assert.rejects(secondCompleted, /Second rejected/);
  pending.completed[1]({ ok: false, error: { message: 'Second rejected' } }); await secondCompletedRejected;
  const firstCompletedRejected = assert.rejects(firstCompleted, /First rejected/);
  pending.completed[0]({ ok: false, error: { message: 'First rejected' } }); await firstCompletedRejected;
  assert.equal(harness.optimisticEdit('entry'), undefined);
  assert.equal(harness.recentEntry('entry').startedAt, completed.startedAt);

  const firstActive = harness.queueActiveStartEdit(active, '2026-09-05T13:35:00Z');
  const secondActive = harness.queueActiveStartEdit(active, '2026-09-05T13:45:00Z');
  const secondActiveRejected = assert.rejects(secondActive, /Second rejected/);
  pending.active[1]({ ok: false, error: { message: 'Second rejected' } }); await secondActiveRejected;
  const firstActiveRejected = assert.rejects(firstActive, /First rejected/);
  pending.active[0]({ ok: false, error: { message: 'First rejected' } }); await firstActiveRejected;
  assert.equal(harness.optimisticEdit('active'), undefined);
});

test('a rejected successor restores a reconciled predecessor without reviving optimistic state', async () => {
  const now = Date.parse('2026-09-05T14:00:00Z');
  const completed = { id: 'entry', taskUrl: 'https://example.com/work', entryDate: '2026-09-05', timezone: 'UTC', startedAt: '2026-09-05T12:00:00Z', endedAt: '2026-09-05T13:00:00Z', _path: 'times/entry.jsonl', _sha: 'sha', _index: 0 };
  const active = { id: 'active', taskUrl: 'https://example.com/active', startedAt: '2026-09-05T13:30:00Z' };
  const pending = { completed: null, active: null };
  let completedCalls = 0, activeCalls = 0;
  const harness = dailyPanelHarness({ state: { configured: true, active, pendingWrites: [] }, records: [completed], now, respond(message, callback) {
    if (message.type === 'QUEUE_ENTRY_EDIT') {
      completedCalls += 1;
      if (completedCalls === 1) callback({ ok: true, data: { operationId: 'entry-a' } });
      else pending.completed = callback;
    } else if (message.type === 'QUEUE_ACTIVE_START_EDIT') {
      activeCalls += 1;
      if (activeCalls === 1) callback({ ok: true, data: { operationId: 'active-a' } });
      else pending.active = callback;
    } else callback({ ok: true, data: { configured: true, active, pendingWrites: [{ id: 'entry-a' }, { id: 'active-a' }] } });
  } });

  await harness.queueCalendarEntry(completed, { startedAt: '2026-09-05T12:05:00Z' });
  const secondCompleted = harness.queueCalendarEntry(harness.recentEntry('entry'), { startedAt: '2026-09-05T12:15:00Z' });
  harness.applyPageState({ configured: true, active, pendingWrites: [] });
  const secondCompletedRejected = assert.rejects(secondCompleted, /Successor rejected/);
  pending.completed({ ok: false, error: { message: 'Successor rejected' } }); await secondCompletedRejected;
  assert.equal(harness.optimisticEdit('entry'), undefined);
  assert.equal(harness.recentEntry('entry').startedAt, '2026-09-05T12:05:00Z');

  await harness.queueActiveStartEdit(active, '2026-09-05T13:35:00Z');
  const secondActive = harness.queueActiveStartEdit(active, '2026-09-05T13:45:00Z');
  harness.applyPageState({ configured: true, active, pendingWrites: [] });
  const secondActiveRejected = assert.rejects(secondActive, /Successor rejected/);
  pending.active({ ok: false, error: { message: 'Successor rejected' } }); await secondActiveRejected;
  assert.equal(harness.optimisticEdit('active'), undefined);
});

test('completion of an older operation cannot clear a newer optimistic generation', async () => {
  const now = Date.parse('2026-09-05T14:00:00Z');
  const completed = { id: 'entry', taskUrl: 'https://example.com/work', entryDate: '2026-09-05', timezone: 'UTC', startedAt: '2026-09-05T12:00:00Z', endedAt: '2026-09-05T13:00:00Z', _path: 'times/entry.jsonl', _sha: 'sha', _index: 0 };
  const active = { id: 'active', taskUrl: 'https://example.com/active', startedAt: '2026-09-05T13:30:00Z' };
  let completedCalls = 0, activeCalls = 0;
  const allPending = [{ id: 'entry-a' }, { id: 'entry-b' }, { id: 'active-a' }, { id: 'active-b' }];
  const harness = dailyPanelHarness({ state: { configured: true, active, pendingWrites: allPending }, records: [completed], now, respond(message, callback) {
    if (message.type === 'QUEUE_ENTRY_EDIT') callback({ ok: true, data: { operationId: `entry-${++completedCalls === 1 ? 'a' : 'b'}` } });
    else if (message.type === 'QUEUE_ACTIVE_START_EDIT') callback({ ok: true, data: { operationId: `active-${++activeCalls === 1 ? 'a' : 'b'}` } });
    else callback({ ok: true, data: { configured: true, active, pendingWrites: allPending } });
  } });

  await harness.queueCalendarEntry(completed, { startedAt: '2026-09-05T12:05:00Z' });
  await harness.queueCalendarEntry(harness.recentEntry('entry'), { startedAt: '2026-09-05T12:15:00Z' });
  await harness.queueActiveStartEdit(active, '2026-09-05T13:35:00Z');
  await harness.queueActiveStartEdit(active, '2026-09-05T13:45:00Z');

  harness.applyPageState({ configured: true, active, pendingWrites: [{ id: 'entry-b' }, { id: 'active-b' }] });
  assert.equal(harness.optimisticEdit('entry').startedAt, '2026-09-05T12:15:00Z');
  assert.equal(harness.optimisticEdit('active').startedAt, '2026-09-05T13:45:00.000Z');
  harness.applyPageState({ configured: true, active, pendingWrites: [] });
  assert.equal(harness.optimisticEdit('entry'), undefined);
  assert.equal(harness.optimisticEdit('active'), undefined);
});

test('reverse responses sharing one compacted operation reconcile the newest generation', async () => {
  const now = Date.parse('2026-09-05T14:00:00Z');
  const completed = { id: 'entry', taskUrl: 'https://example.com/work', entryDate: '2026-09-05', timezone: 'UTC', startedAt: '2026-09-05T12:00:00Z', endedAt: '2026-09-05T13:00:00Z', _path: 'times/entry.jsonl', _sha: 'sha', _index: 0 };
  const active = { id: 'active', taskUrl: 'https://example.com/active', startedAt: '2026-09-05T13:30:00Z' };
  const callbacks = { completed: [], active: [] };
  const harness = dailyPanelHarness({ state: { configured: true, active, pendingWrites: [] }, records: [completed], now, respond(message, callback) {
    if (message.type === 'QUEUE_ENTRY_EDIT') callbacks.completed.push(callback);
    else if (message.type === 'QUEUE_ACTIVE_START_EDIT') callbacks.active.push(callback);
    else callback({ ok: true, data: { configured: true, active, pendingWrites: [{ id: 'shared-entry' }, { id: 'shared-active' }] } });
  } });

  const firstCompleted = harness.queueCalendarEntry(completed, { startedAt: '2026-09-05T12:05:00Z' });
  const secondCompleted = harness.queueCalendarEntry(harness.recentEntry('entry'), { startedAt: '2026-09-05T12:15:00Z' });
  callbacks.completed[1]({ ok: true, data: { operationId: 'shared-entry' } }); await secondCompleted;
  callbacks.completed[0]({ ok: true, data: { operationId: 'shared-entry' } }); await firstCompleted;
  harness.applyPageState({ configured: true, active, pendingWrites: [{ id: 'shared-entry' }] });
  assert.equal(harness.optimisticEdit('entry').startedAt, '2026-09-05T12:15:00Z');
  harness.applyPageState({ configured: true, active, pendingWrites: [] });
  assert.equal(harness.optimisticEdit('entry'), undefined);

  const firstActive = harness.queueActiveStartEdit(active, '2026-09-05T13:35:00Z');
  const secondActive = harness.queueActiveStartEdit({ ...active, startedAt: '2026-09-05T13:35:00.000Z' }, '2026-09-05T13:45:00Z');
  callbacks.active[1]({ ok: true, data: { operationId: 'shared-active' } }); await secondActive;
  callbacks.active[0]({ ok: true, data: { operationId: 'shared-active' } }); await firstActive;
  harness.applyPageState({ configured: true, active, pendingWrites: [{ id: 'shared-active' }] });
  assert.equal(harness.optimisticEdit('active').startedAt, '2026-09-05T13:45:00.000Z');
  harness.applyPageState({ configured: true, active, pendingWrites: [] });
  assert.equal(harness.optimisticEdit('active'), undefined);
});

test('unknown configuration renders Loading and complete route totals include running participants', () => {
  const harness = dailyPanelHarness();
  const loading = harness.renderMenu({ compact: true }).walk();
  assert.ok(loading.some(node => node.textContent === 'Loading…'));
  assert.ok(!loading.some(node => /Configure a private/.test(node.textContent)));
  harness.set({ configured: true, active: null, pendingWrites: [] }, [], { complete: true, taskUrl: 'https://github.com/acme/app/issues/7', participants: [{ totalSeconds: 3600 }] });
  assert.ok(harness.renderMenu({ compact: false }).walk().some(node => node.textContent === 'Tracked on this issue/PR: 1h 0m'));
  harness.set({ configured: true, active: null, pendingWrites: [] }, [], { complete: false, taskUrl: 'https://github.com/acme/app/issues/7', participants: [] });
  assert.ok(!harness.renderMenu({ compact: false }).walk().some(node => /Tracked on this/.test(node.textContent)));
});

test('all strip, header, and shared block Stop and switch paths can cancel a long entry without a mutation', async () => {
  const now = Date.now(), active = { id: 'active', taskUrl: 'https://example.com/active', taskTitle: 'Active task', startedAt: new Date(now - 13 * 3600000).toISOString() };
  const harness = dailyPanelHarness({ state: { configured: true, active, pendingWrites: [] }, confirmResult: false, now });
  for (const compact of [true, false]) {
    const nodes = harness.renderMenu({ compact }).walk();
    for (const label of ['Stop and save', compact ? 'Switch to this task' : 'Save and switch to this task']) {
      await nodes.find(node => node.textContent === label).onclick({ isTrusted: true });
    }
  }
  await harness.restartTimelineEntry({ id: 'other', taskUrl: 'https://example.com/other' });
  await harness.stopTimelineEntry(active);
  assert.equal(harness.confirmations.length, 6);
  assert.ok(harness.confirmations.every(text => text === 'This entry is 13 hours long. Save anyway?'));
  assert.equal(harness.messages.filter(message => ['STOP', 'START', 'SWITCH_TASK'].includes(message.type)).length, 0);
});

test('passive state reconciliation never replaces a focused List editor', () => {
  const now = new Date('2026-10-13T12:00:00.000Z').getTime();
  const original = activityEntry('1', '2026-10-13', '08');
  const state = { configured: true, active: null, pendingWrites: [], pendingCount: 0 };
  const harness = dailyPanelHarness({ state, records: [original], now });
  const menu = harness.renderMenu({ compact: true });
  harness.attach(menu);
  const input = harness.document.createElement('input');
  input.matches = selector => selector === 'input,textarea';
  menu.querySelector('.today-list').append(input);
  input.focus();
  harness.set(state, [{ ...original, description: 'Remote change', _sha: 'remote-sha' }]);
  harness.refreshCompactSurface();
  assert.ok(menu.querySelector('.today-list').contains(input), 'a focused List editor remains mounted');
  assert.equal(harness.document.activeElement, input);

  harness.document.panelShadow.activeElement = null;
  harness.refreshCompactSurface();
  assert.ok(!menu.querySelector('.today-list').contains(input), 'a later safe refresh can rebuild the list');
});

test('mounted panel refresh updates controls, errors, totals and now while preserving editor, scroll and focus', () => {
  const now = new Date(2026, 8, 5, 14).getTime(), date = new Date(now), today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const state = { configured: true, active: null, pendingWrites: [], recent: [], todayTrackedMs: null, weekTrackedMs: null };
  const harness = dailyPanelHarness({ state, now });
  harness.applyPageState(state);
  const menu = harness.renderMenu({ compact: true }); harness.attach(menu);
  const updates = [], editor = { update: props => updates.push(props) }; harness.mount(editor);
  const marker = harness.document.createElement('button'); marker.setAttribute('data-item-id', 'focused'); menu.append(marker); marker.focus(); menu.scrollTop = 125;
  const active = { id: 'active', taskUrl: 'https://example.com/active', taskTitle: 'Running task', entryDate: today, timezone: 'UTC', startedAt: new Date(now - 60000).toISOString() };
  harness.applyPageState({ ...state, active, todayTrackedMs: 60000, weekTrackedMs: 3600000, summaryError: { code: 'error', message: 'Network unavailable' } });
  harness.advance(60000); harness.refreshMountedTimeline();
  assert.equal(updates.length, 1); assert.equal(updates[0].now, now + 60000);
  assert.ok(updates[0].items.some(item => item.id === 'active:active'));
  assert.equal(harness.document.activeElement, marker); assert.equal(menu.scrollTop, 125);
  assert.ok(menu.walk().some(node => node.textContent === 'Stop and save'));
  assert.ok(menu.walk().some(node => node.textContent === "Couldn't reach GitHub"));
  assert.ok(menu.walk().some(node => node.textContent === 'Network unavailable'));
  assert.ok(menu.walk().filter(node => node.getAttribute?.('data-tracked-total')).every(node => node.textContent === '…'));
  harness.applyPageState({ ...state, active, todayTrackedMs: 120000, weekTrackedMs: 3660000 }); harness.refreshMountedTimeline();
  assert.ok(!menu.walk().some(node => node.textContent === 'Network unavailable'));
  const description = menu.querySelector('.strip-description');
  description.value = 'Draft that keeps focus'; description.oninput(); description.focus();
  const saveDescription = menu.walk().find(node => node.getAttribute?.('aria-label') === 'Save description' && node.className === 'save-check');
  assert.equal(saveDescription.hidden, false);
  for (let index = 0; index < 3; index += 1) {
    harness.advance(1000);
    harness.applyPageState({ ...state, active, todayTrackedMs: 120000 + index * 1000, weekTrackedMs: 3660000 + index * 1000 });
    harness.refreshMountedTimeline();
    assert.equal(menu.querySelector('.strip-description'), description, 'refresh keeps the active description input mounted');
    assert.equal(harness.document.activeElement, description, 'refresh keeps description focus');
    assert.equal(description.value, 'Draft that keeps focus');
  }
  const stop = menu.walk().find(node => node.textContent === 'Stop and save'); stop.focus();
  harness.refreshMountedTimeline();
  assert.equal(harness.document.activeElement.getAttribute('data-panel-action'), 'stop');
  harness.advance(60000); harness.updatePanelClocks();
  assert.equal(menu.querySelector('[data-tracked-total="todayTrackedMs"]').textContent, '3m');
  assert.equal(menu.querySelector('[data-tracked-total="weekTrackedMs"]').textContent, '1h 2m');
});

test('visible overlap flags produce one named warning and open Activity without a mutation', async () => {
  const harness = dailyPanelHarness({ state: { configured: true, active: null, pendingWrites: [] } });
  const menu = harness.renderMenu({ compact: true }), host = harness.document.createElement('div');
  const records = ['First', 'Second'].map((title, index) => [`entry:${index}`, { taskTitle: title, taskUrl: `https://example.com/${index}`, timezone: 'UTC', startedAt: '2026-09-05T08:00:00Z', endedAt: '2026-09-05T09:00:00Z' }]);
  for (const [id] of records) { const block = harness.document.createElement('div'); block.setAttribute('data-overlap', 'true'); block.setAttribute('data-item-id', id); host.append(block); }
  harness.overlapHost(host, records); harness.refreshTimelineOverlaps();
  const warnings = menu.querySelectorAll('.overlap-warning'); assert.equal(warnings.length, 1);
  assert.match(warnings[0].children[0].textContent, /First \(.*\).*Second \(.*\)/);
  const link = warnings[0].querySelector('a'); assert.equal(link.textContent, 'Fix in Activity');
  await link.onclick({ isTrusted: true, preventDefault() {} });
  assert.equal(harness.messages.at(-1).type, 'OPEN_TIMES');
  host.replaceChildren(); harness.refreshTimelineOverlaps();
  assert.equal(menu.querySelectorAll('.overlap-warning').length, 0);
});

test('local refresh removes optimistic pending styling after the completed record is confirmed by GitHub', async () => {
  const now = Date.now(), active = { id: 'active', taskUrl: 'https://example.com/active', startedAt: new Date(now - 60000).toISOString() };
  const entry = { ...active, endedAt: new Date(now).toISOString(), entryDate: '2026-09-05', timezone: 'UTC', _path: 'times/2026-09/alice.jsonl' };
  const harness = dailyPanelHarness({ state: { configured: true, active, pendingWrites: [], entry, pending: true }, now });
  await harness.stopTimelineEntry(active);
  harness.applyPageState({ configured: true, active: null, recent: [{ ...entry, _sha: 'confirmed', _pending: false }], pendingWrites: [] });
  const updates = []; harness.mount({ update: props => updates.push(props) }); harness.refreshMountedTimeline();
  assert.equal(updates[0].items.length, 1);
  assert.equal(updates[0].items[0].isPending, false);
});

test('ordinary refresh keeps a just-started zero-duration running item visible at the worker timestamp', () => {
  const now = Date.now(), state = { configured: true, active: { id: 'just-started', taskUrl: 'https://example.com/active', startedAt: new Date(now).toISOString() }, pendingWrites: [] };
  const harness = dailyPanelHarness({ state, now }), updates = [];
  harness.mount({ update: props => updates.push(props) }); harness.refreshMountedTimeline();
  assert.equal(updates[0].now, now);
  assert.equal(updates[0].items[0].id, 'active:just-started');
});

test('delayed Start acceptance preserves manual timeline scroll and does not scroll right twice', async () => {
  const now = Date.now();
  const initial = { configured: true, active: null, pendingWrites: [], recent: [] };
  const workerActive = {
    id: 'worker-active',
    taskUrl: 'https://github.com/acme/app/issues/7',
    taskTitle: 'Issue 7',
    startedAt: new Date(now).toISOString(),
  };
  let startCallback = null;
  const harness = dailyPanelHarness({ state: initial, now, respond(message, callback) {
    if (message.type === 'START') { startCallback = callback; return; }
    callback({ ok: true, data: message.type === 'GET_PAGE_STATE' ? { ...initial, active: workerActive } : {} });
  } });
  const editor = {
    scrollLeft: 0,
    scrollToEndCalls: 0,
    update() {},
    scrollToEnd() { this.scrollToEndCalls += 1; this.scrollLeft = 1000; },
  };
  harness.mount(editor, { start: now - 86_400_000, end: now, focusedAt: now });

  const start = harness.trackCurrentTimelineTask();
  assert.equal(typeof startCallback, 'function', 'worker response is deferred after optimistic rendering');
  assert.equal(editor.scrollToEndCalls, 1);
  editor.scrollLeft = 321;
  startCallback({ ok: true, data: workerActive });
  await start;
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(editor.scrollLeft, 321, 'worker acceptance and reconciliation preserve manual scroll');
  assert.equal(editor.scrollToEndCalls, 1, 'only the optimistic transition scrolls to the right edge');
});

test('opening focuses the primary strip action after local state and closing restores previous focus', async () => {
  const state = { configured: true, active: null, recent: [], pendingWrites: [] };
  const harness = dailyPanelHarness({ state, pageUrl: 'https://example.com/task' });
  const previous = harness.document.createElement('input'); harness.document.body.append(previous); previous.focus();
  await harness.toggleFullWidthPopup();
  while (harness.frames.length) harness.frames.shift()();
  assert.equal(harness.messages[0].type, 'GET_PAGE_STATE'); assert.equal(harness.messages[0].refresh, false);
  assert.equal(harness.messages[1].type, 'GET_PAGE_STATE'); assert.equal(harness.messages[1].refresh, true);
  assert.equal(harness.document.activeElement.textContent, 'Track this task');
  const menu = harness.popupRoot();
  assert.equal(menu.querySelectorAll('.page-tracking-hint').length, 0);
  harness.refreshMountedTimeline(); harness.refreshMountedTimeline();
  assert.equal(menu.querySelectorAll('.page-tracking-hint').length, 0);
  harness.closeFullWidthPopup();
  assert.equal(harness.document.activeElement, previous);
});

test('clicking the GitHub page closes the full-width panel but clicking inside it does not', async () => {
  const h = dailyPanelHarness({ header: true, state: { configured: true, active: null, recent: [], pendingWrites: [] } });
  await new Promise(resolve => setTimeout(resolve, 0));
  const trigger = h.document.panelShadow.querySelector('.trigger-main');
  await trigger.onclick({ isTrusted: true });
  const popup = h.document.getElementById('clockoli-full-width-popup-root');
  assert.ok(popup);
  h.documentListeners.get('click')({ composedPath: () => [popup, h.document.body] });
  assert.equal(h.document.getElementById('clockoli-full-width-popup-root'), popup);
  h.documentListeners.get('click')({ composedPath: () => [trigger, h.document.getElementById('clockoli-root'), h.document.body] });
  assert.equal(h.document.getElementById('clockoli-full-width-popup-root'), popup, 'the launcher click must not immediately dismiss the panel');
  const pageInput = h.document.createElement('input'); h.document.body.append(pageInput); pageInput.focus();
  h.documentListeners.get('click')({ composedPath: () => [h.document.body] });
  assert.equal(h.document.getElementById('clockoli-full-width-popup-root'), null);
  assert.equal(h.document.activeElement, pageInput, 'clicking elsewhere must not return focus to the launcher');
});

test('switching tabs dismisses the GitHub panel without restoring focus; returning requires a fresh open', async () => {
  const h = dailyPanelHarness({ header: true, state: { configured: true, active: null, recent: [], pendingWrites: [] } });
  await new Promise(resolve => setTimeout(resolve, 0));
  const launcherShadow = h.document.panelShadow;
  await launcherShadow.querySelector('.trigger-main').onclick({ isTrusted: true });
  assert.ok(h.document.getElementById('clockoli-full-width-popup-root'));
  const focused = h.document.activeElement;

  h.document.hidden = true;
  h.documentListeners.get('visibilitychange')();
  assert.equal(h.document.getElementById('clockoli-full-width-popup-root'), null);
  assert.equal(h.document.activeElement, focused, 'tab switch must not focus a hidden tab');
  h.document.hidden = false;
  h.documentListeners.get('visibilitychange')();
  assert.equal(h.document.getElementById('clockoli-full-width-popup-root'), null);

  const readsBeforeReopen = h.messages.filter(message => message.type === 'GET_PAGE_STATE').length;
  await launcherShadow.querySelector('.trigger-main').onclick({ isTrusted: true });
  assert.ok(h.document.getElementById('clockoli-full-width-popup-root'));
  assert.ok(h.messages.filter(message => message.type === 'GET_PAGE_STATE').length > readsBeforeReopen);
});

test('switching tabs dismisses the injected toolbar panel on other HTTP(S) pages', async () => {
  const h = dailyPanelHarness({ header: true, actionSurface: true, pageUrl: 'https://example.com/task', state: { configured: true, active: null, recent: [], pendingWrites: [] } });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(h.document.getElementById('clockoli-full-width-popup-root'));
  h.document.hidden = true;
  h.documentListeners.get('visibilitychange')();
  assert.equal(h.document.getElementById('clockoli-full-width-popup-root'), null);
});

test('losing window focus dismisses an open panel even while the document remains visible', async () => {
  for (const actionSurface of [false, true]) {
    const h = dailyPanelHarness({ header: true, actionSurface, state: { configured: true, active: null, recent: [], pendingWrites: [] } });
    await new Promise(resolve => setTimeout(resolve, 0));
    if (!actionSurface) await h.document.panelShadow.querySelector('.trigger-main').onclick({ isTrusted: true });
    assert.ok(h.document.getElementById('clockoli-full-width-popup-root'));
    h.document.hidden = false;
    const focused = h.document.activeElement;
    assert.equal(typeof h.windowListeners.get('blur'), 'function');
    h.windowListeners.get('blur')();
    assert.equal(h.document.getElementById('clockoli-full-width-popup-root'), null);
    assert.equal(h.document.activeElement, focused);
  }
});

test('background tab-activation message dismisses an open panel with no visibility or blur event', async () => {
  for (const actionSurface of [false, true]) {
    const h = dailyPanelHarness({ header: true, actionSurface, state: { configured: true, active: null, recent: [], pendingWrites: [] } });
    await new Promise(resolve => setTimeout(resolve, 0));
    if (!actionSurface) await h.document.panelShadow.querySelector('.trigger-main').onclick({ isTrusted: true });
    assert.ok(h.document.getElementById('clockoli-full-width-popup-root'));
    h.runtimeListeners[0]({ type: 'DISMISS_FULL_WIDTH_POPUP' }, {}, () => {});
    assert.equal(h.document.getElementById('clockoli-full-width-popup-root'), null);
  }
});

test('daily panel shows pending operations without a visible entry but avoids duplicate entry status', async () => {
  const harness = dailyPanelHarness({ state: { configured: true, active: null, showQueueDiagnostics: true, pendingWrites: [{ id: 'queued', status: 'pending', operation: 'completeTimer' }], pendingCount: 1 } });
  let menu = harness.renderMenu({ compact: true });
  assert.equal(menu.querySelector('.timeline-queue-spinner'), null);
  assert.equal(menu.walk().find(node => node.classList.contains('timeline-queue-status')).textContent, 'Saving…');
  assert.equal(menu.querySelector('.queue-diagnostics').open, false);
  harness.set({ configured: true, active: null, pendingWrites: [{ id: 'deleted', status: 'pending', operation: 'deleteEntry' }], pendingCount: 1 }, []);
  menu = harness.renderMenu({ compact: true });
  assert.equal(menu.walk().find(node => node.classList.contains('timeline-queue-status')).textContent, 'Saving…', 'a deleted block cannot show an entry badge');
  harness.set({ configured: true, active: null, showQueueDiagnostics: true, pendingWrites: [{ id: 'queued', status: 'conflict', conflictReason: 'completion_saved_newer_timer', stage: 'clearActive', operation: 'completeTimer' }], pendingCount: 1 }, []);
  menu = harness.renderMenu({ compact: true });
  assert.equal(menu.querySelector('.timeline-queue-spinner'), null);
  assert.equal(menu.querySelector('.queue-diagnostics').open, false);
  assert.ok(menu.walk().some(node => node.textContent === 'Keep newer timer'));
  harness.set({ configured: true, active: null, pendingWrites: [], remoteWriteConfirmed: true, summaryError: { code: 'error', message: 'Read failed', recovery: 'read-retry' } }, []);
  menu = harness.renderMenu({ compact: true });
  assert.equal(menu.querySelector('.timeline-queue-spinner'), null);
  assert.equal(menu.walk().find(node => node.classList.contains('timeline-queue-status')).hidden, true, 'an idle panel has no reserved status row');
  await menu.walk().find(node => node.textContent === 'Retry').onclick({ isTrusted: true });
  assert.deepEqual(harness.messages.filter(message => message.type !== 'LOAD_TASK_PARTICIPANTS').map(message => message.type), ['GET_PAGE_STATE', 'LOAD_RECENT']);
});

test('a pending entry suppresses duplicate status, but a simultaneous queued deletion keeps it visible', () => {
  const now = Date.now();
  const entry = { id: 'entry', taskUrl: 'https://example.com/work', timezone: 'UTC', startedAt: new Date(now - 2 * 60 * 60_000).toISOString(), endedAt: new Date(now - 60 * 60_000).toISOString(), _path: 'times/entry.jsonl', _sha: 'sha', _index: 0, _pending: true };
  const pending = { configured: true, active: null, pendingCount: 1, pendingWrites: [{ id: 'edit', operation: 'editEntry', status: 'pending' }] };
  const harness = dailyPanelHarness({ state: pending, records: [entry], now, timelineEnabled: true });
  const status = () => harness.renderMenu({ compact: true }).walk().find(node => node.classList.contains('timeline-queue-status'));
  assert.equal(status().hidden, true);
  harness.set({ ...pending, pendingCount: 2, pendingWrites: [...pending.pendingWrites, { id: 'delete', operation: 'deleteEntry', status: 'pending' }] }, [entry]);
  assert.equal(status().hidden, false);
  assert.equal(status().textContent, 'Saving…');
});


test('Calendar can delete a locally stopped timer before sync without losing its destination', async () => {
  const now = Date.parse('2026-09-05T12:00:00Z');
  const running = { id: 'pending-stop', taskUrl: 'https://example.com/task', taskTitle: 'Task',
    startedAt: '2026-09-05T10:00:00Z', entryDate: '2026-09-05', timezone: 'UTC',
    destinationId: 'github:2' };
  const stopped = { ...running, endedAt: '2026-09-05T12:00:00Z', durationSeconds: 7200,
    _path: 'times/2026-09/alice.jsonl', _sha: null, _index: -1, _pending: true };
  let current = { configured: true, active: running, pendingWrites: [], pendingCount: 0, recent: [] };
  const harness = dailyPanelHarness({
    state: current, now, timelineEnabled: true,
    pageUrl: 'chrome-extension://clockoli/src/times/times.html',
    respond(message, callback) {
      if (message.type === 'STOP') {
        current = { ...current, active: null, recent: [stopped], pendingWrites: [{ id: running.id, operation: 'completeTimer', status: 'pending' }], pendingCount: 1 };
        callback({ ok: true, data: { entry: stopped, destinationId: 'github:2', pending: true } });
      } else if (message.type === 'QUEUE_ENTRY_DELETE') {
        current = { ...current, recent: [], pendingWrites: [{ ...current.pendingWrites[0] }, { id: 'delete-op', operation: 'deleteEntry', status: 'pending' }], pendingCount: 2 };
        callback({ ok: true, data: { operationId: 'delete-op', pending: true } });
      } else callback({ ok: true, data: current });
    },
  });
  const menu = harness.renderMenu({ compact: true }); harness.attach(menu);
  while (harness.frames.length && !harness.timelineMounts.length) harness.frames.shift()();
  assert.equal(harness.timelineMounts.length, 1);
  assert.equal(await harness.timelineMounts[0].onStop({ id: 'active:pending-stop' }), true);
  const block = harness.timelineItems(0, now).find(item => item.id === 'entry:pending-stop');
  assert.ok(block, 'the locally stopped time remains visible before GitHub sync');
  assert.equal(block.isPending, true);
  assert.equal(block.isDeleteDisabled, false, 'the queued Stop can be deleted');
  assert.equal(await harness.timelineMounts[0].onDelete({ id: 'entry:pending-stop' }), true);
  const request = harness.messages.find(message => message.type === 'QUEUE_ENTRY_DELETE');
  assert.equal(request.payload.destinationId, 'github:2');
  assert.equal(request.payload.path, stopped._path);
  assert.equal(request.payload.original.id, running.id);
  assert.equal(request.payload.index, -1);
  assert.equal(harness.timelineItems(0, now).some(item => item.id === 'entry:pending-stop'), false);
  assert.equal(harness.optimisticCompletion(running.id), undefined);
});

test('Calendar restores a pending completion if its local Delete cannot be queued', async () => {
  const now = Date.parse('2026-09-05T12:00:00Z');
  const entry = { id: 'pending', taskUrl: 'https://example.com/task', taskTitle: 'Pending',
    destinationId: 'github:1', entryDate: '2026-09-05', timezone: 'UTC',
    startedAt: '2026-09-05T10:00:00Z', endedAt: '2026-09-05T11:00:00Z', durationSeconds: 3600,
    _path: 'times/2026-09/alice.jsonl', _sha: null, _index: -1, _pending: true };
  const harness = dailyPanelHarness({
    state: { configured: true, active: null, pendingWrites: [{ id: 'stop', operation: 'completeTimer', status: 'pending' }], pendingCount: 1 },
    records: [entry], now, timelineEnabled: true,
    respond(message, callback) {
      if (message.type === 'QUEUE_ENTRY_DELETE') callback({ ok: false, error: { message: 'Local delete rejected' } });
      else callback({ ok: true, data: { configured: true, active: null, recent: [entry], pendingWrites: [], pendingCount: 0 } });
    },
  });
  const menu = harness.renderMenu({ compact: true }); harness.attach(menu);
  while (harness.frames.length && !harness.timelineMounts.length) harness.frames.shift()();
  assert.equal(harness.timelineItems(0, now)[0].isDeleteDisabled, false);
  await assert.rejects(harness.timelineMounts[0].onDelete({ id: 'entry:pending' }), /Local delete rejected/);
  assert.ok(harness.timelineItems(0, now).some(item => item.id === 'entry:pending'));
  assert.equal(harness.messages.filter(message => message.type === 'QUEUE_ENTRY_DELETE').length, 1);
});

test('deleting a Timeline block keeps saving feedback visible through local queue acceptance', async () => {
  const now = Date.now();
  const entry = { id: 'entry', taskUrl: 'https://example.com/work', timezone: 'UTC', destinationId: 'github:1', startedAt: new Date(now - 2 * 60 * 60_000).toISOString(), endedAt: new Date(now - 60 * 60_000).toISOString(), _path: 'times/entry.jsonl', _sha: 'sha', _index: 0, durationSeconds: 3600 };
  const initial = { configured: true, active: null, pendingCount: 0, pendingWrites: [], remoteWriteConfirmed: true };
  const pending = { ...initial, pendingCount: 1, pendingWrites: [{ id: 'queued-delete', operation: 'deleteEntry', status: 'pending' }] };
  let current = initial;
  let acceptDelete;
  const harness = dailyPanelHarness({ state: initial, records: [entry], now, timelineEnabled: true, respond(message, callback) {
    if (message.type === 'QUEUE_ENTRY_DELETE') { acceptDelete = callback; return; }
    callback({ ok: true, data: current });
  } });
  const menu = harness.renderMenu({ compact: true });
  harness.attach(menu);
  while (harness.frames.length && !harness.timelineMounts.length) harness.frames.shift()();
  assert.equal(harness.timelineMounts.length, 1);
  const status = menu.querySelector('.timeline-queue-status');
  assert.equal(status.hidden, true);
  const deleting = harness.timelineMounts[0].onDelete({ id: 'entry:entry' });
  assert.equal(harness.confirmations.length, 1);
  assert.equal(harness.messages.filter(message => message.type === 'QUEUE_ENTRY_DELETE').length, 1);
  assert.equal(harness.timelineItems(0, now).some(item => item.id === 'entry:entry'), false);
  assert.equal(status.hidden, false);
  assert.equal(status.textContent, 'Saving…');
  current = pending;
  acceptDelete({ ok: true, data: { operationId: 'queued-delete' } });
  assert.equal(await deleting, true);
  assert.equal(status.hidden, false, 'accepted deletion stays visible until the queue drains');
  harness.applyPageState(pending);
  assert.equal(status.hidden, false);
  harness.applyPageState(initial);
  assert.equal(status.hidden, true);
});

test('queue diagnostics show request timing and final end-to-end sync time', () => {
  const queuedAt = new Date(2026, 8, 10, 23, 2, 30).toISOString();
  const initial = { configured: true, active: null, showQueueDiagnostics: true, pendingCount: 1, pendingWrites: [{ id: 'stop', operation: 'completeTimer', status: 'pending', stage: 'commitCompletion', queuedAt }] };
  const harness = dailyPanelHarness({ state: initial, now: new Date(2026, 8, 10, 23, 2, 31, 250).getTime() });
  harness.applyPageState({ ...initial, pendingWrites: [{ ...initial.pendingWrites[0], diagnostics: [
    { at: queuedAt, message: 'GitHub GET /repos/acme/time/git/ref/heads/main: 200 in 90ms.' },
    { at: queuedAt, message: 'GitHub PATCH /repos/acme/time/git/refs/heads/main: 200 in 180ms.' },
  ] }] });
  harness.applyPageState({ configured: true, active: null, showQueueDiagnostics: true, pendingCount: 0, pendingWrites: [] });
  const log = harness.renderMenu({ compact: true }).querySelector('.queue-diagnostics');
  const text = log.querySelectorAll('.queue-diagnostic-event').flatMap(row => row.children.map(child => child.textContent)).join(' ');
  assert.match(text, /GitHub GET \/repos\/acme\/time\/git\/ref\/heads\/main: 200 in 90ms/);
  assert.match(text, /GitHub PATCH \/repos\/acme\/time\/git\/refs\/heads\/main: 200 in 180ms/);
  assert.match(text, /Save stopped timer: synced in 1\.3s/);
});

test('queue diagnostics stay hidden unless enabled in Advanced settings', () => {
  const pending = { configured: true, active: null, pendingWrites: [{ id: 'queued', status: 'pending', operation: 'completeTimer' }], pendingCount: 1 };
  const harness = dailyPanelHarness({ state: pending });
  assert.equal(harness.renderMenu({ compact: true }).querySelector('.queue-diagnostics'), null);
  harness.set({ ...pending, showQueueDiagnostics: true }, []);
  assert.ok(harness.renderMenu({ compact: true }).querySelector('.queue-diagnostics'));
});

async function runningStatusHarness(initial) {
  const moduleSource = await readFile(new URL('../src/ui/running-status.js', import.meta.url), 'utf8');
  const container = new FakeNode('div'), events = new Map(), timers = new Map(), calls = [], confirmations = [], nextReads = [];
  let now = new Date(2026, 8, 5, 14).getTime(), state = initial, stopError = null, confirmed = true, readError = null;
  const document = {
    hidden: false, createElement: tag => new FakeNode(tag), getElementById: () => null,
    addEventListener: (type, fn) => events.set(type, fn), removeEventListener: type => events.delete(type),
  };
  const context = vm.createContext({
    document, formatClockDuration, normalizeTaskUrl, localDateParts, entryDateValue,
    Date: class extends Date { static now() { return now; } },
    setInterval: (fn, delay) => { timers.set(delay, fn); return delay; }, clearInterval: id => timers.delete(id),
    confirm: text => { confirmations.push(text); return confirmed; },
  });
  vm.runInContext(trackingCardSource, context);
  vm.runInContext(moduleSource.replace(/^import .*;\n/gm, '').replace('export function mountRunningStatus', 'function mountRunningStatus'), context);
  const send = async message => {
    calls.push({ ...message });
    if (message.type === 'GET_PAGE_STATE') {
      if (nextReads.length) return nextReads.shift();
      if (readError) throw readError;
      return state;
    }
    if (message.type === 'STOP') {
      if (stopError) throw stopError;
      state = { ...state, active: null }; return { pending: true };
    }
    throw new Error(`Unexpected message ${message.type}`);
  };
  const destroy = context.mountRunningStatus(container, { send });
  const settle = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
  await settle();
  return {
    container, document, events, timers, calls, confirmations, destroy, settle,
    find: className => container.walk().find(node => node.className === className),
    setState: value => { state = value; }, advance: ms => { now += ms; },
    failStop: () => { stopError = new Error('Stop rejected'); },
    failRead: value => { readError = value ? new Error('Worker restarting') : null; },
    cancelConfirmation: () => { confirmed = false; },
    holdNextRead: () => {
      let resolve;
      nextReads.push(new Promise(done => { resolve = done; }));
      return resolve;
    },
  };
}

function runningStatusState(hours = 1) {
  const now = new Date(2026, 8, 5, 14);
  return { configured: true, todayTrackedMs: 7_200_000, active: {
    taskUrl: 'https://github.com/acme/app/issues/7', taskTitle: '<img> Fix tracking',
    startedAt: new Date(now.getTime() - hours * 3_600_000).toISOString(), entryDate: '2026-09-05',
  } };
}

test('shared running status renders idle totals and unknown summaries without inventing zero', async () => {
  const h = await runningStatusHarness({ configured: true, active: null, todayTrackedMs: 7_200_000 });
  assert.equal(h.find('running-status-idle').textContent, 'Not tracking · Today 2h 0m');
  assert.equal(h.find('running-status-stop').hidden, true);
  h.setState({ configured: true, active: null, todayTrackedMs: null });
  await h.events.get('visibilitychange')(); await h.settle();
  assert.equal(h.find('running-status-idle').textContent, 'Not tracking · Today …');
  h.destroy(); assert.equal(h.timers.size, 0); assert.equal(h.events.size, 0);
});

test('shared running status ticks without replacing controls and rereads after Stop', async () => {
  const h = await runningStatusHarness(runningStatusState());
  const link = h.find('running-status-task'), stop = h.find('running-status-stop');
  assert.equal(h.container.classList.contains('is-active'), true);
  assert.equal(h.find('running-status-live').textContent, 'Tracking now');
  assert.equal(h.find('running-status-live').hidden, false);
  assert.equal(h.find('running-status-metrics').children.length, 2);
  assert.equal(link.textContent, '<img> Fix tracking'); assert.equal(link.children.length, 0);
  assert.equal(link.href, 'https://github.com/acme/app/issues/7');
  assert.equal(link.rel, 'noreferrer'); assert.equal(stop.textContent, 'Stop and save');
  assert.equal(h.find('running-status-elapsed').textContent, '1h 0m');
  h.advance(1_000); h.timers.get(1_000)();
  assert.equal(h.find('running-status-elapsed').textContent, '1h 0m');
  assert.equal(h.find('running-status-stop'), stop);
  await stop.onclick(); await h.settle();
  const stopIndex = h.calls.findIndex(call => call.type === 'STOP');
  assert.deepEqual(h.calls[stopIndex], { type: 'STOP' });
  assert.ok(h.calls.slice(stopIndex + 1).some(call => call.type === 'GET_PAGE_STATE'));
  assert.equal(h.find('running-status-idle').hidden, false); assert.equal(stop.hidden, true);
  assert.equal(h.container.classList.contains('is-active'), false);
  assert.equal(h.find('running-status-live').hidden, true);
  h.destroy();
});

test('shared running status confirms only above twelve hours and preserves a rejected Stop', async () => {
  const h = await runningStatusHarness(runningStatusState(13)); h.cancelConfirmation();
  await h.find('running-status-stop').onclick();
  assert.deepEqual(h.confirmations, ['This entry is 13 hours long. Save anyway?']);
  assert.equal(h.calls.some(call => call.type === 'STOP'), false);
  h.setState(runningStatusState(12)); await h.events.get('visibilitychange')(); await h.settle();
  h.failStop(); await h.find('running-status-stop').onclick(); await h.settle();
  assert.equal(h.confirmations.length, 1);
  assert.equal(h.find('running-status-stop').hidden, false);
  assert.equal(h.find('running-status-stop').disabled, false);
  assert.match(h.find('running-status-error').textContent, /Stop rejected/);
  h.destroy();
});

test('shared running status recovers fresh state after a worker restart and rejects unsafe task links', async () => {
  const h = await runningStatusHarness(runningStatusState());
  h.failRead(true); await h.events.get('visibilitychange')(); await h.settle();
  assert.match(h.find('running-status-error').textContent, /Worker restarting/);
  h.failRead(false); h.setState({ configured: true, active: null, todayTrackedMs: 0 });
  await h.events.get('visibilitychange')(); await h.settle();
  assert.equal(h.find('running-status-idle').textContent, 'Not tracking · Today 0m');
  assert.equal(h.find('running-status-error').hidden, true);
  h.setState({ ...runningStatusState(), active: { ...runningStatusState().active, taskUrl: 'javascript:alert(1)' } });
  await h.events.get('visibilitychange')(); await h.settle();
  assert.equal(h.find('running-status-task').getAttribute('href'), null);
  h.destroy();
});

test('shared running status ignores late reads and accepts only one concurrent Stop', async () => {
  const h = await runningStatusHarness(runningStatusState());
  const releaseRead = h.holdNextRead();
  const staleRead = h.events.get('visibilitychange')();
  h.setState({ configured: true, active: null, todayTrackedMs: 0 });
  await h.events.get('visibilitychange')();
  releaseRead(runningStatusState()); await staleRead;
  assert.equal(h.find('running-status-idle').hidden, false);
  h.setState(runningStatusState()); await h.events.get('visibilitychange')();
  const releaseStopRead = h.holdNextRead();
  const stop = h.find('running-status-stop'), stopping = stop.onclick();
  assert.equal(stop.disabled, true);
  await stop.onclick(); releaseStopRead(runningStatusState()); await stopping;
  assert.equal(h.calls.filter(call => call.type === 'STOP').length, 1);
  h.destroy();
});

test('shared running status updates Today only for a timer assigned to today', async () => {
  const h = await runningStatusHarness(runningStatusState());
  h.advance(60_000); h.timers.get(1_000)();
  assert.equal(h.find('running-status-today').textContent, 'Today 2h 1m');
  h.setState({ ...runningStatusState(), active: { ...runningStatusState().active, entryDate: '2026-09-04' } });
  await h.events.get('visibilitychange')(); h.advance(60_000); h.timers.get(1_000)();
  assert.equal(h.find('running-status-today').textContent, 'Today 2h 0m');
  const reads = h.calls.length;
  h.document.hidden = true; h.timers.get(5_000)(); assert.equal(h.calls.length, reads);
  h.document.hidden = false; h.setState({ configured: true, active: null, todayTrackedMs: 0 });
  h.timers.get(5_000)(); await h.settle();
  assert.equal(h.find('running-status-idle').hidden, false);
  h.destroy();
});

function activityEntry(id, date, hour = '10', taskUrl = `https://example.com/${id}`) {
  return { id, taskUrl, taskTitle: `Task ${id}`, entryDate: date, timezone: 'UTC',
    startedAt: `${date}T${hour}:00:00+00:00`, endedAt: `${date}T${hour}:30:00+00:00`, durationSeconds: 1800,
    description: '', _path: `times/${date.slice(0, 7)}/alice.jsonl`, _sha: 'original', _index: Number(id) || 0 };
}

function activityHarness(records = [], respond = null) {
  return dailyPanelHarness({ records, respond: respond || ((message, callback) => callback({ ok: true, data: message.type === 'SEARCH_ACTIVITY'
    ? { configured: true, recent: records } : { configured: true, active: null, pendingCount: 0, pendingWrites: [] } })), now: new Date('2026-09-05T12:00:00').getTime(),
    pageUrl: 'chrome-extension://clockoli/src/times/times.html',
    state: { configured: true, active: null, pendingCount: 0, pendingWrites: [] } });
}

test('Activity List starts a row task, switches from another running task, and stops only the matching task', async () => {
  const first = activityEntry('1', '2026-09-05', '08');
  const second = activityEntry('2', '2026-09-05', '09');
  let active = { id: 'other', taskUrl: 'https://example.com/elsewhere', startedAt: '2026-09-05T11:00:00Z' };
  const h = dailyPanelHarness({ records: [first, second], now: Date.parse('2026-09-05T12:00:00Z'),
    pageUrl: 'chrome-extension://clockoli/src/times/times.html',
    state: { configured: true, active, pendingWrites: [] },
    respond(message, callback) {
      if (message.type === 'SWITCH_TASK') {
        active = { id: 'running', taskUrl: message.taskUrl, startedAt: '2026-09-05T12:00:00Z' };
        callback({ ok: true, data: { active, pending: true } });
      } else if (message.type === 'STOP') {
        active = null;
        callback({ ok: true, data: { entry: { id: 'running', taskUrl: second.taskUrl, startedAt: '2026-09-05T12:00:00Z', endedAt: '2026-09-05T12:01:00Z', durationSeconds: 60 }, pending: true } });
      } else callback({ ok: true, data: { configured: true, active, pendingWrites: [] } });
    },
  });
  let root = h.renderActivity();
  const start = root.querySelectorAll('.entry-track').find(node => node.getAttribute('aria-label') === 'Start tracking Task 2');
  assert.equal(start.getAttribute('aria-label'), 'Start tracking Task 2');
  await start.onclick({ isTrusted: true });
  assert.deepEqual(h.messages.filter(message => message.type === 'SWITCH_TASK').map(message => message.taskUrl), [second.taskUrl]);
  root = h.renderActivity();
  assert.equal(root.querySelectorAll('.entry-stop').length, 1);
  assert.equal(root.querySelectorAll('.entry-track').length, 1);
  const stop = root.querySelector('.entry-stop');
  assert.equal(stop.getAttribute('aria-label'), 'Stop tracking Task 2');
  await start.onclick({ isTrusted: true });
  assert.equal(h.messages.filter(message => message.type === 'STOP').length, 0, 'stale Start cannot stop the new timer');
  await stop.onclick({ isTrusted: true });
  assert.equal(h.messages.filter(message => message.type === 'STOP').length, 1);
  await stop.onclick({ isTrusted: true });
  assert.equal(h.messages.filter(message => message.type === 'SWITCH_TASK').length, 1, 'stale Stop cannot restart the task');
  root = h.renderActivity();
  assert.equal(root.querySelectorAll('.entry-stop').length, 0);
});

test('Activity List can restart a validated imported task identity through the timeline switch policy', async () => {
  const entry = activityEntry('1', '2026-09-05', '08', 'owner/project/imported-task');
  const h = activityHarness([entry], (message, callback) => callback({ ok: true, data: {
    active: { id: 'running', taskUrl: entry.taskUrl, startedAt: '2026-09-05T12:00:00Z' }, pendingWrites: [], configured: true,
  } }));
  await h.renderActivity().querySelector('.entry-track').onclick({ isTrusted: true });
  assert.equal(h.messages.find(message => message.type === 'SWITCH_TASK')?.timelineTask, true);
  assert.equal(h.messages.find(message => message.type === 'SWITCH_TASK')?.taskUrl, entry.taskUrl);
});

test('Activity List does not offer tracking for an invalid identity or a pending row', () => {
  const invalid = activityEntry('1', '2026-09-05', '08', 'not a task URL');
  const pending = { ...activityEntry('2', '2026-09-05', '09'), _pending: true };
  const root = activityHarness([invalid, pending]).renderActivity();
  assert.equal(root.querySelectorAll('.entry-track').length, 0);
  assert.equal(root.querySelectorAll('.entry-stop').length, 0);
});

test('Activity groups nonconsecutive tasks by local record date with day totals and per-record identity', () => {
  const entries = [activityEntry('1', '2026-09-05', '08'), activityEntry('2', '2026-09-05', '09'),
    activityEntry('3', '2026-09-05', '10', 'https://example.com/1'), activityEntry('4', '2026-09-04'), activityEntry('5', '2026-09-02')];
  const h = activityHarness(entries), root = h.renderActivity();
  const groups = root.querySelectorAll('.entry');
  assert.equal(groups.length, 3);
  assert.deepEqual(groups.map(group => group.querySelector('h2').textContent), ['Today', 'Yesterday', 'Wednesday, 2 September']);
  assert.deepEqual(groups.map(group => group.querySelector('.entry-day-total').textContent), ['1h 30m', '30m', '30m']);
  assert.deepEqual(groups.map(group => group.querySelectorAll('.entry-record').length), [3, 1, 1]);
  for (const record of root.querySelectorAll('.entry-record')) {
    assert.ok(record.querySelector('.task-title').href);
    assert.equal(record.querySelector('.task-url').textContent, record.querySelector('.task-title').href);
    assert.equal(record.querySelectorAll('.inline-time-value').length, 4);
  }
});

for (const origin of ['webkit-extension://clockoli/', 'safari-web-extension://clockoli/', 'moz-extension://clockoli/']) {
  test(`Activity renders on the extension's own ${new URL(origin).protocol} page`, () => {
    const h = dailyPanelHarness({ records: [activityEntry('1', '2026-09-05', '08')], now: new Date('2026-09-05T12:00:00').getTime(),
      pageUrl: `${origin}src/times/times.html`, runtimeGetURL: path => `${origin}${path}`,
      state: { configured: true, active: null, pendingCount: 0, pendingWrites: [] } });
    assert.equal(h.renderActivity().querySelectorAll('.entry-record').length, 1);
  });
}

test('Activity displays and searches imported identities without creating a task link', async () => {
  const identity = 'manticoresoftware/NexusRepo/Fixed-last-block-encoding';
  const h = activityHarness([activityEntry('1', '2026-09-05', '08', identity)]);
  const root = h.renderActivity();
  const row = root.querySelector('.entry-record');
  assert.equal(row.querySelector('.task-url').textContent, identity);
  assert.equal(row.querySelector('.task-title').tag, 'span');
  assert.equal(row.querySelectorAll('a').some(link => link.href === identity), false);
  const filter = root.querySelector('.times-filter').querySelector('input');
  filter.value = 'fixed-last-block'; filter.oninput({});
  await [...h.timeouts.values()].find(item => item.delay === 250).callback();
  assert.equal(root.querySelectorAll('.entry-record').length, 1);
  filter.value = 'absent'; filter.oninput({});
  assert.equal(root.querySelectorAll('.entry-record').length, 0);
});

test('Activity edits imported time and metadata without submitting a non-URL as a new task', async () => {
  const identity = 'manticoresoftware/NexusRepo/Fixed-last-block-encoding';
  for (const edit of ['description', 'title', 'time']) {
    const h = activityHarness([activityEntry('1', '2026-09-05', '08', identity)]);
    let root = h.renderActivity();
    await root.querySelector('.entry-edit').onclick({ isTrusted: true });
    root = h.renderActivity();
    if (edit === 'description') {
      const description = root.querySelector('.inline-description');
      description.value = 'Reviewed import'; description.oninput({});
    } else if (edit === 'title') {
      const title = root.querySelector('.inline-task-title');
      title.value = 'New title'; title.oninput({});
    } else {
      const minute = root.querySelectorAll('.inline-time-value')[3];
      minute.value = '45'; minute.oninput({});
    }
    await root.querySelector('.inline-save').onclick({ isTrusted: true });
    const request = h.messages.find(message => message.type === 'QUEUE_ENTRIES_EDIT');
    assert.equal(request.payload.entries[0].original.taskUrl, identity);
    assert.equal(request.payload.entries[0].edits[edit === 'description' ? 'description' : edit === 'title' ? 'taskTitle' : 'endedAt'],
      edit === 'description' ? 'Reviewed import' : edit === 'title' ? 'New title' : '2026-09-05T08:45:00.000Z');
    assert.equal('taskUrl' in request.payload.entries[0].edits, false);
  }
});

test('imported identities can be restarted from the GitHub calendar with record provenance', async () => {
  const identity = 'manticoresoftware/NexusRepo/Fixed-last-block-encoding';
  const entry = activityEntry('1', '2026-09-05', '08', identity);
  entry.destinationId = 'github:1';
  // activityEntry times are UTC, so `now` must be a UTC instant too; a local
  // noon at UTC+4 or further east is not after the entry's start, so it is dropped.
  const now = Date.parse('2026-09-05T12:00:00Z');
  const h = dailyPanelHarness({ records: [entry], now,
    state: { configured: true, active: null, pendingWrites: [] } });
  assert.equal(h.timelineItems(0, now)[0].isStartDisabled, false);
  assert.equal(await h.restartTimelineEntry(entry), true);
  const request = h.messages.find(message => message.type === 'SWITCH_TASK');
  assert.equal(request.taskUrl, identity);
  assert.deepEqual(structuredClone(request.sourceEntry), { id: entry.id, destinationId: entry.destinationId, entryDate: entry.entryDate });
});

test('Activity only permits replacing an imported identity with a valid task URL', async () => {
  const identity = 'manticoresoftware/NexusRepo/Fixed-last-block-encoding';
  const h = activityHarness([activityEntry('1', '2026-09-05', '08', identity)]);
  let root = h.renderActivity();
  await root.querySelector('.entry-edit').onclick({ isTrusted: true });
  root = h.renderActivity();
  const url = root.querySelector('.inline-task-url');
  url.value = 'other/project/another-task'; url.oninput({});
  await root.querySelector('.inline-save').onclick({ isTrusted: true });
  assert.equal(h.messages.some(message => message.type === 'QUEUE_ENTRIES_EDIT'), false);
  url.value = 'https://example.com/task'; url.oninput({});
  await root.querySelector('.inline-save').onclick({ isTrusted: true });
  assert.equal(h.messages.find(message => message.type === 'QUEUE_ENTRIES_EDIT').payload.entries[0].edits.taskUrl, 'https://example.com/task');
});

test('Activity loads the existing colour resolver before the renderer and preserves one running strip', async () => {
  const html = await readFile(new URL('../src/times/times.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('../content/task-timeline-component.js') >= 0);
  assert.ok(html.indexOf('../content/task-timeline-component.js') < html.indexOf('../content/github.js'));
  assert.equal(html.match(/id="activity-running-status"/g).length, 1);
  const h = activityHarness([activityEntry('1', '2026-09-05', '08', 'https://example.com/today'), activityEntry('2', '2026-09-04', '09', 'https://example.com/today')]);
  const titles = h.renderActivity().querySelectorAll('.task-title');
  assert.deepEqual(titles.map(title => title.style.color), ['#123456', '#123456']);
});

test('Activity distinguishes first use from an empty period using history and offers one empty-state action', async () => {
  for (const hasHistory of [false, true]) {
    const h = activityHarness([], (message, callback) => callback({ ok: true, data: {
      configured: true, recent: hasHistory && message.payload?.startDate === '0001-01-01' ? [activityEntry('old', '2025-01-01')] : [],
      pendingCount: 0, pendingWrites: [], remoteWriteConfirmed: false,
    } }));
    await h.loadSelectedTimes();
    const root = h.renderActivity(), empty = root.querySelector('.activity-empty');
    assert.ok(empty);
    assert.equal(empty.querySelector('p').textContent, hasHistory ? 'No time in this range.' : 'Nothing tracked yet. Open a task page and click Clockoli to start.');
    assert.equal(empty.querySelectorAll('button').length, hasHistory ? 1 : 0);
    if (hasHistory) {
      await empty.querySelector('button').onclick({ isTrusted: true });
      assert.equal(root.querySelector('.bulk-time').open, true);
      assert.equal(h.document.activeElement, root.querySelector('.bulk-time-input'));
    }
  }
});

test('Activity no-match action clears the filter and restores records', async () => {
  const h = activityHarness([activityEntry('1', '2026-09-05')]), root = h.renderActivity();
  const filter = root.querySelector('.times-filter').querySelector('input');
  filter.value = 'absent'; filter.oninput({});
  await [...h.timeouts.values()].find(item => item.delay === 250).callback();
  const empty = root.querySelector('.activity-empty');
  assert.equal(empty.querySelector('p').textContent, 'No entries match across all weeks.');
  assert.deepEqual(empty.querySelectorAll('button').map(node => node.textContent), ['Clear filter']);
  await empty.querySelector('button').onclick({ isTrusted: true });
  assert.equal(filter.value, '');
  assert.equal(root.querySelectorAll('.entry-record').length, 1);
});

test('Activity retains independent incomplete and metadata drafts through focus, Save and Cancel', async () => {
  const h = activityHarness([activityEntry('1', '2026-09-05', '08'), activityEntry('2', '2026-09-05', '10'), activityEntry('3', '2026-09-04')]);
  let root = h.renderActivity(), records = root.querySelectorAll('.entry-record');
  let values = records[0].querySelectorAll('.inline-time-value');
  values[3].onfocus({}); values[3].value = ''; values[3].oninput({});
  values = records[1].querySelectorAll('.inline-time-value');
  values[3].onfocus({}); values[3].value = '31'; values[3].oninput({});
  await records[2].querySelector('.entry-description-editable').onclick({ isTrusted: true });
  root = h.renderActivity(); records = root.querySelectorAll('.entry-record');
  const description = records[2].querySelector('.inline-description'); description.value = 'Keep this draft'; description.oninput({});
  assert.equal(records[0].querySelectorAll('.inline-time-value')[3].value, '');
  assert.equal(root.querySelectorAll('.inline-unsaved').filter(node => !node.hidden).length, 3);
  assert.equal(h.messages.some(message => message.type === 'QUEUE_ENTRIES_EDIT'), false);
  await records[0].querySelector('.inline-save').onclick({ isTrusted: true });
  assert.equal(h.messages.some(message => message.type === 'QUEUE_ENTRIES_EDIT'), false, 'explicit Save also rejects incomplete input');
  root = h.renderActivity(); records = root.querySelectorAll('.entry-record');
  await records[1].querySelector('.inline-save').onclick({ isTrusted: true });
  const edits = h.messages.find(message => message.type === 'QUEUE_ENTRIES_EDIT').payload.entries;
  assert.equal(edits.length, 1); assert.equal(edits[0].original.id, '1'); assert.equal(edits[0].originalSha, 'original');
  root = h.renderActivity(); records = root.querySelectorAll('.entry-record');
  await records[0].querySelector('.inline-cancel').onclick({ isTrusted: true });
  root = h.renderActivity();
  assert.equal(root.querySelector('.inline-description').value, 'Keep this draft');
  assert.equal(root.querySelectorAll('.inline-unsaved').filter(node => !node.hidden).length, 1);
});

test('Activity shows a green save check inside URL, title, and description fields', async () => {
  for (const [fieldClass, saveLabel, value, expected] of [
    ['inline-task-url', 'Save task URL', 'https://example.com/changed', ['taskUrl', 'https://example.com/changed']],
    ['inline-task-title', 'Save task title', 'Changed title', ['taskTitle', 'Changed title']],
    ['inline-description', 'Save description', 'Changed description', ['description', 'Changed description']],
  ]) {
    const h = activityHarness([activityEntry('1', '2026-09-05', '08')]);
    let root = h.renderActivity();
    await root.querySelector('.entry-description-editable').onclick({ isTrusted: true });
    root = h.renderActivity();
    const checks = root.querySelectorAll('.save-check');
    assert.match(source, /\.save-check \{[^}]*right:4px[^}]*color:var\(--ck-success\)/);
    assert.deepEqual(checks.map(node => node.getAttribute('aria-label')), ['Save task URL', 'Save task title', 'Save description']);
    const input = root.querySelector(`.${fieldClass}`); input.value = value; input.oninput({});
    const check = checks.find(node => node.getAttribute('aria-label') === saveLabel);
    assert.equal(check.textContent, '✓');
    await check.onclick({ isTrusted: true });
    const edit = h.messages.find(message => message.type === 'QUEUE_ENTRIES_EDIT').payload.entries[0];
    assert.equal(edit.edits[expected[0]], expected[1]);
  }
});

test('Activity preserves newer grouped metadata through acceptance, duplicate click, rejection, and retry', async () => {
  const entry = activityEntry('1', '2026-09-05', '08');
  const callbacks = [];
  const state = { configured: true, active: null, pendingCount: 0, pendingWrites: [] };
  const harness = activityHarness([entry], (message, callback) => {
    if (message.type === 'QUEUE_ENTRIES_EDIT') { callbacks.push(callback); return; }
    callback({ ok: true, data: state });
  });
  let root = harness.renderActivity();
  await root.querySelector('.entry-description-editable').onclick({ isTrusted: true });
  root = harness.renderActivity();
  const enter = ([url, title, description]) => {
    for (const [selector, value] of [['.inline-task-url', url], ['.inline-task-title', title], ['.inline-description', description]]) {
      const input = root.querySelector(selector); input.value = value; input.oninput({});
    }
  };
  const check = label => root.querySelectorAll('.save-check').find(node => node.getAttribute('aria-label') === label);
  enter(['https://example.com/first', 'First title', 'First description']);
  const first = check('Save description').onclick({ isTrusted: true });
  assert.equal(callbacks.length, 1);
  enter(['https://example.com/second', 'Second title', 'Second description']);
  root = harness.renderActivity();
  assert.deepEqual(['.inline-task-url', '.inline-task-title', '.inline-description'].map(selector => root.querySelector(selector).value),
    ['https://example.com/second', 'Second title', 'Second description']);
  assert.ok(root.querySelectorAll('.save-check').every(node => node.disabled), 'rerendered checks reflect the in-flight group save');
  assert.equal(root.querySelector('.inline-save').disabled, true, 'rerendered Save time reflects the in-flight group save');
  const duplicate = check('Save task URL').onclick({ isTrusted: true });
  assert.equal(callbacks.length, 1, 'another field check after rerender joins the in-flight group save');
  callbacks.shift()({ ok: true, data: { operationId: 'first' } });
  await Promise.all([first, duplicate]);
  assert.deepEqual(['.inline-task-url', '.inline-task-title', '.inline-description'].map(selector => root.querySelector(selector).value),
    ['https://example.com/second', 'Second title', 'Second description']);
  assert.ok(root.querySelectorAll('.save-check').every(node => !node.disabled), 'completion rerender releases every group check');
  assert.equal(root.querySelector('.inline-save').disabled, false, 'completion rerender releases Save time');

  const rejected = check('Save task title').onclick({ isTrusted: true });
  assert.equal(callbacks.length, 1);
  let edit = harness.messages.filter(message => message.type === 'QUEUE_ENTRIES_EDIT').at(-1).payload.entries[0].edits;
  assert.deepEqual([edit.taskUrl, edit.taskTitle, edit.description], ['https://example.com/second', 'Second title', 'Second description']);
  callbacks.shift()({ ok: false, error: { message: 'Queue rejected' } });
  await rejected;
  root = harness.renderActivity();
  assert.deepEqual(['.inline-task-url', '.inline-task-title', '.inline-description'].map(selector => root.querySelector(selector).value),
    ['https://example.com/second', 'Second title', 'Second description']);
  assert.ok(root.querySelectorAll('.save-check').every(node => !node.disabled));

  const retry = check('Save description').onclick({ isTrusted: true });
  assert.equal(callbacks.length, 1);
  callbacks.shift()({ ok: true, data: { operationId: 'second' } });
  await retry;
  root = harness.renderActivity();
  assert.equal(root.querySelector('.inline-metadata-editor'), null);
});

test('Activity pins draft originals across a refresh and keeps a linked repair atomic after focus changes', async () => {
  const entries = [activityEntry('1', '2026-09-05', '08'), { ...activityEntry('2', '2026-09-05', '08'), startedAt: '2026-09-05T08:30:00+00:00', endedAt: '2026-09-05T09:00:00+00:00' }];
  const h = activityHarness(entries);
  let root = h.renderActivity(), records = root.querySelectorAll('.entry-record');
  let values = records[1].querySelectorAll('.inline-time-value');
  values[3].onfocus({}); values[3].value = '35'; values[3].oninput({});
  values = records[0].querySelectorAll('.inline-time-value'); values[1].onfocus({});
  assert.equal(values[1].value, '35');
  h.set({ configured: true, active: null, pendingCount: 0, pendingWrites: [] }, entries.map(entry => ({ ...entry, _sha: 'refreshed' })));
  root = h.renderActivity(); records = root.querySelectorAll('.entry-record');
  assert.equal(records[0].querySelectorAll('.inline-time-value')[1].value, '35');
  assert.equal(root.querySelectorAll('.inline-unsaved').filter(node => !node.hidden).length, 2);
  await records[0].querySelector('.inline-save').onclick({ isTrusted: true });
  const edits = h.messages.find(message => message.type === 'QUEUE_ENTRIES_EDIT').payload.entries;
  assert.equal(edits.length, 2);
  assert.ok(edits.every(edit => edit.originalSha === 'original'));
  assert.equal(new Date(edits.find(edit => edit.original.id === '1').edits.endedAt).toISOString(), '2026-09-05T08:35:00.000Z');
  assert.equal(new Date(edits.find(edit => edit.original.id === '2').edits.startedAt).toISOString(), '2026-09-05T08:35:00.000Z');
});

test('Activity does not claim first use when the history lookup fails or tracking is pending', async () => {
  for (const pendingCount of [0, 1]) {
    const h = activityHarness([], (message, callback) => {
      if (message.payload?.startDate === '0001-01-01') callback({ ok: false, error: { message: 'History unavailable' } });
      else callback({ ok: true, data: { configured: true, recent: [], pendingCount, pendingWrites: [] } });
    });
    await h.loadSelectedTimes();
    assert.equal(h.renderActivity().querySelector('.activity-empty').querySelector('p').textContent, 'No time in this range.');
  }
});
