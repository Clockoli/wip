import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { timeValue, parseTime, localTimestamp } from '../src/ui/local-time.js';
import { mountAddTime } from '../src/ui/add-time.js';

test('precise local time parses and roundtrips milliseconds without changing the minute-only default', () => {
  const date = new Date(2026, 9, 18, 23, 4, 5, 6);
  assert.equal(timeValue(date), '23:04');
  assert.equal(timeValue(date, true), '23:04:05.006');
  assert.equal(parseTime('2304'), '23:04');
  assert.equal(parseTime('23:04:05.006', true), '23:04:05.006');
  for (const bad of ['24:00:00.000', '23:60:00.000', '23:04:60.000', '23:04:05.1000', '23:04', '2304', '23:04:05.6']) {
    assert.equal(parseTime(bad, true), null, bad);
  }
  assert.equal(localTimestamp('2026-10-18', '23:04:05.006')?.getTime(), date.getTime());
  assert.equal(localTimestamp('2026-02-30', '23:04:05.006'), null);
});

test('precise local time rejects nonexistent DST wall times in browser timezone', () => {
  const output = execFileSync(process.execPath, ['--input-type=module', '-e',
    "import { localTimestamp } from './src/ui/local-time.js'; console.log(localTimestamp('2026-03-08', '02:30:00.001') === null, localTimestamp('2026-11-01', '01:30:00.001')?.getMilliseconds())"],
  { cwd: new URL('..', import.meta.url), env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8' });
  assert.equal(output.trim(), 'true 1');
});

class Element {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.listeners = {}; this.hidden = false; this.value = ''; this.dataset = {}; this.style = {}; this.attributes = {}; this.open = false; }
  append(...children) { for (const child of children) { this.children.push(child); child.parentElement = this; } }
  after(...siblings) {
    for (const sibling of siblings) sibling.remove();
    const index = this.parentElement.children.indexOf(this);
    this.parentElement.children.splice(index + 1, 0, ...siblings);
    for (const sibling of siblings) sibling.parentElement = this.parentElement;
  }
  remove() {
    const index = this.parentElement?.children.indexOf(this) ?? -1;
    if (index >= 0) this.parentElement.children.splice(index, 1);
    this.parentElement = null;
  }
  setAttribute(key, value) { this.attributes[key] = value; }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  get childElementCount() { return this.children.length; }
  addEventListener(type, handler) { (this.listeners[type] ??= []).push(handler); }
  fire(type) { for (const handler of this.listeners[type] ?? []) handler({ key: type, preventDefault() {}, stopPropagation() {} }); }
  insertAdjacentElement(_position, child) { this.parentElement.append(child); }
  showModal() { this.open = true; }
  close() { this.open = false; this.fire('close'); }
  focus() {}
  select() {}
}

function setup() {
  const previous = { document: globalThis.document, ClockoliTaskSearch: globalThis.ClockoliTaskSearch };
  const body = new Element();
  globalThis.document = { body, createElement: tag => new Element(tag), createTextNode: text => Object.assign(new Element('#text'), { textContent: text }) };
  globalThis.ClockoliTaskSearch = { mount: () => ({ query: '', matches: () => [] }) };
  const button = new Element('button'); body.append(button);
  const dialog = mountAddTime(button, { send: async () => { throw Error('unexpected send'); }, container: body });
  const walk = node => [node, ...node.children.flatMap(walk)];
  const byId = id => walk(dialog).find(child => child.id === id);
  const start = byId('add-time-start'), end = byId('add-time-end'), date = byId('add-time-date');
  const save = dialog.children.at(-1).children.at(-1);
  const restore = () => { globalThis.document = previous.document; globalThis.ClockoliTaskSearch = previous.ClockoliTaskSearch; };
  return { dialog, start, end, date, save, restore };
}

const entry = { taskUrl: 'https://example.com/task', taskTitle: 'Task', description: 'Keep this',
  startedAt: new Date(2026, 9, 18, 10, 15, 22, 123).toISOString(),
  endedAt: new Date(2026, 9, 18, 11, 20, 33, 456).toISOString(), _overlapBoundary: 'end' };

test('conflict-only editor shows minutes and saves the end at :00 while preserving the exact start', async () => {
  const ui = setup();
  try {
    let payload;
    ui.dialog.openEdit(entry, value => { payload = value; });
    assert.equal(ui.date.disabled, true);
    assert.equal(ui.start.disabled, true);
    assert.equal(ui.end.disabled, false);
    assert.equal(ui.date.parentElement.hidden, true);
    assert.equal(ui.start.parentElement.hidden, true);
    assert.equal(ui.end.parentElement.hidden, false);
    assert.equal(ui.end.parentElement.children[0].textContent, 'End');
    assert.equal(ui.start.value, '10:15');
    assert.equal(ui.end.value, '11:20');
    assert.equal(ui.start.maxLength, 5);
    assert.equal(ui.dialog.children.find(node => node.id === 'add-time-task').hidden, true);
    assert.equal(ui.dialog.children.find(node => node.id === 'add-time-description').hidden, true);
    assert.doesNotMatch(ui.dialog.children.find(node => node.className === 'add-time-hint' && !node.hidden).textContent, /SS|mmm/i);
    ui.end.value = '11:19';
    await ui.save.listeners.click[0]();
    assert.equal(payload.startedAt, entry.startedAt);
    assert.equal(payload.endedAt, new Date(2026, 9, 18, 11, 19, 0, 0).toISOString());
  } finally { ui.restore(); }
});

test('start boundary edits use :01, preserve end ISO, and reset ordinary form', async () => {
  const ui = setup();
  try {
    let payload;
    ui.dialog.openEdit({ ...entry, _overlapBoundary: 'start' }, value => { payload = value; });
    assert.equal(ui.start.disabled, false);
    assert.equal(ui.end.disabled, true);
    assert.equal(ui.start.parentElement.hidden, false);
    assert.equal(ui.end.parentElement.hidden, true);
    assert.equal(ui.date.parentElement.hidden, true);
    ui.start.value = '10:15:22.12';
    await ui.save.listeners.click[0]();
    assert.equal(payload, undefined);
    assert.match(ui.dialog.children.find(node => node.className === 'add-time-error').textContent, /valid/i);
    ui.start.value = '10:14';
    await ui.save.listeners.click[0]();
    assert.equal(payload.startedAt, new Date(2026, 9, 18, 10, 14, 1, 0).toISOString());
    assert.equal(payload.endedAt, entry.endedAt);
    ui.dialog.openEdit(entry, () => {});
    await ui.save.listeners.click[0]();
    ui.dialog.openEdit({ ...entry, _overlapBoundary: undefined }, () => {});
    assert.equal(ui.start.disabled, false);
    assert.equal(ui.end.disabled, false);
    assert.equal(ui.date.disabled, false);
    assert.equal(ui.start.parentElement.hidden, false);
    assert.equal(ui.end.parentElement.hidden, false);
    assert.equal(ui.date.parentElement.hidden, false);
    assert.equal(ui.end.parentElement.children[0].textContent, 'End (optional)');
    assert.equal(ui.start.maxLength, 5);
    assert.equal(ui.start.value, '10:15');
  } finally { ui.restore(); }
});

test('overnight conflict end uses its own local date and ignores disabled fields', async () => {
  const ui = setup();
  try {
    const overnight = { ...entry, startedAt: new Date(2026, 9, 18, 23, 30, 1, 123).toISOString(),
      endedAt: new Date(2026, 9, 19, 0, 15, 2, 456).toISOString() };
    let payload;
    ui.dialog.openEdit(overnight, value => { payload = value; });
    ui.date.value = '2026-10-17';
    ui.start.value = '00:00';
    await ui.save.listeners.click[0]();
    assert.equal(payload.startedAt, overnight.startedAt);
    assert.equal(payload.endedAt, overnight.endedAt);
    ui.dialog.openEdit(overnight, value => { payload = value; });
    ui.end.value = '00:14';
    await ui.save.listeners.click[0]();
    assert.equal(payload.endedAt, new Date(2026, 9, 19, 0, 14, 0, 0).toISOString());
  } finally { ui.restore(); }
});

test('conflict-only range validates exact ordering and 24-hour limit', async () => {
  const ui = setup();
  try {
    const equal = { ...entry, startedAt: new Date(2026, 9, 18, 11, 20, 33, 455).toISOString() };
    let calls = 0;
    ui.dialog.openEdit(equal, () => { calls++; });
    ui.end.value = '11:19';
    await ui.save.listeners.click[0]();
    assert.match(ui.dialog.children.find(node => node.className === 'add-time-error').textContent, /after start/);
    assert.equal(calls, 0);
    const crossing = { ...entry, startedAt: new Date(2026, 9, 17, 11, 20, 33, 455).toISOString() };
    ui.dialog.openEdit(crossing, () => { calls++; });
    ui.end.value = '11:21';
    await ui.save.listeners.click[0]();
    assert.match(ui.dialog.children.find(node => node.className === 'add-time-error').textContent, /24 hours/);
    assert.equal(calls, 0);
  } finally { ui.restore(); }
});
