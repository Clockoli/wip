import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const source = readFileSync(new URL('../src/clockoli-adapter.js', import.meta.url), 'utf8');
const vendor = readFileSync(new URL('../vendor/timeline-component.js', import.meta.url), 'utf8');

test('vendored TaskTimeline is the reviewed Clockoli-patched artifact', () => {
  assert.equal(createHash('sha256').update(vendor).digest('hex'), '02f8847c72054ca00fca8036c715e6e7799e55ac9afe33497ae85888ff68d22d');
  assert.match(vendor, /let t = this\._floorDay\(this\.domainStart\)/);
  assert.match(vendor, /trailingGutterRatio/);
  assert.match(vendor, /\.calendar-task:hover \{[\s\S]*?z-index: 6/);
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

test('adapter keeps atomic Clockoli switching and action permissions', () => {
  assert.match(source, /event\?\.source === 'replaced'/);
  assert.match(source, /return true;/);
  assert.match(source, /permissionsFor/);
  assert.match(source, /stopImmediatePropagation/);
  assert.match(source, /props\.onStart\(item, event\)/);
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
