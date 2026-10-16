import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/clockoli-adapter.js', import.meta.url), 'utf8');
const vendor = readFileSync(new URL('../vendor/timeline-component.js', import.meta.url), 'utf8');

function calendarFaviconHarness(item) {
  class Node {
    constructor(tag) {
      this.tag = tag; this.children = []; this.attributes = new Map(); this.listeners = new Map(); this.className = '';
      this.style = { setProperty() {} };
      this.classList = { contains: name => this.className.split(' ').includes(name), add: name => { this.className += ` ${name}`; }, toggle() {} };
    }
    querySelector(selector) {
      return this.children.find(child => child.classList.contains(selector.slice(1)))
        ?? this.children.map(child => child.querySelector(selector)).find(Boolean) ?? null;
    }
    prepend(node) { this.children.unshift(node); }
    setAttribute(name, value) { this.attributes.set(name, value); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
  }
  const card = new Node('div'); card.className = 'calendar-task'; card.dataset = { taskKey: item.id };
  const name = new Node('div'); name.className = 'calendar-task-name'; card.children.push(name);
  const start = source.indexOf('    function styleTasks() {');
  const end = source.indexOf('    function renderActions()', start);
  assert.ok(start >= 0 && end > start);
  const decorate = vm.runInNewContext(`${source.slice(start, end)}; styleTasks`, {
    destroyed: false, savingKeys: new Set(), sourceItem: () => item, resolveColor: () => '#e76f51', URL,
    timeline: { shadow: { querySelectorAll: () => [card] } }, document: { createElement: tag => new Node(tag) },
  });
  return { decorate, name };
}

test('Calendar renders a projected monogram without producing a favicon URL', () => {
  const harness = calendarFaviconHarness({ id: 'monogram', url: 'https://www.example.com/work', faviconUrl: null });
  harness.decorate();
  const icon = harness.name.children[0];
  assert.ok(icon, 'the Calendar task needs a monogram');
  assert.equal(icon.tag, 'span');
  assert.equal(icon.textContent, 'E');
  assert.equal(icon.getAttribute('aria-hidden'), 'true');
  assert.equal(icon.src, undefined);
  harness.decorate();
  assert.equal(harness.name.children.length, 1);
});

test('Calendar preserves supported favicon images, including a failed image', () => {
  const faviconUrl = 'chrome-extension://clockoli/_favicon/?pageUrl=https%3A%2F%2Fexample.com%2Fwork&size=32';
  const harness = calendarFaviconHarness({ id: 'image', url: 'https://example.com/work', faviconUrl });
  harness.decorate();
  const icon = harness.name.children[0];
  assert.equal(icon.tag, 'img');
  assert.equal(icon.src, faviconUrl);
  assert.equal(icon.alt, '');
  icon.listeners.get('error')();
  harness.decorate();
  assert.equal(icon.hidden, true);
  assert.equal(harness.name.children.length, 1);
});

test('Calendar keeps unavailable resources and imported identities without favicons', () => {
  for (const item of [
    { id: 'unavailable', url: 'https://example.com/work', faviconUrl: '' },
    { id: 'imported', url: null, faviconUrl: '' },
  ]) {
    const harness = calendarFaviconHarness(item);
    harness.decorate();
    assert.equal(harness.name.children.length, 0);
  }
});

test('vendored TaskTimeline is the reviewed Clockoli-patched artifact', () => {
  assert.equal(createHash('sha256').update(vendor).digest('hex'), 'e051c1e8f04684dbb62d51c8fccc75281dfc67c8b4edd02a7d4f80b357f9a15f');
  assert.match(vendor, /let t = this\._floorDay\(this\.domainStart\)/);
  assert.match(vendor, /trailingGutterRatio/);
  assert.match(vendor, /\.calendar-task:hover \{[\s\S]*?z-index: 6/);
});

test('Timeline and Calendar double-clicks only select the task', () => {
  assert.match(vendor, /calendarCanvas\.addEventListener\('click'/);
  assert.match(vendor, /taskRow\.addEventListener\('click'/);
  assert.doesNotMatch(vendor, /addEventListener\('dblclick'/);
  assert.doesNotMatch(source, /addEventListener\('dblclick'/);
  assert.doesNotMatch(vendor, /source: 'double-click'/);
});

test('adapter exposes TaskTimeline through the Clockoli runtime API', () => {
  assert.match(vendor, /global\.TaskTimeline = TaskTimeline/);
  assert.match(source, /global\.ClockoliTaskTimeline = Object\.freeze/);
  assert.match(source, /createTimeline/);
  assert.match(source, /createColorResolver/);
});

test('adapter maps durable Clockoli state and preserves the old block styling contract', () => {
  assert.match(source, /running: true|running,/);
  assert.match(source, /timeline\.runningKey = running\[0\]\?\._key/);
  assert.match(source, /timeline\.pendingKeys = new Set/);
  assert.match(source, /height: 40px !important/);
  assert.match(source, /border-left: 3px solid var\(--clockoli-task-color/);
  assert.match(source, /background: color-mix\(in srgb, var\(--clockoli-task-color/);
});

test('pending timeline and calendar entries never display background saving feedback', () => {
  assert.match(source, /\.task\.pending, \.calendar-task\.pending \{ opacity: 1; \}/);
  assert.match(source, /\.task\.pending::after \{ display: none; \}/);
  assert.doesNotMatch(source, /clockoli-entry-saving|clockoli-compact-saving|clockoli-saving/);
  assert.doesNotMatch(source, /Saving…|aria-busy/);
  assert.match(source, /timeline\.pendingKeys = new Set/);
  assert.match(source, /!pending && !item\?\.isDeleteDisabled/);
});

test('Clockoli graphic Timeline edits use a five-minute grid while Calendar keeps its one-minute precision', () => {
  assert.match(source, /magnetStepsMinutes: \[5\]/);
  assert.match(source, /calendarMagnetStepMinutes: 1/);
  assert.match(vendor, /_calendarMagnetStepMs\(rawTime, state\)[\s\S]*?this\.options\.calendarMagnetStepMinutes/);
  assert.doesNotMatch(source, /magnetStepsMinutes: \[1 \/ 60\]/);
});

test('adapter keeps atomic Clockoli switching and action permissions', () => {
  assert.match(source, /event\?\.source === 'replaced'/);
  assert.match(source, /return true;/);
  assert.match(source, /permissionsFor/);
  assert.match(source, /stopImmediatePropagation/);
  assert.match(source, /props\.onStart\(item, event\)/);
});

test('completed current task keeps the static Stop and save action', () => {
  assert.match(source, /stop: \(running \|\| item\?\.isCurrentTask\) && !item\?\.isStopDisabled/);
  assert.match(source, /const mode = item\.isCurrentTask \? 'current'/);
  assert.match(source, /item\.isRunning \|\| item\.endedAt == null \|\| item\.isCurrentTask\) && typeof props\.onStop/);
  assert.match(source, /button\.textContent = 'Stop and save'/);
  assert.doesNotMatch(source, /formatClockDuration|updateActionClock|actionClock/);
});

test('weekly Calendar controls coexist with preserved viewport anchors and deferred gestures', () => {
  assert.match(source, /initialProps\.weeklyCalendar[\s\S]*?calendar-toolbar \{ display:none \}/);
  assert.match(source, /const domainStart = Math\.min\([\s\S]*?initialProps\.domainStart/);
  assert.match(source, /totalRange: initialProps\.totalRange \?\? initialProps\.view/);
  assert.match(source, /nextProps\.domainStart[\s\S]*?nextProps\.view\?\.end/);
  assert.match(source, /const anchorTime = previousMode === 'timeline'[\s\S]*?timeline\.xToTime/);
  assert.match(source, /timeline\._setScrollLeft\(timeline\.timeToX\(anchorTime\) - previousWidth \/ 2\)/);
  assert.match(source, /timeline\.editState \|\| timeline\.calendarEditState \|\| timeline\.dragState \|\| pendingEdits\.size/);
  assert.match(source, /global\.addEventListener\('pointerup', onGestureEnd\)/);
  assert.match(source, /global\.removeEventListener\('pointerup', onGestureEnd\)/);
});

test('adapter supports external Timeline and Calendar controls without applying Timeline scale to Calendar', () => {
  assert.match(source, /setViewMode\(mode\)/);
  assert.match(source, /getViewMode\(\)/);
  assert.match(source, /setCalendarDate/);
  assert.match(source, /shiftCalendar/);
  assert.match(source, /if \(timeline\.getViewMode\(\) === 'calendar'\)[\s\S]*?return;[\s\S]*?timeline\.setVisibleDays/);
  assert.match(source, /props = \{ \.\.\.props, view \}/);
  assert.match(source, /applyExternalView: Object\.hasOwn\(next, 'view'\)/);
});
